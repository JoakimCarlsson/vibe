package generator

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
)

// File is one source file in a generated project.
type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

var fileHeaderRe = regexp.MustCompile(`(?m)^[ \t]*===[ \t]*FILE:[ \t]*(.+?)[ \t]*===[ \t]*$`)

// parseFileMap turns the model's fenced "=== FILE: path ===" output into an
// ordered list of files. Output with no markers is treated as a single
// App.tsx, so older single-file responses still work.
func parseFileMap(raw string) ([]File, error) {
	s := stripFences(raw)

	headers := fileHeaderRe.FindAllStringSubmatchIndex(s, -1)
	if len(headers) == 0 {
		body := strings.TrimSpace(s)
		if body == "" {
			return nil, errors.New("model returned no code")
		}
		return []File{{Path: "App.tsx", Content: body + "\n"}}, nil
	}

	var files []File
	for i, h := range headers {
		name := normalizePath(s[h[2]:h[3]])
		bodyStart := h[1]
		bodyEnd := len(s)
		if i+1 < len(headers) {
			bodyEnd = headers[i+1][0]
		}
		content := cleanFileBody(s[bodyStart:bodyEnd])
		if name == "" || content == "" {
			continue
		}
		files = append(files, File{Path: name, Content: content})
	}
	if len(files) == 0 {
		return nil, errors.New("no files parsed from model output")
	}
	return files, nil
}

// renderFileMap serializes files back into the wire format for edit prompts.
func renderFileMap(files []File) string {
	var b strings.Builder
	for _, f := range files {
		fmt.Fprintf(&b, "=== FILE: %s ===\n%s\n", f.Path, strings.TrimRight(f.Content, "\n"))
	}
	return strings.TrimRight(b.String(), "\n")
}

// entryPoint picks the root module esbuild bundles from.
func entryPoint(files []File) string {
	for _, want := range []string{"App.tsx", "App.ts", "App.jsx", "App.js"} {
		for _, f := range files {
			if f.Path == want {
				return f.Path
			}
		}
	}
	if len(files) == 1 {
		return files[0].Path
	}
	return ""
}

func cleanFileBody(body string) string {
	b := strings.TrimSpace(body)
	if strings.HasPrefix(b, "```") {
		if nl := strings.IndexByte(b, '\n'); nl != -1 {
			b = b[nl+1:]
		}
		b = strings.TrimSuffix(strings.TrimRight(b, " \t\n"), "```")
	}
	b = strings.TrimSpace(b)
	if b == "" {
		return ""
	}
	return b + "\n"
}

func normalizePath(p string) string {
	p = strings.ReplaceAll(strings.TrimSpace(p), "\\", "/")
	p = strings.TrimPrefix(p, "./")
	p = strings.TrimPrefix(p, "/")
	cleaned := path.Clean(p)
	if cleaned == "." || cleaned == "" || strings.HasPrefix(cleaned, "..") {
		return ""
	}
	return cleaned
}
