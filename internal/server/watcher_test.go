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

func TestWatcher_SetWatchesDetectsSubdirEdit(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(sub, "x.md")
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
	w.SetWatches([]string{"sub"})
	sub2 := b.Subscribe()

	time.Sleep(50 * time.Millisecond)
	if err := os.WriteFile(file, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForMsg(t, sub2, func(m map[string]string) bool {
		return m["type"] == "change" && m["path"] == "sub/x.md"
	})
}

func TestWatcher_TreeEventCarriesDir(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	b := NewBroker()
	w, err := NewWatcher(root, b)
	if err != nil {
		t.Fatal(err)
	}
	go w.Run()
	defer w.Close()
	w.SetWatches([]string{"sub"})
	subc := b.Subscribe()

	time.Sleep(50 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(sub, "new.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitForMsg(t, subc, func(m map[string]string) bool {
		return m["type"] == "tree" && m["path"] == "sub"
	})
}
