# Architecture

## System overview

rRed has three user-facing surfaces:

| Surface | Technology | Hosting |
|---|---|---|
| Browser extension | TypeScript, Manifest V3, webextension-polyfill | Distributed to users |
| Web admin (`r/main`) | React 18, Vite, TypeScript | S3 + CloudFront |
| Backend API | Go 1.22, `net/http`, AWS Lambda | Lambda Function URL |

All three talk to a single backend. Authentication uses **JWT Bearer tokens** everywhere:

- **Extension** — stores the JWT in `browser.storage.local` and sends it as `Authorization: Bearer <token>` on every request.
- **Web admin** — receives the JWT from the extension via a one-time auth code (`?code=<auth-code>`), exchanges it for a JWT via `POST /auth/code/redeem`, stores it in `localStorage` as `rred_token`, and sends it as `Authorization: Bearer <token>` on every request.

---

## AWS infrastructure

```
Internet
    |
    v
+-----------------------------------------------------------+
|  AWS (us-east-1, configurable)                            |
|                                                           |
|  CloudFront distribution                                  |
|  (default cert, PriceClass_100, SPA 404->index.html)     |
|      |                                                    |
|      v                                                    |
|  S3 bucket (private, OAC)                                 |
|  rred-web-prod-<random>                                   |
|                                                           |
|  Lambda Function URL (HTTPS)                              |
|  rred-api-prod                                            |
|  arm64, provided.al2023, 256 MB, 30 s timeout            |
|      |                                                    |
|      v                                                    |
|  DynamoDB table (pay-per-request)                         |
|  GoRedLi (single-table design)                            |
|  GSI1 (membership lookups by user)                        |
|  GSI2 (alias resolution)                                  |
+-----------------------------------------------------------+
```

---

## Request flows

### 1. First-time sign-in (extension)

