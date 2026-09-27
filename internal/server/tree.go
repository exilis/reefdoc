package server

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Node is a directory or viewable file in the tree. Path is relative to the
// root, slash-separated. Directories with no viewable descendants are omitted.
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

// isMedia reports whether a file is a media format reefdoc streams to the
// browser's native <video>/<img>/<audio> elements. Media files are served
// with HTTP Range support and are never buffered whole (see server.go).
//
// A container belongs here only if at least one major browser can play it
// natively (reefdoc never transcodes); browsers that can't get a clear
// fallback message client-side (see renderMedia in web/viewers.js). That is
// why .mkv is listed (Chromium demuxes Matroska) but .avi/.wmv/.flv are not:
// no browser plays those, so offering a player would fail for everyone.
func isMedia(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".webm", ".mov", ".mkv",
		".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
		".wav", ".mp3":
		return true
	}
	return false
}

// isViewable reports whether a file should appear in the tree: the text
// formats reefdoc renders inline, the binary document formats it previews
// client-side (pdf/docx/xlsx/pptx), and the media formats it streams
// (video/image/audio). It also gates live-reload "change" events
// (see watcher.go), so narrowing it affects both tree listing and auto-update.
func isViewable(name string) bool {
	if isMarkdown(name) || isMedia(name) {
		return true
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf", ".docx", ".xlsx", ".pptx":
		return true
	}
	return false
}

// dotDirAllowlist are hidden directories that do hold documents worth browsing,
// so they survive the blanket dot-directory skip in isNoiseDir.
var dotDirAllowlist = map[string]bool{
	".allium":    true,
	".claude":    true,
	".herdr":     true,
	".worktrees": true,
}

// isNoiseDir reports whether a directory should be skipped entirely when
// listing or searching: dependency/VCS/hidden directories that are never of
// interest to a markdown viewer and would otherwise dominate a large tree.
func isNoiseDir(name string) bool {
	return name == "node_modules" || (strings.HasPrefix(name, ".") && !dotDirAllowlist[name])
}

// isUnfiltered reports whether relDir sits inside a ".worktrees" directory,
// where directory noise filtering is switched off entirely: a worktree is a
// whole checkout, and hiding its ".git"/"node_modules" would misrepresent it.
func isUnfiltered(relDir string) bool {
	for _, seg := range strings.Split(filepath.ToSlash(relDir), "/") {
		if seg == ".worktrees" {
			return true
		}
	}
	return false
}

// isListableDir reports whether the directory at relDir (relative to root;
// "" means the root) is one the tree would show: no noise directory on its
// path. Under ".worktrees" directories are unfiltered, as in ListDir.
func isListableDir(relDir string) bool {
	relDir = filepath.ToSlash(filepath.Clean(relDir))
	if relDir == "." {
		return true
	}
	for _, seg := range strings.Split(relDir, "/") {
		if seg == ".worktrees" {
			return true
		}
		if isNoiseDir(seg) {
			return false
		}
	}
	return true
}

// isServable reports whether the file at rel (relative to root) is one the
// tree would list: a viewable file in a listable directory. /api/file
// enforces it so that a path the tree hides cannot be fetched by guessing it.
func isServable(rel string) bool {
	rel = filepath.ToSlash(filepath.Clean(rel))
	return isViewable(rel) && isListableDir(filepath.Dir(rel))
}

// ErrNotListable means the requested directory is one the tree hides.
var ErrNotListable = errors.New("directory is not listable")

// listableDir resolves relDir against root like SafeJoin, and additionally
// requires the directory, and whatever it resolves to through symlinks, to be
// one the tree would show.
func listableDir(root, relDir string) (string, error) {
	abs, err := SafeJoin(root, relDir)
	if err != nil {
		return "", err
	}
	if !isListableDir(relDir) {
		return "", ErrNotListable
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return abs, nil // missing directory: let the caller's read fail
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	relResolved, err := filepath.Rel(resolveRoot(absRoot), resolved)
	if err != nil || relResolved == ".." || strings.HasPrefix(relResolved, ".."+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	if !isListableDir(relResolved) {
		return "", ErrNotListable
	}
	return abs, nil
}

// ListDir returns the immediate children (non-noise directories and viewable
// files) of the directory at relDir (relative to root; "" means the root).
// A directory the tree hides is rejected with ErrNotListable.
// Under ".worktrees" every directory is listed — see isUnfiltered.
// It does NOT recurse — directory nodes carry no children, so callers list
// deeper levels on demand. Directories come first, then files, each group
// sorted case-insensitively by name.
func ListDir(root, relDir string) ([]*Node, error) {
	absDir, err := listableDir(root, relDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, err
	}
	var nodes []*Node
	unfiltered := isUnfiltered(relDir)
	for _, e := range entries {
		name := e.Name()
		childRel := filepath.ToSlash(filepath.Join(relDir, name))
		if e.IsDir() {
			if !unfiltered && isNoiseDir(name) {
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
