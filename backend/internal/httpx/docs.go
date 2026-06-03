package httpx

import (
	"net/http"

	"github.com/joakimcarlsson/minmux/router"
	"github.com/joakimcarlsson/minmux/scalar"
)

func registerDocs(r *router.Router) {
	r.HandleFunc(http.MethodGet, "/docs", scalar.HandlerWith(scalar.Config{
		SpecURL: "/openapi.json",
		Title:   "vibe API — Reference",
	}))
}
