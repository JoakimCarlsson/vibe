GOPATH_FWD := $(shell go env GOPATH)
GOLANGCI := $(GOPATH_FWD)/bin/golangci-lint run

.PHONY: install fmt lint test

install:
	go install github.com/air-verse/air@latest
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
	go install golang.org/x/tools/cmd/goimports@latest
	go install github.com/golangci/golines@latest

fmt:
	$(GOPATH_FWD)/bin/goimports -w cmd internal
	$(GOPATH_FWD)/bin/golines -m 80 -w cmd internal

lint:
	go vet ./...
	$(GOLANGCI)

test:
	go test -count=1 -race ./...
