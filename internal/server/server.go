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
