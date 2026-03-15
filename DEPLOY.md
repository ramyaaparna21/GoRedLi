# Goredli — Deployment Guide

## How auth works

All Google OAuth is handled **client-side in the extension** using PKCE:
1. Extension → Google OAuth (PKCE, no client secret) → gets Google ID token
2. Extension → `POST /auth/verify` with the ID token → backend verifies signature using cached Google JWKS → returns a JWT
3. Extension stores the JWT in `chrome.storage.local`
4. When opening `go/main`, extension appends `?token=<jwt>` to the URL
5. Web app reads the token from the URL, stores it in `localStorage`, uses it as a Bearer token

There is no server-side OAuth redirect flow. No cookies. No VPC. No RDS.

---

## Prerequisites

- Go 1.22+
- Node.js 20+
- Terraform 1.6+
- AWS CLI configured (`aws configure`)
- A Google Cloud project

---

## Step 1 — Google Cloud OAuth setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** — type: **Web application**
3. Leave redirect URIs blank for now (fill in after Step 3)
4. Note the **Client ID** (the client secret is not used — PKCE only)

---

## Step 2 — Provision AWS infrastructure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — fill in google_client_id, jwt_secret

terraform init
terraform apply
```

Note the outputs:
```
api_url                    = "https://xxxx.lambda-url.us-east-1.on.aws/"
admin_app_url              = "https://xxxx.cloudfront.net"
s3_bucket                  = "goredli-web-prod-xxxx"
cloudfront_distribution_id = "EXXXX"
```

---

## Step 3 — Build and load the extension (to get its ID)

```bash
cd extension
npm install
cp .env.example .env
# Edit .env — fill in API_URL, ADMIN_APP_URL, GOOGLE_CLIENT_ID

API_URL=https://xxxx.lambda-url.us-east-1.on.aws \
ADMIN_APP_URL=https://xxxx.cloudfront.net \
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
npm run build
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`

Note the **Extension ID** shown (e.g. `abcdefghijklmnopqrstuvwxyzabcdef`).

---

## Step 4 — Register redirect URIs in Google Console

Add these to your OAuth client's **Authorized redirect URIs**:

```
https://<chrome-extension-id>.chromiumapp.org/
https://<firefox-extension-id>.extensions.allizom.org/
```

For Firefox, load the extension first: `about:debugging` → Load Temporary Add-on → `extension/dist/manifest.json`

---

## Step 5 — Build and deploy the backend

```bash
cd backend
make deps   # go mod tidy
make build  # produces function.zip

aws lambda update-function-code \
  --function-name goredli-api-prod \
  --zip-file fileb://function.zip \
  --region us-east-1
```

---

## Step 6 — Build and deploy the web app

```bash
cd web
npm install
cp .env.example .env.local
# Edit .env.local — set VITE_API_URL

VITE_API_URL=https://xxxx.lambda-url.us-east-1.on.aws npm run build

aws s3 sync dist/ s3://goredli-web-prod-xxxx/ --delete

aws cloudfront create-invalidation \
  --distribution-id EXXXX \
  --paths "/*"
```

---

## Local development

**Backend (requires DynamoDB Local):**
```bash
# Start DynamoDB Local (Docker):
docker run -p 8000:8000 amazon/dynamodb-local

cd backend
export DYNAMO_ENDPOINT="http://localhost:8000"
export DYNAMO_TABLE="GoRedLi"
export GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
export JWT_SECRET="dev-secret-at-least-32-chars-long"
export ADMIN_APP_URL="http://localhost:5173"
export ALLOWED_ORIGINS="http://localhost:5173"
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="local"
export AWS_SECRET_ACCESS_KEY="local"
make local
```

**Web:**
```bash
cd web
npm install
npm run dev   # http://localhost:5173
```
The Vite dev proxy forwards API calls to `http://localhost:8080`.

**Extension (local backend):**
```bash
cd extension
API_URL=http://localhost:8080 \
ADMIN_APP_URL=http://localhost:5173 \
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
npm run dev
```

Note: `browser.identity.launchWebAuthFlow` requires HTTPS redirect URIs registered in Google Console. For local dev, register `https://<ext-id>.chromiumapp.org/` — the extension ID is the same locally.

---

## Redeployment (after initial setup)

**Backend change:**
```bash
cd backend && make build
aws lambda update-function-code --function-name goredli-api-prod --zip-file fileb://function.zip --region us-east-1
```

**Web change:**
```bash
cd web && VITE_API_URL=... npm run build
aws s3 sync dist/ s3://BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id ID --paths "/*"
```

**Extension change:**
```bash
cd extension && API_URL=... ADMIN_APP_URL=... GOOGLE_CLIENT_ID=... npm run build
# Reload in browser (chrome://extensions → Update)
```
