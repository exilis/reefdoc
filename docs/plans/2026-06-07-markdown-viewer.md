# Markdown & Mermaid Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lightweight, local-only Go binary that serves a browser UI for viewing markdown + mermaid documents, with a file-tree navigator, tabs, a TOC, and live reload on file change.

**Architecture:** A Go single binary is a thin file API + change announcer (it knows the filesystem, not markdown). The embedded vanilla-JS frontend does all rendering client-side (markdown-it + highlight.js + mermaid loaded from CDN via an import map). The seam between them is four HTTP endpoints. The server watches the root directory with `fsnotify` and pushes change events over SSE; the browser re-renders only the affected open tabs.

**Tech Stack:** Go (`net/http`, `embed`, `github.com/fsnotify/fsnotify`); vanilla ES-module frontend; markdown-it, markdown-it-task-lists, highlight.js, mermaid via CDN. Frontend pure-logic modules are unit-tested with `node --test` (dev-only npm devDependencies); the Go server is tested with `go test` + `httptest`.

---

## File Structure

```
go.mod                              Go module "reefdoc"
main.go                             CLI entry: flags, embed web/, wire watcher+server, listen
internal/server/safepath.go         SafeJoin: resolve rel path, reject escapes
internal/server/safepath_test.go
internal/server/tree.go             BuildTree: dirs + .md/.markdown only, dirs-first
internal/server/tree_test.go
internal/server/broker.go           SSE pub/sub broker
internal/server/broker_test.go
internal/server/watcher.go          fsnotify recursive watch + debounce → broker
internal/server/watcher_test.go
internal/server/server.go           HTTP handlers: /api/tree, /api/file, /api/events, assets
internal/server/server_test.go
internal/server/e2e_test.go         end-to-end smoke over httptest server
web/index.html                      shell + import map + library CDN URLs
web/app.css                         layout + light/dark themes
web/app.js                          browser-only wiring (tree DOM, tabs DOM, SSE, mermaid init)
web/render.js                       createRenderer(): markdown → html (pure, testable)
web/render.test.js
web/tabs.js                         tab store: pure state functions
web/tabs.test.js
web/tree.js                         filterTree(): pure tree filter
web/tree.test.js
web/toc.js                          buildToc()/slugify(): pure
web/toc.test.js
web/package.json                    dev-only test deps + "node --test" script
```

Each file has one responsibility. The pure-logic modules (`render.js`, `tabs.js`, `tree.js`, `toc.js`) hold the testable behavior; `app.js` is thin DOM/event glue tested by the e2e smoke and by hand.

---

## Task 1: Project scaffold

**Files:**
- Create: `go.mod`
- Create: `main.go`
- Create: `web/index.html` (placeholder so `//go:embed web` compiles)

- [ ] **Step 1: Initialize the module and dependency**

Run:
```bash
cd /home/exilis/work_remote/reefdoc
go mod init reefdoc
go get github.com/fsnotify/fsnotify@latest
```
Expected: `go.mod` created with module `reefdoc` and an `fsnotify` require line.

- [ ] **Step 2: Create a placeholder embed asset**

Create `web/index.html`:
```html
<!doctype html><title>reefdoc</title><p>scaffold</p>
```

- [ ] **Step 3: Write a minimal `main.go` that compiles**

Create `main.go`:
```go
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
)

//go:embed all:web
var webFS embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	flag.Parse()

	root := "."
	if flag.NArg() > 0 {
		root = flag.Arg(0)
	}
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		log.Fatalf("not a directory: %s", root)
	}

	assets, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(assets)))

	fmt.Printf("reefdoc serving %s at http://%s\n", root, *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
```

- [ ] **Step 4: Verify it builds and runs**

Run:
```bash
go build ./... && echo BUILD_OK
```
Expected: `BUILD_OK` and no errors.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum main.go web/index.html
git commit -m "feat: scaffold reefdoc module with embedded web assets"
```

---

## Task 2: Safe path resolution (the security boundary)

**Files:**
- Create: `internal/server/safepath.go`
- Test: `internal/server/safepath_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/server/safepath_test.go`:
```go
package server

import (
	"path/filepath"
	"testing"
)

func TestSafeJoin_AllowsInRoot(t *testing.T) {
	root := t.TempDir()
	got, err := SafeJoin(root, "docs/readme.md")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := filepath.Join(root, "docs", "readme.md")
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestSafeJoin_RejectsEscapes(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"../secret", "../../etc/passwd", "docs/../../x"} {
		if _, err := SafeJoin(root, rel); err == nil {
			t.Errorf("expected error for %q, got nil", rel)
		}
	}
}

func TestSafeJoin_RejectsAbsolute(t *testing.T) {
	root := t.TempDir()
	if _, err := SafeJoin(root, "/etc/passwd"); err == nil {
		t.Error("expected error for absolute path, got nil")
	}
}
```

- [ ] **Step 2: Run it to confirm it fails to compile**

Run: `go test ./internal/server/ -run TestSafeJoin -v`
Expected: FAIL — `undefined: SafeJoin`.

- [ ] **Step 3: Implement `SafeJoin`**

Create `internal/server/safepath.go`:
```go
package server

import (
	"errors"
	"path/filepath"
	"strings"
)

