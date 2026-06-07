package server

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Server exposes the lazy file tree, file contents, on-demand watch
// registration, an SSE event stream, and the embedded frontend assets,
// all rooted at root.
type Server struct {
	root    string
	broker  *Broker
	assets  fs.FS
	watcher *Watcher
}

func New(root string, broker *Broker, assets fs.FS, watcher *Watcher) *Server {
	return &Server{root: root, broker: broker, assets: assets, watcher: watcher}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/tree", s.handleTree)
	mux.HandleFunc("/api/file", s.handleFile)
	mux.HandleFunc("/api/watch", s.handleWatch)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.Handle("/", http.FileServer(http.FS(s.assets)))
	return mux
}

// handleTree lists one directory level (immediate children of ?path=, root by
// default). Non-recursive — the browser fetches deeper levels on demand.
func (s *Server) handleTree(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	nodes, err := ListDir(s.root, rel)
	if err != nil {
		if errors.Is(err, ErrUnsafePath) {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if nodes == nil {
		nodes = []*Node{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"path": rel, "children": nodes})
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	abs, err := SafeJoin(s.root, r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
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

// handleWatch reconciles the watcher's directory set to the posted list of
// relative directories.
func (s *Server) handleWatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Dirs []string `json:"dirs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if s.watcher != nil {
		s.watcher.SetWatches(body.Dirs)
	}
	w.WriteHeader(http.StatusNoContent)
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
