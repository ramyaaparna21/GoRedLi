# rRed — Services & Costs

This document lists every paid and free service rRed depends on, what happens when AWS Free Tier expires, and estimated monthly costs at various usage levels.

---

## Services overview

| Service | What it does in rRed | Plan / Tier | Cost |
|---------|---------------------|-------------|------|
| **AWS Lambda** | Runs the Go API backend | arm64, 256 MB, 30s timeout | Free tier, then pay-per-use |
| **AWS DynamoDB** | Stores all data (users, workspaces, links, memberships) | On-demand (PAY_PER_REQUEST), 1 table, 2 GSIs, PITR enabled | Free tier, then pay-per-use |
| **AWS S3** | Hosts the React web admin static files | Single bucket, private (CloudFront access only) | Free tier, then pay-per-use |
| **AWS CloudFront** | CDN for the web admin at `rred.me` | PriceClass_100 (US, Canada, Europe) | Free tier, then pay-per-use |
| **AWS ACM** | SSL certificate for `rred.me` and `api.rred.me` | Public certificate, DNS validation | **Always free** |
| **AWS CloudWatch Logs** | Lambda execution logs | Auto-created by Lambda | Free tier, then pay-per-use |
| **Cloudflare** | DNS for `rred.me` | Free plan | **Always free** |
| **Squarespace** | Domain registration for `rred.me` | Domain only (DNS moved to Cloudflare) | **~$20/year** for `.me` |
| **Google Cloud** | OAuth 2.0 (user sign-in) | No paid APIs used | **Always free** |

---

## AWS Free Tier details

AWS Free Tier lasts **12 months from account creation**. Here's exactly what you get for free and what happens after.

### Lambda

| | Free Tier (12 months) | After Free Tier |
|---|---|---|
| Requests | 1M requests/month | $0.20 per 1M requests |
| Compute | 400,000 GB-seconds/month | $0.0000133334 per GB-second |
| **Your config** | 256 MB, 30s max timeout | — |
| **GB-seconds budget** | 400,000 / 0.25 GB = **1,600,000 invocations** at 1s each | — |

> Lambda free tier (1M requests + 400K GB-seconds) is **permanent** — it doesn't expire after 12 months. You will likely stay within free tier indefinitely for a small team.

### DynamoDB

| | Free Tier (permanent) | After Free Tier |
|---|---|---|
| Read request units | 25 RRU/s sustained | $0.25 per million RRU |
| Write request units | 25 WRU/s sustained | $1.25 per million WRU |
| Storage | 25 GB | $0.25 per GB/month |
| PITR backups | Not included in free tier | $0.20 per GB/month |

> DynamoDB free tier (25 RRU/s, 25 WRU/s, 25 GB storage) is also **permanent**. rRed's data is tiny — a team of 100 people with 1,000 links uses well under 1 MB of storage. You will almost certainly stay in free tier.
>
> **Exception**: Point-in-time recovery (PITR) is **not** covered by free tier. It costs **$0.20/GB/month** based on table size. For rRed's small table this is pennies, but you can disable it in `modules/database/main.tf` if you want to save that.

### S3

| | Free Tier (12 months) | After Free Tier |
|---|---|---|
| Storage | 5 GB | $0.023 per GB/month |
| GET requests | 20,000/month | $0.0004 per 1,000 |
| PUT requests | 2,000/month | $0.005 per 1,000 |

> The web admin build is ~1 MB. After free tier, storage cost is effectively $0. CloudFront caches everything, so S3 GET requests are minimal.

### CloudFront

| | Free Tier (permanent) | After Free Tier |
|---|---|---|
| Data transfer out | 1 TB/month | $0.085 per GB (US/EU) |
| Requests (HTTP/HTTPS) | 10M/month | $0.01 per 10,000 |

> CloudFront free tier is **permanent** (1 TB + 10M requests). A small-to-medium team will never exceed this.

### CloudWatch Logs

| | Free Tier (permanent) | After Free Tier |
|---|---|---|
| Ingestion | 5 GB/month | $0.50 per GB |
| Storage | 5 GB/month | $0.03 per GB/month |

> Lambda logs are small. You'll stay in free tier unless you have very high traffic.

---

## What happens when your 12-month AWS Free Tier ends

**Services that stay free permanently:**
- Lambda (1M requests + 400K GB-seconds/month)
- DynamoDB (25 RRU/s, 25 WRU/s, 25 GB storage)
- CloudFront (1 TB + 10M requests/month)
- CloudWatch Logs (5 GB ingest + 5 GB storage)
- ACM (always free)

**Services that start charging:**
- **S3**: ~$0.02/month (your web admin build is ~1 MB)
- **DynamoDB PITR**: ~$0.20/month (based on table size, currently pennies)

### Estimated monthly cost after free tier expires

| Team size | Redirects/day | Est. monthly AWS cost |
|-----------|--------------|----------------------|
| 1–10 people | ~100 | **$0.00–$0.25** (within permanent free tiers) |
| 10–50 people | ~1,000 | **$0.25–$1.00** |
| 50–200 people | ~5,000 | **$1.00–$3.00** |
| 200–1,000 people | ~20,000 | **$3.00–$10.00** |

> The biggest cost driver at scale would be DynamoDB write request units (link creation/updates) and Lambda invocations — but you'd need thousands of active daily users before AWS bills exceed $10/month.

---

## Services that are always free

| Service | Why it's free |
|---------|--------------|
| **Cloudflare DNS** | Free plan includes unlimited DNS queries |
| **AWS ACM** | Public certificates are free; you only pay for the resources that use them |
| **Google Cloud OAuth** | OAuth consent screen and credential creation have no cost; no paid APIs are called |

---

## Annual fixed costs

| Service | Cost | Notes |
|---------|------|-------|
| Squarespace domain (`rred.me`) | ~$20/year | Renewal price for `.me` TLD |

---

## Total cost summary

| Period | Monthly cost | Annual cost |
|--------|-------------|-------------|
| **During AWS Free Tier** (first 12 months) | ~$0 (AWS) + $1.67 (domain amortized) | ~$20 (domain only) |
| **After AWS Free Tier** (small team) | ~$0.25 (AWS) + $1.67 (domain) | ~$24 |
| **After AWS Free Tier** (medium team, ~100 users) | ~$2 (AWS) + $1.67 (domain) | ~$44 |
