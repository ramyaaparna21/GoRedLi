package handlers

import (
	"net/http"

	"github.com/goredli/backend/internal/middleware"
)

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	user, err := h.Store.GetUser(r.Context(), userID)
	if err != nil || user == nil {
		h.writeError(w, http.StatusNotFound, "user not found")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]any{
		"id":        user.PK[5:], // strip "USER#"
		"email":     user.Email,
		"name":      user.Name,
		"avatarUrl": user.AvatarURL,
		"createdAt": user.CreatedAt,
	})
}
