package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/goredli/backend/internal/auth"
	"github.com/goredli/backend/internal/config"
	"github.com/goredli/backend/internal/db"
	"github.com/goredli/backend/internal/middleware"
)

type Handler struct {
	Store          *db.Store
	Config         *config.Config
	JWTAuth        *auth.JWTAuth
	GoogleVerifier *auth.GoogleVerifier
}

// maxBodySize is the maximum allowed request body size (1 MB).
const maxBodySize = 1 << 20

func (h *Handler) limitBody(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySize)
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) writeError(w http.ResponseWriter, status int, msg string) {
	h.writeJSON(w, status, map[string]string{"error": msg})
}

func (h *Handler) requireMembership(r *http.Request, wsID string) (string, bool) {
	userID := middleware.GetUserID(r.Context())
	return h.Store.GetUserMembershipRole(r.Context(), userID, wsID)
}

func (h *Handler) requireOwner(r *http.Request, wsID string) bool {
	role, ok := h.requireMembership(r, wsID)
	return ok && role == "owner"
}
