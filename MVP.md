# Goredli — Chrome + Firefox go-links extension MVP

## Product goal

Build the smallest usable Goredli product with:

- a Chrome/Firefox extension
- Google sign-in
- a lightweight admin web app at `go/main`
- workspace-based access and ownership
- ordered workspace resolution
- clean link management UI

This MVP is intentionally narrow. Everything not needed for those flows is removed.

## Core product model

There are only four core objects:

- **User**
- **Workspace**
- **Membership**
- **GoLink**

A user signs in with Google.
Every user has a default personal workspace created automatically on first sign-in.&#x20;
A user can also create additional workspaces.
The creator becomes the first owner of any workspace they create.
A workspace contains go-links.
A user can belong to multiple workspaces.
A user has a personal workspace priority order.

## Exact MVP behavior

### 1. Extension

The extension is the resolver client.

Supported flow:

- user installs extension
- user signs in with Google on first use
- user enters a go alias
- extension calls backend resolve API
- backend resolves alias using the user’s ordered workspaces
- extension redirects user to the target URL

For MVP, keep the extension very thin:

- login state check
- alias input / quick open
- resolve request
- redirect

Do not add favorites, recents, offline mode, analytics, or local ranking in v1.

## 2. Admin website at `go/main`

This is the only management UI.

It should be a lightweight web app that handles:

- workspace creation
- workspace joining if invited later
- workspace ordering
- workspace member management
- go-link listing
- go-link creation/edit/delete

`go/main` is the default landing page when a user wants to manage Goredli.

## 3. Workspace model

A workspace is a scoped collection of go-links and members.

Each workspace has:

- name
- system-generated immutable id

Each user can:

- create workspace
- be added to workspace
- belong as either `user` or `owner`

Creator rule:

- creator becomes `owner` automatically

## 4. Workspace priority order

Each user has an ordered list of workspaces.
This order is used during resolution.

Example:

- user belongs to Workspace A and Workspace B
- user searches `go/wiki`
- system checks A first, then B
- first match wins

The admin site must allow changing this order with drag and drop.

This is a core feature, not optional.

## 5. Roles

For MVP, only two roles exist inside a workspace:

- `user`
- `owner`

Permissions:

### User

- view workspace links
- use workspace links
- create/edit/delete links in that workspace

### Owner

- all user permissions
- add/remove members by email
- promote/demote members between user and owner, but cannot demote themselves if that would remove owner access

No finer RBAC in MVP.

## 6. Member management

Owners manage members by email address.

Supported actions:

- add user by email
- remove user by email
- change role between `user` and `owner`

For MVP, keep this simple:

- membership can be created directly for an email even if that person has not signed in yet
- when that person later signs in with Google using the same email, the account is linked to the existing membership
- it is acceptable to have zombie users or email-only memberships in the system

No advanced invitation workflow is needed unless implementation requires it.

## 7. Go-link model

A go-link belongs to exactly one workspace.

Fields:

- alias
- targetUrl
- optional title
- workspaceId

Rules:

- alias must be unique inside a workspace
- duplicate aliases across different workspaces are allowed
- resolution uses workspace priority order
- no alias should be equal to "main", should be checked at creation.

## Clean user flows

### Flow 1: first-time setup

- install extension
- open extension
- click sign in with Google
- auth completes
- system creates the user’s default personal workspace if it does not already exist
- personal workspace is added to the user’s workspace list by default
- extension can now resolve go aliases

### Flow 2: open `go/main`

- user opens `go/main`
- page shows two top-level buttons: `Add workspace` and `Add link`
- page shows two tables:
  - workspaces table
  - links table

### Flow 3: workspaces table

- user sees a table of workspaces they belong to
- each row represents one workspace
- rows can be reordered by drag and drop
- row order is the user’s workspace priority order for resolution
- the table includes an add row option that takes the user to the create workspace page
- the `Add workspace` button at the top also takes the user to the create workspace page

### Flow 4: create workspace

- user clicks `Add workspace` or the add row option in the workspaces table
- user enters workspace name
- workspace is created
- user becomes owner
- new workspace appears in the workspaces table below the default personal workspace unless the user reorders it
- user is redirected to workspace management page of the newly created workspace

### Flow 5: links table

