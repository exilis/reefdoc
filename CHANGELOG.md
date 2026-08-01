# Changelog

All notable changes to reefdoc are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-08-01

### Added
- **Inline media viewing**: videos (`mp4`, `webm`, `mov`), images (`png`,
  `jpg`/`jpeg`, `gif`, `webp`, `svg`), and audio (`wav`, `mp3`) in the served
  tree now appear in the file-tree navigator and open in native browser
  viewers — `<video controls>`, `<img>`, and `<audio controls>`.
- Media is served with its correct `Content-Type` and full **HTTP Range**
  support, streamed from disk rather than buffered — multi-hundred-MB videos
  play and seek without loading the whole file into memory. The download
  button works on media files too.

## [0.14.0] - 2026-07-26

### Added
- **VS Code / Cursor extension**: preview your docs without leaving the editor.
  Run **reefdoc: Open Preview** from the command palette and a panel opens
  beside your editor with reefdoc's file tree, tabs, and live reload; closing
  the panel stops the server. The reefdoc binary is bundled per-platform, so
  there's nothing separate to install. Configure `reefdoc.binaryPath` to use
  your own binary and `reefdoc.host` to change the listen host (default
  `127.0.0.1`). Source and packaging live in `editor/vscode/`.
- `.worktrees` directories now appear in the file tree, so docs in sibling git
  worktrees are browsable. Inside a `.worktrees` path no directory filtering
  applies at all — a worktree is a whole checkout, so its `.git` and
  `node_modules` are listed rather than hidden, unlike everywhere else.

## [0.13.0] - 2026-07-12

### Added
- `.herdr` directories are no longer treated as noise: they now appear in the
  file tree and are included in search and live-reload watching, alongside the
  existing `.allium` and `.claude` exceptions.

## [0.12.0] - 2026-07-04

### Added
- When a markdown document live-reloads, the blocks that changed are now
  **highlighted**: modified and inserted blocks get a brief yellow flash and an
  accent left border, and removed blocks leave a thin dashed gap marker (with a
  "×N" count when several were deleted). Indicators persist until the next
  reload, so you can immediately see what's different without re-reading the
  document.

## [0.11.0] - 2026-06-26

### Added
- Binary document previews (PDF, DOCX, XLSX, PPTX) now **auto-update** when the
  file changes on disk, matching markdown live-reload. The active preview
  re-renders automatically; background tabs are flagged and re-render when you
  switch to them. PDF/DOCX/XLSX render off-screen and swap in (no flicker, and a
  half-written file leaves the previous preview intact); PPTX re-renders in
  place. Scroll position is best-effort preserved across a refresh.
- End-to-end browser tests (Playwright) covering the live-reload pipeline:
  active-tab auto-update, the background "updated" marker, and the
  deleted-file state. Run with `npm run e2e`.

### Fixed
- The file watcher now emits change events for binary document formats, not
  just markdown, so binary previews actually receive live updates.
- Deleting an open document on disk now shows the "this file no longer exists"
  state in its tab, instead of leaving a stale preview. This previously did not
  happen for any file type (deletion emits only a directory-tree event); the
  open tab is now re-checked when its directory listing changes.

## [0.10.0] - 2026-06-26

### Added
- Download the currently-open document with one click via a button in the tab
  bar. Works for every document type reefdoc opens (markdown, Allium, code,
  PDF, DOCX, XLSX, PPTX), and you get the original file back unchanged.

## [0.9.0] - 2026-06-25

### Added
- Browse and preview binary document formats in the browser: **PDF**
  (PDF.js), **DOCX** (docx-preview), **XLSX** (SheetJS), and **PPTX**
  (lower fidelity). These files now appear in the file tree and open in a
  tab as a static preview. Rendering is fully client-side; renderer
  libraries lazy-load from CDN on first use.

## [0.8.1] - 2026-06-09

### Added
- The `.claude` directory is now visible in the file-tree navigator (same as `.allium`).

## [0.8.0] - 2026-06-09

