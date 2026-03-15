variable "environment" {}
variable "google_client_id" { sensitive = true }
variable "jwt_secret" { sensitive = true }
variable "dynamo_table" {}
variable "dynamo_table_arn" {}
variable "admin_app_url" {}
variable "allowed_origins" {}

resource "aws_iam_role" "lambda" {
  name = "goredli-lambda-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dynamodb" {
  name = "goredli-dynamodb-${var.environment}"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
      ]
      Resource = [
        var.dynamo_table_arn,
        "${var.dynamo_table_arn}/index/*",
      ]
    }]
  })
}

resource "aws_lambda_function" "api" {
  function_name    = "goredli-api-${var.environment}"
  role             = aws_iam_role.lambda.arn
  filename         = "${path.module}/../../../backend/function.zip"
  source_code_hash = fileexists("${path.module}/../../../backend/function.zip") ? filebase64sha256("${path.module}/../../../backend/function.zip") : ""
  handler          = "bootstrap"
  runtime          = "provided.al2023"
  architectures    = ["arm64"]
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DYNAMO_TABLE     = var.dynamo_table
      GOOGLE_CLIENT_ID = var.google_client_id
      JWT_SECRET       = var.jwt_secret
      ADMIN_APP_URL    = var.admin_app_url
      ALLOWED_ORIGINS  = var.allowed_origins
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.dynamodb]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
}

output "api_url" {
  value = aws_lambda_function_url.api.function_url
}
