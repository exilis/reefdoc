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
