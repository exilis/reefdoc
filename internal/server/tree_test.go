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
