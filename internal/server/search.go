package server

import (
	"io/fs"
	"path/filepath"
	"strings"
)

// SearchResult is one markdown file matching a search query.
type SearchResult struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// SearchFiles walks root and returns markdown files whose base name contains
// query (case-insensitive), skipping noise directories. At most limit results
// are returned; truncated is true when more matches existed beyond the limit.
// A blank query returns no results.
func SearchFiles(root, query string, limit int) (results []SearchResult, truncated bool, err error) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil, false, nil
	}
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return nil // skip unreadable entries rather than aborting the walk
		}
		if d.IsDir() {
			if path != root && isNoiseDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isMarkdown(d.Name()) || !strings.Contains(strings.ToLower(d.Name()), q) {
			return nil
		}
		if len(results) >= limit {
			truncated = true
			return filepath.SkipAll
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		results = append(results, SearchResult{Name: d.Name(), Path: filepath.ToSlash(rel)})
		return nil
	})
	return results, truncated, walkErr
}
