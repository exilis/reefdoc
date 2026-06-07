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
