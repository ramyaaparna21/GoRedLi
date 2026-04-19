# Data model

## DynamoDB single-table design

All data lives in a single DynamoDB table (`GoRedLi` by default) with a composite primary key (`PK`, `SK`) and two Global Secondary Indexes (GSI1, GSI2). The table is created by Terraform in production and by `internal/db/migrate.go` in local dev (using DynamoDB Local).

Billing mode: pay-per-request (on-demand).

---

## Table schema

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | Partition key |
| `SK` | String | Sort key |
| `GSI1PK` | String | GSI1 partition key (membership lookups by user) |
| `GSI1SK` | String | GSI1 sort key |
| `GSI2PK` | String | GSI2 partition key (alias resolution) |
| `GSI2SK` | String | GSI2 sort key |

Both GSIs use `ProjectionType: ALL` (all attributes are projected).

---

## Item types

### User

| Attribute | Example | Description |
|---|---|---|
| `PK` | `USER#<uuid>` | User partition key |
| `SK` | `USER#<uuid>` | Same as PK (single-item pattern) |
| `googleSub` | `"117..."` | Google's stable user identifier |
| `email` | `"alice@example.com"` | Google account email |
| `name` | `"Alice Smith"` | Display name from Google |
| `avatarUrl` | `"https://lh3..."` | Google profile picture URL |
| `workspaceOrder` | `["ws-uuid-1", "ws-uuid-2"]` | Ordered list of workspace IDs (index = priority) |
| `createdAt` | `"2024-01-15T10:00:00Z"` | ISO 8601 timestamp |
| `entityType` | `"USER"` | Item type discriminator |

On every sign-in, `email`, `name`, and `avatarUrl` are refreshed to reflect any Google account changes.

### Google Sub lookup

| Attribute | Example | Description |
|---|---|---|
| `PK` | `GSUB#<google-sub>` | Lookup by Google sub |
| `SK` | `GSUB#<google-sub>` | Same as PK |
| `userId` | `"<uuid>"` | Points to the user item |

### Email lookup

| Attribute | Example | Description |
|---|---|---|
| `PK` | `EMAIL#<email>` | Lookup by email |
| `SK` | `EMAIL#<email>` | Same as PK |
| `userId` | `"<uuid>"` | Points to the user item |

### Workspace

| Attribute | Example | Description |
|---|---|---|
| `PK` | `WS#<uuid>` | Workspace partition key |
| `SK` | `META` | Fixed sort key for workspace metadata |
| `name` | `"Engineering"` | Human-readable name |
| `ownerCount` | `1` | Number of owners (used for last-owner protection) |
| `createdAt` | `"2024-01-15T10:00:00Z"` | ISO 8601 timestamp |
| `entityType` | `"WORKSPACE"` | Item type discriminator |

### Membership

| Attribute | Example | Description |
|---|---|---|
| `PK` | `WS#<ws-uuid>` | Workspace partition key |
| `SK` | `MEM#<mem-uuid>` | Membership sort key |
| `userId` | `"<uuid>"` or omitted | User ID; empty for pre-signup memberships |
| `email` | `"alice@example.com"` | Email address |
| `role` | `"owner"` or `"user"` | Access level |
| `createdAt` | `"2024-01-15T10:00:00Z"` | ISO 8601 timestamp |
| `entityType` | `"MEMBERSHIP"` | Item type discriminator |
| `GSI1PK` | `UMEM#<user-uuid>` or `PMEM#<email>` | User membership index (or pre-signup marker) |
| `GSI1SK` | `WS#<ws-uuid>` | Workspace reference |

**GSI1** enables two access patterns:
- `UMEM#<userId>`: Find all workspaces a user is a member of.
- `PMEM#<email>`: Find pre-signup memberships to link when the user signs up.

### Link

| Attribute | Example | Description |
|---|---|---|
| `PK` | `WS#<ws-uuid>` | Workspace partition key |
| `SK` | `LINK#<link-uuid>` | Link sort key |
| `alias` | `"wiki"` | Short name for the redirect |
| `targetUrl` | `"https://notion.so/..."` | Destination URL |
| `title` | `"Team Wiki"` | Optional description |
| `createdAt` | `"2024-01-15T10:00:00Z"` | ISO 8601 timestamp |
| `updatedAt` | `"2024-01-15T10:00:00Z"` | Last update timestamp |
| `entityType` | `"LINK"` | Item type discriminator |
| `GSI2PK` | `ALIAS#wiki` | Alias resolution index |
| `GSI2SK` | `WS#<ws-uuid>` | Workspace reference |

**GSI2** enables the resolution access pattern: query `ALIAS#<alias>` to find all links with that alias across all workspaces.

### Alias guard

| Attribute | Example | Description |
|---|---|---|
| `PK` | `WS#<ws-uuid>` | Workspace partition key |
| `SK` | `ALIAS#wiki` | Alias sort key |
| `linkId` | `"<uuid>"` | Points to the link item |

Used with a `ConditionExpression: attribute_not_exists(PK)` to enforce alias uniqueness within a workspace via DynamoDB transactions.

### Auth code

| Attribute | Example | Description |
|---|---|---|
| `PK` | `AUTHCODE#<hex>` | Auth code partition key |
| `SK` | `AUTHCODE#<hex>` | Same as PK |
| `jwt` | `"eyJ..."` | The JWT this code was created from |
| `expiresAt` | `1712345678` | Unix timestamp (60 seconds after creation) |

