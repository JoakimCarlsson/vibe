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
	return findNodeModules("jsdeps/node_modules", "backend/jsdeps/node_modules")
}

// findTypeDir locates the real type-definition tree the typecheck pass resolves
// against, or returns "" when it is not present (the pass then falls back to
// declaring every host module as ambient `any`).
func findTypeDir() string {
	return findNodeModules("typedeps/node_modules", "backend/typedeps/node_modules")
}

func findNodeModules(candidates ...string) string {
	for _, candidate := range candidates {
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
// available. When the real type tree is present it is linked in so tsc resolves
// actual SDK types — catching non-callable values, missing exports, and wrong
// argument types before the app ships. Modules without real types (and any when
// the link can't be made) fall back to ambient `any`. A no-op without tsc.
func (s *Service) typecheck(ctx context.Context, dir string) error {
	if s.tsc == "" {
		return nil
	}

	realTyped := false
	if s.typeDir != "" {
		link := filepath.Join(dir, "node_modules")
		if err := os.Symlink(s.typeDir, link); err == nil {
			realTyped = true
			defer func() { _ = os.Remove(link) }()
		} else {
			logger.WarnContext(ctx, "could not link type deps; using ambient types", "err", err)
		}
	}

	ambient := s.ambientDeclarations(realTyped)
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
    "strictNullChecks": true,
    "noImplicitAny": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
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

// ambientDeclarations declares host modules as ambient `any`. When the real
// type tree is linked, modules it actually provides are skipped so their real
// types win; the rest (e.g. the expo-* modules and @vibe/router) stay ambient.
func (s *Service) ambientDeclarations(realTyped bool) string {
	var b strings.Builder
	for _, m := range s.ambient {
		if realTyped && hasTypes(s.typeDir, m) {
			continue
		}
		fmt.Fprintf(&b, "declare module %q;\n", m)
	}
	return b.String()
}

// hasTypes reports whether the real type tree provides the package backing an
// import specifier (e.g. "react/jsx-runtime" → the "react" package).
func hasTypes(typeDir, module string) bool {
	if typeDir == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(typeDir, filepath.FromSlash(packageRoot(module))))
	return err == nil && info.IsDir()
}

// packageRoot returns the installed package name for an import specifier:
// "@scope/pkg/sub" → "@scope/pkg", "react/jsx-runtime" → "react".
func packageRoot(module string) string {
	parts := strings.Split(module, "/")
	if strings.HasPrefix(module, "@") && len(parts) >= 2 {
		return parts[0] + "/" + parts[1]
	}
	return parts[0]
}
