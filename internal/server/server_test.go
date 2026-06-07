package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func newTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.md"), []byte("# hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	assets := fstest.MapFS{"index.html": {Data: []byte("<p>app</p>")}}
	return New(root, NewBroker(), assets, nil), root
}

func TestHandleTree_ReturnsJSON(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tree", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type %q", ct)
	}
}

func TestHandleFile_ReturnsContent(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=a.md", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Body.String() != "# hi" {
		t.Fatalf("body %q", rec.Body.String())
	}
}

func TestHandleFile_MissingIs404(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=nope.md", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

func TestHandleFile_EscapeIs400(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=../../etc/passwd", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
}

func TestHandleAssets_ServesIndex(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != 200 || rec.Body.String() != "<p>app</p>" {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
}

func TestHandleFile_SymlinkEscapeIs400(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.md")
	if err := os.WriteFile(secret, []byte("top secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link.md")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("symlinks not supported on this platform: %v", err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=link.md", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 (in-root symlink pointing outside root must be rejected)", rec.Code)
	}
}

func TestHandleTree_LazyLevel(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "top.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "guide"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "guide", "intro.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tree?path=guide", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var resp struct {
		Path     string `json:"path"`
		Children []struct {
			Name  string `json:"name"`
			Path  string `json:"path"`
			IsDir bool   `json:"isDir"`
		} `json:"children"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Path != "guide" || len(resp.Children) != 1 || resp.Children[0].Name != "intro.md" {
		t.Fatalf("unexpected response: %+v", resp)
	}

	rec2 := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/tree?path=../x", nil))
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("escape status %d, want 400", rec2.Code)
	}
}

func TestHandleSearch_ReturnsMatches(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "intro.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "other.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/search?q=intro", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "intro.md") || strings.Contains(body, "other.md") {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestHandleWatch_ReconcilesAndReturns204(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	broker := NewBroker()
	wch, err := NewWatcher(root, broker)
	if err != nil {
		t.Fatal(err)
	}
	defer wch.Close()
	s := New(root, broker, fstest.MapFS{}, wch)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/watch", strings.NewReader(`{"dirs":["sub"]}`))
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", rec.Code)
	}
}

func TestHandleWatch_GetIs405(t *testing.T) {
	s := New(t.TempDir(), NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/watch", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d, want 405", rec.Code)
	}
}

func TestHandleWatch_BadJSONIs400(t *testing.T) {
	s := New(t.TempDir(), NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/watch", strings.NewReader("not json"))
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
}

func TestHandleTree_MissingDirIs404(t *testing.T) {
	s := New(t.TempDir(), NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tree?path=nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

func TestHandleTree_EmptyDirReturnsEmptyArray(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tree?path=empty", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	// children must serialize as [] (not null)
	var resp struct {
		Children []any `json:"children"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Children == nil {
		t.Fatal("children was null; want empty array []")
	}
	if len(resp.Children) != 0 {
		t.Fatalf("expected 0 children, got %d", len(resp.Children))
	}
	if !strings.Contains(rec.Body.String(), `"children":[]`) {
		t.Fatalf("expected literal []; body: %s", rec.Body.String())
	}
}
