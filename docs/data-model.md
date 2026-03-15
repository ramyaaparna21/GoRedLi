# Data model

## Schema

All tables are created by `internal/db/migrate.go` using `CREATE TABLE IF NOT EXISTS`, making the migration idempotent. The `pgcrypto` extension is enabled for `gen_random_uuid()`.

### users

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` | Surrogate key used everywhere as a foreign key |
| `google_sub` | TEXT | UNIQUE NOT NULL | Google's stable user identifier (`userinfo.id`); used as the upsert key on sign-in |
| `email` | TEXT | UNIQUE NOT NULL | Google account email; used for pre-signup membership matching |
| `name` | TEXT | NOT NULL | Display name from Google profile |
| `avatar_url` | TEXT | nullable | Google profile picture URL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Row creation timestamp |

`google_sub` and `email` each have their own UNIQUE index. On every sign-in, `email`, `name`, and `avatar_url` are refreshed to reflect any changes on the Google account side.

---

### workspaces

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` | Surrogate key |
| `name` | TEXT | NOT NULL | Human-readable name (e.g. "Engineering", "Alice's workspace") |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Row creation timestamp |

Workspaces have no direct reference to an owner; ownership is expressed through a `role = 'owner'` membership row.

---

### memberships

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` | Surrogate key |
| `user_id` | UUID | nullable, FK → `users(id)` ON DELETE CASCADE | Null for pre-signup memberships; filled in when the user first signs in |
| `workspace_id` | UUID | NOT NULL, FK → `workspaces(id)` ON DELETE CASCADE | The workspace this membership grants access to |
| `email` | TEXT | NOT NULL | The email address invited; used to match pre-signup memberships when the user signs up |
| `role` | TEXT | NOT NULL, CHECK IN ('user', 'owner') | Access level — only `owner` can add/update/delete members |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Row creation timestamp |
| _(unique)_ | | UNIQUE(workspace_id, email) | Prevents duplicate invitations; used as the upsert key in `AddMember` |

`user_id` being nullable is intentional: an owner can invite `alice@example.com` before Alice has ever signed in. When Alice first signs in, `UPDATE memberships SET user_id = $1 WHERE email = $2 AND user_id IS NULL` links all pending memberships to her account.

---

### user_workspace_order

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `user_id` | UUID | NOT NULL, FK → `users(id)` ON DELETE CASCADE | The user whose ordering this is |
| `workspace_id` | UUID | NOT NULL, FK → `workspaces(id)` ON DELETE CASCADE | The workspace being ordered |
| `priority_index` | INTEGER | NOT NULL | Lower value = higher priority during alias resolution |
| _(pk)_ | | PRIMARY KEY (user_id, workspace_id) | Each user has at most one entry per workspace |

This table is the core of the per-user workspace priority system. Every workspace a user belongs to has exactly one row here. The `priority_index` values are not required to be contiguous — only their relative order matters.

When a member is removed from a workspace (`DeleteMember`), the corresponding `user_workspace_order` row is also deleted, so the workspace disappears from their resolution order immediately.

---

### go_links

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` | Surrogate key |
| `workspace_id` | UUID | NOT NULL, FK → `workspaces(id)` ON DELETE CASCADE | Workspace this link belongs to |
| `alias` | TEXT | NOT NULL | The short name (e.g. `wiki`, `jira`); case-sensitive in the DB |
| `target_url` | TEXT | NOT NULL | The destination URL |
| `title` | TEXT | nullable | Optional human-readable description |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Last update timestamp; set to `NOW()` explicitly in UPDATE statements |
| _(unique)_ | | UNIQUE(workspace_id, alias) | Alias uniqueness is per-workspace, not global |

---

## Relationships

```
users ──────────────────────────────────┐
  │ id                                  │
  │                                     │
  ├── memberships                        │
  │     user_id (nullable FK → users)   │
  │     workspace_id FK → workspaces    │
  │     email                           │
  │     role                            │
  │                                     │
  └── user_workspace_order              │
        user_id FK → users              │
        workspace_id FK → workspaces    │
        priority_index                  │
                                        │
workspaces ─────────────────────────────┘
  │ id
  │
  └── go_links
        workspace_id FK → workspaces
        alias
        target_url

CASCADE rules:
  - DELETE user  → DELETE memberships where user_id matches
                 → DELETE user_workspace_order where user_id matches
  - DELETE workspace → DELETE memberships where workspace_id matches
                     → DELETE user_workspace_order where workspace_id matches
                     → DELETE go_links where workspace_id matches
```

