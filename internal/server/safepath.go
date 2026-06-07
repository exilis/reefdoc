package server

import (
	"errors"
	"path/filepath"
	"strings"
)

// ErrUnsafePath means the requested path resolved outside the root.
var ErrUnsafePath = errors.New("path escapes root")

// SafeJoin resolves rel against root and returns the absolute path, but only
// if the result stays within root. filepath.Join cleans the path (resolving
// "..") before the prefix check, so traversal attempts are rejected.
func SafeJoin(root, rel string) (string, error) {
	if filepath.IsAbs(rel) {
		return "", ErrUnsafePath
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	joined := filepath.Join(absRoot, rel)
	if joined != absRoot && !strings.HasPrefix(joined, absRoot+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	return joined, nil
}
