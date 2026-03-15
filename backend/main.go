package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	"github.com/goredli/backend/internal/config"
	"github.com/goredli/backend/internal/db"
	"github.com/goredli/backend/internal/server"
)

func main() {
	ctx := context.Background()
	cfg := config.Load()

	client, err := db.NewClient(ctx, cfg.DynamoEndpoint)
	if err != nil {
		log.Fatalf("Failed to create DynamoDB client: %v", err)
	}

	store := db.NewStore(client, cfg.DynamoTable)
	handler := server.Build(cfg, store)
	lambda.Start(httpadapter.NewV2(handler).ProxyWithContext)
}
