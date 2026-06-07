# reefdoc

[![CI](https://github.com/exilis/reefdoc/actions/workflows/ci.yml/badge.svg)](https://github.com/exilis/reefdoc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A lightweight, local-only **markdown & mermaid viewer**. One self-contained Go
binary serves a browser UI with a file-tree navigator, tabs for multiple open
documents, an auto table of contents, dark/light themes, and live reload when
files change on disk.

You edit markdown in your own editor; `reefdoc` is the preview.

```bash
reefdoc ./docs      # serve a folder (defaults to the current directory)
# then open http://127.0.0.1:8080
```

## Install

Download a prebuilt binary for your platform from the
[latest release](https://github.com/exilis/reefdoc/releases/latest), or build
from source:

```bash
go install github.com/exilis/reefdoc@latest   # needs Go 1.23+
# or, from a clone:
go build -o reefdoc . && ./reefdoc ./docs
```

## Features

- File-tree navigator with instant filename filtering
- Tabs for multiple open documents
- GitHub-flavored markdown, code syntax highlighting, and mermaid diagrams
- Auto table of contents from document headings
- Dark / light theme (mermaid follows the theme)
- Live reload: edit a file in any editor and the open tab updates

## Status

Implemented and tested — Go backend (path-safe file API, recursive watcher, SSE)
plus a vanilla-JS frontend (tree, tabs, markdown/mermaid/highlighting, TOC,
themes, live reload). See [`docs/specs`](docs/specs) for the design and
[`docs/plans`](docs/plans) for the implementation plan.

Run the tests with `go test ./...` and `npm test`.

## Architecture

A Go single binary is a thin file API plus change announcer — it knows the
filesystem, not markdown. The embedded vanilla-JS frontend renders everything
client-side (markdown-it + highlight.js + mermaid via CDN). The two communicate
through a small HTTP API; the server watches directories on demand with
`fsnotify` and pushes change events over SSE.

## License

[MIT](LICENSE) © 2026 exilis
