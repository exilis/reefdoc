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
	if ct, ok := mediaContentType(abs); ok {
		// Media (video/image/audio) can be hundreds of MB: stream from disk
		// with http.ServeFile, which handles HTTP Range requests (required
		// for <video> seeking) and never buffers the whole file in memory.
		// ServeFile keeps a Content-Type that is already set.
		w.Header().Set("Content-Type", ct)
		if r.URL.Query().Get("download") == "1" {
			name := dispositionFilename(filepath.Base(abs))
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		}
		http.ServeFile(w, r, abs)
		return
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType(abs))
	if r.URL.Query().Get("download") == "1" {
		name := dispositionFilename(filepath.Base(abs))
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	}
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

// mediaContentType returns the Content-Type for media files (video, image,
// audio) that reefdoc streams with Range support, and whether the path is one.
// Types are fixed here rather than left to mime.TypeByExtension so responses
// do not depend on the host's /etc/mime.types.
func mediaContentType(path string) (string, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4":
		return "video/mp4", true
	case ".webm":
		return "video/webm", true
	case ".mov":
		return "video/quicktime", true
	case ".png":
		return "image/png", true
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".gif":
		return "image/gif", true
	case ".webp":
		return "image/webp", true
	case ".svg":
		return "image/svg+xml", true
	case ".wav":
		return "audio/wav", true
	case ".mp3":
		return "audio/mpeg", true
	}
	return "", false
}

// contentType returns the response Content-Type for a served file. Text formats
// reefdoc renders inline are sent as UTF-8 text; binary document formats get
// their official MIME type so the browser and PDF.js handle them correctly.
func contentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".pdf":
		return "application/pdf"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".json":
		return "application/json; charset=utf-8"
	default:
		return "text/plain; charset=utf-8"
	}
}

// dispositionFilename returns a value safe to embed in a quoted
// Content-Disposition filename. It drops control characters and escapes
// backslashes and double-quotes so the header cannot be broken or injected.
// Path safety is enforced elsewhere; this only produces a valid header value.
//
// Non-ASCII filenames are passed through as raw UTF-8 in the quoted filename
// parameter rather than using the RFC 6266 extended (filename*) form. All
// current browsers accept and decode raw UTF-8 here, so this is a deliberate
// simplification, not an oversight.
func dispositionFilename(base string) string {
	var b strings.Builder
	for _, r := range base {
		switch {
		case r < 0x20 || r == 0x7f:
			// drop control characters
		case r == '"' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}
