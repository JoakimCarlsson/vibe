package httpx

import (
	"net/http"

	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// HealthResponse is the body returned by the health probe.
type HealthResponse struct {
	Status string `json:"status"`
}

func (s *Server) registerHealth() {
	s.router.Get("/api/v1/healthz", s.health,
		openapi.Summary("Health probe"),
		openapi.Tags("Meta"),
		openapi.ReturnsBody[HealthResponse](
			http.StatusOK,
			"Service is healthy",
		),
	)
}

func (s *Server) health(c *router.Context) {
	c.JSON(http.StatusOK, HealthResponse{Status: "ok"})
}
