// Command api is the vibe backend HTTP server.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joakimcarlsson/vibe/internal/config"
	"github.com/joakimcarlsson/vibe/internal/httpx"
	"github.com/joakimcarlsson/vibe/internal/otel"
)

var logger = slog.With("subsystem", "api")

func main() {
	if err := run(); err != nil {
		logger.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	ctx := context.Background()

	otelRuntime, err := otel.NewRuntime(ctx, otel.Config{
		ServiceName:    cfg.OTel.ServiceName,
		ServiceVersion: cfg.OTel.ServiceVersion,
		OTLPEndpoint:   cfg.OTel.OTLPEndpoint,
		OTLPToken:      cfg.OTel.OTLPToken,
		OTLPInsecure:   cfg.OTel.OTLPInsecure,
	})
	if err != nil {
		return fmt.Errorf("setup otel: %w", err)
	}
	defer func() {
		if err := otelRuntime.Shutdown(context.Background()); err != nil {
			logger.Error("otel shutdown failed", "err", err)
		}
	}()

	srv := httpx.NewServer(cfg)

	serverErr := make(chan error, 1)
	go func() {
		logger.InfoContext(ctx, "server listening", "addr", srv.Addr())
		if err := srv.Start(); err != nil &&
			!errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		return fmt.Errorf("server error: %w", err)
	case <-stop:
		logger.InfoContext(ctx, "shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}

	return nil
}
