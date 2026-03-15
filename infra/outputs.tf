output "api_url" {
  description = "Lambda function URL (set as API_URL in extension build)"
  value       = module.backend.api_url
}

output "admin_app_url" {
  description = "Admin web app URL (set as ADMIN_APP_URL in extension build)"
  value       = "https://${module.frontend.cloudfront_domain}"
}

output "s3_bucket" {
  description = "S3 bucket for deploying the web app"
  value       = module.frontend.s3_bucket_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation after deploy)"
  value       = module.frontend.cloudfront_distribution_id
}
