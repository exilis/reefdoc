package server

import (
	"encoding/json"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watcher watches the root directory plus an on-demand set of subdirectories
// (reconciled via SetWatches) and broadcasts debounced events through the
// broker. "change" carries the relative path of a modified markdown file;
// "tree" carries the relative path of a directory whose listing changed
// (the root directory is the empty string).
type Watcher struct {
	root    string // absolute
	broker  *Broker
	fsw     *fsnotify.Watcher
	mu      sync.Mutex
	watched map[string]bool // absolute directory paths currently watched
}

func NewWatcher(root string, broker *Broker) (*Watcher, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{root: absRoot, broker: broker, fsw: fsw, watched: map[string]bool{}}
	if err := fsw.Add(absRoot); err != nil {
		fsw.Close()
		return nil, err
	}
	w.watched[absRoot] = true
	return w, nil
}

// SetWatches reconciles the watched set to exactly the root plus the given
// relative directories. Directories that escape the root are ignored.
// Previously-watched directories no longer requested are unwatched; the root
// is always kept.
func (w *Watcher) SetWatches(relDirs []string) {
	target := map[string]bool{w.root: true}
	for _, d := range relDirs {
		if abs, err := SafeJoin(w.root, d); err == nil {
			target[abs] = true
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for abs := range target {
		if !w.watched[abs] {
			if err := w.fsw.Add(abs); err == nil {
				w.watched[abs] = true
			}
		}
	}
	for abs := range w.watched {
		if abs == w.root || target[abs] {
			continue
		}
		_ = w.fsw.Remove(abs)
		delete(w.watched, abs)
	}
}

func (w *Watcher) Close() error { return w.fsw.Close() }

func (w *Watcher) emit(m map[string]string) {
	b, _ := json.Marshal(m)
	w.broker.Broadcast(string(b))
}

// rel converts an absolute path under root to a slash-relative path; the root
// itself becomes "". ok is false if abs is not under root.
func (w *Watcher) rel(abs string) (path string, ok bool) {
	r, err := filepath.Rel(w.root, abs)
	if err != nil {
		return "", false
	}
	r = filepath.ToSlash(r)
	if r == "." {
		r = ""
	}
	return r, true
}

// Run consumes filesystem events, coalescing those within a 100ms window so a
// single save produces a single event.
func (w *Watcher) Run() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	pendingChange := map[string]bool{} // file rel paths
	pendingTree := map[string]bool{}   // directory rel paths

	flush := func() {
		for p := range pendingChange {
			w.emit(map[string]string{"type": "change", "path": p})
			delete(pendingChange, p)
		}
		for d := range pendingTree {
			w.emit(map[string]string{"type": "tree", "path": d})
			delete(pendingTree, d)
		}
	}

	for {
		select {
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			if ev.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 {
				if dir, ok := w.rel(filepath.Dir(ev.Name)); ok {
					pendingTree[dir] = true
				}
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create) != 0 && isMarkdown(ev.Name) {
				if rel, ok := w.rel(ev.Name); ok {
					pendingChange[rel] = true
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
