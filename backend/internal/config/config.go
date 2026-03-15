package config

import (
	"log"
	"os"
	"strings"
)

type Config struct {
	DynamoTable    string
	DynamoEndpoint string // optional, for local DynamoDB
	GoogleClientID string
	JWTSecret      string
	AdminAppURL    string
	AllowedOrigins []string
	Port           string
}

func Load() *Config {
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	if len(jwtSecret) < 32 {
		log.Fatal("JWT_SECRET must be at least 32 characters")
	}

	googleClientID := os.Getenv("GOOGLE_CLIENT_ID")
	if googleClientID == "" {
		log.Fatal("GOOGLE_CLIENT_ID is required")
	}

	var allowedOrigins []string
	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			allowedOrigins = append(allowedOrigins, o)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	table := os.Getenv("DYNAMO_TABLE")
	if table == "" {
		table = "GoRedLi"
	}

	return &Config{
		DynamoTable:    table,
		DynamoEndpoint: os.Getenv("DYNAMO_ENDPOINT"),
		GoogleClientID: googleClientID,
		JWTSecret:      jwtSecret,
		AdminAppURL:    os.Getenv("ADMIN_APP_URL"),
		AllowedOrigins: allowedOrigins,
		Port:           port,
	}
}
