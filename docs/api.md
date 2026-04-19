# API Reference

## Base URL

- **Production**: `https://api.rred.me` (custom domain fronting the Lambda Function URL)
- **Local dev**: `http://localhost:8080`

---

## Authentication

All protected endpoints require a JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

The JWT is obtained through the extension's OAuth PKCE flow:
1. Extension initiates Google OAuth with PKCE (S256 challenge).
2. Google redirects to the callback URL (`https://rred.me/auth/callback`) with an authorization code.
3. Extension exchanges the code for a Google ID token.
4. Extension sends the ID token to `POST /auth/verify`.
5. Backend verifies the token and returns a signed JWT.

The web admin receives its JWT from the extension via a one-time auth code: the extension calls `POST /auth/code` to create a short-lived code, opens `ADMIN_APP_URL?code=<auth-code>`, and the web app exchanges it for a JWT via `POST /auth/code/redeem`. The JWT is stored in `localStorage`.

Unauthenticated requests to protected endpoints receive:

```json
{ "error": "unauthorized" }
```
HTTP 401.

---

## CORS policy

The `corsMiddleware` in `internal/server/server.go` handles CORS before any route handler runs.

**Allowed origins**:
- All origins listed in the `ALLOWED_ORIGINS` environment variable (comma-separated). In production this is `https://rred.me`.
- Any origin with scheme `chrome-extension://` (Chrome extension).
- Any origin with scheme `moz-extension://` (Firefox extension).

**Headers set on allowed origins**:
```
Access-Control-Allow-Origin: <origin>
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
```

`OPTIONS` preflight requests return HTTP 204 with no body.

Requests from origins not in the allowed list receive no CORS headers and will be blocked by the browser's same-origin policy.

---

## Endpoints

### Authentication

---

#### `POST /auth/verify`

Verifies a Google ID token and returns a signed JWT. Called by the extension after completing the OAuth PKCE flow.

**Auth required**: No

**Request body**:
```json
{ "idToken": "<google-id-token>" }
```

| Field | Required | Description |
|---|---|---|
| `idToken` | Yes | Google ID token obtained via OAuth PKCE code exchange |

**Response** (HTTP 200):
```json
{ "token": "<jwt>" }
```

**Error responses**:
- HTTP 400: `{ "error": "idToken is required" }` — missing or empty token
- HTTP 401: `{ "error": "invalid id token" }` — signature/audience/issuer verification failed
- HTTP 500: `{ "error": "failed to upsert user" }` — DB error
- HTTP 500: `{ "error": "failed to sign token" }` — JWT signing error

**Side effects**:
- Creates or updates user record; creates personal workspace on first sign-in; links pre-signup memberships.

---

#### `POST /auth/code`

Creates a short-lived, single-use auth code tied to the caller's JWT. The extension uses this to open the web admin without exposing the JWT in the URL.

**Auth required**: Yes

**Request body**: None

**Response** (HTTP 200):
```json
{ "code": "<64-char-hex-string>" }
```

The code expires after 60 seconds and can only be redeemed once.

**Error responses**:
- HTTP 401: unauthorized
- HTTP 500: `{ "error": "failed to generate code" }` or `{ "error": "failed to store code" }`

---

#### `POST /auth/code/redeem`

Exchanges a one-time auth code for the JWT it was created from. Called by the web admin on page load.

**Auth required**: No

**Request body**:
```json
{ "code": "<auth-code>" }
```

| Field | Required | Description |
|---|---|---|
| `code` | Yes | The auth code from `POST /auth/code` |

**Response** (HTTP 200):
```json
{ "token": "<jwt>" }
```

**Error responses**:
- HTTP 400: `{ "error": "code is required" }` — missing or empty code
- HTTP 401: `{ "error": "invalid or expired code" }` — code not found, already used, or expired

> **Warning**: The `code` parameter on `/auth/callback` URLs is a Google authorization code, NOT an rRed auth code. Do not send Google codes to this endpoint — they will fail with 401.

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

Resolves a redirect alias to a target URL. This is the endpoint called by the extension's redirect page on every `r/*` navigation.

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

