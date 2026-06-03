// Package config loads application configuration from the environment.
package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all application configuration.
type Config struct {
	Server ServerConfig
	OTel   OTelConfig
	Log    LogConfig
}

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Port int
}

// OTelConfig holds OpenTelemetry export settings.
type OTelConfig struct {
	ServiceName    string
	ServiceVersion string
	OTLPEndpoint   string
	OTLPToken      string
	OTLPInsecure   bool
}

// LogConfig holds logging settings.
type LogConfig struct {
	Level  string
	Format string
}

// Load reads configuration from the environment (and an optional .env file)
// and returns the populated Config.
func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		Server: ServerConfig{
			Port: getEnvInt("PORT", 1337),
		},
		OTel: OTelConfig{
			ServiceName:    getEnv("OTEL_SERVICE_NAME", "vibe-backend"),
			ServiceVersion: getEnv("OTEL_SERVICE_VERSION", "dev"),
			OTLPEndpoint:   os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
			OTLPToken:      os.Getenv("OTEL_EXPORTER_OTLP_TOKEN"),
			OTLPInsecure:   getEnvBool("OTEL_EXPORTER_OTLP_INSECURE", false),
		},
		Log: LogConfig{
			Level:  getEnv("LOG_LEVEL", "info"),
			Format: getEnv("LOG_FORMAT", "json"),
		},
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}
