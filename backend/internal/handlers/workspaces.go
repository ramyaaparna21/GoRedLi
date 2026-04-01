package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/goredli/backend/internal/middleware"
)

func (h *Handler) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	workspaces, err := h.Store.ListWorkspacesForUser(r.Context(), userID)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to list workspaces")
		return
	}

	h.writeJSON(w, http.StatusOK, workspaces)
}

func (h *Handler) GetWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	wsID := r.PathValue("id")

	role, ok := h.Store.GetUserMembershipRole(r.Context(), userID, wsID)
	if !ok {
		h.writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	ws, err := h.Store.GetWorkspace(r.Context(), wsID)
	if err != nil || ws == nil {
		h.writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{
		"id":        wsID,
		"name":      ws.Name,
		"createdAt": ws.CreatedAt,
		"role":      role,
	})
}

func (h *Handler) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	userEmail := middleware.GetUserEmail(r.Context())

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		h.writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	wsID, err := h.Store.CreateWorkspace(r.Context(), userID, userEmail, body.Name)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to create workspace")
		return
	}

	h.writeJSON(w, http.StatusCreated, map[string]string{"id": wsID})
}

func (h *Handler) UpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	wsID := r.PathValue("id")

	role, ok := h.Store.GetUserMembershipRole(r.Context(), userID, wsID)
	if !ok {
		h.writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	if role != "owner" {
		h.writeError(w, http.StatusForbidden, "owner required")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		h.writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	if err := h.Store.UpdateWorkspaceName(r.Context(), wsID, body.Name); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to update workspace")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "name": body.Name})
}

func (h *Handler) UpdateWorkspaceOrder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var body struct {
		Order []string `json:"order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	if err := h.Store.UpdateWorkspaceOrder(r.Context(), userID, body.Order); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to update order")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
