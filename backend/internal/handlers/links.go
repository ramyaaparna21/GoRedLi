package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/goredli/backend/internal/middleware"
)

func parseOffsetLimit(r *http.Request) (int, int) {
	offset := 0
	limit := 25
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v >= 0 {
		offset = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	return offset, limit
}

func (h *Handler) ListAllLinks(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	search := r.URL.Query().Get("search")
	offset, limit := parseOffsetLimit(r)

	links, err := h.Store.ListAllLinksForUser(r.Context(), userID, search, offset, limit)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to list links")
		return
	}

	// Convert to API response format.
	result := make([]map[string]string, 0, len(links))
	for _, l := range links {
		result = append(result, map[string]string{
			"id":          l.SK[5:], // strip "LINK#"
			"workspaceId": l.PK[3:], // strip "WS#"
			"alias":       l.Alias,
			"targetUrl":   l.TargetURL,
			"title":       l.Title,
			"createdAt":   l.CreatedAt,
			"updatedAt":   l.UpdatedAt,
		})
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ListLinks(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if _, ok := h.requireMembership(r, wsID); !ok {
		h.writeError(w, http.StatusForbidden, "not a member")
		return
	}

	search := r.URL.Query().Get("search")
	offset, limit := parseOffsetLimit(r)

	links, err := h.Store.ListLinksByWorkspace(r.Context(), wsID, search, offset, limit)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to list links")
		return
	}

	result := make([]map[string]string, 0, len(links))
	for _, l := range links {
		result = append(result, map[string]string{
			"id":          l.SK[5:],
			"workspaceId": l.PK[3:],
			"alias":       l.Alias,
			"targetUrl":   l.TargetURL,
			"title":       l.Title,
			"createdAt":   l.CreatedAt,
			"updatedAt":   l.UpdatedAt,
		})
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CreateLink(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if _, ok := h.requireMembership(r, wsID); !ok {
		h.writeError(w, http.StatusForbidden, "not a member")
		return
	}

	var body struct {
		Alias     string `json:"alias"`
		TargetURL string `json:"targetUrl"`
		Title     string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Alias == "" || body.TargetURL == "" {
		h.writeError(w, http.StatusBadRequest, "alias and targetUrl are required")
		return
	}
	if strings.EqualFold(body.Alias, "main") {
		h.writeError(w, http.StatusBadRequest, "alias 'main' is reserved")
		return
	}

	link, err := h.Store.CreateLink(r.Context(), wsID, body.Alias, body.TargetURL, body.Title)
	if err != nil {
		if err.Error() == "alias_conflict" {
			h.writeError(w, http.StatusConflict, "alias already exists in this workspace")
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to create link")
		return
	}

	h.writeJSON(w, http.StatusCreated, map[string]string{
		"id":          link.SK[5:],
		"workspaceId": link.PK[3:],
		"alias":       link.Alias,
		"targetUrl":   link.TargetURL,
		"title":       link.Title,
		"createdAt":   link.CreatedAt,
		"updatedAt":   link.UpdatedAt,
	})
}

func (h *Handler) UpdateLink(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	linkID := r.PathValue("linkId")

	if _, ok := h.requireMembership(r, wsID); !ok {
		h.writeError(w, http.StatusForbidden, "not a member")
		return
	}

	var body struct {
		Alias     *string `json:"alias"`
		TargetURL *string `json:"targetUrl"`
		Title     *string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Alias != nil && strings.EqualFold(*body.Alias, "main") {
		h.writeError(w, http.StatusBadRequest, "alias 'main' is reserved")
		return
	}

	link, err := h.Store.UpdateLink(r.Context(), wsID, linkID, body.Alias, body.TargetURL, body.Title)
	if err != nil {
		if err.Error() == "alias_conflict" {
			h.writeError(w, http.StatusConflict, "alias already exists in this workspace")
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to update link")
		return
	}
	if link == nil {
		h.writeError(w, http.StatusNotFound, "link not found")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{
		"id":          link.SK[5:],
		"workspaceId": link.PK[3:],
		"alias":       link.Alias,
		"targetUrl":   link.TargetURL,
		"title":       link.Title,
		"createdAt":   link.CreatedAt,
		"updatedAt":   link.UpdatedAt,
	})
}

func (h *Handler) DeleteLink(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	linkID := r.PathValue("linkId")

	if _, ok := h.requireMembership(r, wsID); !ok {
		h.writeError(w, http.StatusForbidden, "not a member")
		return
	}

	err := h.Store.DeleteLink(r.Context(), wsID, linkID)
	if err != nil {
		if err.Error() == "not_found" {
			h.writeError(w, http.StatusNotFound, "link not found")
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to delete link")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
