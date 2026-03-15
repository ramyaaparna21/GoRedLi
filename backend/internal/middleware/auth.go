package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/goredli/backend/internal/auth"
)

type contextKey string

const (
	ContextUserID    contextKey = "userID"
	ContextUserEmail contextKey = "userEmail"
)

func GetUserID(ctx context.Context) string {
	v, _ := ctx.Value(ContextUserID).(string)
	return v
}

func GetUserEmail(ctx context.Context) string {
	v, _ := ctx.Value(ContextUserEmail).(string)
	return v
}

// AuthMiddleware extracts and verifies the JWT from the Authorization: Bearer header.
// All auth is Bearer-token only — the web app receives its token via URL param from the extension.
func AuthMiddleware(jwtAuth *auth.JWTAuth, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := jwtAuth.Verify(tokenStr)
		if err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), ContextUserID, claims.Sub)
		ctx = context.WithValue(ctx, ContextUserEmail, claims.Email)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
