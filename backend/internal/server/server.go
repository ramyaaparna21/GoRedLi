package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/goredli/backend/internal/auth"
	"github.com/goredli/backend/internal/config"
	"github.com/goredli/backend/internal/db"
	"github.com/goredli/backend/internal/handlers"
	"github.com/goredli/backend/internal/middleware"
)

func Build(cfg *config.Config, store *db.Store) http.Handler {
	jwtAuth := auth.NewJWTAuth(cfg.JWTSecret)

	h := &handlers.Handler{
		Store:          store,
		Config:         cfg,
		JWTAuth:        jwtAuth,
		GoogleVerifier: auth.NewGoogleVerifier(cfg.GoogleClientID),
	}

	mux := http.NewServeMux()

	// Rate limiter for auth endpoints: 20 requests per minute per IP
	authRL := middleware.NewRateLimiter(20, 1*time.Minute)

	authed := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			middleware.AuthMiddleware(jwtAuth, next).ServeHTTP(w, r)
		}
	}

	mux.HandleFunc("POST /auth/verify", middleware.RateLimit(authRL, h.VerifyToken))
	mux.HandleFunc("POST /auth/code", authed(middleware.RateLimit(authRL, h.CreateAuthCode)))
	mux.HandleFunc("POST /auth/code/redeem", middleware.RateLimit(authRL, h.RedeemAuthCode))

	mux.HandleFunc("GET /me", authed(h.Me))
	mux.HandleFunc("GET /resolve", authed(h.Resolve))
	mux.HandleFunc("GET /links", authed(h.ListAllLinks))

	mux.HandleFunc("GET /workspaces", authed(h.ListWorkspaces))
	mux.HandleFunc("POST /workspaces", authed(h.CreateWorkspace))
	mux.HandleFunc("PATCH /workspace-order", authed(h.UpdateWorkspaceOrder))
	mux.HandleFunc("GET /workspaces/{id}", authed(h.GetWorkspace))
	mux.HandleFunc("PATCH /workspaces/{id}", authed(h.UpdateWorkspace))

	mux.HandleFunc("GET /workspaces/{id}/links", authed(h.ListLinks))
	mux.HandleFunc("POST /workspaces/{id}/links", authed(h.CreateLink))
	mux.HandleFunc("PATCH /workspaces/{id}/links/{linkId}", authed(h.UpdateLink))
	mux.HandleFunc("DELETE /workspaces/{id}/links/{linkId}", authed(h.DeleteLink))

	mux.HandleFunc("GET /workspaces/{id}/members", authed(h.ListMembers))
	mux.HandleFunc("POST /workspaces/{id}/members", authed(h.AddMember))
	mux.HandleFunc("PATCH /workspaces/{id}/members/{memberId}", authed(h.UpdateMember))
	mux.HandleFunc("DELETE /workspaces/{id}/members/{memberId}", authed(h.DeleteMember))

	return securityHeaders(corsMiddleware(cfg, mux))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(cfg *config.Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := false
		for _, o := range cfg.AllowedOrigins {
			if o == origin {
				allowed = true
				break
			}
		}
		if strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "moz-extension://") {
			allowed = true
		}

		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