### Added
- Clicking a markdown link or an Allium `use "path"` declaration opens the
  referenced file in a new reefdoc tab. Relative paths resolve against the
  current file; external URLs open in the browser as before.

## [0.7.0] - 2026-06-09

### Added
- Allium spec files (`.allium`) are rendered as formatted cards in the browser,
  with syntax highlighting and a dedicated card layout for entities, rules,
  triggers, surfaces, and contracts.
- `.allium` files and directories are listed in the file-tree navigator.

## [0.6.1] - 2026-06-08

### Added
- This changelog.

### Changed
- CI: bumped GitHub Actions to Node 24-compatible major versions, ahead of
  GitHub removing Node 20 from its runners.

## [0.6.0] - 2026-06-08

### Added
- Recently-updated files (modified within the last 24 hours) are marked with a
  small accent dot at the right of their row in the file tree. The dot appears
  live as files change on disk, via the existing live-reload stream.

### Fixed
- `web/recency.js` was missing from the embedded asset set, so the server
  returned 404 for it and the frontend module graph failed to load. Added a
  smoke test that boots the server and checks every `web/*` asset is served.

## [0.5.0] - 2026-06-08

### Added
- Folder and file icons in the tree and Favorites sections to clearly
  distinguish directories from files.

## [0.4.0] - 2026-06-08

### Removed
- The filename filter/search feature (sidebar UI, `/api/search` endpoint, and
  the server-side search module).

## [0.3.0] - 2026-06-08

### Added
- Directories can now be favorited. Clicking a favorited directory reveals and
  expands it in the tree.

## [0.2.0] - 2026-06-07

### Added
- Favorite files by clicking the star next to them; favorites appear in a
  dedicated sidebar section and persist across sessions via `localStorage`.

## [0.1.1] - 2026-06-07

### Changed
- Copyright attribution.

## [0.1.0] - 2026-06-07

### Added
- Initial release: a single self-contained binary that serves a local browser
  UI for previewing Markdown and Mermaid.
- Lazy file-tree navigation (one directory level at a time), tabs for multiple
  documents, an auto-generated table of contents, and dark/light themes.
- Live reload: edits on disk are pushed to the browser over Server-Sent Events
  via an on-demand filesystem watcher scoped to the visible tree.
- Path-traversal-safe file serving and a `--version` flag.

[0.15.0]: https://github.com/exilis/reefdoc/releases/tag/v0.15.0
[0.14.0]: https://github.com/exilis/reefdoc/releases/tag/v0.14.0
[0.13.0]: https://github.com/exilis/reefdoc/releases/tag/v0.13.0
[0.12.0]: https://github.com/exilis/reefdoc/releases/tag/v0.12.0
[0.11.0]: https://github.com/exilis/reefdoc/releases/tag/v0.11.0
[0.10.0]: https://github.com/exilis/reefdoc/releases/tag/v0.10.0
[0.9.0]: https://github.com/exilis/reefdoc/releases/tag/v0.9.0
[0.8.1]: https://github.com/exilis/reefdoc/releases/tag/v0.8.1
[0.8.0]: https://github.com/exilis/reefdoc/releases/tag/v0.8.0
[0.7.0]: https://github.com/exilis/reefdoc/releases/tag/v0.7.0
[0.6.1]: https://github.com/exilis/reefdoc/releases/tag/v0.6.1
[0.6.0]: https://github.com/exilis/reefdoc/releases/tag/v0.6.0
[0.5.0]: https://github.com/exilis/reefdoc/releases/tag/v0.5.0
[0.4.0]: https://github.com/exilis/reefdoc/releases/tag/v0.4.0
[0.3.0]: https://github.com/exilis/reefdoc/releases/tag/v0.3.0
[0.2.0]: https://github.com/exilis/reefdoc/releases/tag/v0.2.0
[0.1.1]: https://github.com/exilis/reefdoc/releases/tag/v0.1.1
[0.1.0]: https://github.com/exilis/reefdoc/releases/tag/v0.1.0
