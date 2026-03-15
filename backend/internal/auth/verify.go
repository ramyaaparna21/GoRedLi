package auth

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"
	jwksTTL       = time.Hour
)

// GoogleClaims holds the verified claims from a Google ID token.
type GoogleClaims struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
	jwt.RegisteredClaims
}

type jwk struct {
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksResponse struct {
	Keys []jwk `json:"keys"`
}

// GoogleVerifier verifies Google ID tokens using Google's JWKS public keys.
// Keys are fetched once and cached for jwksTTL (1 hour) to avoid repeated outbound calls.
type GoogleVerifier struct {
	clientID  string
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

func NewGoogleVerifier(clientID string) *GoogleVerifier {
	return &GoogleVerifier{clientID: clientID, keys: map[string]*rsa.PublicKey{}}
}

// Verify checks the signature, issuer, audience and expiry of a Google ID token.
func (v *GoogleVerifier) Verify(idToken string) (*GoogleClaims, error) {
	claims := &GoogleClaims{}
	_, err := jwt.ParseWithClaims(idToken, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		kid, _ := token.Header["kid"].(string)
		return v.getKey(kid)
	}, jwt.WithAudience(v.clientID))
	if err != nil {
		return nil, fmt.Errorf("invalid id token: %w", err)
	}

	iss := claims.Issuer
	if iss != "accounts.google.com" && iss != "https://accounts.google.com" {
		return nil, fmt.Errorf("invalid issuer: %s", iss)
	}

	return claims, nil
}

func (v *GoogleVerifier) getKey(kid string) (*rsa.PublicKey, error) {
	v.mu.RLock()
	if time.Since(v.fetchedAt) < jwksTTL {
		key, ok := v.keys[kid]
		v.mu.RUnlock()
		if ok {
			return key, nil
		}
	} else {
		v.mu.RUnlock()
	}

	if err := v.refreshKeys(); err != nil {
		return nil, err
	}

	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok := v.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key %q not found in Google JWKS", kid)
	}
	return key, nil
}

func (v *GoogleVerifier) refreshKeys() error {
	v.mu.Lock()
	defer v.mu.Unlock()

	// Re-check under write lock in case another goroutine already refreshed.
	if time.Since(v.fetchedAt) < jwksTTL {
		return nil
	}

	resp, err := http.Get(googleJWKSURL)
	if err != nil {
		return fmt.Errorf("fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	var body jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decode JWKS: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(body.Keys))
	for _, k := range body.Keys {
		pub, err := jwkToRSA(k)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}

	v.keys = keys
	v.fetchedAt = time.Now()
	return nil
}

func jwkToRSA(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}, nil
}
