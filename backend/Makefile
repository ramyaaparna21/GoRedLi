.PHONY: deps build local test

deps:
	go mod tidy

build:
	GOOS=linux GOARCH=arm64 go build -o bootstrap ./main.go
	zip function.zip bootstrap

local:
	go run ./cmd/server/main.go

test:
	go test ./...
