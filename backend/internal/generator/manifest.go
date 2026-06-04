package generator

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed host-sdk.json
var hostSDKRaw []byte

// sdkModule is one entry in the host SDK manifest. Host modules are provided by
// the device at runtime and treated as externals by the bundler; purejs modules
// are vendored on the backend and bundled into the output.
type sdkModule struct {
	Module string `json:"module"`
	Kind   string `json:"kind"`
	Docs   string `json:"docs"`
}

type hostSDK struct {
	Modules []sdkModule `json:"modules"`
}

func loadHostSDK() (*hostSDK, error) {
	var h hostSDK
	if err := json.Unmarshal(hostSDKRaw, &h); err != nil {
		return nil, fmt.Errorf("parse host-sdk.json: %w", err)
	}
	if len(h.Modules) == 0 {
		return nil, fmt.Errorf("host-sdk.json defines no modules")
	}
	return &h, nil
}

// externals are the module specifiers esbuild must leave as runtime requires.
func (h *hostSDK) externals() []string {
	var out []string
	for _, m := range h.Modules {
		if m.Kind == "host" {
			out = append(out, m.Module)
		}
	}
	return out
}

// allModules lists every importable specifier, host and vendored alike.
func (h *hostSDK) allModules() []string {
	out := make([]string, 0, len(h.Modules))
	for _, m := range h.Modules {
		out = append(out, m.Module)
	}
	return out
}

// docs renders the importable surface for injection into the system prompt.
func (h *hostSDK) docs() string {
	var b strings.Builder
	for _, m := range h.Modules {
		if strings.TrimSpace(m.Docs) == "" {
			continue
		}
		fmt.Fprintf(&b, "- \"%s\" — %s\n", m.Module, m.Docs)
	}
	return strings.TrimRight(b.String(), "\n")
}
