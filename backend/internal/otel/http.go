// Package otel wires up OpenTelemetry tracing, metrics, and logging.
package otel

import (
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Middleware returns HTTP middleware that traces requests under the given name.
func Middleware(name string) func(http.Handler) http.Handler {
	return otelhttp.NewMiddleware(name)
}
