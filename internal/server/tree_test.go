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
	writeFile(t, filepath.Join(root, ".worktrees", "feat-x", "README.md"))
	writeFile(t, filepath.Join(root, ".git", "config"))

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	// .allium, .claude and .worktrees dirs listed, .git hidden; spec.allium listed as file
	want := []string{".allium", ".claude", ".worktrees", "spec.allium"}
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

func TestListDir_NoDirFilteringInsideWorktrees(t *testing.T) {
	root := t.TempDir()
	wt := filepath.Join(root, ".worktrees", "feat-x")
	writeFile(t, filepath.Join(wt, "README.md"))
	writeFile(t, filepath.Join(wt, ".git", "HEAD"))
	writeFile(t, filepath.Join(wt, "node_modules", "pkg", "readme.md"))
	// same names at the root are still filtered
	writeFile(t, filepath.Join(root, ".git", "config"))
	writeFile(t, filepath.Join(root, "node_modules", "pkg", "readme.md"))

	names := func(relDir string) []string {
		nodes, err := ListDir(root, relDir)
		if err != nil {
			t.Fatalf("ListDir(%q): %v", relDir, err)
		}
		var out []string
		for _, n := range nodes {
			out = append(out, n.Name)
		}
		return out
	}

	if got, want := names(""), []string{".worktrees"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("root: got %v want %v", got, want)
	}
	if got, want := names(".worktrees"), []string{"feat-x"}; !reflect.DeepEqual(got, want) {
		t.Fatalf(".worktrees: got %v want %v", got, want)
	}
	// inside a worktree nothing is skipped, not even .git/node_modules
	got, want := names(".worktrees/feat-x"), []string{".git", "node_modules", "README.md"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("worktree: got %v want %v", got, want)
	}
	// and filtering stays off deeper down
	if got, want := names(".worktrees/feat-x/node_modules"), []string{"pkg"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("nested: got %v want %v", got, want)
	}
}

func TestListDir_ListsBinaryDocs(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "slides.pptx"))
	writeFile(t, filepath.Join(root, "report.docx"))
	writeFile(t, filepath.Join(root, "data.xlsx"))
	writeFile(t, filepath.Join(root, "manual.pdf"))
	writeFile(t, filepath.Join(root, "notes.md"))
	writeFile(t, filepath.Join(root, "ignore.txt"))

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	// files sorted case-insensitively; ignore.txt excluded
	want := []string{"data.xlsx", "manual.pdf", "notes.md", "report.docx", "slides.pptx"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("got %v want %v", names, want)
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
