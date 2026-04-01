# Architecture

## System overview

rRed has three user-facing surfaces:

| Surface | Technology | Hosting |
|---|---|---|
| Browser extension | TypeScript, Manifest V3, webextension-polyfill | Distributed to users |
| Web admin (`r/main`) | React 18, Vite, TypeScript | S3 + CloudFront |
| Backend API | Go 1.22, `net/http`, AWS Lambda | Lambda Function URL |

All three talk to a single backend. Authentication uses **JWT** in both cases, but the transport differs:

- **Extension** — stores the JWT in `browser.storage.local` and sends it as `Authorization: Bearer <token>` on every request.
- **Web admin** — receives the JWT from the extension via URL parameter, stores it in `localStorage` as `rred_token`, and sends it as `Authorization: Bearer <token>` on every request.

---

## AWS infrastructure

```
Internet
    │
    ▼
┌───────────────────────────────────────────────────────────┐
│  AWS (us-east-1, configurable)                            │
│                                                           │
│  CloudFront distribution                                  │
│  (default cert, PriceClass_100, SPA 404→index.html)       │
│      │                                                    │
│      ▼                                                    │
│  S3 bucket (private, OAC)                                 │
│  rred-web-prod-<random>                                │
│                                                           │
│  Lambda Function URL (HTTPS)                              │
│  rred-api-prod                                         │
│  arm64, provided.al2023, 256 MB, 30 s timeout            │
│      │                                                    │
│  VPC 10.0.0.0/16                                          │
│  ┌───────────────────────────────────────────────────┐    │
│  │  Private subnets (10.0.1/2.0/24)                 │    │
│  │      │                                            │    │
│  │      ├─── RDS PostgreSQL 16 (db.t4g.micro)        │    │
│  │      │    rred-prod                            │    │
│  │      │    encrypted, 7-day backups                │    │
│  │      │                                            │    │
│  │  Public subnet (10.0.10.0/24)                     │    │
│  │      │                                            │    │
│  │      └─── NAT Gateway ──► Internet Gateway        │    │
│  │           (Lambda needs outbound for Google OAuth) │    │
│  └───────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

Security groups:
- `rred-lambda` — egress-only (0.0.0.0/0 all ports)
- `rred-db` — ingress TCP 5432 from `rred-lambda` only; not publicly accessible

---

## Request flows

### 1. First-time sign-in (extension)

1. User opens the extension popup. `popup.ts` checks `browser.storage.local` for `jwt`; nothing found.
2. Popup renders the "Sign in with Google" button.
3. User clicks. Popup calls `browser.tabs.create({ url: API_URL + '/auth/google?from=extension' })` and closes itself.
4. Backend `GET /auth/google` generates a random 16-byte state, prepends `"ext:"`, stores it in the `oauth_state` cookie (5-minute TTL, HttpOnly), and redirects the browser to Google's OAuth consent URL.
5. User consents. Google redirects to `GET /auth/google/callback?state=...&code=...`.
6. Backend validates `state` cookie, exchanges `code` for a Google token, calls `GET https://www.googleapis.com/oauth2/v2/userinfo`.
7. `upsertUser` runs in a transaction:
   - Inserts or updates the user row (upsert on `google_sub`).
   - If this is the user's first sign-in (no `user_workspace_order` rows), creates a personal workspace named `"<name>'s workspace"`, inserts an `owner` membership, and inserts `priority_index = 0`.
   - Updates any pre-signup `memberships` where `user_id IS NULL` and `email` matches.
   - Inserts missing rows into `user_workspace_order` for newly linked workspaces, using `ROW_NUMBER()` to assign sequential `priority_index` values after the current max.
8. Backend signs a JWT (HS256, 30-day expiry), sets it as the `rred_token` (localStorage), and — because `state` starts with `"ext:"` — redirects to `ADMIN_APP_URL/auth-success?token=<jwt>`.
9. `background.ts` is watching `browser.tabs.onUpdated`. When it sees a tab URL that starts with `ADMIN_APP_URL + '/auth-success'`, it extracts `token` from the query string, stores it in `browser.storage.local` as `jwt`, and closes the tab.
10. On next popup open, the JWT is found and the user is signed in.

### 2. First-time sign-in (web)

Steps 1–7 are identical except `from=extension` is absent, so `state` has no `"ext:"` prefix.

After step 7, the backend redirects to `ADMIN_APP_URL` (the root of the web admin). The `rred_token` (localStorage) is already set. `App.tsx` calls `GET /me` on load; the cookie is sent automatically and the user is authenticated.

### 3. r/alias resolution via extension

