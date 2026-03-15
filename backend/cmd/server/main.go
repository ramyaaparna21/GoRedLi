package main

import (
	"context"
	"log"
	"net/http"

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

	// For local dev, ensure the table exists (uses DynamoDB Local).
	if cfg.DynamoEndpoint != "" {
		if err := db.EnsureTable(ctx, client, cfg.DynamoTable); err != nil {
			log.Fatalf("Failed to ensure table: %v", err)
		}
	}

	store := db.NewStore(client, cfg.DynamoTable)
	handler := server.Build(cfg, store)
	log.Printf("Starting local server on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
