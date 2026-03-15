package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (h *Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if _, ok := h.requireMembership(r, wsID); !ok {
		h.writeError(w, http.StatusForbidden, "not a member")
		return
	}

	members, err := h.Store.ListMembers(r.Context(), wsID)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}

	result := make([]map[string]any, 0, len(members))
	for _, m := range members {
		item := map[string]any{
			"id":          m.SK[4:], // strip "MEM#"
			"workspaceId": m.PK[3:], // strip "WS#"
			"email":       m.Email,
			"role":        m.Role,
			"createdAt":   m.CreatedAt,
		}
		if m.UserID != "" {
			item["userId"] = m.UserID
		}
		result = append(result, item)
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	if !h.requireOwner(r, wsID) {
		h.writeError(w, http.StatusForbidden, "owner required")
		return
	}

	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Email == "" {
		h.writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if body.Role != "user" && body.Role != "owner" {
		h.writeError(w, http.StatusBadRequest, "role must be 'user' or 'owner'")
		return
	}

	email := strings.ToLower(body.Email)

	mem, err := h.Store.AddMember(r.Context(), wsID, email, body.Role)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to add member")
		return
	}

	item := map[string]any{
		"id":          mem.SK[4:],
		"workspaceId": mem.PK[3:],
		"email":       mem.Email,
		"role":        mem.Role,
		"createdAt":   mem.CreatedAt,
	}
	if mem.UserID != "" {
		item["userId"] = mem.UserID
	}

	h.writeJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	memberID := r.PathValue("memberId")

	if !h.requireOwner(r, wsID) {
		h.writeError(w, http.StatusForbidden, "owner required")
		return
	}

	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Role != "user" && body.Role != "owner") {
		h.writeError(w, http.StatusBadRequest, "role must be 'user' or 'owner'")
		return
	}

	mem, err := h.Store.UpdateMemberRole(r.Context(), wsID, memberID, body.Role)
	if err != nil {
		if err.Error() == "not_found" {
			h.writeError(w, http.StatusNotFound, "member not found")
			return
		}
		if err.Error() == "last_owner" {
			h.writeError(w, http.StatusBadRequest, "cannot demote the last owner")
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to update member")
		return
	}

	item := map[string]any{
		"id":          mem.SK[4:],
		"workspaceId": mem.PK[3:],
		"email":       mem.Email,
		"role":        mem.Role,
		"createdAt":   mem.CreatedAt,
	}
	if mem.UserID != "" {
		item["userId"] = mem.UserID
	}

	h.writeJSON(w, http.StatusOK, item)
}

func (h *Handler) DeleteMember(w http.ResponseWriter, r *http.Request) {
	wsID := r.PathValue("id")
	memberID := r.PathValue("memberId")

	if !h.requireOwner(r, wsID) {
		h.writeError(w, http.StatusForbidden, "owner required")
		return
	}

	_, err := h.Store.DeleteMember(r.Context(), wsID, memberID)
	if err != nil {
		if err.Error() == "not_found" {
			h.writeError(w, http.StatusNotFound, "member not found")
			return
		}
		if err.Error() == "last_owner" {
			h.writeError(w, http.StatusBadRequest, "cannot remove the last owner")
			return
		}
		h.writeError(w, http.StatusInternalServerError, "failed to delete member")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