// ErrUnsafePath means the requested path resolved outside the root.
var ErrUnsafePath = errors.New("path escapes root")

// SafeJoin resolves rel against root and returns the absolute path, but only
// if the result stays within root. filepath.Join cleans the path (resolving
// "..") before the prefix check, so traversal attempts are rejected.
func SafeJoin(root, rel string) (string, error) {
	if filepath.IsAbs(rel) {
		return "", ErrUnsafePath
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	joined := filepath.Join(absRoot, rel)
	if joined != absRoot && !strings.HasPrefix(joined, absRoot+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	return joined, nil
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `go test ./internal/server/ -run TestSafeJoin -v`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add internal/server/safepath.go internal/server/safepath_test.go
git commit -m "feat: SafeJoin path resolution rejecting traversal and absolute paths"
```

---

## Task 3: Tree builder

**Files:**
- Create: `internal/server/tree.go`
- Test: `internal/server/tree_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/server/tree_test.go`:
```go
package server

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBuildTree_FiltersAndOrders(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "b.md"))
	writeFile(t, filepath.Join(root, "a.markdown"))
	writeFile(t, filepath.Join(root, "ignore.txt"))
	writeFile(t, filepath.Join(root, "sub", "deep.md"))
	writeFile(t, filepath.Join(root, "empty", "nothing.txt"))

	node, err := BuildTree(root)
	if err != nil {
		t.Fatal(err)
	}
	// Dirs first, then files; "empty" dir (no markdown) omitted.
	var names []string
	for _, c := range node.Children {
		names = append(names, c.Name)
	}
	want := []string{"sub", "a.markdown", "b.md"}
	if len(names) != len(want) {
		t.Fatalf("got %v want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("got %v want %v", names, want)
		}
	}
	if node.Children[0].Children[0].Path != "sub/deep.md" {
		t.Fatalf("unexpected child path: %q", node.Children[0].Children[0].Path)
	}
}

func TestBuildTree_EmptyRoot(t *testing.T) {
	node, err := BuildTree(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(node.Children) != 0 {
		t.Fatalf("expected no children, got %d", len(node.Children))
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `go test ./internal/server/ -run TestBuildTree -v`
Expected: FAIL — `undefined: BuildTree`.

- [ ] **Step 3: Implement the tree builder**

Create `internal/server/tree.go`:
```go
package server

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Node is a directory or markdown file in the tree. Path is relative to the
// root, slash-separated. Directories with no markdown descendants are omitted.
type Node struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	IsDir    bool    `json:"isDir"`
	Children []*Node `json:"children,omitempty"`
}

func isMarkdown(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".markdown"
}

// BuildTree builds the document tree rooted at root.
func BuildTree(root string) (*Node, error) {
	return buildNode(root, "")
}

func buildNode(absPath, relPath string) (*Node, error) {
	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}
	node := &Node{
		Name:  filepath.Base(absPath),
		Path:  filepath.ToSlash(relPath),
		IsDir: true,
	}
	for _, e := range entries {
		childRel := filepath.Join(relPath, e.Name())
		childAbs := filepath.Join(absPath, e.Name())
		if e.IsDir() {
			child, err := buildNode(childAbs, childRel)
			if err != nil {
				continue
			}
			if len(child.Children) > 0 {
				node.Children = append(node.Children, child)
			}
		} else if isMarkdown(e.Name()) {
			node.Children = append(node.Children, &Node{
				Name:  e.Name(),
				Path:  filepath.ToSlash(childRel),
				IsDir: false,
			})
		}
	}
	sort.Slice(node.Children, func(i, j int) bool {
		a, b := node.Children[i], node.Children[j]
		if a.IsDir != b.IsDir {
			return a.IsDir // directories first
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return node, nil
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `go test ./internal/server/ -run TestBuildTree -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add internal/server/tree.go internal/server/tree_test.go
git commit -m "feat: BuildTree producing dirs-first markdown-only tree"
```

---

## Task 4: SSE broker

**Files:**
- Create: `internal/server/broker.go`
- Test: `internal/server/broker_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/server/broker_test.go`:
```go
package server

import "testing"

func TestBroker_BroadcastReachesSubscribers(t *testing.T) {
	b := NewBroker()
	a := b.Subscribe()
	c := b.Subscribe()
	b.Broadcast("hello")
	if got := <-a; got != "hello" {
		t.Fatalf("a got %q", got)
	}
	if got := <-c; got != "hello" {
		t.Fatalf("c got %q", got)
	}
}

func TestBroker_UnsubscribeStopsDelivery(t *testing.T) {
	b := NewBroker()
	ch := b.Subscribe()
	b.Unsubscribe(ch)
	if _, ok := <-ch; ok {
		t.Fatal("expected channel closed after unsubscribe")
	}
	b.Broadcast("x") // must not panic on a closed/removed channel
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `go test ./internal/server/ -run TestBroker -v`
Expected: FAIL — `undefined: NewBroker`.

- [ ] **Step 3: Implement the broker**

Create `internal/server/broker.go`:
```go
package server

import "sync"

// Broker fans out string messages to all subscribed SSE clients.
type Broker struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func NewBroker() *Broker {
	return &Broker{clients: make(map[chan string]struct{})}
}

func (b *Broker) Subscribe() chan string {
	ch := make(chan string, 16)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Broker) Unsubscribe(ch chan string) {
	b.mu.Lock()
	if _, ok := b.clients[ch]; ok {
		delete(b.clients, ch)
		close(ch)
	}
	b.mu.Unlock()
}

// Broadcast delivers msg to every subscriber, dropping the message for any
// subscriber whose buffer is full rather than blocking.
func (b *Broker) Broadcast(msg string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `go test ./internal/server/ -run TestBroker -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add internal/server/broker.go internal/server/broker_test.go
git commit -m "feat: SSE broker with buffered fan-out"
```

---

## Task 5: File watcher with debounce

**Files:**
- Create: `internal/server/watcher.go`
- Test: `internal/server/watcher_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/server/watcher_test.go`:
```go
package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// waitForMsg reads from ch until pred returns true or it times out.
func waitForMsg(t *testing.T, ch chan string, pred func(map[string]string) bool) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case raw := <-ch:
			var m map[string]string
			if err := json.Unmarshal([]byte(raw), &m); err != nil {
				t.Fatalf("bad json %q: %v", raw, err)
			}
			if pred(m) {
				return
			}
		case <-deadline:
			t.Fatal("timed out waiting for matching event")
		}
	}
}

func TestWatcher_EmitsChangeOnWrite(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "a.md")
	if err := os.WriteFile(file, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	b := NewBroker()
	w, err := NewWatcher(root, b)
	if err != nil {
		t.Fatal(err)
	}
	go w.Run()
	defer w.Close()
	sub := b.Subscribe()

	time.Sleep(50 * time.Millisecond)
	if err := os.WriteFile(file, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForMsg(t, sub, func(m map[string]string) bool {
		return m["type"] == "change" && m["path"] == "a.md"
	})
}

func TestWatcher_EmitsTreeOnCreate(t *testing.T) {
	root := t.TempDir()
	b := NewBroker()
	w, err := NewWatcher(root, b)
	if err != nil {
		t.Fatal(err)
	}
	go w.Run()
	defer w.Close()
	sub := b.Subscribe()

	time.Sleep(50 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(root, "new.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForMsg(t, sub, func(m map[string]string) bool {
		return m["type"] == "tree"
	})
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `go test ./internal/server/ -run TestWatcher -v`
Expected: FAIL — `undefined: NewWatcher`.

- [ ] **Step 3: Implement the watcher**

Create `internal/server/watcher.go`:
```go
package server

import (
	"encoding/json"
	"io/fs"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watcher watches root recursively and broadcasts debounced change/tree
// events through the broker. "change" carries the relative path of a modified
// markdown file; "tree" signals that the directory structure changed.
type Watcher struct {
	root   string
	broker *Broker
	fsw    *fsnotify.Watcher
}

func NewWatcher(root string, broker *Broker) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{root: root, broker: broker, fsw: fsw}
	if err := w.addRecursive(root); err != nil {
		fsw.Close()
		return nil, err
	}
	return w, nil
}

func (w *Watcher) addRecursive(dir string) error {
	return filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			_ = w.fsw.Add(path)
		}
		return nil
	})
}

func (w *Watcher) Close() error { return w.fsw.Close() }

func (w *Watcher) emit(m map[string]string) {
	b, _ := json.Marshal(m)
	w.broker.Broadcast(string(b))
}

// Run consumes filesystem events, coalescing those that arrive within a 100ms
// window before broadcasting, so a single save produces a single event.
func (w *Watcher) Run() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	pendingChange := map[string]bool{}
	pendingTree := false

	flush := func() {
		for p := range pendingChange {
			w.emit(map[string]string{"type": "change", "path": p})
			delete(pendingChange, p)
		}
		if pendingTree {
			w.emit(map[string]string{"type": "tree"})
			pendingTree = false
		}
	}

	for {
		select {
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			if ev.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 {
				pendingTree = true
				// New directories must be watched too.
				if ev.Op&fsnotify.Create != 0 {
					_ = w.addRecursive(ev.Name)
				}
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create) != 0 && isMarkdown(ev.Name) {
				if rel, err := filepath.Rel(w.root, ev.Name); err == nil {
					pendingChange[filepath.ToSlash(rel)] = true
				}
			}
		case <-ticker.C:
			flush()
		case _, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
		}
	}
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `go test ./internal/server/ -run TestWatcher -v`
Expected: PASS (both). If flaky under load, the 2s deadline in the test helper covers normal CI timing.

- [ ] **Step 5: Commit**

```bash
git add internal/server/watcher.go internal/server/watcher_test.go
git commit -m "feat: recursive fsnotify watcher with 100ms debounce"
```

---

## Task 6: HTTP handlers (tree, file, events, assets)

**Files:**
- Create: `internal/server/server.go`
- Test: `internal/server/server_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/server/server_test.go`:
```go
package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	return New(root, NewBroker(), assets), root
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `go test ./internal/server/ -run 'TestHandle' -v`
Expected: FAIL — `undefined: New` / `undefined: Server`.

- [ ] **Step 3: Implement the server**

Create `internal/server/server.go`:
```go
package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Server exposes the file tree, file contents, an SSE event stream, and the
// embedded frontend assets, all rooted at root.
type Server struct {
	root   string
	broker *Broker
	assets fs.FS
}

func New(root string, broker *Broker, assets fs.FS) *Server {
	return &Server{root: root, broker: broker, assets: assets}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/tree", s.handleTree)
	mux.HandleFunc("/api/file", s.handleFile)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.Handle("/", http.FileServer(http.FS(s.assets)))
	return mux
}

func (s *Server) handleTree(w http.ResponseWriter, r *http.Request) {
	node, err := BuildTree(s.root)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(node)
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	abs, err := SafeJoin(s.root, r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	// Reject symlinks that point outside the root.
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		absRoot, _ := filepath.Abs(s.root)
		if resolved != absRoot && !strings.HasPrefix(resolved, absRoot+string(filepath.Separator)) {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		abs = resolved
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := s.broker.Subscribe()
	defer s.broker.Unsubscribe(ch)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			_, _ = w.Write([]byte("data: " + msg + "\n\n"))
			flusher.Flush()
		}
	}
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `go test ./internal/server/ -run 'TestHandle' -v`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add internal/server/server.go internal/server/server_test.go
git commit -m "feat: HTTP handlers for tree, file, SSE events, and assets"
```

---

## Task 7: Wire watcher + server into main

**Files:**
- Modify: `main.go`

- [ ] **Step 1: Replace `main.go` to wire the real server**

Replace the entire contents of `main.go`:
```go
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"reefdoc/internal/server"
)

//go:embed all:web
var webFS embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	flag.Parse()

	root := "."
	if flag.NArg() > 0 {
		root = flag.Arg(0)
	}
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		log.Fatalf("not a directory: %s", root)
	}

	assets, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	broker := server.NewBroker()
	watcher, err := server.NewWatcher(root, broker)
	if err != nil {
		log.Fatal(err)
	}
	go watcher.Run()
	defer watcher.Close()

	srv := server.New(root, broker, assets)
	fmt.Printf("reefdoc serving %s at http://%s\n", root, *addr)
	log.Fatal(http.ListenAndServe(*addr, srv.Handler()))
}
```

- [ ] **Step 2: Verify it builds**

Run: `go build ./... && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 3: Smoke-run by hand (optional manual check)**

Run: `go run . . &` then `curl -s localhost:8080/api/tree | head -c 80; echo; kill %1`
Expected: a JSON object beginning with `{"name":`.

- [ ] **Step 4: Commit**

```bash
git add main.go
git commit -m "feat: wire watcher and SSE server into main"
```

---

## Task 8: Frontend shell + import map + test harness

**Files:**
- Create: `web/index.html` (replace placeholder)
- Create: `web/app.css`
- Create: `web/package.json`

- [ ] **Step 1: Write `web/index.html` with the import map**

Replace `web/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>reefdoc</title>
<link rel="stylesheet" href="/app.css">
<link id="hljs-theme" rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css">
<script type="importmap">
{
  "imports": {
    "markdown-it": "https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/+esm",
    "markdown-it-task-lists": "https://cdn.jsdelivr.net/npm/markdown-it-task-lists@2.1.1/+esm",
    "highlight.js": "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/+esm",
    "mermaid": "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/+esm"
  }
}
</script>
</head>
<body data-theme="light">
  <button id="sidebar-toggle" title="Toggle sidebar">☰</button>
  <aside id="sidebar">
    <input id="filter" type="search" placeholder="Filter files…" autocomplete="off">
    <nav id="tree"></nav>
    <div id="toc-divider"></div>
    <nav id="toc"></nav>
    <button id="theme-toggle">Toggle theme</button>
  </aside>
  <main id="main">
    <div id="tabbar"></div>
    <article id="content"><p class="empty">Select a file from the tree.</p></article>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `web/app.css`**

Create `web/app.css`:
```css
:root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --border:#e2e2e2; --accent:#0b69c7; --sidebar:#fafafa; }
body[data-theme="dark"] { --bg:#1e1e1e; --fg:#e6e6e6; --muted:#9aa; --border:#333; --accent:#5aa9ff; --sidebar:#252526; }

* { box-sizing: border-box; }
body { margin:0; display:flex; height:100vh; font:14px/1.6 system-ui,sans-serif;
       color:var(--fg); background:var(--bg); }
#sidebar { width:280px; flex:0 0 280px; display:flex; flex-direction:column;
           border-right:1px solid var(--border); background:var(--sidebar); overflow:hidden; }
body.sidebar-collapsed #sidebar { display:none; }
#sidebar-toggle { position:fixed; top:8px; left:8px; z-index:10; border:1px solid var(--border);
                  background:var(--bg); color:var(--fg); cursor:pointer; border-radius:4px; padding:2px 8px; }
#filter { margin:40px 8px 8px; padding:6px 8px; border:1px solid var(--border);
          border-radius:4px; background:var(--bg); color:var(--fg); }
#tree { flex:1 1 auto; overflow:auto; padding:0 8px; }
#toc-divider { border-top:1px solid var(--border); margin:8px 0; }
#toc { flex:0 1 35%; overflow:auto; padding:0 8px; font-size:13px; }
#theme-toggle { margin:8px; padding:6px; cursor:pointer; background:var(--bg);
                color:var(--fg); border:1px solid var(--border); border-radius:4px; }

.tree-item { cursor:pointer; padding:2px 4px; white-space:nowrap; border-radius:3px; }
.tree-item:hover { background:var(--border); }
.tree-dir > .tree-label { font-weight:600; }
.tree-children { margin-left:12px; }
.tree-item.hidden { display:none; }

#main { flex:1 1 auto; display:flex; flex-direction:column; overflow:hidden; }
#tabbar { display:flex; border-bottom:1px solid var(--border); overflow-x:auto; }
.tab { display:flex; align-items:center; gap:6px; padding:6px 10px; cursor:pointer;
       border-right:1px solid var(--border); white-space:nowrap; color:var(--muted); }
.tab.active { color:var(--fg); border-bottom:2px solid var(--accent); }
.tab.updated::after { content:"●"; color:var(--accent); }
.tab.missing { text-decoration:line-through; opacity:.6; }
.tab .close { color:var(--muted); }
.tab .close:hover { color:var(--fg); }

#content { flex:1 1 auto; overflow:auto; padding:24px 32px; max-width:900px; }
#content .empty { color:var(--muted); }
#content table { border-collapse:collapse; }
#content th, #content td { border:1px solid var(--border); padding:4px 8px; }
#content pre { overflow:auto; }
.mermaid-error { border:1px solid #c00; background:#fee; color:#900; padding:8px;
                 border-radius:4px; white-space:pre-wrap; }

#toc a { display:block; color:var(--muted); text-decoration:none; padding:1px 0; }
#toc a:hover { color:var(--accent); }
#toc a.lvl-2 { padding-left:12px; }
#toc a.lvl-3 { padding-left:24px; }
```

- [ ] **Step 3: Write `web/package.json` for the test harness**

Create `web/package.json`:
```json
{
  "name": "reefdoc-web-tests",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" },
  "devDependencies": {
    "highlight.js": "11.9.0",
    "markdown-it": "14.1.0",
    "markdown-it-task-lists": "2.1.1"
  }
}
```

- [ ] **Step 4: Install test dependencies**

Run:
```bash
cd /home/exilis/work_remote/reefdoc/web && npm install && cd ..
```
Expected: `web/node_modules/` created (dev-only; not embedded — see Step 5).

- [ ] **Step 5: Exclude test artifacts from the binary embed**

Create `web/.gitignore`:
```
node_modules/
package-lock.json
```
Note: `//go:embed all:web` would embed `node_modules`. Prevent that by creating `web/embed_exclude` awareness — Go's `all:` prefix embeds everything including dotfiles, but `node_modules` is large. Change the embed directive in `main.go` from `//go:embed all:web` to explicit files so only app assets ship:
```go
//go:embed web/index.html web/app.css web/app.js web/render.js web/tabs.js web/tree.js web/toc.js
var webFS embed.FS
```
Then update `fs.Sub(webFS, "web")` — it still works because the embedded paths keep the `web/` prefix. Apply this edit to `main.go` now and run `go build ./... && echo BUILD_OK` (the `.js` files don't exist yet, so this will fail until Task 9–12 create them; that's expected — proceed and it will pass after Task 12).

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/app.css web/package.json web/.gitignore main.go
git commit -m "feat: frontend shell, themes, import map, and test harness"
```

---

## Task 9: Renderer module (markdown → html)

**Files:**
- Create: `web/render.js`
- Test: `web/render.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/render.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from './render.js';

const render = createRenderer();

test('renders GFM tables', () => {
  const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<td>1<\/td>/);
});

test('renders task lists', () => {
  const html = render('- [x] done\n- [ ] todo');
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked/);
});

test('highlights fenced code', () => {
  const html = render('```js\nconst x = 1;\n```');
  assert.match(html, /class="hljs"/);
});

test('mermaid blocks become <pre class="mermaid">', () => {
  const html = render('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(html, /<pre class="mermaid">/);
  assert.match(html, /A--&gt;B/); // escaped, ready for client-side mermaid.run
});

test('mermaid content is escaped, not executed as html', () => {
  const html = render('```mermaid\n<script>x</script>\n```');
  assert.match(html, /&lt;script&gt;/);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && node --test render.test.js; cd ..`
Expected: FAIL — cannot find module `./render.js`.

- [ ] **Step 3: Implement the renderer**

Create `web/render.js`:
```js
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';

// createRenderer returns a pure function (markdown:string) => html:string.
// Fenced ```mermaid blocks are emitted as <pre class="mermaid"> for the
// browser to render with mermaid.run(); all other code is highlighted here.
export function createRenderer() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code>' +
            hljs.highlight(code, { language: lang }).value +
            '</code></pre>';
        } catch (_) { /* fall through */ }
      }
      return '<pre class="hljs"><code>' + md.utils.escapeHtml(code) + '</code></pre>';
    },
  });
  md.use(taskLists);

  const defaultFence =
    md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
      return '<pre class="mermaid">' + md.utils.escapeHtml(token.content) + '</pre>';
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  return (markdown) => md.render(markdown);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd web && node --test render.test.js; cd ..`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add web/render.js web/render.test.js
git commit -m "feat: client-side markdown renderer with mermaid + highlighting"
```

---

## Task 10: Tab store (pure state)

**Files:**
- Create: `web/tabs.js`
- Test: `web/tabs.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/tabs.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStore, openTab, closeTab, isOpen, getTab } from './tabs.js';

test('openTab adds and activates', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  assert.equal(s.active, 'a.md');
  assert.equal(s.tabs.length, 1);
});

test('opening an already-open path just activates it', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  openTab(s, 'b.md', 'b');
  openTab(s, 'a.md', 'a');
  assert.equal(s.active, 'a.md');
  assert.equal(s.tabs.length, 2);
});

test('isOpen reflects state', () => {
  const s = createTabStore();
  assert.equal(isOpen(s, 'a.md'), false);
  openTab(s, 'a.md', 'a');
  assert.equal(isOpen(s, 'a.md'), true);
});

test('closeTab activates a neighbor', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  openTab(s, 'b.md', 'b');
  closeTab(s, 'b.md');
  assert.equal(s.active, 'a.md');
  assert.equal(s.tabs.length, 1);
});

test('closing the last tab clears active', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  closeTab(s, 'a.md');
  assert.equal(s.active, null);
  assert.equal(getTab(s, 'a.md'), null);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && node --test tabs.test.js; cd ..`
Expected: FAIL — cannot find module `./tabs.js`.

- [ ] **Step 3: Implement the tab store**

Create `web/tabs.js`:
```js
// Pure tab-state model. A tab: { path, title, scrollRatio, updated, missing }.
export function createTabStore() {
  return { tabs: [], active: null };
}

export function openTab(store, path, title) {
  if (!store.tabs.some((t) => t.path === path)) {
    store.tabs.push({ path, title, scrollRatio: 0, updated: false, missing: false });
  }
  store.active = path;
  return store;
}

export function closeTab(store, path) {
  const i = store.tabs.findIndex((t) => t.path === path);
  if (i === -1) return store;
  store.tabs.splice(i, 1);
  if (store.active === path) {
    store.active = store.tabs.length ? store.tabs[Math.max(0, i - 1)].path : null;
  }
  return store;
}

export function isOpen(store, path) {
  return store.tabs.some((t) => t.path === path);
}

export function getTab(store, path) {
  return store.tabs.find((t) => t.path === path) || null;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd web && node --test tabs.test.js; cd ..`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add web/tabs.js web/tabs.test.js
git commit -m "feat: pure tab-state store"
```

---

## Task 11: Tree filter (pure)

**Files:**
- Create: `web/tree.js`
- Test: `web/tree.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/tree.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTree } from './tree.js';

