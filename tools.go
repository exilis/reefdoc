//go:build tools
// +build tools

// Package main pins build/runtime dependencies that are not yet imported by
// regular source, so `go mod tidy` keeps them. fsnotify is used by
// internal/server (added in a later task).
package main

import _ "github.com/fsnotify/fsnotify"
