terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Modules ───────────────────────────────────────────────────────────────────

module "database" {
  source      = "./modules/database"
  environment = var.environment
}

module "frontend" {
  source      = "./modules/frontend"
  environment = var.environment
}

module "backend" {
  source = "./modules/backend"

  environment      = var.environment
  google_client_id = var.google_client_id
  jwt_secret       = var.jwt_secret
  dynamo_table     = module.database.table_name
  dynamo_table_arn = module.database.table_arn
  admin_app_url    = "https://${module.frontend.cloudfront_domain}"
  allowed_origins  = "https://${module.frontend.cloudfront_domain}"
}
