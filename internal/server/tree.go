package server

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Node is a directory or markdown file in the tree. Path is relative to the
// root, slash-separated. Directories with no markdown descendants are omitted.
type Node struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	IsDir    bool    `json:"isDir"`
	ModTime  int64   `json:"modTime,omitempty"` // unix millis; set for files only
	Children []*Node `json:"children,omitempty"`
}

func isMarkdown(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".markdown" || ext == ".allium"
}

// isViewable reports whether a file should appear in the tree: the text
// formats reefdoc renders inline plus the binary document formats it previews
// client-side (pdf/docx/xlsx/pptx).
func isViewable(name string) bool {
	if isMarkdown(name) {
		return true
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf", ".docx", ".xlsx", ".pptx":
		return true
	}
	return false
}

// isNoiseDir reports whether a directory should be skipped entirely when
// listing or searching: dependency/VCS/hidden directories that are never of
// interest to a markdown viewer and would otherwise dominate a large tree.
func isNoiseDir(name string) bool {
	return name == "node_modules" || (strings.HasPrefix(name, ".") && name != ".allium" && name != ".claude")
}

// ListDir returns the immediate children (non-noise directories and markdown
// files) of the directory at relDir (relative to root; "" means the root).
// It does NOT recurse — directory nodes carry no children, so callers list
// deeper levels on demand. Directories come first, then files, each group
// sorted case-insensitively by name.
func ListDir(root, relDir string) ([]*Node, error) {
	absDir, err := SafeJoin(root, relDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, err
	}
	var nodes []*Node
	for _, e := range entries {
		name := e.Name()
		childRel := filepath.ToSlash(filepath.Join(relDir, name))
		if e.IsDir() {
			if isNoiseDir(name) {
				continue
			}
			nodes = append(nodes, &Node{Name: name, Path: childRel, IsDir: true})
		} else if isViewable(name) {
			n := &Node{Name: name, Path: childRel, IsDir: false}
			if info, err := e.Info(); err == nil {
				n.ModTime = info.ModTime().UnixMilli()
			}
			nodes = append(nodes, n)
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		a, b := nodes[i], nodes[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return nodes, nil
}
