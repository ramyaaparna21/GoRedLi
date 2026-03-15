package handlers

import (
	"net/http"

	"github.com/goredli/backend/internal/middleware"
)

func (h *Handler) Resolve(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	alias := r.URL.Query().Get("alias")
	if alias == "" {
		h.writeError(w, http.StatusBadRequest, "alias is required")
		return
	}

	targetURL, err := h.Store.ResolveAlias(r.Context(), userID, alias)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "resolve failed")
		return
	}
	if targetURL == "" {
		h.writeError(w, http.StatusNotFound, "alias not found")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"targetUrl": targetURL})
}
