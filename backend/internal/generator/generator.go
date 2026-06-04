// Package generator turns a user prompt into runnable React Native code:
// LLM → TSX → esbuild transpile → import allowlist → hermesc validation,
// feeding compiler errors back to the model for a bounded number of retries.
package generator

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/joakimcarlsson/ai/llm"
	llmanthropic "github.com/joakimcarlsson/ai/llm/anthropic"
	"github.com/joakimcarlsson/ai/message"
	"github.com/joakimcarlsson/ai/model"
	"github.com/joakimcarlsson/ai/prompt"

	"github.com/joakimcarlsson/vibe/internal/config"
)

var logger = slog.With("subsystem", "generator")

//go:embed prompts/system.md
var systemPrompt string

//go:embed prompts/retry.md
var retryTemplate string

// allowedImports are the only modules a generated component may require.
// Everything in here must be provided by the app's require shim.
var allowedImports = map[string]bool{
	"react":             true,
	"react-native":      true,
	"react/jsx-runtime": true,
}

var requireRe = regexp.MustCompile(`require\("([^"]+)"\)`)

// Service generates and validates React Native components from prompts.
type Service struct {
	client      llm.LLM
	hermesc     string
	maxAttempts int
}

// Result is a successfully generated and compiled app.
type Result struct {
	// TSX is the source as the model wrote it, for display.
	TSX string
	// HBC is the Hermes bytecode the app evaluates on its runtime.
	HBC []byte
	// Attempts is how many generations it took.
	Attempts int
}

// New constructs a Service from config.
func New(cfg config.GeneratorConfig) (*Service, error) {
	if cfg.AnthropicAPIKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is not set")
	}
	if cfg.HermescPath == "" {
		return nil, errors.New("HERMESC_PATH is not set (required to emit bytecode)")
	}
	hermesc, err := exec.LookPath(cfg.HermescPath)
	if err != nil {
		return nil, fmt.Errorf("hermesc not found %q: %w", cfg.HermescPath, err)
	}
	client := llmanthropic.NewLLM(
		llmanthropic.WithAPIKey(cfg.AnthropicAPIKey),
		llmanthropic.WithModel(model.AnthropicModels[model.Claude45Haiku]),
		llmanthropic.WithMaxTokens(16000),
		llmanthropic.WithTimeout(4*time.Minute),
	)
	return &Service{
		client:      client,
		hermesc:     hermesc,
		maxAttempts: max(cfg.MaxAttempts, 1),
	}, nil
}

// Generate runs the full pipeline for one prompt.
func (s *Service) Generate(ctx context.Context, userPrompt, currentCode string) (*Result, error) {
	msgs := []message.Message{
		message.NewSystemMessage(systemPrompt),
		message.NewUserMessage(buildUserMessage(userPrompt, currentCode)),
	}

	logger.InfoContext(ctx, "generation started",
		"prompt", userPrompt, "edit", currentCode != "")

	var lastErr error
	for attempt := 1; attempt <= s.maxAttempts; attempt++ {
		resp, err := s.client.SendMessages(ctx, msgs, nil)
		if err != nil {
			logger.ErrorContext(ctx, "llm call failed", "attempt", attempt, "err", err)
			return nil, fmt.Errorf("llm call: %w", err)
		}

		tsx := stripFences(resp.Content)
		logger.InfoContext(ctx, "model responded",
			"attempt", attempt,
			"input_tokens", resp.Usage.InputTokens,
			"output_tokens", resp.Usage.OutputTokens,
			"finish_reason", resp.FinishReason,
			"tsx_chars", len(tsx),
		)
		logger.DebugContext(ctx, "model output", "attempt", attempt, "tsx", tsx)

		hbc, buildErr := s.compile(ctx, tsx)
		if buildErr == nil {
			logger.InfoContext(ctx, "generation succeeded",
				"attempt", attempt, "tsx_chars", len(tsx), "hbc_bytes", len(hbc))
			return &Result{TSX: tsx, HBC: hbc, Attempts: attempt}, nil
		}

		logger.WarnContext(ctx, "generated code failed to compile",
			"attempt", attempt, "err", buildErr, "tsx", tsx)
		lastErr = buildErr

		retry, err := renderRetry(buildErr)
		if err != nil {
			return nil, fmt.Errorf("render retry prompt: %w", err)
		}
		assistant := message.NewAssistantMessage()
		assistant.AppendContent(resp.Content)
		msgs = append(msgs, assistant, message.NewUserMessage(retry))
	}

	logger.ErrorContext(ctx, "generation exhausted attempts",
		"attempts", s.maxAttempts, "err", lastErr)

	return nil, fmt.Errorf(
		"generated code failed to compile after %d attempts: %w",
		s.maxAttempts, lastErr,
	)
}

