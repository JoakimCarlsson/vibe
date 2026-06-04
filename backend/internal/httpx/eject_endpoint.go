package httpx

import (
	"net/http"
	"strings"

	"github.com/joakimcarlsson/minmux/openapi"
	"github.com/joakimcarlsson/minmux/router"

	"github.com/joakimcarlsson/vibe/internal/eject"
)

func (s *Server) registerEject() {
	s.router.Post("/api/v1/eject", s.eject,
		openapi.Summary("Eject a generated app to a full Expo project"),
		openapi.Description(
			"Renders the generated file map into a complete, buildable Expo "+
				"project and returns it as a zip archive, ready for eas build.",
		),
		openapi.Tags("Forge"),
		openapi.ReturnsBody[router.ProblemDetails](
			http.StatusBadRequest,
			"Missing project files",
		),
	)
}

func (s *Server) eject(c *router.Context, p GenerateParams) {
	files := toGeneratorFiles(p.Body.Files)
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, router.BadRequest("files are required"))
		return
	}

	archive, err := eject.Zip(files)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &router.ProblemDetails{
			Status: http.StatusInternalServerError,
			Title:  "Eject failed",
			Detail: err.Error(),
		})
		return
	}

	name := slugify(strings.TrimSpace(p.Body.Prompt))
	c.Header("Content-Disposition", `attachment; filename="`+name+`.zip"`)
	c.Bytes(http.StatusOK, "application/zip", archive)
}

func slugify(s string) string {
	if s == "" {
		return "vibe-app"
	}
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteByte('-')
		}
		if b.Len() >= 40 {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "vibe-app"
	}
	return out
}