---

## Business rules encoded in the schema

**Alias uniqueness is per-workspace, not global**

`UNIQUE(workspace_id, alias)` on `go_links` means two different workspaces can each have a `go/wiki` link. The resolution query uses `user_workspace_order.priority_index` to decide which one wins for a given user.

**The alias `main` is reserved at the application layer**

There is no DB constraint preventing the alias `main`. The application rejects it in both `CreateLink` and `UpdateLink`:
```go
if strings.EqualFold(body.Alias, "main") {
    h.writeError(w, http.StatusBadRequest, "alias 'main' is reserved")
    return
}
```
`go/main` (and the bare `http://go/`) is intercepted by the extension and always opens the admin web app.

**Pre-signup memberships use a nullable `user_id`**

`memberships.user_id` is nullable so an owner can invite an email address before that person has an account. The UNIQUE constraint is on `(workspace_id, email)`, not on `user_id`, so this works correctly. Once the invited user signs in, `upsertUser` fills in their `user_id`.

**Duplicate memberships are prevented and handled gracefully**

The `AddMember` handler uses an upsert: `INSERT ... ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role, user_id = COALESCE(memberships.user_id, EXCLUDED.user_id)`. Re-inviting someone updates their role rather than creating a duplicate row. `user_id` is only overwritten if the existing row has `NULL` (preserving an already-linked user_id).

**Cascade deletes keep the DB consistent**

All foreign keys use `ON DELETE CASCADE`. Deleting a workspace removes all its memberships, workspace-order entries, and go-links in a single statement without application-side cleanup. Deleting a user removes their memberships and workspace-order entries (but not workspaces themselves or their links — other members of those workspaces are unaffected).

**Last-owner protection is enforced at the application layer**

The DB has no constraint preventing all owners from being removed from a workspace. The `UpdateMember` and `DeleteMember` handlers enforce this:
- If the caller is trying to demote themselves to `user` and they are the only owner, the request is rejected.
- If the caller is trying to delete themselves and they are the last owner, the request is rejected.

---

## Key queries

### Resolution query

The query executed by `GET /resolve?alias=<alias>`:

```sql
SELECT gl.target_url
FROM go_links gl
JOIN user_workspace_order uwo ON uwo.workspace_id = gl.workspace_id
JOIN memberships m ON m.workspace_id = gl.workspace_id AND m.user_id = $1
WHERE uwo.user_id = $1 AND gl.alias = $2
ORDER BY uwo.priority_index ASC
LIMIT 1
```

Parameters: `$1` = caller's user UUID, `$2` = alias string.

The three-way join ensures:
1. The link exists (`go_links`).
2. The caller is a member of the workspace (`memberships`).
3. The caller has a priority-ordering for the workspace (`user_workspace_order`).

`ORDER BY priority_index ASC LIMIT 1` selects the highest-priority (lowest index) workspace when the alias exists in multiple workspaces.

---

### List workspaces for a user (ordered)

```sql
SELECT w.id, w.name, w.created_at, m.role, uwo.priority_index
FROM workspaces w
JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $1
JOIN user_workspace_order uwo ON uwo.workspace_id = w.id AND uwo.user_id = $1
ORDER BY uwo.priority_index ASC
```

Parameters: `$1` = caller's user UUID.

Returns only workspaces the user is a member of, enriched with their role and the current priority index.

---

### List all links for a user across all workspaces

```sql
SELECT gl.id, gl.workspace_id, gl.alias, gl.target_url,
       COALESCE(gl.title, ''), gl.created_at, gl.updated_at
FROM go_links gl
JOIN memberships m ON m.workspace_id = gl.workspace_id AND m.user_id = $1
ORDER BY gl.updated_at DESC
LIMIT $2 OFFSET $3
```

Parameters: `$1` = caller's user UUID, `$2` = page size (max 100, default 25), `$3` = offset.

The `JOIN memberships` enforces the membership check — the user only sees links from workspaces they belong to. When a search query is provided, a `WHERE LOWER(gl.alias) LIKE $2 OR LOWER(COALESCE(gl.title, '')) LIKE $2` clause is added (with the search pattern as `$2` and limit/offset shifted to `$3`/`$4`).
