# API Reference

## Base URL

- **Production**: Lambda Function URL — `https://<id>.lambda-url.<region>.on.aws`
- **Local dev**: `http://localhost:8080`

---

## Authentication

All protected endpoints accept the JWT in one of two ways (checked in this order):

1. `Authorization: Bearer <token>` header — used by the extension.
2. `rred_token` HTTP-only cookie — set by the backend after sign-in, used by the web admin.

Unauthenticated requests to protected endpoints receive:

```json
{ "error": "unauthorized" }
```
HTTP 401.

---

## CORS policy

The `corsMiddleware` in `internal/server/server.go` handles CORS before any route handler runs.

**Allowed origins**:
- All origins listed in the `ALLOWED_ORIGINS` environment variable (comma-separated). In production this is the CloudFront URL.
- Any origin with scheme `chrome-extension://` (Chrome extension).
- Any origin with scheme `moz-extension://` (Firefox extension).

**Headers set on allowed origins**:
```
Access-Control-Allow-Origin: <origin>
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
```

`OPTIONS` preflight requests return HTTP 204 with no body.

Requests from origins not in the allowed list receive no CORS headers and will be blocked by the browser's same-origin policy.

---

## Endpoints

### Authentication

---

#### `GET /auth/google`

Initiates Google OAuth sign-in. Redirects the browser to Google's consent page.

**Auth required**: No

**Query params**:

| Param | Required | Description |
|---|---|---|
| `from` | No | Set to `extension` to trigger the extension sign-in flow (token passed in redirect URL rather than cookie-only) |

**Response**: HTTP 307 redirect to `https://accounts.google.com/o/oauth2/auth`

**Side effects**: Sets `oauth_state` cookie (HttpOnly, Secure, SameSiteLax, 5-minute TTL).

---

#### `GET /auth/google/callback`

OAuth callback. Called by Google after the user consents. Not called directly by clients.

**Auth required**: No

**Query params**:

| Param | Description |
|---|---|
| `state` | Must match the `oauth_state` cookie value |
| `code` | Authorization code from Google |

**Responses**:

- HTTP 400: `{ "error": "invalid state" }` — state mismatch (CSRF protection)
- HTTP 500: `{ "error": "oauth exchange failed" }` — token exchange error
- HTTP 500: `{ "error": "failed to get user info" }` — Google userinfo call failed
- HTTP 500: `{ "error": "failed to upsert user" }` — DB error
- HTTP 307 redirect to `ADMIN_APP_URL/auth-success?token=<jwt>` — when `from=extension`
- HTTP 307 redirect to `ADMIN_APP_URL` — for web sign-in

**Side effects**:
- Clears `oauth_state` cookie.
- Sets `rred_token` cookie (HttpOnly, Secure, SameSiteLax, 30-day TTL).
- Creates or updates user record; creates personal workspace on first sign-in; links pre-signup memberships.

---

#### `POST /auth/logout`

Clears the session cookie.

**Auth required**: No (the cookie is cleared regardless)

**Request body**: None

**Response** (HTTP 200):
```json
{ "status": "ok" }
```

**Side effects**: Sets `rred_token` cookie with `MaxAge: -1` (immediate expiry).

Note: this endpoint does not invalidate the JWT itself — the token remains valid until its 30-day expiry. The extension handles logout by removing the JWT from `browser.storage.local` directly.

---

### User

---

#### `GET /me`

Returns the authenticated user's profile.

**Auth required**: Yes

**Response** (HTTP 200):
```json
{
  "id": "uuid",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "avatarUrl": "https://lh3.googleusercontent.com/...",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

**Error responses**:
- HTTP 401: unauthorized
- HTTP 404: `{ "error": "user not found" }` — JWT refers to a deleted user

---

### Resolution

---

#### `GET /resolve`

Resolves a redirect alias to a target URL. This is the endpoint called by the extension's background service worker on every `http://r/*` navigation.

**Auth required**: Yes

**Query params**:

| Param | Required | Description |
|---|---|---|
| `alias` | Yes | The alias to resolve (e.g. `wiki`) |

**Response** (HTTP 200):
```json
{ "targetUrl": "https://notion.so/team/wiki-abc123" }
```

**Error responses**:
- HTTP 400: `{ "error": "alias is required" }` — missing `alias` param
- HTTP 401: unauthorized
- HTTP 404: `{ "error": "alias not found" }` — alias doesn't exist in any of the user's workspaces

Resolution uses the user's workspace priority order (lowest `priority_index` wins) when the alias exists in multiple workspaces.

---

### Links (cross-workspace)

---

#### `GET /links`

Returns redirects across all workspaces the caller is a member of, ordered by `updated_at DESC`.

**Auth required**: Yes

**Query params**:

