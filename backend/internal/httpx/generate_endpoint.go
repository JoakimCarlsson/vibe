package httpx

import (
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"

	"github.com/joakimcarlsson/vibe/internal/generator"
)

// GeneratedFile is one source file of a generated project.
type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// GenerateCommand is the request body for app generation.
type GenerateCommand struct {
	Prompt string `json:"prompt"`
	// Files is the current project when iterating on an existing app; empty for
	// a fresh build.
	Files []GeneratedFile `json:"files,omitempty"`
	// Error is a runtime crash report (message + component stack) captured on
	// device; when set with Files, the pipeline runs a repair pass.
	Error string `json:"error,omitempty"`
}

// GenerateParams binds the generate request.
type GenerateParams struct {
	Body GenerateCommand `body:""`
}

// GenerateResponse carries a generated, compiled app.
type GenerateResponse struct {
	// Files is the generated project as the model wrote it, for display and edits.
	Files []GeneratedFile `json:"files"`
	// HBC is the base64-encoded Hermes bytecode the app evaluates at runtime.
	HBC string `json:"hbc"`
	// Attempts is how many generations the pipeline needed.
	Attempts int `json:"attempts"`
}

func (s *Server) registerGenerate() {
	s.router.Post("/api/v1/generate", s.generate,
		openapi.Summary("Generate a native app from a prompt"),
		openapi.Description(
			"Runs the forge pipeline: the LLM emits a multi-file React Native "+
				"project, esbuild bundles it against the host SDK (host modules "+
				"external, vendored pure-JS inlined), and hermesc validates the "+
				"bundle for the device engine. Build errors are fed back to the "+
				"model for bounded retries.",
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
	runtimeError := strings.TrimSpace(p.Body.Error)
	files := toGeneratorFiles(p.Body.Files)
	isRepair := runtimeError != "" && len(files) > 0
	if prompt == "" && !isRepair {
		c.JSON(http.StatusBadRequest, router.BadRequest("prompt is required"))
		return
	}

	result, err := s.generator.Generate(c.Ctx(), generator.Command{
		Prompt:       prompt,
		Files:        files,
		RuntimeError: runtimeError,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, &router.ProblemDetails{
			Status: http.StatusBadGateway,
			Title:  "Generation failed",
			Detail: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, GenerateResponse{
		Files:    fromGeneratorFiles(result.Files),
		HBC:      base64.StdEncoding.EncodeToString(result.HBC),
		Attempts: result.Attempts,
	})
}

func toGeneratorFiles(in []GeneratedFile) []generator.File {
	if len(in) == 0 {
		return nil
	}
	out := make([]generator.File, len(in))
	for i, f := range in {
		out[i] = generator.File{Path: f.Path, Content: f.Content}
	}
	return out
}

func fromGeneratorFiles(in []generator.File) []GeneratedFile {
	out := make([]GeneratedFile, len(in))
	for i, f := range in {
		out[i] = GeneratedFile{Path: f.Path, Content: f.Content}
	}
	return out
}
