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
	Children []*Node `json:"children,omitempty"`
}

func isMarkdown(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".md" || ext == ".markdown"
}

// BuildTree builds the document tree rooted at root.
func BuildTree(root string) (*Node, error) {
	return buildNode(root, "")
}

func buildNode(absPath, relPath string) (*Node, error) {
	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}
	node := &Node{
		Name:  filepath.Base(absPath),
		Path:  filepath.ToSlash(relPath),
		IsDir: true,
	}
	for _, e := range entries {
		childRel := filepath.Join(relPath, e.Name())
		childAbs := filepath.Join(absPath, e.Name())
		if e.IsDir() {
			child, err := buildNode(childAbs, childRel)
			if err != nil {
				continue
			}
			if len(child.Children) > 0 {
				node.Children = append(node.Children, child)
			}
		} else if isMarkdown(e.Name()) {
			node.Children = append(node.Children, &Node{
				Name:  e.Name(),
				Path:  filepath.ToSlash(childRel),
				IsDir: false,
			})
		}
	}
	sort.Slice(node.Children, func(i, j int) bool {
		a, b := node.Children[i], node.Children[j]
		if a.IsDir != b.IsDir {
			return a.IsDir // directories first
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return node, nil
}

// isNoiseDir reports whether a directory should be skipped entirely when
// listing or searching: dependency/VCS/hidden directories that are never of
// interest to a markdown viewer and would otherwise dominate a large tree.
func isNoiseDir(name string) bool {
	return name == "node_modules" || strings.HasPrefix(name, ".")
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
		} else if isMarkdown(name) {
			nodes = append(nodes, &Node{Name: name, Path: childRel, IsDir: false})
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
