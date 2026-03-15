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
