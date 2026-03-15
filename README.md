# GoRedLi

GoRedLi is a self-hosted go-links system: type `http://go/alias` in your browser and the extension resolves it to a real URL using rules stored in a team workspace. It ships as three pieces — a browser extension (Chrome and Firefox, Manifest V3), a React web admin, and a Go API backend — all deployed on AWS with Terraform.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  ┌──────────────────────┐      ┌──────────────────────────────────┐ │
│  │  Extension           │      │  Web admin (CloudFront + S3)     │ │
│  │  (background.js)     │      │  https://<dist>.cloudfront.net   │ │
│  │                      │      │                                  │ │
│  │  Intercepts          │      │  React SPA — manage workspaces,  │ │
│  │  http://go/*         │      │  links, and members              │ │
│  │                      │      │                                  │ │
│  │  Stores JWT in       │      │  Auth via HTTP-only cookie       │ │
│  │  browser.storage     │      │  (goredli_token)                 │ │
│  └──────────┬───────────┘      └──────────────┬───────────────────┘ │
│             │  Bearer token                   │  Cookie              │
└─────────────┼─────────────────────────────────┼─────────────────────┘
              │                                 │
              ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AWS                                                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Lambda (arm64, provided.al2023)                             │   │
│  │  Go binary — handles HTTP via aws-lambda-go-api-proxy        │   │
│  │  Lambda Function URL (HTTPS, no API Gateway)                 │   │
│  │                                                              │   │
│  │  VPC private subnets → NAT gateway → Google OAuth APIs      │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │  postgres:// (VPC-internal)          │
│  ┌───────────────────────────▼──────────────────────────────────┐   │
│  │  RDS PostgreSQL 16 (db.t4g.micro)                            │   │
│  │  Private subnet, encrypted, 7-day backups                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Repo layout

```
GoRedLi/
├── README.md                  # This file
├── DEPLOY.md                  # Step-by-step deployment guide
├── docs/
│   ├── architecture.md        # System design, request flows, auth details
│   ├── data-model.md          # Schema, relationships, key queries
│   ├── api.md                 # Full REST API reference
│   └── development.md         # Local dev setup and common tasks
│
├── backend/                   # Go API — runs as AWS Lambda
│   ├── main.go                # Lambda entry point (wraps net/http via httpadapter)
│   ├── go.mod
│   ├── Makefile               # deps / build / local / test
│   ├── cmd/server/main.go     # Local HTTP server entry point
│   └── internal/
│       ├── config/config.go   # Env-var config struct
│       ├── db/
│       │   ├── db.go          # Connection pool with retry logic
│       │   └── migrate.go     # Idempotent DDL run on startup
│       ├── auth/
│       │   ├── google.go      # Google OAuth2 client
│       │   └── jwt.go         # HS256 sign / verify
│       ├── middleware/auth.go  # Bearer token + cookie auth middleware
│       ├── models/models.go   # Shared Go structs
│       ├── server/server.go   # Mux wiring + CORS middleware
│       └── handlers/
│           ├── handler.go     # Handler struct, requireMembership/requireOwner helpers
│           ├── auth.go        # /auth/google, /auth/google/callback, /auth/logout
│           ├── me.go          # /me
│           ├── resolve.go     # /resolve
│           ├── workspaces.go  # /workspaces, /workspace-order
│           ├── links.go       # /links, /workspaces/{id}/links
│           └── members.go     # /workspaces/{id}/members
│
├── web/                       # React admin SPA
│   ├── package.json
│   ├── vite.config.ts         # Dev proxy: /api/* → localhost:8080
│   ├── .env.example
│   └── src/
│       ├── types.ts           # TypeScript interfaces
│       ├── api.ts             # Typed fetch wrapper
│       ├── App.tsx            # Router, auth gate, logout
│       ├── pages/
│       │   ├── Home.tsx           # Workspace list (drag-to-reorder) + all links
│       │   ├── CreateWorkspace.tsx
│       │   ├── WorkspaceDetail.tsx # Links + members for one workspace
│       │   └── AuthSuccess.tsx     # Extension OAuth landing page
│       └── components/
│           ├── WorkspaceTable.tsx  # Drag-and-drop via @dnd-kit
│           ├── LinksTable.tsx      # Paginated, searchable, with modal editor
│           └── MembersTable.tsx    # Member list with inline role editor
│
├── extension/                 # Browser extension (MV3, Chrome + Firefox)
│   ├── manifest.json
│   ├── package.json
│   ├── webpack.config.js      # Inlines API_URL and ADMIN_APP_URL at build time
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── background.ts      # Service worker: intercept go/*, capture OAuth token
│       └── popup/
│           ├── popup.ts       # Popup UI: sign-in, alias input, sign-out
│           ├── popup.html
│           └── popup.css
│
└── infra/                     # Terraform (AWS)
    ├── main.tf                # VPC, subnets, NAT, security groups, module wiring
    ├── variables.tf
    ├── outputs.tf             # api_url, admin_app_url, s3_bucket, cf_distribution_id
    ├── terraform.tfvars.example
    └── modules/
        ├── backend/main.tf    # Lambda function + Function URL + IAM role
        ├── database/main.tf   # RDS PostgreSQL 16 (db.t4g.micro)
        └── frontend/main.tf   # S3 bucket + CloudFront distribution
```

---

## Quick links

- **Deployment**: [DEPLOY.md](./DEPLOY.md)
- **Architecture**: [docs/architecture.md](./docs/architecture.md)
- **Data model**: [docs/data-model.md](./docs/data-model.md)
- **API reference**: [docs/api.md](./docs/api.md)
- **Local development**: [docs/development.md](./docs/development.md)
