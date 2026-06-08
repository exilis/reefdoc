package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/exilis/reefdoc/internal/server"
)

// TestEmbeddedWebAssetsAreServed guards the //go:embed directive against drift.
// Every static asset under web/ that the browser loads (.html/.css/.js, except
// node test files) must be embedded and served with 200. The frontend has no
// bundler — index.html loads /app.js as a native ES module and relative imports
// (./recency.js, ./render.js, …) are fetched from this server at runtime — so a
// file missing from the //go:embed list 404s and breaks the whole module graph.
// go build and the unit tests do NOT catch that; this test does.
func TestEmbeddedWebAssetsAreServed(t *testing.T) {
	entries, err := os.ReadDir("web")
	if err != nil {
		t.Fatal(err)
	}

	assets, err := fs.Sub(webFS, "web")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.New(t.TempDir(), server.NewBroker(), assets, nil).Handler())
	defer ts.Close()

	var checked int
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			continue
		}
		// Only the assets the browser actually requests. *.test.js are Node
		// test files that are neither embedded nor served.
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".html" && ext != ".css" && ext != ".js" {
			continue
		}
		if strings.HasSuffix(name, ".test.js") {
			continue
		}
		checked++

		resp, err := http.Get(ts.URL + "/" + name)
		if err != nil {
			t.Fatalf("GET /%s: %v", name, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET /%s = %d, want 200 — is web/%s missing from the //go:embed directive in main.go?",
				name, resp.StatusCode, name)
		}
	}
	if checked == 0 {
		t.Fatal("no web assets found to check — wrong working directory?")
	}
}