// buildUserMessage frames a fresh build as the prompt itself, or an edit as
// the current component plus the requested change.
func buildUserMessage(prompt, currentCode string) string {
	if currentCode == "" {
		return prompt
	}
	return "Here is the current component:\n\n```tsx\n" + currentCode +
		"\n```\n\nApply this change and return the COMPLETE updated component, " +
		"following all the same rules:\n\n" + prompt
}

// renderRetry fills the retry template with the compiler output.
func renderRetry(buildErr error) (string, error) {
	return prompt.Process(retryTemplate, map[string]any{
		"errors": buildErr.Error(),
	})
}

// compile lowers TSX to CommonJS, enforces the import allowlist, then compiles
// it to Hermes bytecode the app evaluates directly on its runtime.
func (s *Service) compile(ctx context.Context, tsx string) ([]byte, error) {
	res := api.Transform(tsx, api.TransformOptions{
		Loader:     api.LoaderTSX,
		Format:     api.FormatCommonJS,
		Target:     api.ES2017,
		JSX:        api.JSXAutomatic,
		Sourcefile: "app.tsx",
	})
	if len(res.Errors) > 0 {
		return nil, errors.New(formatEsbuildErrors(res.Errors))
	}
	js := string(res.Code)

	if err := checkImports(js); err != nil {
		return nil, err
	}
	return s.emitBytecode(ctx, wrapForBytecode(js))
}

// wrapForBytecode adapts esbuild's CommonJS output to Hermes' global scope:
// bytecode evaluated via evaluateJavaScript has no injected require/module, so
// the app pre-sets globalThis.__vibeRequire and reads back globalThis.__VIBE_APP.
func wrapForBytecode(cjs string) string {
	return "(function(){\n" +
		"var require=globalThis.__vibeRequire;\n" +
		"var module={exports:{}};var exports=module.exports;\n" +
		cjs + "\n" +
		"globalThis.__VIBE_APP=module.exports.default||module.exports;\n" +
		"})();"
}

// checkImports rejects modules the app cannot provide.
func checkImports(js string) error {
	var bad []string
	for _, m := range requireRe.FindAllStringSubmatch(js, -1) {
		if !allowedImports[m[1]] {
			bad = append(bad, m[1])
		}
	}
	if len(bad) > 0 {
		return fmt.Errorf(
			"app.tsx: forbidden import(s) %s — only \"react\" and \"react-native\" exist",
			strings.Join(bad, ", "),
		)
	}
	return nil
}

// emitBytecode compiles the JS to a Hermes bytecode bundle with hermesc and
// returns it. A hermesc failure doubles as the validation signal fed back to
// the model on retry.
func (s *Service) emitBytecode(ctx context.Context, js string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "vibe-hermes-*")
	if err != nil {
		return nil, fmt.Errorf("hermes compile: %w", err)
	}
	defer os.RemoveAll(dir)

	src := filepath.Join(dir, "app.js")
	if err := os.WriteFile(src, []byte(js), 0o600); err != nil {
		return nil, fmt.Errorf("hermes compile: %w", err)
	}

	out := filepath.Join(dir, "app.hbc")
	cmd := exec.CommandContext(ctx, s.hermesc, "-emit-binary", "-out", out, src)
	if output, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("hermes rejected the code:\n%s", string(output))
	}

	hbc, err := os.ReadFile(out)
	if err != nil {
		return nil, fmt.Errorf("hermes compile: read bytecode: %w", err)
	}
	return hbc, nil
}

// stripFences removes a wrapping markdown code fence if the model added one.
func stripFences(content string) string {
	code := strings.TrimSpace(content)
	if !strings.HasPrefix(code, "```") {
		return code
	}
	if idx := strings.Index(code, "\n"); idx != -1 {
		code = code[idx+1:]
	}
	code = strings.TrimSuffix(strings.TrimSpace(code), "```")
	return strings.TrimSpace(code)
}

func formatEsbuildErrors(errs []api.Message) string {
	var b strings.Builder
	for i, e := range errs {
		if i > 0 {
			b.WriteString("\n")
		}
		if e.Location != nil {
			fmt.Fprintf(&b, "%s:%d:%d: %s",
				e.Location.File, e.Location.Line, e.Location.Column, e.Text)
			if e.Location.LineText != "" {
				fmt.Fprintf(&b, "\n  %s", e.Location.LineText)
			}
		} else {
			b.WriteString(e.Text)
		}
	}
	return b.String()
}