| Param | Required | Default | Description |
|---|---|---|---|
| `search` | No | — | Case-insensitive substring match on `alias` and `title` |
| `offset` | No | 0 | Pagination offset |
| `limit` | No | 25 | Page size (max 100) |

**Response** (HTTP 200):
```json
[
  {
    "id": "uuid",
    "workspaceId": "uuid",
    "alias": "wiki",
    "targetUrl": "https://notion.so/...",
    "title": "Team Wiki",
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
]
```

Returns an empty array `[]` (not null) when there are no results.

**Error responses**:
- HTTP 401: unauthorized
- HTTP 500: `{ "error": "failed to list links" }`

---

### Workspaces

---

#### `GET /workspaces`

Returns all workspaces the caller is a member of, ordered by `priority_index ASC`.

**Auth required**: Yes

**Response** (HTTP 200):
```json
[
  {
    "id": "uuid",
    "name": "Alice's workspace",
    "role": "owner",
    "priorityIndex": 0,
    "createdAt": "2024-01-15T10:00:00Z"
  },
  {
    "id": "uuid",
    "name": "Engineering",
    "role": "user",
    "priorityIndex": 1,
    "createdAt": "2024-01-20T09:00:00Z"
  }
]
```

**Error responses**:
- HTTP 401: unauthorized
- HTTP 500: `{ "error": "failed to list workspaces" }`

---

#### `POST /workspaces`

Creates a new workspace. The caller is automatically added as `owner` with the next available `priority_index`.

**Auth required**: Yes

**Request body**:
```json
{ "name": "Engineering" }
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Workspace display name |

**Response** (HTTP 201):
```json
{ "id": "uuid" }
```

**Error responses**:
- HTTP 400: `{ "error": "name is required" }` — missing or empty name
- HTTP 401: unauthorized
- HTTP 500: various internal errors

---

#### `PATCH /workspace-order`

Updates the caller's workspace priority order. All workspace IDs must belong to the caller's workspaces.

**Auth required**: Yes

**Request body**:
```json
{ "order": ["uuid-1", "uuid-2", "uuid-3"] }
```

The array is the complete ordered list of workspace IDs. Position 0 = `priority_index` 0 (highest priority).

**Response** (HTTP 200):
```json
{ "status": "ok" }
```

**Error responses**:
- HTTP 400: `{ "error": "invalid body" }` — malformed JSON
- HTTP 400: `{ "error": "workspace not found in user's list" }` — an ID in `order` does not belong to the caller
- HTTP 401: unauthorized
- HTTP 500: internal errors

---

#### `GET /workspaces/{id}`

Returns a single workspace, including the caller's role and priority index.

**Auth required**: Yes. Caller must be a member of the workspace.

**Path params**:

| Param | Description |
|---|---|
| `id` | Workspace UUID |

**Response** (HTTP 200):
```json
{
  "id": "uuid",
  "name": "Engineering",
  "role": "owner",
  "priorityIndex": 1,
  "createdAt": "2024-01-20T09:00:00Z"
}
```

**Error responses**:
- HTTP 401: unauthorized
- HTTP 404: `{ "error": "workspace not found" }` — workspace doesn't exist or caller is not a member

---

### Workspace links

---

#### `GET /workspaces/{id}/links`

Returns links for a specific workspace, ordered by `updated_at DESC`.

**Auth required**: Yes. Caller must be a member of the workspace (any role).

**Path params**:

| Param | Description |
|---|---|
| `id` | Workspace UUID |

**Query params**:

| Param | Required | Default | Description |
|---|---|---|---|
| `search` | No | — | Case-insensitive substring match on `alias` and `title` |
| `offset` | No | 0 | Pagination offset |
| `limit` | No | 25 | Page size (max 100) |

**Response** (HTTP 200): Array of GoLink objects (same shape as `GET /links`).

**Error responses**:
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "not a member" }`
- HTTP 500: `{ "error": "failed to list links" }`

---

#### `POST /workspaces/{id}/links`

Creates a new redirect in the workspace.

**Auth required**: Yes. Caller must be a member of the workspace (any role).

**Path params**: `id` = workspace UUID

**Request body**:
```json
{
  "alias": "wiki",
  "targetUrl": "https://notion.so/...",
  "title": "Team Wiki"
}
```

| Field | Required | Description |
|---|---|---|
| `alias` | Yes | Short name. Must not be `main` (case-insensitive). |
| `targetUrl` | Yes | Destination URL |
| `title` | No | Human-readable description |

**Response** (HTTP 201): Full GoLink object.

**Error responses**:
- HTTP 400: `{ "error": "alias and targetUrl are required" }` — missing required fields
- HTTP 400: `{ "error": "alias 'main' is reserved" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "not a member" }`
- HTTP 409: `{ "error": "alias already exists in this workspace" }` — UNIQUE constraint violation

