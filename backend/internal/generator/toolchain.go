package generator

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// findVendorDir locates the curated pure-JS dependency tree the bundler inlines,
// or returns "" when none is vendored.
func findVendorDir() string {
	for _, candidate := range []string{"jsdeps/node_modules", "backend/jsdeps/node_modules"} {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			abs, err := filepath.Abs(candidate)
			if err == nil {
				return abs
			}
		}
	}
	return ""
}

// findTSC locates a tsc binary for the optional typecheck pass, or "" if absent.
func findTSC() string {
	if path, err := exec.LookPath("tsc"); err == nil {
		return path
	}
	return ""
}

// typecheck runs tsc --noEmit over the generated project when a tsc binary is
// available. Host and vendored modules are declared as ambient any so the pass
// catches real type and reference errors in the generated code without needing
// the full type definitions on disk. It is a no-op when tsc is not installed.
func (s *Service) typecheck(ctx context.Context, dir, entry string) error {
	if s.tsc == "" {
		return nil
	}

	ambient := s.ambientDeclarations()
	if err := os.WriteFile(filepath.Join(dir, "vibe-ambient.d.ts"), []byte(ambient), 0o600); err != nil {
		return fmt.Errorf("typecheck: %w", err)
	}

	tsconfig := `{
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "module": "esnext",
    "target": "es2020",
    "moduleResolution": "bundler",
    "strict": false,
    "noImplicitAny": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": false,
    "types": []
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(tsconfig), 0o600); err != nil {
		return fmt.Errorf("typecheck: %w", err)
	}

	cmd := exec.CommandContext(ctx, s.tsc, "--noEmit", "-p", "tsconfig.json")
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if _, ok := err.(*exec.ExitError); !ok {
		logger.WarnContext(ctx, "tsc could not run; skipping typecheck", "err", err)
		return nil
	}

	report := strings.ReplaceAll(string(output), dir+string(filepath.Separator), "")
	report = strings.ReplaceAll(report, dir+"/", "")
	report = strings.TrimSpace(report)
	if report == "" {
		return nil
	}
	return fmt.Errorf("the TypeScript compiler reported errors:\n%s", report)
}

func (s *Service) ambientDeclarations() string {
	var b strings.Builder
	for _, m := range s.ambient {
		fmt.Fprintf(&b, "declare module %q;\n", m)
	}
	return b.String()
}
