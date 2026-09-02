package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	// Embedded assets must be revalidated so a redeploy isn't hidden behind a
	// stale browser/CDN cache.
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache", got)
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

func TestHandleFile_ContentTypeByExtension(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"a.md":        "text/plain; charset=utf-8",
		"spec.allium": "text/plain; charset=utf-8",
		"doc.pdf":     "application/pdf",
		"d.docx":      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"s.xlsx":      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"p.pptx":      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	}
	for name := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	for name, wantCT := range files {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path="+name, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", name, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != wantCT {
			t.Fatalf("%s: content-type %q, want %q", name, ct, wantCT)
		}
	}
}

func TestHandleFile_BinaryBytesIntact(t *testing.T) {
	root := t.TempDir()
	// bytes that are not valid UTF-8 — must survive round-trip unchanged
	raw := []byte{0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80}
	if err := os.WriteFile(filepath.Join(root, "b.pdf"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=b.pdf", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), raw) {
		t.Fatalf("body bytes %v, want %v", rec.Body.Bytes(), raw)
	}
}

func TestHandleFile_DownloadSetsContentDisposition(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "report.pdf"), []byte("PDFDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=report.pdf&download=1", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	got := rec.Header().Get("Content-Disposition")
	want := `attachment; filename="report.pdf"`
	if got != want {
		t.Fatalf("Content-Disposition %q, want %q", got, want)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("Content-Type %q, want application/pdf", ct)
	}
	if rec.Body.String() != "PDFDATA" {
		t.Fatalf("body %q", rec.Body.String())
	}
}

func TestHandleFile_DownloadUsesBasename(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "intro.md"), []byte("# hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=docs/intro.md&download=1", nil))
	if got := rec.Header().Get("Content-Disposition"); got != `attachment; filename="intro.md"` {
		t.Fatalf("Content-Disposition %q, want basename intro.md", got)
	}
}

func TestHandleFile_DownloadSanitizesFilename(t *testing.T) {
	root := t.TempDir()
	name := "a\"b\x01.md"
	if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
		t.Skipf("OS rejected test filename: %v", err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/file?path="+url.PathEscape(name)+"&download=1", nil))
	cd := rec.Header().Get("Content-Disposition")
	if strings.ContainsAny(cd[len("attachment; filename=\""):], "\x01") {
		t.Fatalf("control char leaked into header: %q", cd)
	}
	inner := strings.TrimSuffix(strings.TrimPrefix(cd, `attachment; filename="`), `"`)
	// A raw, unescaped double-quote would break the header. An escaped \" is fine.
	if strings.Contains(strings.ReplaceAll(inner, `\"`, ""), `"`) {
		t.Fatalf("raw double-quote leaked into filename value: %q", cd)
	}
}

func TestHandleFile_NoDownloadParamOmitsContentDisposition(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=a.md", nil))
	if cd := rec.Header().Get("Content-Disposition"); cd != "" {
		t.Fatalf("Content-Disposition should be absent for inline requests, got %q", cd)
	}
}

func TestHandleFile_MediaContentTypeByExtension(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"v.mp4":  "video/mp4",
		"v.webm": "video/webm",
		"v.MOV":  "video/quicktime",
		"i.png":  "image/png",
		"i.jpg":  "image/jpeg",
		"i.jpeg": "image/jpeg",
		"i.gif":  "image/gif",
		"i.webp": "image/webp",
		"i.svg":  "image/svg+xml",
		"a.wav":  "audio/wav",
		"a.mp3":  "audio/mpeg",
	}
	for name := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte("media-bytes"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	for name, wantCT := range files {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path="+name, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", name, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != wantCT {
			t.Fatalf("%s: content-type %q, want %q", name, ct, wantCT)
		}
		if rec.Body.String() != "media-bytes" {
			t.Fatalf("%s: body %q", name, rec.Body.String())
		}
	}
}

func TestHandleFile_MediaSupportsRangeRequests(t *testing.T) {
	root := t.TempDir()
	// 100 known bytes so range offsets are easy to assert.
	raw := make([]byte, 100)
	for i := range raw {
		raw[i] = byte(i)
	}
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)

	// Full GET advertises byte-range support.
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=clip.mp4", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if ar := rec.Header().Get("Accept-Ranges"); ar != "bytes" {
		t.Fatalf("Accept-Ranges %q, want %q", ar, "bytes")
	}

	// A Range request gets 206 with exactly the requested slice.
	req := httptest.NewRequest(http.MethodGet, "/api/file?path=clip.mp4", nil)
	req.Header.Set("Range", "bytes=10-19")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status %d, want 206", rec.Code)
	}
	if cr := rec.Header().Get("Content-Range"); cr != "bytes 10-19/100" {
		t.Fatalf("Content-Range %q, want %q", cr, "bytes 10-19/100")
	}
	if !bytes.Equal(rec.Body.Bytes(), raw[10:20]) {
		t.Fatalf("body %v, want %v", rec.Body.Bytes(), raw[10:20])
	}
	if ct := rec.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("content-type %q, want video/mp4", ct)
	}
}

func TestHandleFile_MediaHeadRequest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "pic.png"), []byte("pngbytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/api/file?path=pic.png", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("HEAD body %d bytes, want 0", rec.Body.Len())
	}

	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/api/file?path=missing.png", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing: status %d, want 404", rec.Code)
	}
}

func TestHandleFile_MediaMissingIs404(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=nope.mp4", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

func TestHandleFile_MediaDownloadSetsContentDisposition(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "song.mp3"), []byte("mp3"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=song.mp3&download=1", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	want := `attachment; filename="song.mp3"`
	if cd := rec.Header().Get("Content-Disposition"); cd != want {
		t.Fatalf("Content-Disposition %q, want %q", cd, want)
	}
}

func TestHandleAssets_VersionedMirror(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v2/", nil))
	if rec.Code != 200 || rec.Body.String() != "<p>app</p>" {
		t.Fatalf("/v2/ status %d body %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("/v2/ Cache-Control = %q, want no-cache", got)
	}
}