- user sees a table of go-links in a clean tabular format
- table shows link columns such as alias, target URL, workspace, title, and updatedAt
- only the top 25 links are loaded initially
- additional links are loaded lazily as needed
- the table has a search button and filter option
- user can browse links from `go/main`
- the `Add link` button at the top opens the add link flow
- owners can add, edit, or delete links for workspaces they are users of

### Flow 6: create link

- user clicks `Add link`
- user selects the workspace from a dropdown of their existing workspaces
- user enters alias
- user enters target URL
- user optionally enters title
- system validates that the alias is unique within the selected workspace
- link is created
- user is redirected back to `go/main`
- new link appears in the links table

### Flow 7: workspace management page

- owner opens the workspace management page
- adds email
- chooses role
- can remove or update existing members

### Flow 8: resolve alias

- user types alias in extension
- extension sends alias + user session to backend
- backend checks user’s ordered workspaces based on the workspaces table order
- first match wins
- extension opens resolved URL

## MVP scope

The MVP should be very cheap to operate.

### Must-have

- Chrome/Firefox extension
- Google OAuth sign-in
- backend resolve API
- lightweight admin website at `go/main`
- create workspace
- ordered workspace list per user
- go-link CRUD in admin site
- member management by email
- roles: user / owner
- resolution by workspace priority

### Explicit non-goals

- public anonymous usage
- favorites
- recents
- offline cache
- analytics dashboards
- Slack/CLI integrations
- browser omnibox complexity beyond bare minimum
- advanced search/ranking
- audit logs
- fine-grained permissions
- SCIM / enterprise provisioning
- custom domains

## Recommended architecture

## 1. Extension

Responsibilities:

- sign-in bootstrap
- alias input
- call resolve API
- redirect browser
- open `go/main` for admin actions

Keep it minimal.

## 2. Admin web app

Responsibilities:

- auth/session handling
- workspace CRUD
- workspace ordering UI
- go-link CRUD
- workspace member management page

This is the main Goredli product surface.

## 3. Backend API

Single backend serving both extension and admin site.

Required endpoints:

- `POST /auth/google/callback` or managed auth callback
- `GET /me`
- `GET /resolve?alias=main`
- `GET /workspaces`
- `POST /workspaces`
- `PATCH /workspace-order`
- `GET /workspaces/:id/links`
- `POST /workspaces/:id/links`
- `PATCH /workspaces/:id/links/:linkId`
- `DELETE /workspaces/:id/links/:linkId`
- `GET /workspaces/:id/members`
- `POST /workspaces/:id/members`
- `PATCH /workspaces/:id/members/:memberId`
- `DELETE /workspaces/:id/members/:memberId`

No extra APIs unless clearly needed.

## 4. Data model

### users

- id
- googleSub
- email
- name
- avatarUrl
- createdAt

### workspaces

- workspaceId
- name
- userId (email)
- role (`user` | `owner`)
- createdAt

### user\_workspace\_order

- userId
- workspaceId
- priorityIndex

### go\_links

- workspaceId
- alias
- targetUrl
- title nullable

## Resolution logic

Given a signed-in user and alias:

- the extension makes a single resolve call to the backend API
- the backend handles workspace priority lookup and alias resolution internally in a single database call
- the backend returns the first matching link across the user’s ordered workspaces
- if nothing matches, the backend returns not found

That is the full MVP rule.

## Security model

- Google OAuth for authentication
- server-side session or secure token validation
- all admin APIs require authenticated user
- workspace mutations require `owner` role
- workspace reads require membership
- extension only resolves for authenticated users

No more security layers in MVP.

## Clean UI structure for `go/main`

### Page 1: Home

- my workspaces
- create workspace button
- reorder workspaces

### Page 2: Workspace detail

- workspace name
- links table
- members table

### Page 3: Links table

- clean table with alias, target URL, title, updatedAt
- add link
- edit link
- delete link

### Page 4: Members table

- member email
- role
- add member
- remove member
- change role

## Success criteria

The MVP is successful if:

- a user can sign in with Google
- create a workspace
- add links to it
- add/remove members by email
- reorder workspaces
- resolve aliases correctly based on that order
- manage everything through `go/main`

## Direct recommendation

Keep the MVP centered on **three surfaces only**:

- extension for resolve
- `go/main` for admin
- one backend for auth, resolve, workspaces, links, and memberships
