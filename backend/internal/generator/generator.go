// Package generator turns a user prompt into a runnable React Native app:
// LLM → multi-file project → esbuild bundle → hermesc validation, feeding
// build errors back to the model for a bounded number of retries.
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
	"strings"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/joakimcarlsson/ai/llm"
	llmanthropic "github.com/joakimcarlsson/ai/llm/anthropic"
	"github.com/joakimcarlsson/ai/message"
	"github.com/joakimcarlsson/ai/model"
	"github.com/joakimcarlsson/ai/prompt"
	"github.com/joakimcarlsson/ai/types"

	"github.com/joakimcarlsson/vibe/internal/config"
)

var logger = slog.With("subsystem", "generator")

//go:embed prompts/system.md
var systemTemplate string

//go:embed prompts/planner.md
var plannerTemplate string

//go:embed prompts/retry.md
var retryTemplate string

// Service generates and validates React Native apps from prompts.
type Service struct {
	client       llm.LLM
	hermesc      string
	tsc          string
	vendorDir    string
	systemPrompt  string
	plannerPrompt string
	externals     []string
	ambient       []string
	maxAttempts   int
}

// Command is one generation request: a fresh build (Prompt only), an edit
// (Prompt + Files), or a runtime repair (Files + RuntimeError, Prompt optional).
type Command struct {
	Prompt       string
	Files        []File
	RuntimeError string
}

// Result is a successfully generated and compiled app.
type Result struct {
	// Files is the generated project as the model wrote it, for display and edits.
	Files []File
	// HBC is the Hermes bytecode the app evaluates on its runtime.
	HBC []byte
	// Brief is the design/architecture brief the planner produced, if any.
	Brief string
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

	sdk, err := loadHostSDK()
	if err != nil {
		return nil, err
	}

	// Prod builds with Sonnet for stronger, larger apps; DEV trades that for
	// Haiku's speed and cost during local iteration.
	genModel, maxTokens := model.Claude46Sonnet, int64(32000)
	if cfg.Dev {
		genModel, maxTokens = model.Claude45Haiku, int64(16000)
	}
	logger.Info("generator model selected", "model", genModel, "max_tokens", maxTokens, "dev", cfg.Dev)

	// Note: the request timeout is applied per-call in send() via the context,
	// not via WithTimeout. StreamResponse sets up its timeout context with a
	// `defer cancel()` that fires the moment it returns the channel, so a
	// client-level timeout would cancel the stream immediately.
	client := llmanthropic.NewLLM(
		llmanthropic.WithAPIKey(cfg.AnthropicAPIKey),
		llmanthropic.WithModel(model.AnthropicModels[genModel]),
		llmanthropic.WithMaxTokens(maxTokens),
	)

	return &Service{
		client:       client,
		hermesc:      hermesc,
		tsc:          findTSC(),
		vendorDir:    findVendorDir(),
		systemPrompt:  renderSystemPrompt(sdk),
		plannerPrompt: renderPlannerPrompt(sdk),
		externals:     sdk.externals(),
		ambient:       sdk.allModules(),
		maxAttempts:   max(cfg.MaxAttempts, 1),
	}, nil
}

