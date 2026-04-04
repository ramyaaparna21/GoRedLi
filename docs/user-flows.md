# User flows

This document describes every user-facing flow in rRed. Use it as a test plan and onboarding reference.

---

## Authentication

### 1. Sign in (extension)

1. Open the rRed extension popup.
2. Click **Sign in with Google**.
3. A new tab opens with Google's OAuth consent screen.
4. Authorize. Google redirects to the CloudFront callback URL.
5. `background.ts` intercepts the callback, exchanges the code for an ID token via PKCE, sends it to `POST /auth/verify`, and stores the returned JWT in `browser.storage.local`.
6. The callback tab closes automatically.
7. On next popup open, the JWT is found and the user's email is displayed.

### 2. Sign in (web admin)

The web admin has no standalone sign-in flow. It receives its JWT from the extension:
- Extension popup → **Open r/main** → opens `ADMIN_APP_URL?token=<jwt>`.
- `App.tsx` reads `?token=`, saves it to `localStorage`, and strips it from the URL.
- `GET /me` is called to verify the token and display the user.

### 3. Sign out (extension popup)

1. Open the popup.
2. Click **Sign out** at the bottom.
3. JWT is removed from `browser.storage.local`.
4. Popup re-renders with the "Sign in with Google" button.

### 4. Sign out (web admin)

1. Click **Sign out** in the top bar.
2. Token is removed from `localStorage`.
3. The app shows the "Open this page from the rRed extension" screen.

---

## r/ navigation (via browser address bar)

### 5. Navigate to r/alias (alias exists)

1. Type `r/wiki` in the browser address bar and press Enter.
2. Chrome either navigates to `http://r/wiki` (if `/etc/hosts` is configured) or sends it to a search engine.
3. The extension intercepts via `webNavigation.onBeforeNavigate` (direct) or search-engine URL matching (fallback).
4. The tab is redirected to the extension's `redirect.html?alias=wiki`.
5. `redirect.ts` reads the JWT from storage, calls `GET /resolve?alias=wiki`.
6. API returns 200 with `{ targetUrl }`.
7. Browser navigates to the target URL.

### 6. Navigate to r/alias (alias does not exist)

1. Type `r/newpage` in the address bar.
2. Extension intercepts and redirects to `redirect.html?alias=newpage`.
3. `redirect.ts` calls `GET /resolve?alias=newpage` → 404.
4. Browser redirects to `ADMIN_APP_URL?token=<jwt>&notfound=newpage`.
5. `App.tsx` strips the token, navigates to `/?notfound=newpage`.
6. `Home.tsx` reads `?notfound=newpage`, passes it to `LinksTable` as `initialAlias`.
7. The "Create r/newpage" modal auto-opens with the alias pre-filled and the Target URL field focused.
8. The `?notfound=` param is cleaned from the URL.

### 7. Navigate to r/main (or r/ with empty alias)

1. Type `r/main` or `r/` in the address bar.
2. Extension intercepts, redirects to `redirect.html?alias=main` (or empty).
3. `redirect.ts` detects `alias === 'main'` or empty.
4. Browser redirects to the admin app — no API call is made.

### 8. Navigate to r/alias (not signed in)

1. Type `r/anything` in the address bar.
2. Extension intercepts, redirects to `redirect.html?alias=anything`.
3. `redirect.ts` finds no JWT in storage.
4. Browser redirects to `ADMIN_APP_URL` (the "Open from extension" page).

### 9. Navigate to r/alias (expired JWT)

1. Type `r/anything`.
2. `redirect.ts` calls `GET /resolve` → 401.
3. JWT is removed from storage.
4. Browser redirects to `ADMIN_APP_URL`.

---

## Extension popup actions

### 10. Save current page as an rlink

1. Open the popup while on any web page (not `chrome://` or `chrome-extension://`).
2. The current page URL is displayed at the top.
3. Select a workspace from the dropdown (if you have multiple).
4. Type an alias in the `r/` input field.
5. Click **Save page** (or press Enter).
6. On success: status shows "Saved r/alias" in green. The alias input clears.
7. On conflict (alias already exists): error message shown.

### 11. Go to an alias from the popup

1. Open the popup.
2. Type an alias in the `r/` input field.
3. Click **Go**.
4. The alias is resolved via `GET /resolve?alias=...`.
5. If found: a new tab opens with the target URL. The popup closes.
6. If not found: status shows an error message.
7. If the alias is `main`: opens the admin app directly (no API call).

### 12. Open the admin app from the popup

1. Open the popup.
2. Click **Open r/main**.
3. A new tab opens at `ADMIN_APP_URL?token=<jwt>`.
4. The popup closes.

---

## Web admin — Links

### 13. View all links

1. Open the admin app (Home page).
2. The **Links** section shows all links across all your workspaces.
3. Each row shows: alias, target URL, workspace name, title, last updated.

### 14. Search links

1. Type in the "Search links..." input above the links table.
2. Results filter after a 300ms debounce.

### 15. Create a link

1. Click **+ Add link** above the links table.
2. The "Add link" modal appears.
3. Select a workspace, enter alias, target URL, and optional title.
4. Click **Save**.
5. The modal closes and the links table refreshes.

### 16. Edit a link

1. Click **Edit** on a link row.
2. The "Edit link" modal appears with current values pre-filled.
3. Modify any field and click **Save**.
4. The modal closes and the links table refreshes.

### 17. Delete a link

1. Click **Delete** on a link row.
2. A browser confirm dialog asks "Delete r/alias?".
3. Click OK to confirm.
4. The link is removed from the table.

### 18. Load more links

1. If there are more than 25 links, a **Load more** button appears below the table.
2. Click it to fetch the next page.

---

## Web admin — Workspaces

### 19. View workspaces

1. Open the admin app (Home page).
2. The **Workspaces** section lists all your workspaces with their roles.

### 20. Create a workspace

1. Click **Add workspace** (top right).
2. Enter a workspace name.
3. Click **Create workspace**.
4. You're redirected to the new workspace's detail page as its owner.

### 21. Reorder workspaces (affects alias resolution priority)

1. On the Home page, drag a workspace row using the ⠿ handle.
2. Drop it in the desired position.
3. The order is saved via `PATCH /workspace-order`.
4. When the same alias exists in multiple workspaces, the higher-priority workspace wins.

### 22. Rename a workspace (owner only)

1. Navigate to a workspace's detail page (click **Manage**).
2. Click the workspace name in the header (shows a pencil icon if you're the owner).
3. An inline editor appears.
4. Type the new name and press Enter (or click away to save).

---

## Web admin — Members

### 23. View workspace members

1. Navigate to a workspace detail page.
2. The **Members** section lists all members with their roles.

### 24. Add a member (owner only)

1. On the workspace detail page, enter an email address below the members table.
2. Select a role (user or owner).
3. Click **Add member**.
4. The member appears in the table. If the email matches an existing user, they're linked immediately. Otherwise, a placeholder membership is created that links when the user signs up.

### 25. Change a member's role (owner only)

1. On the workspace detail page, change the role dropdown next to a member.
2. The role is updated immediately via `PATCH`.

### 26. Remove a member (owner only)

1. Click **Remove** next to a member.
2. A browser confirm dialog asks "Remove email@example.com?".
3. Click OK to confirm.
4. The member is removed from the table.
