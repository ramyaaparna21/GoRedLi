# rRed — Deployment Guide

## How auth works

All Google OAuth is handled **client-side in the extension** using PKCE:
1. Extension opens Google OAuth consent page (PKCE flow) → gets authorization code
2. Extension exchanges code for Google ID token via `https://oauth2.googleapis.com/token`
3. Extension sends ID token to `POST /auth/verify` → backend verifies signature using cached Google JWKS → returns a JWT
4. Extension stores the JWT in `browser.storage.local`
5. When opening `r/main`, extension appends `?token=<jwt>` to the admin URL
6. Web app reads the token from the URL, stores it in `localStorage`, uses it as a Bearer token

There is no server-side OAuth redirect flow. No cookies.

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
3. Add your admin app URL (CloudFront URL) to **Authorized redirect URIs**
4. Note the **Client ID** and **Client secret**

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
s3_bucket                  = "rred-web-prod-xxxx"
cloudfront_distribution_id = "EXXXX"
```

---

## Step 3 — Build and load the extension

```bash
cd extension
npm install

API_URL=https://xxxx.lambda-url.us-east-1.on.aws \
ADMIN_APP_URL=https://xxxx.cloudfront.net \
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx \
npm run build
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`

---

## Step 4 — Configure /etc/hosts

Add this line to `/etc/hosts` so the browser treats `r/` as a hostname:

```
127.0.0.1	r
```

---

## Step 5 — Build and deploy the backend

```bash
cd backend
make deps   # go mod tidy
make build  # produces function.zip

aws lambda update-function-code \
  --function-name rred-api-prod \
  --zip-file fileb://function.zip \
  --region us-east-1
```

---

## Step 6 — Build and deploy the web app

```bash
cd web
npm install

VITE_API_URL=https://xxxx.lambda-url.us-east-1.on.aws npm run build

aws s3 sync dist/ s3://rred-web-prod-xxxx/ --delete

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
export DYNAMO_TABLE="rRed"
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
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx \
npm run dev
```

---

## Redeployment (after initial setup)

**Backend change:**
```bash
cd backend && make build
aws lambda update-function-code --function-name rred-api-prod --zip-file fileb://function.zip --region us-east-1
```

**Web change:**
```bash
cd web && VITE_API_URL=... npm run build
aws s3 sync dist/ s3://BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id ID --paths "/*"
```

**Extension change:**
```bash
cd extension && API_URL=... ADMIN_APP_URL=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run build
# Reload in browser (chrome://extensions → Update)
```
