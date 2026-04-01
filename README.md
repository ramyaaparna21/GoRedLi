# rRed

rRed is a self-hosted redirect system: type `http://r/alias` in your browser and the extension resolves it to a real URL using rules stored in a team workspace. It ships as three pieces — a browser extension (Chrome and Firefox, Manifest V3), a React web admin, and a Go API backend — all deployed on AWS with Terraform.

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
│  │  http://r/*          │      │  links, and members              │ │
│  │                      │      │                                  │ │
│  │  Stores JWT in       │      │  Auth via Bearer token           │ │
│  │  browser.storage     │      │  (rred_token in localStorage)    │ │
│  └──────────┬───────────┘      └──────────────┬───────────────────┘ │
│             │  Bearer token                   │  Bearer token        │
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
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌───────────────────────────▼──────────────────────────────────┐   │
│  │  DynamoDB (GoRedLi-prod table)                               │   │
│  │  Single-table design, on-demand capacity                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Repo layout

```
rRed/
├── README.md                  # This file
├── DEPLOY.md                  # Step-by-step deployment guide
├── docs/
│   ├── architecture.md        # System design, request flows, auth details
│   ├── data-model.md          # Schema, relationships, key queries
│   └── api.md                 # Full REST API reference
│
├── backend/                   # Go API — runs as AWS Lambda
│   ├── main.go                # Lambda entry point
│   ├── go.mod
│   ├── Makefile               # deps / build / local / test
│   └── internal/
│       ├── config/config.go   # Env-var config struct
│       ├── db/dynamo.go       # DynamoDB operations
│       ├── auth/
│       │   ├── google.go      # Google ID token verification
│       │   └── jwt.go         # HS256 sign / verify
│       ├── middleware/auth.go  # Bearer token auth middleware
│       ├── models/models.go   # Shared Go structs
│       ├── server/server.go   # Mux wiring + CORS middleware
│       └── handlers/
│           ├── handler.go     # Handler struct, helpers
│           ├── auth.go        # /auth/verify
│           ├── me.go          # /me
│           ├── resolve.go     # /resolve
│           ├── workspaces.go  # /workspaces, /workspace-order
│           ├── links.go       # /links, /workspaces/{id}/links
│           └── members.go     # /workspaces/{id}/members
│
├── web/                       # React admin SPA
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── types.ts           # TypeScript interfaces
│       ├── api.ts             # Typed fetch wrapper
│       ├── App.tsx            # Router, auth gate, logout
│       ├── pages/
│       │   ├── Home.tsx           # Workspace list (drag-to-reorder) + all links
│       │   ├── CreateWorkspace.tsx
│       │   └── WorkspaceDetail.tsx # Links + members for one workspace
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
│   ├── icons/                 # Extension icons (16, 32, 48, 128px)
│   └── src/
│       ├── background.ts      # Service worker: intercept r/*, OAuth callback
│       ├── redirect.ts        # Intermediate redirect page for alias resolution
│       ├── redirect/
│       │   └── redirect.html  # "Redirecting…" page
│       └── popup/
│           ├── popup.ts       # Popup UI: sign-in, alias input, sign-out
│           ├── popup.html
│           └── popup.css
│
└── infra/                     # Terraform (AWS)
    ├── main.tf                # Module wiring
    ├── variables.tf
    ├── outputs.tf             # api_url, admin_app_url, s3_bucket, cf_distribution_id
    ├── terraform.tfvars.example
    └── modules/
        ├── backend/main.tf    # Lambda function + Function URL + IAM role
        └── frontend/main.tf   # S3 bucket + CloudFront distribution
```

---

## Quick links

- **Deployment**: [DEPLOY.md](./DEPLOY.md)
- **Architecture**: [docs/architecture.md](./docs/architecture.md)
- **Data model**: [docs/data-model.md](./docs/data-model.md)
- **API reference**: [docs/api.md](./docs/api.md)
