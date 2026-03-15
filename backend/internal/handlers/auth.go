package handlers

import (
	"encoding/json"
	"log"
	"net/http"
)

func (h *Handler) VerifyToken(w http.ResponseWriter, r *http.Request) {
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