// Generate runs the full pipeline for one command.
func (s *Service) Generate(ctx context.Context, cmd Command) (*Result, error) {
	logger.InfoContext(ctx, "generation started",
		"prompt", cmd.Prompt, "edit", len(cmd.Files) > 0, "repair", cmd.RuntimeError != "")

	var brief string
	if len(cmd.Files) == 0 {
		b, err := s.plan(ctx, cmd.Prompt)
		if err != nil {
			logger.WarnContext(ctx, "planning failed; building without a brief", "err", err)
		} else {
			brief = b
			logger.InfoContext(ctx, "planning complete", "brief_chars", len(brief))
			logger.DebugContext(ctx, "design brief", "brief", brief)
		}
	}

	msgs := []message.Message{
		message.NewSystemMessage(s.systemPrompt),
		message.NewUserMessage(buildUserMessage(cmd, brief)),
	}

	var lastErr error
	for attempt := 1; attempt <= s.maxAttempts; attempt++ {
		resp, err := s.send(ctx, msgs)
		if err != nil {
			logger.ErrorContext(ctx, "llm call failed", "attempt", attempt, "err", err)
			return nil, fmt.Errorf("llm call: %w", err)
		}

		files, buildErr := parseFileMap(resp.Content)
		var hbc []byte
		if buildErr == nil {
			logger.InfoContext(ctx, "model responded",
				"attempt", attempt,
				"input_tokens", resp.Usage.InputTokens,
				"output_tokens", resp.Usage.OutputTokens,
				"finish_reason", resp.FinishReason,
				"files", len(files),
			)
			hbc, buildErr = s.compile(ctx, files)
		}
		if buildErr == nil {
			logger.InfoContext(ctx, "generation succeeded",
				"attempt", attempt, "files", len(files), "hbc_bytes", len(hbc))
			return &Result{Files: files, HBC: hbc, Brief: brief, Attempts: attempt}, nil
		}

		logger.WarnContext(ctx, "generated app failed to build",
			"attempt", attempt, "err", buildErr)
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
		"generated app failed to build after %d attempts: %w",
		s.maxAttempts, lastErr,
	)
}

// generationTimeout bounds a single streamed completion. It is generous because
// a full Sonnet generation at the configured token budget can take minutes.
const generationTimeout = 10 * time.Minute

// send streams a single completion and returns the full response once the
// stream completes. Streaming is mandatory: the generator's token budget can
// exceed the API's non-streaming 10-minute limit, which rejects the request
// outright. The channel is drained to completion so the provider's stream
// goroutine always finishes rather than leaking on an early return.
func (s *Service) send(ctx context.Context, msgs []message.Message) (*llm.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, generationTimeout)
	defer cancel()

	var resp *llm.Response
	var streamErr error
	for evt := range s.client.StreamResponse(ctx, msgs, nil) {
		switch evt.Type {
		case types.EventComplete:
			resp = evt.Response
		case types.EventError:
			streamErr = evt.Error
		}
	}
	if streamErr != nil {
		return nil, streamErr
	}
	if resp == nil {
		return nil, errors.New("stream ended without a response")
	}
	return resp, nil
}

// plan runs the design pass: it turns the one-line idea into a concrete build
// brief (concept, aesthetic, data source, layout, interactions) that the
// code-gen pass then implements. Its failure is non-fatal — the caller falls
// back to generating straight from the prompt.
func (s *Service) plan(ctx context.Context, userPrompt string) (string, error) {
	resp, err := s.send(ctx, []message.Message{
		message.NewSystemMessage(s.plannerPrompt),
		message.NewUserMessage(userPrompt),
	})
	if err != nil {
		return "", fmt.Errorf("planner call: %w", err)
	}
	brief := strings.TrimSpace(stripFences(resp.Content))
	if brief == "" {
		return "", errors.New("planner returned an empty brief")
	}
	return brief, nil
}

// buildUserMessage frames a runtime repair (current project crashed with an
// error), an edit (current project plus a requested change), or a fresh build
// (the prompt, optionally guided by a design brief).
func buildUserMessage(cmd Command, brief string) string {
	if cmd.RuntimeError != "" && len(cmd.Files) > 0 {
		msg := "The current project below built successfully but CRASHED AT RUNTIME on the " +
			"device with the error:\n\n" + cmd.RuntimeError + "\n\n" +
			"Diagnose the root cause, fix the bug, and return the COMPLETE updated project " +
			"as a file map, following all the same rules. Do not just guard the symptom — " +
			"remove the actual cause (e.g. calling a non-function, reading a property of " +
			"undefined, a bad hook usage)."
		if strings.TrimSpace(cmd.Prompt) != "" {
			msg += "\n\nAlso keep this in mind: " + cmd.Prompt
		}
		return msg + "\n\n" + renderFileMap(cmd.Files)
	}
	if len(cmd.Files) > 0 {
		return "Here is the current project:\n\n" + renderFileMap(cmd.Files) +
			"\n\nApply this change and return the COMPLETE updated project as a file map, " +
			"following all the same rules:\n\n" + cmd.Prompt
	}
	if brief != "" {
		return "Build this app: " + cmd.Prompt + "\n\n" +
			"A designer has produced the build brief below. Follow it faithfully — " +
			"honor the concept, aesthetic, data source, and layout it specifies, " +
			"refining details only where they improve the result:\n\n" + brief
	}
	return cmd.Prompt
}

