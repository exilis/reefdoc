package server

import (
	"os"
	"path/filepath"
	"reflect"
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

func TestListDir_RootLevelOnly(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "b.md"))
	writeFile(t, filepath.Join(root, "a.markdown"))
	writeFile(t, filepath.Join(root, "ignore.txt"))
	writeFile(t, filepath.Join(root, "sub", "deep.md"))
	if err := os.MkdirAll(filepath.Join(root, "node_modules", "x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	// directories first (only "sub"; node_modules and .git are noise);
	// then markdown files alphabetically; ignore.txt excluded.
	want := []string{"sub", "a.markdown", "b.md"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("got %v want %v", names, want)
	}
	// lazy: a directory entry carries no preloaded children
	if len(nodes[0].Children) != 0 {
		t.Fatalf("expected dir %q to have no children, got %d", nodes[0].Name, len(nodes[0].Children))
	}
}

func TestListDir_Subdir(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "guide", "intro.md"))
	writeFile(t, filepath.Join(root, "guide", "setup.md"))
	nodes, err := ListDir(root, "guide")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 || nodes[0].Path != "guide/intro.md" || nodes[1].Path != "guide/setup.md" {
		t.Fatalf("unexpected: %+v", nodes)
	}
}

func TestListDir_RejectsEscape(t *testing.T) {
	root := t.TempDir()
	if _, err := ListDir(root, "../escape"); err == nil {
		t.Fatal("expected error for escaping path")
	}
}

func TestListDir_AlliumFilesAndDir(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "spec.allium"))
	writeFile(t, filepath.Join(root, ".allium", "schema.allium"))
	writeFile(t, filepath.Join(root, ".claude", "settings.json"))
	writeFile(t, filepath.Join(root, ".git", "config"))

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	// .allium and .claude dirs listed, .git hidden; spec.allium listed as file
	want := []string{".allium", ".claude", "spec.allium"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("got %v want %v", names, want)
	}

	// listing inside .allium works
	inner, err := ListDir(root, ".allium")
	if err != nil {
		t.Fatal(err)
	}
	if len(inner) != 1 || inner[0].Name != "schema.allium" {
		t.Fatalf("unexpected inner: %+v", inner)
	}
}

func TestListDir_FilesCarryModTime(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.md"))
	writeFile(t, filepath.Join(root, "sub", "deep.md"))

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	// nodes are: "sub" (dir) then "a.md" (file)
	for _, n := range nodes {
		if n.IsDir {
			if n.ModTime != 0 {
				t.Fatalf("dir %q should have zero ModTime, got %d", n.Name, n.ModTime)
			}
		} else if n.ModTime == 0 {
			t.Fatalf("file %q should have a non-zero ModTime", n.Name)
		}
	}
}
