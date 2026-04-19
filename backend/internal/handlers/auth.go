package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
)

func (h *Handler) VerifyToken(w http.ResponseWriter, r *http.Request) {
	h.limitBody(w, r)
	var body struct {
		IDToken string `json:"idToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IDToken == "" {
		h.writeError(w, http.StatusBadRequest, "idToken is required")
		return
	}

	claims, err := h.GoogleVerifier.Verify(body.IDToken)
	if err != nil {
		log.Printf("ID token verification failed: %v", err)
		h.writeError(w, http.StatusUnauthorized, "invalid id token")
		return
	}

	user, err := h.Store.UpsertUserOnLogin(r.Context(), claims.Sub, claims.Email, claims.Name, claims.Picture)
	if err != nil {
		log.Printf("upsertUser error: %v", err)
		h.writeError(w, http.StatusInternalServerError, "failed to upsert user")
		return
	}

	userID := user.PK[5:] // strip "USER#"
	jwtToken, err := h.JWTAuth.Sign(userID, user.Email)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"token": jwtToken})
}

// CreateAuthCode accepts a valid JWT (via Bearer header) and returns a short-lived,
// single-use auth code. The extension uses this to open the web admin without
// exposing the JWT in the URL.
func (h *Handler) CreateAuthCode(w http.ResponseWriter, r *http.Request) {
	// The caller is already authenticated via AuthMiddleware.
	// Re-read the Authorization header to get the raw JWT to store.
	authHeader := r.Header.Get("Authorization")
	jwt := authHeader[7:] // strip "Bearer "

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to generate code")
		return
	}
	code := hex.EncodeToString(buf)

	if err := h.Store.StoreAuthCode(r.Context(), code, jwt); err != nil {
		log.Printf("StoreAuthCode error: %v", err)
		h.writeError(w, http.StatusInternalServerError, "failed to store code")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"code": code})
}

// RedeemAuthCode exchanges a one-time auth code for the JWT it was created from.
// Called by the web admin on page load instead of reading the token from the URL.
func (h *Handler) RedeemAuthCode(w http.ResponseWriter, r *http.Request) {
	h.limitBody(w, r)
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		h.writeError(w, http.StatusBadRequest, "code is required")
		return
	}

	jwt, err := h.Store.RedeemAuthCode(r.Context(), body.Code)
	if err != nil {
		h.writeError(w, http.StatusUnauthorized, "invalid or expired code")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"token": jwt})
}