// renderRetry fills the retry template with the build output.
func renderRetry(buildErr error) (string, error) {
	return prompt.Process(retryTemplate, map[string]any{
		"errors": buildErr.Error(),
	})
}

// renderSystemPrompt injects the host SDK surface into the system prompt.
func renderSystemPrompt(sdk *hostSDK) string {
	return strings.ReplaceAll(systemTemplate, "{{HOST_SDK}}", sdk.docs())
}

// renderPlannerPrompt injects the host SDK surface into the planner prompt so
// the design pass plans only around capabilities the engineer can actually build.
func renderPlannerPrompt(sdk *hostSDK) string {
	return strings.ReplaceAll(plannerTemplate, "{{HOST_SDK}}", sdk.docs())
}

// compile writes the project to a temp dir, bundles it with esbuild (host
// modules external, vendored deps inlined), type-checks it, then compiles the
// bundle to Hermes bytecode the app evaluates directly on its runtime.
func (s *Service) compile(ctx context.Context, files []File) ([]byte, error) {
	entry := entryPoint(files)
	if entry == "" {
		return nil, errors.New("project is missing an App.tsx entry point with a default export")
	}

	dir, err := os.MkdirTemp("", "vibe-build-*")
	if err != nil {
		return nil, fmt.Errorf("build: %w", err)
	}
	defer os.RemoveAll(dir)

	for _, f := range files {
		dst := filepath.Join(dir, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, fmt.Errorf("build: %w", err)
		}
		if err := os.WriteFile(dst, []byte(f.Content), 0o600); err != nil {
			return nil, fmt.Errorf("build: %w", err)
		}
	}

	opts := api.BuildOptions{
		EntryPoints:   []string{filepath.Join(dir, filepath.FromSlash(entry))},
		AbsWorkingDir: dir,
		Bundle:        true,
		Format:        api.FormatCommonJS,
		Target:        api.ES2017,
		JSX:           api.JSXAutomatic,
		External:      s.externals,
		Write:         false,
		LogLevel:      api.LogLevelSilent,
	}
	if s.vendorDir != "" {
		opts.NodePaths = []string{s.vendorDir}
	}

	res := api.Build(opts)
	if len(res.Errors) > 0 {
		return nil, errors.New(formatEsbuildErrors(res.Errors, dir))
	}
	if len(res.OutputFiles) == 0 {
		return nil, errors.New("esbuild produced no output")
	}

	if err := s.typecheck(ctx, dir, entry); err != nil {
		return nil, err
	}

	return s.emitBytecode(ctx, wrapForBytecode(string(res.OutputFiles[0].Contents)))
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

func formatEsbuildErrors(errs []api.Message, dir string) string {
	var b strings.Builder
	for i, e := range errs {
		if i > 0 {
			b.WriteString("\n")
		}
		if e.Location != nil {
			file := strings.TrimPrefix(e.Location.File, dir+string(filepath.Separator))
			file = strings.TrimPrefix(file, dir+"/")
			fmt.Fprintf(&b, "%s:%d:%d: %s", file, e.Location.Line, e.Location.Column, e.Text)
			if e.Location.LineText != "" {
				fmt.Fprintf(&b, "\n  %s", e.Location.LineText)
			}
		} else {
			b.WriteString(e.Text)
		}
	}
	return b.String()
}
