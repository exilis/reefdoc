package server

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestSearchFiles_MatchesByNameSkippingNoise(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "intro.md"))
	writeFile(t, filepath.Join(root, "guide", "Setup.md"))
	writeFile(t, filepath.Join(root, "guide", "other.md"))
	writeFile(t, filepath.Join(root, "node_modules", "pkg", "setup.md")) // noise: excluded
	writeFile(t, filepath.Join(root, "notes.txt"))                       // not markdown

	res, trunc, err := SearchFiles(root, "setup", 100)
	if err != nil {
		t.Fatal(err)
	}
	if trunc {
		t.Fatal("unexpected truncation")
	}
	var paths []string
	for _, r := range res {
		paths = append(paths, r.Path)
	}
	want := []string{"guide/Setup.md"} // case-insensitive; node_modules excluded
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("got %v want %v", paths, want)
	}
}

func TestSearchFiles_BlankQuery(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.md"))
	res, _, err := SearchFiles(root, "   ", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("blank query must return nothing, got %v", res)
	}
}

func TestSearchFiles_Truncates(t *testing.T) {
	root := t.TempDir()
	for _, n := range []string{"a1.md", "a2.md", "a3.md"} {
		writeFile(t, filepath.Join(root, n))
	}
	res, trunc, err := SearchFiles(root, "a", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 2 || !trunc {
		t.Fatalf("expected 2 results + truncated=true, got %d trunc=%v", len(res), trunc)
	}
}
