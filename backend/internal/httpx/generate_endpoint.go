package httpx

import (
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"
)

// GenerateCommand is the request body for app generation.
type GenerateCommand struct {
	Prompt string `json:"prompt"`
}

// GenerateParams binds the generate request.
type GenerateParams struct {
	Body GenerateCommand `body:""`
}

// GenerateResponse carries a generated, compiled app.
type GenerateResponse struct {
	// TSX is the component source as the model wrote it, for display.
	TSX string `json:"tsx"`
	// HBC is the base64-encoded Hermes bytecode the app evaluates at runtime.
	HBC string `json:"hbc"`
	// Attempts is how many generations the pipeline needed.
	Attempts int `json:"attempts"`
}

func (s *Server) registerGenerate() {
	s.router.Post("/api/v1/generate", s.generate,
		openapi.Summary("Generate a native app from a prompt"),
		openapi.Description(
			"Runs the forge pipeline: LLM generates a React Native component, "+
				"esbuild transpiles it, imports are checked against the shell's "+
				"module allowlist, and hermesc validates it for the device engine. "+
				"Compiler errors are fed back to the model for bounded retries.",
		),
		openapi.Tags("Forge"),
		openapi.ReturnsBody[GenerateResponse](http.StatusOK, "Generated app code"),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest,
			"Missing or empty prompt",
		),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadGateway,
			"Generation failed after all attempts",
		),
	)
}

func (s *Server) generate(c *router.Context, p GenerateParams) {
	prompt := strings.TrimSpace(p.Body.Prompt)
	if prompt == "" {
		c.JSON(http.StatusBadRequest, router.BadRequest("prompt is required"))
		return
	}

	result, err := s.generator.Generate(c.Ctx(), prompt)
	if err != nil {
		c.JSON(http.StatusBadGateway, &router.ProblemDetails{
			Status: http.StatusBadGateway,
			Title:  "Generation failed",
			Detail: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, GenerateResponse{
		TSX:      result.TSX,
		HBC:      base64.StdEncoding.EncodeToString(result.HBC),
		Attempts: result.Attempts,
	})
}