Short-lived, single-use codes for passing authentication from the extension to the web admin without exposing the JWT in the URL. Redeemed atomically via `DeleteItem` with `ConditionExpression: attribute_exists(PK)` to prevent double-use.

---

## Access patterns

### By primary key (PK + SK)

| Pattern | PK | SK | Returns |
|---|---|---|---|
| Get user | `USER#<id>` | `USER#<id>` | User item |
| Get workspace metadata | `WS#<id>` | `META` | Workspace item |
| Get membership | `WS#<id>` | `MEM#<mem-id>` | Membership item |
| Get link | `WS#<id>` | `LINK#<link-id>` | Link item |
| Get alias guard | `WS#<id>` | `ALIAS#<alias>` | Alias guard item |
| List workspace members | `WS#<id>` | begins_with `MEM#` | All memberships |
| List workspace links | `WS#<id>` | begins_with `LINK#` | All links |
| Google sub lookup | `GSUB#<sub>` | `GSUB#<sub>` | Lookup -> userId |
| Email lookup | `EMAIL#<email>` | `EMAIL#<email>` | Lookup -> userId |

### By GSI1

| Pattern | GSI1PK | GSI1SK | Returns |
|---|---|---|---|
| User's memberships | `UMEM#<userId>` | — | All memberships for user |
| Check membership in workspace | `UMEM#<userId>` | `WS#<wsId>` | Single membership |
| Pre-signup memberships | `PMEM#<email>` | — | Pending memberships for email |

### By GSI2

| Pattern | GSI2PK | GSI2SK | Returns |
|---|---|---|---|
| Resolve alias | `ALIAS#<alias>` | — | All links with this alias (across workspaces) |

---

## Relationships

```
User (USER#<id>)
  |
  +-- workspaceOrder: [ws-uuid-1, ws-uuid-2, ...]
  |     (ordered list stored on user item)
  |
  +-- Lookup items:
        GSUB#<google-sub> -> userId
        EMAIL#<email> -> userId

Workspace (WS#<id> / META)
  |
  +-- Members (WS#<id> / MEM#<mem-id>)
  |     GSI1: UMEM#<userId> or PMEM#<email>
  |
  +-- Links (WS#<id> / LINK#<link-id>)
  |     GSI2: ALIAS#<alias>
  |
  +-- Alias guards (WS#<id> / ALIAS#<alias>)
        (uniqueness enforcement)
```

---

## Business rules encoded in the data model

**Alias uniqueness is per-workspace, not global**

The alias guard item (`WS#<wsId>` / `ALIAS#<alias>`) with a `ConditionExpression: attribute_not_exists(PK)` in a DynamoDB transaction ensures that two links in the same workspace cannot share an alias. Different workspaces can each have a `r/wiki` link. The resolution logic uses `workspaceOrder` to decide which one wins for a given user.

**The alias `main` is reserved at the application layer**

There is no DB constraint preventing the alias `main`. The application rejects it in both `CreateLink` and `UpdateLink`:
```go
if strings.EqualFold(body.Alias, "main") {
    h.writeError(w, http.StatusBadRequest, "alias 'main' is reserved")
    return
}
```
`r/main` (and the bare `http://r/`) is intercepted by the extension and always opens the admin web app.

**Pre-signup memberships use GSI1 with a `PMEM#` prefix**

An owner can add an email address to a workspace before that person has an account. The membership's `GSI1PK` is set to `PMEM#<email>` instead of `UMEM#<userId>`. When the invited user signs up, `linkPreSignupMemberships` queries for `PMEM#<email>`, updates each membership to `UMEM#<userId>`, and appends the workspace to the user's `workspaceOrder`.

**Last-owner protection uses `ownerCount`**

The workspace metadata item tracks `ownerCount`. When demoting or removing an owner, a `ConditionExpression: ownerCount > :one` ensures at least one owner remains. Both the role change and the count decrement happen in a single DynamoDB transaction.

**Duplicate memberships are prevented by upsert logic**

The `AddMember` handler checks existing members by email before creating a new membership. If the email already exists, the role is updated in place rather than creating a duplicate row.

**Workspace order is denormalized on the user item**

Instead of a separate join table, the user's workspace order is stored as a list attribute (`workspaceOrder`) directly on the user item. This enables single-item reads for resolution and workspace listing, at the cost of a read-modify-write pattern for reordering.

---

## Key operations

### Resolution

1. Get user item to read `workspaceOrder`.
2. Query GSI2 for `ALIAS#<alias>` to get all matching link items.
3. Filter to workspaces present in `workspaceOrder` (membership check).
4. Sort by index in `workspaceOrder` (lower = higher priority).
5. Return the target URL from the highest-priority workspace.

### List workspaces for a user (ordered)

1. Get user item to read `workspaceOrder`.
2. Query GSI1 for `UMEM#<userId>` to get role information.
3. BatchGetItem for workspace metadata items.
4. Return results in `workspaceOrder` order, enriched with role.

### Create workspace (transactional)

A single `TransactWriteItems` creates:
1. The workspace metadata item.
2. An owner membership for the creator.
3. Appends the workspace ID to the creator's `workspaceOrder`.

### Create link (transactional)

A single `TransactWriteItems` creates:
1. The link item (with GSI2 attributes for alias resolution).
2. The alias guard item (with `ConditionExpression: attribute_not_exists(PK)` for uniqueness).

### Update link with alias change (transactional)

A single `TransactWriteItems`:
1. Puts the updated link item.
2. Deletes the old alias guard.
3. Puts the new alias guard (with uniqueness condition).