Resolution uses the user's workspace priority order (lowest index wins) when the alias exists in multiple workspaces.

---

### Links (cross-workspace)

---

#### `GET /links`

Returns redirects across all workspaces the caller is a member of, ordered by `updatedAt DESC`.

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

Returns all workspaces the caller is a member of, ordered by the user's workspace priority order.

**Auth required**: Yes

**Response** (HTTP 200):
```json
[
  {
    "id": "uuid",
    "name": "Alice's workspace",
    "role": "owner",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  {
    "id": "uuid",
    "name": "Engineering",
    "role": "user",
    "createdAt": "2024-01-20T09:00:00Z"
  }
]
```

**Error responses**:
- HTTP 401: unauthorized
- HTTP 500: `{ "error": "failed to list workspaces" }`

---

#### `POST /workspaces`

Creates a new workspace. The caller is automatically added as `owner` and the workspace is appended to their workspace order.

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

Updates the caller's workspace priority order.

**Auth required**: Yes

**Request body**:
```json
{ "order": ["uuid-1", "uuid-2", "uuid-3"] }
```

The array is the complete ordered list of workspace IDs. Position 0 = highest priority.

**Response** (HTTP 200):
```json
{ "status": "ok" }
```

**Error responses**:
- HTTP 400: `{ "error": "invalid body" }` — malformed JSON
- HTTP 401: unauthorized
- HTTP 500: internal errors

---

#### `GET /workspaces/{id}`

Returns a single workspace, including the caller's role.

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
  "createdAt": "2024-01-20T09:00:00Z"
}
```

**Error responses**:
- HTTP 401: unauthorized
- HTTP 404: `{ "error": "workspace not found" }` — workspace doesn't exist or caller is not a member

---

#### `PATCH /workspaces/{id}`

Renames a workspace.

**Auth required**: Yes. Caller must be an `owner` of the workspace.

**Path params**: `id` = workspace UUID

**Request body**:
```json
{ "name": "New Name" }
```

**Response** (HTTP 200):
```json
{ "status": "ok", "name": "New Name" }
```

**Error responses**:
- HTTP 400: `{ "error": "name is required" }` — missing or empty name
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "owner required" }`
- HTTP 404: `{ "error": "workspace not found" }`

---

### Workspace links

---

#### `GET /workspaces/{id}/links`

Returns links for a specific workspace, ordered by `updatedAt DESC`.

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
- HTTP 409: `{ "error": "alias already exists in this workspace" }` — alias uniqueness violation

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

Omitting a field leaves it unchanged.

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

Returns all members of the workspace, ordered by `createdAt ASC`.

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
    "workspaceId": "uuid",
    "email": "bob@example.com",
    "role": "user",
    "createdAt": "2024-01-16T10:00:00Z"
  }
]
```

`userId` is omitted for pre-signup memberships (invited by email before the user has signed in).

**Error responses**:
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "not a member" }`

---

#### `POST /workspaces/{id}/members`

Adds a member to the workspace by email. If the email belongs to an existing user, they are linked immediately and the workspace is added to their order. If not, a pre-signup membership is created. If the email is already a member, their role is updated (upsert).

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
- Cannot demote the last owner of the workspace.

**Response** (HTTP 200): Full updated Membership object.

**Error responses**:
- HTTP 400: `{ "error": "role must be 'user' or 'owner'" }` — invalid role or malformed JSON
- HTTP 400: `{ "error": "cannot demote the last owner" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "owner required" }`
- HTTP 404: `{ "error": "member not found" }`

---

#### `DELETE /workspaces/{id}/members/{memberId}`

Removes a member from the workspace. Also removes the workspace from their workspace order if the user is known.

**Auth required**: Yes. Caller must be an `owner` of the workspace.

**Path params**: `id` = workspace UUID, `memberId` = membership UUID

**Business rules**:
- Cannot remove the last owner of the workspace.

**Response** (HTTP 200):
```json
{ "status": "ok" }
```

**Error responses**:
- HTTP 400: `{ "error": "cannot remove the last owner" }`
- HTTP 401: unauthorized
- HTTP 403: `{ "error": "owner required" }`
- HTTP 404: `{ "error": "member not found" }`
