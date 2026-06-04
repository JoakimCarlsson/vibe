// Package httpx is the HTTP adapter: all net/http, router, and OpenAPI wiring
// lives here. One *_endpoint.go file per subsystem registers its routes.
package httpx

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
	"github.com/joakimcarlsson/vibe/internal/config"
	"github.com/joakimcarlsson/vibe/internal/generator"
	"github.com/joakimcarlsson/vibe/internal/otel"
)

// Server owns the router, OpenAPI generator, and the underlying http.Server.
type Server struct {
	cfg       config.Config
	router    *router.Router
	http      *http.Server
	generator *generator.Service
}

// NewServer constructs a Server, registers all routes, and wires up the
// OpenAPI spec and docs endpoints.
func NewServer(cfg config.Config, gen *generator.Service) *Server {
	r := router.New()
	r.Use(router.Recover())

	specGen := openapi.NewGenerator(openapi.Info{
		Title:   "vibe API",
		Version: "0.1.0",
	})

	s := &Server{cfg: cfg, router: r, generator: gen}

	s.registerHealth()
	s.registerGenerate()
	s.registerEject()

	r.HandleFunc(http.MethodGet, "/openapi.json", specGen.Handler(r))
	registerDocs(r)

	s.http = &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:           otel.Middleware("vibe-backend")(r),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	return s
}

// Addr returns the address the server listens on.
func (s *Server) Addr() string {
	return s.http.Addr
}

// Handler returns the server's HTTP handler, for use in tests.
func (s *Server) Handler() http.Handler {
	return s.http.Handler
}

// Start begins serving and blocks until the server is closed.
func (s *Server) Start() error {
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}
