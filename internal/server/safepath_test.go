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

func TestSafeJoin_EmptyAndDotResolveToRoot(t *testing.T) {
	root := t.TempDir()
	absRoot, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"", "."} {
		got, err := SafeJoin(root, rel)
		if err != nil {
			t.Fatalf("rel %q: unexpected error: %v", rel, err)
		}
		if got != absRoot {
			t.Fatalf("rel %q: got %q want %q", rel, got, absRoot)
		}
	}
}