1. User opens the extension popup. `popup.ts` checks `browser.storage.local` for `jwt`; nothing found.
2. Popup renders the "Sign in with Google" button.
3. User clicks. Popup sends `{ action: 'startSignIn' }` to `background.ts` and closes.
4. `background.ts` generates a PKCE verifier/challenge pair and a random state, stores them in `browser.storage.local` as `pendingAuth`, and opens a new tab to Google's OAuth consent URL with `code_challenge_method=S256`.
5. User consents. Google redirects to `https://rred.me/auth/callback?state=...&code=...`.
6. `background.ts` has a `webNavigation.onCompleted` listener filtered to `{ urlPrefix: https://rred.me/auth/callback }`. When the callback page finishes loading, the listener fires.
7. The listener validates `state` matches `pendingAuth`, checks the 5-minute TTL, and closes the callback tab.
8. The listener exchanges the authorization code for tokens via `POST https://oauth2.googleapis.com/token` using the PKCE `code_verifier`.
9. The listener sends the Google ID token to `POST /auth/verify` on the backend.
10. Backend `VerifyToken` handler verifies the Google ID token signature (via Google's JWKS public keys), checks the audience and issuer, then runs `UpsertUserOnLogin`:
    - Inserts or updates the user (upsert on `google_sub`).
    - If new user: creates a personal workspace named `"<name>'s workspace"` with an owner membership.
    - Links any pre-signup memberships matching the user's email.
    - Signs and returns a JWT (HS256, 30-day expiry).
11. The listener stores the JWT in `browser.storage.local`.
12. The listener triggers `refreshLinksCache()` to populate the local alias cache immediately, so `r/alias` redirects are instant from the first use.
13. On next popup open, the JWT is found and `GET /me` succeeds — the user is signed in.

### 2. Sign-in (web admin)

The web admin has no standalone sign-in flow. It always receives its JWT from the extension:

1. Extension popup -> **Open r/main** -> extension calls `POST /auth/code` to create a short-lived one-time auth code -> opens `https://rred.me?code=<auth-code>`.
2. `App.tsx` reads `?code=`, exchanges it for a JWT via `POST /auth/code/redeem`, saves the JWT to `localStorage`, and strips the code from the URL.
3. `GET /me` is called with the Bearer token to verify and display the user.
4. Legacy fallback: if `?token=<jwt>` is present (old extension versions), it is saved directly.

> **Important: `/auth/callback` is reserved for Google OAuth.**
> The Google OAuth flow redirects to `https://rred.me/auth/callback?code=<google-code>&state=...`. The `code` parameter on this path is a **Google authorization code**, NOT an rRed one-time auth code. `App.tsx` explicitly skips the auth code exchange when the path is `/auth/callback` — the extension's background script handles the Google code. Treating a Google code as an rRed code causes 400/401 errors on every sign-in.

### 3. r/alias resolution via extension

1. User navigates to `http://r/wiki` in the browser (or types `r/wiki` in the address bar, which is intercepted from search engines).
2. `background.ts` has two `webNavigation.onBeforeNavigate` listeners:
   - **Direct navigation**: filtered to `{ schemes: ['http'], hostEquals: 'r' }` — catches `http://r/wiki`.
   - **Search engine fallback**: filtered to major search engines (Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Perplexity) — catches when Chrome treats `r/wiki` as a search query.
3. The main-frame check (`frameId === 0`) passes.
4. Alias is extracted from the pathname (direct) or the `q` query parameter (search engine).
5. The tab is redirected to the extension's `redirect/redirect.html?alias=wiki`.
6. `redirect.ts` reads the JWT from `browser.storage.local` and checks the local `aliasMap` cache first (stored in `browser.storage.local`). If the alias is found in the cache, `window.location.href = targetUrl` fires immediately — no network request needed.
7. On cache miss, `redirect.ts` calls `GET /resolve?alias=wiki` with `Authorization: Bearer <jwt>`.
8. Backend runs the resolution logic: queries GSI2 for all links with the alias, filters by membership, picks the one from the highest-priority workspace.
9. If found: `window.location.href = targetUrl` — browser navigates to the real URL.
10. If 401: JWT removed from storage; redirects to `https://rred.me`.
11. If 404: creates a one-time auth code via `POST /auth/code`, then redirects to `https://rred.me?code=<auth-code>&notfound=wiki`. The web admin exchanges the code for a JWT, detects `?notfound=` and auto-opens the "Add link" modal with the alias pre-filled.
12. If network error: redirects to `https://rred.me`.

### 4. r/main redirect

1. User navigates to `http://r/main` or `http://r/` (empty alias).
2. `redirect.ts` checks if `alias === 'main'` or `alias === ''`.
3. Creates a one-time auth code via `POST /auth/code`, then redirects to `https://rred.me?code=<auth-code>` — no `GET /resolve` API call is made.

The popup also handles `r/main` directly: if the alias input contains `main`, it opens `https://rred.me` (with auth code) and closes the popup without calling the resolve API.

### 5. Quick-save from the extension popup

1. User clicks the extension icon while on any page.
2. Popup fetches the current tab's URL and title via `browser.tabs.query()`, and the user's workspaces via `GET /workspaces`.
3. Popup displays the current page URL, a workspace selector (if multiple), and an alias input with a "Save page" button (primary) and a "Go" button (secondary).
4. User types an alias (e.g. `wiki`) and clicks "Save page" (or presses Enter).
5. Popup calls `POST /workspaces/{wsId}/links` with the alias, current tab URL, and page title.
6. On success, the status shows "Saved r/wiki" in green. On conflict (409), shows the error.

### 6. Admin CRUD (web -> backend -> DynamoDB)

Example: creating a new link.

1. User fills out the link modal in `LinksTable` and clicks Save.
2. `api.createLink(wsId, { alias, targetUrl, title })` calls `POST /workspaces/{id}/links` with `Authorization: Bearer <token>`.
3. `AuthMiddleware` extracts the JWT from the `Authorization` header, verifies it, injects `userID` and `userEmail` into context.
4. `CreateLink` handler calls `requireMembership` — queries GSI1 for the user's membership in the workspace. 403 if not a member.
5. Validates that alias is not `"main"` (case-insensitive).
6. Creates the link item and an alias guard item in a DynamoDB transaction. If the alias already exists in this workspace, the conditional check fails and the handler returns 409.
7. Returns the created `GoLink` as JSON (201).
8. Web app closes the modal and refreshes the links table.

---

## Extension internals

### Building the extension

The extension requires four environment variables at build time. Without them, **the build will fail**:

```bash
cd extension
cp .env.example .env   # then fill in real values
npm run build
```

| Variable | Source | Purpose |
|---|---|---|
| `API_URL` | `terraform output api_url` | Lambda Function URL for all API calls |
| `ADMIN_APP_URL` | `terraform output admin_app_url` | Web admin URL (`https://rred.me`) |
| `GOOGLE_CLIENT_ID` | Google Cloud Console / terraform.tfvars | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console | OAuth client secret |

Webpack's `DefinePlugin` injects these as compile-time constants. The `.env` file is loaded automatically via `dotenv`. If the file is missing or a variable is unset, the build exits with an error listing the missing variables.

> **Common issue**: running `npm run build` without a `.env` file silently used to produce an extension with placeholder URLs (`REPLACE_WITH_API_URL`, etc.), causing 400 errors on every sign-in attempt. The build now fails fast instead.

After building, reload the extension in `chrome://extensions` (click the refresh icon on the rRed card) to pick up the new `dist/` files.

### Manifest V3 architecture

The extension has five scripts compiled by Webpack into `dist/`:

| File | Type | Purpose |
|---|---|---|
| `background.js` | Service worker | Navigation interception, OAuth PKCE flow, links cache, message listener |
| `popup.js` | Browser action popup | Sign-in / sign-out, save current page as rlink, go-to-alias |
| `redirect.js` | Intermediate page | Resolves alias via local cache (then API fallback), redirects to target or admin app |
| `popular.js` | Extension page | Shows most-visited URLs without rRed aliases; lets user add redirects |
| `content.js` | Content script | Bridges visit count data from extension to the web admin via localStorage + CustomEvent |

All five scripts use `webextension-polyfill` so the same TypeScript source targets both Chrome (`chrome.*`) and Firefox (`browser.*`). The Firefox build is triggered with `BROWSER=firefox npm run build` (the polyfill handles the difference at runtime; no source changes are needed).

Build-time constants `__API_URL__`, `__ADMIN_APP_URL__`, `__GOOGLE_CLIENT_ID__`, and `__GOOGLE_CLIENT_SECRET__` are injected by Webpack's `DefinePlugin` from environment variables.

### How r/ navigation interception works

`background.ts` registers two `webNavigation.onBeforeNavigate` listeners:

1. **Direct navigation**: filtered to `{ schemes: ['http'], hostEquals: 'r' }`. This fires when the user has `/etc/hosts` configured to resolve `r` to `127.0.0.1`, so `http://r/wiki` is a valid navigation.

2. **Search engine fallback**: filtered to major search engines (Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Perplexity). When Chrome doesn't recognize `r/wiki` as a URL and sends it to a search engine, the extension intercepts the search navigation, extracts the `r/alias` from the query parameter, and redirects before the search page loads.

Both listeners redirect the tab to the extension's own `redirect/redirect.html?alias=<alias>` page, which handles the API call and final redirect. The special alias `popular-urls` is intercepted directly and opens the extension's Popular URLs page instead of going through the redirect flow.

Only main-frame navigations are handled (`details.frameId !== 0` is skipped) to avoid reacting to iframes.

### How the OAuth token is captured after sign-in

The extension uses a full PKCE (Proof Key for Code Exchange) OAuth flow:

1. `background.ts` generates a random verifier and computes the S256 challenge.
2. The verifier, state, and timestamp are persisted in `browser.storage.local` (survives service worker suspension in MV3).
3. A new tab opens to Google's OAuth consent URL with the challenge.
4. Google redirects to `https://rred.me/auth/callback?code=...&state=...`.
5. `background.ts` has a `webNavigation.onCompleted` listener with a declarative URL filter `{ urlPrefix: REDIRECT_URI }`. This reliably wakes Firefox MV3 event pages.
6. The listener validates the state, exchanges the code for tokens (including `code_verifier`), sends the ID token to the backend, and stores the returned JWT.

### Cross-browser support

The `webextension-polyfill` package wraps Chrome's callback-based `chrome.*` APIs in Promises and maps them to the `browser.*` namespace, matching Firefox's native API shape. Because the code is written against `browser.*` throughout, it runs identically on both browsers. The `browser_specific_settings.gecko` block in `manifest.json` provides Firefox with the required extension ID and minimum version (109.0, which is the first Firefox version with full MV3 support).

### Local links cache

The extension maintains a local cache of all the user's links in `browser.storage.local` to enable instant `r/alias` redirects without a network round-trip.

**Stored keys**:

| Key | Type | Description |
|---|---|---|
| `linksCache` | `CachedLink[]` | All links across all workspaces |
| `aliasMap` | `Record<string, string>` | Alias → target URL map (respects workspace priority) |
| `visitCounts` | `Record<string, number>` | Browser history visit counts for link target URLs (90-day window) |
| `cacheUpdatedAt` | `number` | `Date.now()` timestamp of last refresh |

**When the cache is refreshed** (`refreshLinksCache()` in `background.ts`):

1. **On extension startup** — the background service worker calls `refreshLinksCache()` immediately.
2. **Every 5 minutes** — via a `browser.alarms` periodic alarm.
3. **After sign-in** — triggered immediately after the JWT is stored, so new users get instant redirects from their first `r/alias` use.
4. **After creating a link** — both the popup and popular page send `{ action: 'refreshCache' }` to the background after a successful link creation.

**Cache refresh process**:

1. Fetch all links (paginated) via `GET /links`.
2. Fetch all workspaces via `GET /workspaces` (returned in priority order).
3. Build `aliasMap`: sort links by workspace priority, first alias wins (highest-priority workspace).
4. Build `visitCounts`: query `browser.history.search` for the last 90 days, match against link target URLs.
5. Store everything in `browser.storage.local`.

**How redirect.ts uses the cache**:

1. Read `aliasMap` from `browser.storage.local`.
2. If the alias exists in the map → instant redirect (`window.location.href`), no API call.
3. If cache miss → fall back to `GET /resolve?alias=...` API call.

**Cache cleanup on sign-out**:

When the user signs out, all cached data (`linksCache`, `aliasMap`, `visitCounts`, `cacheUpdatedAt`) is removed alongside the JWT to prevent stale data from persisting.

---

## Authentication

### Google OAuth 2.0 PKCE flow in detail

1. Extension popup sends `{ action: 'startSignIn' }` to background.
2. `background.ts` generates:
   - A 32-byte random verifier (base64url-encoded).
   - An S256 challenge: `SHA-256(verifier)` base64url-encoded.
   - A random state string.
3. Persists `{ verifier, state, timestamp }` in `browser.storage.local` as `pendingAuth`.
4. Opens a new tab to `https://accounts.google.com/o/oauth2/v2/auth` with `code_challenge`, `code_challenge_method=S256`, `state`, `redirect_uri=https://rred.me/auth/callback`, `scope=openid email profile`, `prompt=select_account`.
5. User consents. Google redirects to the callback URL.
6. `background.ts` `onCompleted` listener fires, validates state, checks 5-minute TTL.
7. Exchanges code for tokens at `https://oauth2.googleapis.com/token` with `code_verifier`.
8. Sends the `id_token` to `POST API_URL/auth/verify`.
9. Backend verifies the ID token using Google's JWKS public keys (cached for 1 hour), checks audience matches `GOOGLE_CLIENT_ID` and issuer is `accounts.google.com`.
10. Backend upserts the user, creates personal workspace if new, links pre-signup memberships.
11. Backend signs and returns a JWT.
12. Extension stores JWT in `browser.storage.local`.

### JWT structure

Algorithm: HS256, signed with the `JWT_SECRET` environment variable.

| Claim | Value |
|---|---|
| `sub` | User UUID |
| `email` | User's Google email |
| `iat` | Issued-at timestamp |
| `exp` | Issued-at + 30 days |

The `JWTAuth.Verify` method rejects tokens with unexpected signing methods (prevents algorithm confusion attacks).

---

## Resolution logic

The resolution flow in `store.ResolveAlias`:

1. Fetch the user to get their `workspaceOrder` list.
2. Query GSI2 (`ALIAS#<alias>`) to find all link items with this alias across all workspaces.
3. Filter to only workspaces the user is a member of (present in `workspaceOrder`).
4. Sort by workspace priority (index in `workspaceOrder` — lower index = higher priority).
5. Return the target URL from the highest-priority workspace.

This ensures:
1. **Membership check** — only links from workspaces the user belongs to are considered.
2. **Priority ordering** — if the same alias exists in multiple workspaces, the workspace with the lowest index (highest priority) wins.

### Workspace priority order

Each user has a personal ordering stored as `workspaceOrder` (a list attribute on the user item in DynamoDB). Lower index = higher priority. The user controls this order via the drag-and-drop workspace table in the web admin, which calls `PATCH /workspace-order` with the full ordered list of workspace IDs.

On first sign-in, the personal workspace is the only entry. Each subsequently created or linked workspace is appended to the end of the list.

---

## First sign-in logic

`UpsertUserOnLogin` handles four cases:

**Case 1: Returning user**
The existing user's `email`, `name`, and `avatarUrl` are updated to reflect any Google account changes.

**Case 2: Brand new user**
A DynamoDB transaction creates:
1. The user item (`USER#<id>`).
2. A Google sub lookup item (`GSUB#<sub>`) pointing to the user.
3. An email lookup item (`EMAIL#<email>`) pointing to the user.
4. A personal workspace (`WS#<id>` / `META`) named `"<name>'s workspace"`.
5. An owner membership for the user in that workspace.

**Case 3: Pre-signup memberships exist**
After creating/updating the user, `linkPreSignupMemberships` queries GSI1 for memberships with `PMEM#<email>` (pre-signup marker). For each found:
- Updates the membership to set `userId` and change GSI1PK from `PMEM#<email>` to `UMEM#<userId>`.
- Appends the workspace ID to the user's `workspaceOrder`.

**Case 4: Returning user with new pre-signup memberships**
Same as case 3 — runs on every sign-in so newly invited workspaces are linked on next login.
