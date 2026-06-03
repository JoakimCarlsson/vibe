package otel

import (
	"context"
	"errors"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config holds the settings needed to set up OpenTelemetry exporters.
type Config struct {
	ServiceName    string
	ServiceVersion string
	OTLPEndpoint   string
	OTLPToken      string
	OTLPInsecure   bool
}

// Setup configures the global tracer and meter providers and returns a function
// that shuts them down. When the OTLP endpoint or token is empty, providers are
// created without exporters (a no-op fallback).
func Setup(
	ctx context.Context,
	cfg Config,
) (shutdown func(context.Context) error, err error) {
	var shutdownFuncs []func(context.Context) error

	shutdown = func(ctx context.Context) error {
		var errs []error
		for _, fn := range shutdownFuncs {
			if err := fn(ctx); err != nil {
				errs = append(errs, err)
			}
		}
		return errors.Join(errs...)
	}

	handleErr := func(inErr error) {
		err = errors.Join(inErr, shutdown(ctx))
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(cfg.ServiceName),
			semconv.ServiceVersion(cfg.ServiceVersion),
		),
	)
	if err != nil {
		handleErr(err)
		return
	}

	prop := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
	otel.SetTextMapPropagator(prop)

	useOTLP := cfg.OTLPEndpoint != ""

	tracerProvider, err := newTracerProvider(ctx, res, cfg, useOTLP)
	if err != nil {
		handleErr(err)
		return
	}
	shutdownFuncs = append(shutdownFuncs, tracerProvider.Shutdown)
	otel.SetTracerProvider(tracerProvider)

	meterProvider, err := newMeterProvider(ctx, res, cfg, useOTLP)
	if err != nil {
		handleErr(err)
		return
	}
	shutdownFuncs = append(shutdownFuncs, meterProvider.Shutdown)
	otel.SetMeterProvider(meterProvider)

	return shutdown, nil
}

func newTracerProvider(
	ctx context.Context,
	res *resource.Resource,
	cfg Config,
	useOTLP bool,
) (*trace.TracerProvider, error) {
	if useOTLP {
		opts := []otlptracehttp.Option{
			otlptracehttp.WithEndpoint(cfg.OTLPEndpoint),
		}
		if cfg.OTLPInsecure {
			opts = append(opts, otlptracehttp.WithInsecure())
		}
		if cfg.OTLPToken != "" {
			opts = append(opts, otlptracehttp.WithHeaders(map[string]string{
				"Authorization": "Bearer " + cfg.OTLPToken,
			}))
		}
		exporter, err := otlptracehttp.New(ctx, opts...)
		if err != nil {
			return nil, err
		}
		return trace.NewTracerProvider(
			trace.WithBatcher(exporter),
			trace.WithResource(res),
		), nil
	}

	return trace.NewTracerProvider(
		trace.WithResource(res),
	), nil
}

func newMeterProvider(
	ctx context.Context,
	res *resource.Resource,
	cfg Config,
	useOTLP bool,
) (*metric.MeterProvider, error) {
	if useOTLP {
		opts := []otlpmetrichttp.Option{
			otlpmetrichttp.WithEndpoint(cfg.OTLPEndpoint),
		}
		if cfg.OTLPInsecure {
			opts = append(opts, otlpmetrichttp.WithInsecure())
		}
		if cfg.OTLPToken != "" {
			opts = append(opts, otlpmetrichttp.WithHeaders(map[string]string{
				"Authorization": "Bearer " + cfg.OTLPToken,
			}))
		}
		exporter, err := otlpmetrichttp.New(ctx, opts...)
		if err != nil {
			return nil, err
		}
		return metric.NewMeterProvider(
			metric.WithReader(metric.NewPeriodicReader(exporter)),
			metric.WithResource(res),
		), nil
	}

	return metric.NewMeterProvider(
		metric.WithResource(res),
	), nil
}
