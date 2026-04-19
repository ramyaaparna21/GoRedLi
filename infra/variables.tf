variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "google_client_id" {
  description = "Google OAuth client ID — also baked into the extension build"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "HS256 signing secret for JWTs (min 32 chars)"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Custom domain for the web admin (e.g. rred.me). Leave empty to use the CloudFront default domain."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the custom domain (must be in us-east-1). Required if domain_name is set."
  type        = string
  default     = ""
}