const tree = {
  name: 'root', path: '', isDir: true, children: [
    { name: 'guide', path: 'guide', isDir: true, children: [
      { name: 'intro.md', path: 'guide/intro.md', isDir: false },
      { name: 'setup.md', path: 'guide/setup.md', isDir: false },
    ]},
    { name: 'readme.md', path: 'readme.md', isDir: false },
  ],
};

test('empty query returns the tree unchanged', () => {
  assert.equal(filterTree(tree, ''), tree);
});

test('matches files case-insensitively and keeps parent dirs', () => {
  const out = filterTree(tree, 'INTRO');
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].name, 'guide');
  assert.equal(out.children[0].children.length, 1);
  assert.equal(out.children[0].children[0].name, 'intro.md');
});

test('no match yields an empty root', () => {
  const out = filterTree(tree, 'zzz');
  assert.equal(out.children.length, 0);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && node --test tree.test.js; cd ..`
Expected: FAIL — cannot find module `./tree.js`.

- [ ] **Step 3: Implement the filter**

Create `web/tree.js`:
```js
// filterTree returns a pruned copy of the tree keeping files whose name
// matches the query (case-insensitive) and the directories that contain them.
// An empty query returns the original tree. No match yields an empty root.
export function filterTree(node, query) {
  const q = query.trim().toLowerCase();
  if (!q) return node;
  return prune(node, q) || { ...node, children: [] };
}

function prune(node, q) {
  if (!node.isDir) {
    return node.name.toLowerCase().includes(q) ? node : null;
  }
  const kids = (node.children || []).map((c) => prune(c, q)).filter(Boolean);
  if (kids.length === 0) return null;
  return { ...node, children: kids };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd web && node --test tree.test.js; cd ..`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add web/tree.js web/tree.test.js
git commit -m "feat: pure filename tree filter"
```

---

## Task 12: TOC extraction (pure)

**Files:**
- Create: `web/toc.js`
- Test: `web/toc.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/toc.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToc, slugify } from './toc.js';

test('slugify lowercases and dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('buildToc keeps levels 1-3 only', () => {
  const headings = [
    { level: 1, text: 'Title', id: 'title' },
    { level: 2, text: 'Sub', id: 'sub' },
    { level: 4, text: 'Deep', id: 'deep' },
  ];
  const toc = buildToc(headings);
  assert.equal(toc.length, 2);
  assert.deepEqual(toc.map((h) => h.level), [1, 2]);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && node --test toc.test.js; cd ..`
Expected: FAIL — cannot find module `./toc.js`.

- [ ] **Step 3: Implement the TOC helpers**

Create `web/toc.js`:
```js
// slugify turns heading text into a DOM id used for in-page anchors.
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

// buildToc keeps only headings within [minLevel, maxLevel].
// Each heading is { level, text, id }.
export function buildToc(headings, minLevel = 1, maxLevel = 3) {
  return headings.filter((h) => h.level >= minLevel && h.level <= maxLevel);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd web && node --test toc.test.js; cd ..`
Expected: PASS (both).

- [ ] **Step 5: Run the full frontend suite and confirm the binary builds**

Run:
```bash
cd web && node --test; cd ..
go build ./... && echo BUILD_OK
```
Expected: all frontend tests PASS; `BUILD_OK` (all embedded `.js` files now exist).

- [ ] **Step 6: Commit**

```bash
git add web/toc.js web/toc.test.js
git commit -m "feat: pure TOC extraction helpers"
```

---

## Task 13: App wiring (browser glue)

**Files:**
- Create: `web/app.js`

This task is integration glue; it has no unit tests (its behavior is covered by the Task 14 e2e smoke and manual verification). Keep it thin — all real logic lives in the tested modules.

- [ ] **Step 1: Write `web/app.js`**

Create `web/app.js`:
```js
import mermaid from 'mermaid';
import { createRenderer } from './render.js';
import { createTabStore, openTab, closeTab, isOpen, getTab } from './tabs.js';
import { filterTree } from './tree.js';
import { buildToc, slugify } from './toc.js';

const render = createRenderer();
const store = createTabStore();
let fullTree = { name: 'root', path: '', isDir: true, children: [] };

const el = (id) => document.getElementById(id);
const treeEl = el('tree');
const tabbarEl = el('tabbar');
const contentEl = el('content');
const tocEl = el('toc');
const filterEl = el('filter');

function currentTheme() {
  return document.body.getAttribute('data-theme');
}

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme() === 'dark' ? 'dark' : 'default',
  });
}

// ---- Tree rendering ----
async function loadTree() {
  const res = await fetch('/api/tree');
  fullTree = await res.json();
  renderTree();
}

function renderTree() {
  const filtered = filterTree(fullTree, filterEl.value);
  treeEl.innerHTML = '';
  for (const child of filtered.children || []) {
    treeEl.appendChild(renderNode(child));
  }
}

function renderNode(node) {
  const wrap = document.createElement('div');
  const item = document.createElement('div');
  item.className = 'tree-item ' + (node.isDir ? 'tree-dir' : 'tree-file');
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = node.name;
  item.appendChild(label);
  wrap.appendChild(item);

  if (node.isDir) {
    const kids = document.createElement('div');
    kids.className = 'tree-children';
    for (const c of node.children || []) kids.appendChild(renderNode(c));
    wrap.appendChild(kids);
    item.addEventListener('click', () => {
      kids.style.display = kids.style.display === 'none' ? '' : 'none';
    });
  } else {
    item.addEventListener('click', () => open(node.path, node.name));
  }
  return wrap;
}

// ---- Tabs ----
function renderTabs() {
  tabbarEl.innerHTML = '';
  for (const tab of store.tabs) {
    const t = document.createElement('div');
    t.className = 'tab' +
      (tab.path === store.active ? ' active' : '') +
      (tab.updated ? ' updated' : '') +
      (tab.missing ? ' missing' : '');
    const title = document.createElement('span');
    title.textContent = tab.title;
    title.addEventListener('click', () => activate(tab.path));
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); doClose(tab.path); });
    t.appendChild(title);
    t.appendChild(close);
    t.addEventListener('mousedown', (e) => { if (e.button === 1) doClose(tab.path); });
    tabbarEl.appendChild(t);
  }
}

async function open(path, title) {
  if (!isOpen(store, path)) openTab(store, path, title);
  else openTab(store, path, title); // just activates
  renderTabs();
  await show(path);
}

function activate(path) {
  store.active = path;
  const tab = getTab(store, path);
  if (tab) tab.updated = false;
  renderTabs();
  show(path);
}

function doClose(path) {
  closeTab(store, path);
  renderTabs();
  if (store.active) show(store.active);
  else { contentEl.innerHTML = '<p class="empty">Select a file from the tree.</p>'; tocEl.innerHTML = ''; }
}

// ---- Render a document into the content pane ----
const MAX_BYTES = 5 * 1024 * 1024;

async function show(path) {
  const tab = getTab(store, path);
  if (!tab) return;
  const res = await fetch('/api/file?path=' + encodeURIComponent(path));
  if (res.status === 404) {
    tab.missing = true;
    renderTabs();
    contentEl.innerHTML = '<p class="empty">This file no longer exists.</p>';
    tocEl.innerHTML = '';
    return;
  }
  tab.missing = false;
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    contentEl.innerHTML = '<p class="empty">File too large to preview.</p>';
    tocEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = render(text);
  assignHeadingIds();
  renderToc();
  await runMermaid();
  restoreScroll(tab);
}

function assignHeadingIds() {
  contentEl.querySelectorAll('h1,h2,h3').forEach((h) => {
    if (!h.id) h.id = slugify(h.textContent);
  });
}

function renderToc() {
  const headings = [...contentEl.querySelectorAll('h1,h2,h3')].map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent,
    id: h.id,
  }));
  const entries = buildToc(headings);
  tocEl.innerHTML = '';
  if (entries.length < 2) return;
  for (const e of entries) {
    const a = document.createElement('a');
    a.href = '#' + e.id;
    a.className = 'lvl-' + e.level;
    a.textContent = e.text;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById(e.id)?.scrollIntoView({ behavior: 'smooth' });
    });
    tocEl.appendChild(a);
  }
}

async function runMermaid() {
  const blocks = [...contentEl.querySelectorAll('pre.mermaid')];
  for (const block of blocks) {
    try {
      const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), block.textContent);
      block.outerHTML = svg;
    } catch (err) {
      const box = document.createElement('div');
      box.className = 'mermaid-error';
      box.textContent = 'Mermaid error: ' + (err?.message || err);
      block.replaceWith(box);
    }
  }
}

function restoreScroll(tab) {
  contentEl.scrollTop = (tab.scrollRatio || 0) * contentEl.scrollHeight;
}

contentEl.addEventListener('scroll', () => {
  const tab = getTab(store, store.active);
  if (tab && contentEl.scrollHeight > 0) {
    tab.scrollRatio = contentEl.scrollTop / contentEl.scrollHeight;
  }
});

// ---- Live reload via SSE ----
function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'tree') {
      loadTree();
    } else if (msg.type === 'change') {
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
  };
  // On reconnect, refresh everything once.
  es.onopen = () => { loadTree(); if (store.active) show(store.active); };
}

// ---- Controls ----
filterEl.addEventListener('input', renderTree);
el('theme-toggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('reefdoc-theme', next);
  el('hljs-theme').href =
    'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github' +
    (next === 'dark' ? '-dark' : '') + '.min.css';
  initMermaid();
  if (store.active) show(store.active);
});
el('sidebar-toggle').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
});

// ---- Boot ----
const savedTheme = localStorage.getItem('reefdoc-theme');
if (savedTheme) {
  document.body.setAttribute('data-theme', savedTheme);
  if (savedTheme === 'dark') {
    el('hljs-theme').href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
  }
}
initMermaid();
loadTree();
connectSSE();
```

- [ ] **Step 2: Build and manually verify in a browser**

Run:
```bash
mkdir -p /tmp/mddemo && printf '# Demo\n\n## Section\n\n```mermaid\ngraph TD; A-->B;\n```\n\n```js\nconst x=1;\n```\n' > /tmp/mddemo/demo.md
go run . /tmp/mddemo
```
Then open `http://127.0.0.1:8080` in a browser. Expected: the tree shows `demo.md`; clicking opens a tab; the mermaid diagram renders; the code block is highlighted; the TOC lists "Demo" and "Section"; editing `/tmp/mddemo/demo.md` in another editor live-updates the open tab. Stop with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add web/app.js
git commit -m "feat: app wiring — tree, tabs, render, TOC, theme, live reload"
```

---

## Task 14: End-to-end smoke test

**Files:**
- Create: `internal/server/e2e_test.go`

- [ ] **Step 1: Write the e2e test**

Create `internal/server/e2e_test.go`:
```go
package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestE2E_EndpointsOverHTTP(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "doc.md"), []byte("# Title"), 0o644); err != nil {
		t.Fatal(err)
	}
	assets := fstest.MapFS{"index.html": {Data: []byte("<p>app</p>")}}
	srv := httptest.NewServer(New(root, NewBroker(), assets).Handler())
	defer srv.Close()

	cases := []struct {
		path       string
		wantStatus int
		wantSub    string
	}{
		{"/", 200, "app"},
		{"/api/tree", 200, "doc.md"},
		{"/api/file?path=doc.md", 200, "# Title"},
		{"/api/file?path=missing.md", 404, ""},
		{"/api/file?path=../escape", 400, ""},
	}
	for _, c := range cases {
		resp, err := http.Get(srv.URL + c.path)
		if err != nil {
			t.Fatalf("%s: %v", c.path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != c.wantStatus {
			t.Errorf("%s: status %d want %d", c.path, resp.StatusCode, c.wantStatus)
		}
		if c.wantSub != "" && !strings.Contains(string(body), c.wantSub) {
			t.Errorf("%s: body %q missing %q", c.path, body, c.wantSub)
		}
	}
}
```

- [ ] **Step 2: Run the full Go suite**

Run: `go test ./... -v`
Expected: PASS across `safepath`, `tree`, `broker`, `watcher`, `server`, and the new `e2e` test.

- [ ] **Step 3: Commit**

```bash
git add internal/server/e2e_test.go
git commit -m "test: end-to-end smoke over httptest server"
```

---

## Final verification

- [ ] **Step 1: Run everything**

Run:
```bash
go test ./... && (cd web && node --test) && go build ./... && echo ALL_GREEN
```
Expected: `ALL_GREEN`.

- [ ] **Step 2: Manual acceptance pass**

Launch `go run . /tmp/mddemo` and confirm against the spec: tree navigation, filename filter, multiple tabs, markdown + GFM + highlighting + mermaid rendering, TOC, dark/light toggle (mermaid follows), live reload on edit, and the empty-state / missing-file / bad-mermaid behaviors.

---

## Notes for the implementer

- **Module path is `reefdoc`** — imports use `reefdoc/internal/server`.
- **CDN versions are pinned** in `web/index.html` and mirrored as `web/package.json` devDependencies; if you bump one, bump both so tests match runtime.
- **`node_modules` is never embedded** — the embed directive lists explicit files (Task 8, Step 5). Keep it in sync if you add a frontend module.
- **Timing tests** (`watcher_test.go`) use generous 2s deadlines; if they flake on a slow machine, increase the deadline, don't shorten the debounce.