---

#### `PATCH /workspaces/{id}/links/{linkId}`

Updates one or more fields of a redirect. All fields are optional; only provided fields are updated.

**Auth required**: Yes. Caller must be a member of the workspace (any role).

**Path params**: `id` = workspace UUID, `linkId` = link UUID

**Request body** (all fields optional):
```json
{
  "alias": "new-alias",
  "targetUrl": "https://new-url.com",
  "title": "New Title"
}
```

| Field | Description |
|---|---|
| `alias` | New alias. Must not be `main` (case-insensitive). |
| `targetUrl` | New destination URL |
| `title` | New title |

Omitting a field leaves it unchanged (uses `COALESCE($param, existing_value)` in SQL).

**Response** (HTTP 200): Full updated GoLink object.

**Error responses**:
- HTTP 400: `{ "error": "alias 'main' is reserved" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "not a member" }`
- HTTP 404: `{ "error": "link not found" }` — link doesn't exist in this workspace
- HTTP 409: `{ "error": "alias already exists in this workspace" }`

---

#### `DELETE /workspaces/{id}/links/{linkId}`

Deletes a redirect.

**Auth required**: Yes. Caller must be a member of the workspace (any role).

**Path params**: `id` = workspace UUID, `linkId` = link UUID

**Response** (HTTP 200):
```json
{ "status": "ok" }
```

**Error responses**:
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "not a member" }`
- HTTP 404: `{ "error": "link not found" }`

---

### Workspace members

---

#### `GET /workspaces/{id}/members`

Returns all members of the workspace, ordered by `created_at ASC`.

**Auth required**: Yes. Caller must be a member of the workspace (any role).

**Path params**: `id` = workspace UUID

**Response** (HTTP 200):
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "workspaceId": "uuid",
    "email": "alice@example.com",
    "role": "owner",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  {
    "id": "uuid",
    "userId": null,
    "workspaceId": "uuid",
    "email": "bob@example.com",
    "role": "user",
    "createdAt": "2024-01-16T10:00:00Z"
  }
]
```

`userId` is `null` (omitted in JSON) for pre-signup memberships (invited by email before the user has signed in).

**Error responses**:
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "not a member" }`

---

#### `POST /workspaces/{id}/members`

Adds a member to the workspace by email. If the email belongs to an existing user, they are linked immediately. If not, a pre-signup membership is created. If the email is already a member, their role is updated.

**Auth required**: Yes. Caller must be an `owner` of the workspace.

**Path params**: `id` = workspace UUID

**Request body**:
```json
{
  "email": "bob@example.com",
  "role": "user"
}
```

| Field | Required | Description |
|---|---|---|
| `email` | Yes | Email address to invite |
| `role` | Yes | `user` or `owner` |

Email is lowercased before storage.

If the user already exists, their `user_workspace_order` is updated to include this workspace (appended with `MAX(priority_index) + 1`).

**Response** (HTTP 201): Full Membership object (same shape as items in `GET /workspaces/{id}/members`).

**Error responses**:
- HTTP 400: `{ "error": "email is required" }`
- HTTP 400: `{ "error": "role must be 'user' or 'owner'" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "owner required" }`
- HTTP 500: internal errors

---

#### `PATCH /workspaces/{id}/members/{memberId}`

Updates a member's role.

**Auth required**: Yes. Caller must be an `owner` of the workspace.

**Path params**: `id` = workspace UUID, `memberId` = membership UUID

**Request body**:
```json
{ "role": "owner" }
```

| Field | Required | Description |
|---|---|---|
| `role` | Yes | `user` or `owner` |

**Business rules**:
- Cannot demote yourself if you are the last owner of the workspace.

**Response** (HTTP 200): Full updated Membership object.

**Error responses**:
- HTTP 400: `{ "error": "role must be 'user' or 'owner'" }` — invalid role or malformed JSON
- HTTP 400: `{ "error": "cannot demote the last owner" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "owner required" }`
- HTTP 404: `{ "error": "member not found" }`

---

#### `DELETE /workspaces/{id}/members/{memberId}`

Removes a member from the workspace. Also removes the workspace from their `user_workspace_order` if the user is known.

**Auth required**: Yes. Caller must be an `owner` of the workspace.

**Path params**: `id` = workspace UUID, `memberId` = membership UUID

**Business rules**:
- Cannot remove yourself if you are the last owner of the workspace.

**Response** (HTTP 200):
```json
{ "status": "ok" }
```

**Error responses**:
- HTTP 400: `{ "error": "cannot remove the last owner" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "owner required" }`
- HTTP 404: `{ "error": "member not found" }`