1. User navigates to `http://r/wiki` in the browser.
2. `background.ts` listener fires on `browser.webNavigation.onBeforeNavigate` filtered to `{ schemes: ['http'], hostEquals: 'go' }`.
3. The main-frame check (`frameId === 0`) passes.
4. Alias is extracted from the pathname: `wiki`.
5. JWT is read from `browser.storage.local`.
6. `background.ts` calls `GET /resolve?alias=wiki` with `Authorization: Bearer <jwt>`.
7. Backend runs the resolution query (see [data-model.md](./data-model.md#resolution-query)).
8. If found: `browser.tabs.update(tabId, { url: targetUrl })` — browser navigates to the real URL.
9. If 401: JWT removed from storage; tab redirected to `ADMIN_APP_URL`.
10. If 404: tab redirected to `ADMIN_APP_URL?notfound=wiki`.
11. If network error: tab redirected to `ADMIN_APP_URL`.

### 4. r/main redirect (extension intercepting http://r/main)

1. User navigates to `http://r/main` or `http://r/` (empty alias).
2. `background.ts` checks if `alias === 'main'` or `alias === ''`.
3. Immediately calls `browser.tabs.update(tabId, { url: ADMIN_APP_URL })` — no API call made.

The popup also handles `r/main` directly: if the alias input contains `main`, it opens `ADMIN_APP_URL` and closes the popup without calling the API.

### 5. Admin CRUD (web → backend → DB)

Example: creating a new link.

1. User fills out the link modal in `LinksTable` and clicks Save.
2. `api.createLink(wsId, { alias, targetUrl, title })` calls `POST /workspaces/{id}/links` with `credentials: 'include'` (cookie).
3. `AuthMiddleware` extracts the JWT from `rred_token` (localStorage), verifies it, injects `userID` and `userEmail` into context.
4. `CreateLink` handler calls `requireMembership` — queries `memberships WHERE workspace_id = $1 AND user_id = $2`. 403 if not a member.
5. Validates that alias is not `"main"` (case-insensitive).
6. Inserts into `go_links`. If the alias already exists in this workspace, the UNIQUE constraint fires and the handler returns 409.
7. Returns the created `GoLink` as JSON (201).
8. Web app closes the modal and refreshes the links table.

---

## Extension internals

### Manifest V3 architecture

The extension has two scripts compiled by Webpack into `dist/`:

| File | Type | Purpose |
|---|---|---|
| `background.js` | Service worker | Navigation interception, OAuth token capture, message listener |
| `popup.js` | Browser action popup | Sign-in / sign-out UI, manual alias input |

Both scripts use `webextension-polyfill` so the same TypeScript source targets both Chrome (`chrome.*`) and Firefox (`browser.*`). The Firefox build is triggered with `BROWSER=firefox npm run build` (the polyfill handles the difference at runtime; no source changes are needed).

Build-time constants `__API_URL__` and `__ADMIN_APP_URL__` are injected by Webpack's `DefinePlugin` from the `API_URL` and `ADMIN_APP_URL` environment variables respectively.

### How http://r/* navigation interception works

`background.ts` registers a listener on `browser.webNavigation.onBeforeNavigate` with the filter `{ url: [{ schemes: ['http'], hostEquals: 'go' }] }`. This fires before the browser sends any HTTP request to `http://go`, so the internal hostname never actually resolves — the extension intercepts at the navigation layer and redirects the tab to either the resolved target URL or the admin app.

Only main-frame navigations are handled (`details.frameId !== 0` is skipped) to avoid reacting to iframes loading `http://go` resources.

### How the OAuth token is captured after sign-in

The backend redirects to `ADMIN_APP_URL/auth-success?token=<jwt>` when `from=extension` is present. `background.ts` listens on `browser.tabs.onUpdated`. For every tab update it checks `tab.url.startsWith(ADMIN_APP_URL + '/auth-success')`. When matched, it reads `token` from the query string, saves it to `browser.storage.local`, and closes the tab.

This approach avoids needing a native messaging host or any special extension API: the token travels via a standard redirect URL that the extension already has `host_permissions` for (`https://*.cloudfront.net/*`).

### Cross-browser support

The `webextension-polyfill` package wraps Chrome's callback-based `chrome.*` APIs in Promises and maps them to the `browser.*` namespace, matching Firefox's native API shape. Because the code is written against `browser.*` throughout, it runs identically on both browsers. The `browser_specific_settings.gecko` block in `manifest.json` provides Firefox with the required extension ID and minimum version (109.0, which is the first Firefox version with full MV3 support).

---

## Authentication

### Google OAuth 2.0 flow in detail

1. `GET /auth/google[?from=extension]`
   - Generates a 16-byte random state, base64url-encoded.
   - If `from=extension`, prepends `"ext:"` to the state string.
   - Sets `oauth_state` cookie: HttpOnly, Secure, SameSiteLax, 5-minute TTL.
   - Redirects to `https://accounts.google.com/o/oauth2/auth` with scopes `openid`, `userinfo.email`, `userinfo.profile`.

2. Google redirects to `GET /auth/google/callback?state=...&code=...`
   - Validates `state` matches the `oauth_state` cookie; returns 400 if not.
   - Clears the `oauth_state` cookie (MaxAge: -1).
   - Exchanges `code` for a Google token via `oauth2.Config.Exchange`.
   - Calls `GET https://www.googleapis.com/oauth2/v2/userinfo` to get `id` (sub), `email`, `name`, `picture`.
   - Calls `upsertUser` (see First sign-in logic below).
   - Signs a JWT.
   - Sets `rred_token` (localStorage): HttpOnly, Secure, SameSiteLax, 30-day TTL.
   - If extension flow: redirects to `ADMIN_APP_URL/auth-success?token=<jwt>`.
   - If web flow: redirects to `ADMIN_APP_URL`.

### JWT structure

Algorithm: HS256, signed with the `JWT_SECRET` environment variable.

| Claim | Value |
|---|---|
| `sub` | User UUID (`users.id`) |
| `email` | User's Google email |
| `iat` | Issued-at timestamp |
| `exp` | Issued-at + 30 days |

The `JWTAuth.Verify` method rejects tokens with unexpected signing methods (prevents algorithm confusion attacks).

### How the extension uses Bearer tokens vs web using cookies

The `AuthMiddleware` in `internal/middleware/auth.go` checks for a token in this order:

1. `Authorization: Bearer <token>` header — used by the extension.
2. `rred_token` (localStorage) — used by the web admin.

If neither is present or the token is invalid, it returns `{"error":"unauthorized"}` with 401.

The web admin sends all requests with `credentials: 'include'` so the cookie is always transmitted. The extension sends `Authorization: Bearer <jwt>` explicitly on every API call (both in `background.ts` and `popup.ts`).

### Extension sign-in flow detail

1. Popup opens tab to `API_URL/auth/google?from=extension`.
2. Backend stores `"ext:" + randomState` in `oauth_state` cookie.
3. Google OAuth completes; backend detects `"ext:"` prefix in cookie.
4. Backend redirects to `ADMIN_APP_URL/auth-success?token=<jwt>`.
5. `background.ts` catches the tab update, reads `token`, stores in `browser.storage.local`.
6. Tab is closed.
7. Next popup open: JWT found, `GET /me` called with Bearer token, user displayed.

---

## Resolution logic

The resolution query is the core of the redirects feature:

```sql
SELECT gl.target_url
FROM go_links gl
JOIN user_workspace_order uwo ON uwo.workspace_id = gl.workspace_id
JOIN memberships m ON m.workspace_id = gl.workspace_id AND m.user_id = $1
WHERE uwo.user_id = $1 AND gl.alias = $2
ORDER BY uwo.priority_index ASC
LIMIT 1
```

This single query enforces three things simultaneously:

1. **Membership check** — the `JOIN memberships` ensures only links from workspaces the user belongs to are considered.
2. **Priority ordering** — `ORDER BY uwo.priority_index ASC` means if the same alias exists in multiple workspaces, the workspace with the lowest `priority_index` (highest priority) wins.
3. **Efficiency** — `LIMIT 1` stops after finding the best match.

### Workspace priority order

Each user has a personal ordering stored in `user_workspace_order (user_id, workspace_id, priority_index)`. Lower `priority_index` = higher priority. The user controls this order via the drag-and-drop workspace table in the web admin, which calls `PATCH /workspace-order` with the full ordered list of workspace IDs. The backend rewrites all `priority_index` values in a transaction.

On first sign-in, the personal workspace gets `priority_index = 0`. Each subsequently created or linked workspace gets `MAX(priority_index) + 1` (or `ROW_NUMBER()` offset from the current max when multiple workspaces are linked at once).

---

## First sign-in logic

`upsertUser` runs inside a single database transaction and handles four cases:

**Case 1: Returning user**
The `INSERT ... ON CONFLICT (google_sub) DO UPDATE` brings `email`, `name`, and `avatar_url` up to date (handles Google account changes). No workspace is created.

**Case 2: Brand new user**
`SELECT COUNT(*) FROM user_workspace_order WHERE user_id = $1` returns 0. The transaction:
1. Creates a workspace named `"<user.Name>'s workspace"`.
2. Inserts an `owner` membership for the user.
3. Inserts `user_workspace_order` with `priority_index = 0`.

**Case 3: Pre-signup memberships exist**
An admin can add a user's email to a workspace before that user signs up. `memberships.user_id` is nullable for this purpose. On sign-in:
```sql
UPDATE memberships SET user_id = $1 WHERE email = $2 AND user_id IS NULL
```
This links all pending memberships to the new user ID.

**Case 4: Newly linked workspaces need ordering**
After linking pre-signup memberships, any workspace not yet in `user_workspace_order` is inserted with sequential `priority_index` values using:
```sql
INSERT INTO user_workspace_order (user_id, workspace_id, priority_index)
SELECT $1, workspace_id,
       COALESCE((SELECT MAX(priority_index) FROM user_workspace_order WHERE user_id = $1), -1)
         + ROW_NUMBER() OVER ()
FROM memberships
WHERE user_id = $1
  AND workspace_id NOT IN (
      SELECT workspace_id FROM user_workspace_order WHERE user_id = $1
  )
ON CONFLICT DO NOTHING
```
`ROW_NUMBER() OVER ()` ensures each newly linked workspace gets a distinct index (max+1, max+2, ...) even if multiple workspaces are linked simultaneously. `ON CONFLICT DO NOTHING` makes the statement idempotent.

Cases 2, 3, and 4 all run on every sign-in (not just first sign-in), so they are safe to re-run. Case 2's body is gated by the `orderCount == 0` check so the personal workspace is only created once.
