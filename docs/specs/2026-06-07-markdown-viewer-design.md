# Lightweight Markdown & Mermaid Viewer — Design

**Date:** 2026-06-07
**Status:** Implemented; revised to lazy/on-demand tree + watching (see "Scaling
to large trees" below) so the viewer stays fast even when pointed at a directory
with millions of entries (e.g. a monorepo root).

## Summary

A lightweight, personal, local-only server that renders markdown (with mermaid
diagrams) in the browser. It provides a file-tree navigator, tabs for multiple
open documents, and live reload when files change on disk. The user edits files
in their own editor; this tool is a read-only preview.

Invoked as `reefdoc ./docs` (defaults to the current working directory). One
self-contained Go binary, no external runtime to install.

## Goals

- Render markdown + mermaid + code highlighting, faithfully and fast.
- Browse a local folder of docs via a collapsible file tree.
- Open multiple documents in tabs.
- Live-reload an open document when its file changes on disk.
- Auto table of contents and dark/light theme.
- Stay genuinely lightweight at runtime: one binary, instant start, no build
  step or `node_modules`.

## Non-Goals (v1)

- Editing or saving files (read-only viewer).
- Authentication / multi-user / network deployment (local, single user only).
- Full-text search across documents (filename filtering only; full-text is a
  candidate later addition).
- Offline operation (JS libraries load from CDN — see Architecture).

## Architecture

Two units with a thin, well-defined seam between them.

### Server (Go single binary)

Knows about the filesystem; knows nothing about markdown.

- Serves the embedded frontend assets via `go:embed`.
- Exposes a small HTTP/JSON API over the file tree rooted at the directory
  passed on the command line.
- Watches that directory recursively (`fsnotify`) and announces changes over
  Server-Sent Events.

### Frontend (vanilla JS/CSS, embedded in the binary)

Knows about rendering; knows nothing about the filesystem beyond the paths the
API hands it.

- Tree navigator, tabs, TOC, theme toggle.
- Renders markdown + mermaid + code highlighting entirely client-side.
- Subscribes to change announcements and re-renders affected open tabs.

The frontend is plain ES modules (`index.html`, `app.js`, `app.css`) loaded
directly by the browser — no framework, no bundler, no build step.

### Third-party libraries (CDN)

`markdown-it`, `highlight.js`, and `mermaid.js` load from a CDN (e.g.
jsDelivr/unpkg) at pinned versions. The binary embeds only our own small
assets. Trade-off: requires internet on first load (then browser-cached); in
exchange the binary stays small and popular libs are shared across tools.

### The seam

Everything the browser knows about the filesystem flows through four HTTP
endpoints. This lets the server be tested with plain HTTP calls and the
frontend be tested against a fake API, with no coupling.

## Server API

All file paths in the API are **relative to the root directory**. The server
rejects any path that resolves outside the root (no `..`, absolute, or
symlink-out escapes).

| Endpoint | Returns |
|---|---|
| `GET /` and assets | Embedded frontend (`index.html`, `app.js`, `app.css`) |
| `GET /api/tree?path=<rel>` | The **immediate children** of directory `<rel>` (default root) — folders and `.md`/`.markdown` files only, directories first, alphabetical. Non-recursive: directory entries carry no children; the browser fetches a level when a folder is expanded. **Noise directories** (`node_modules`, `.git`, dot-dirs) are omitted. `400` if `<rel>` escapes root. |
| `GET /api/file?path=<rel>` | Raw markdown text of one file (`404` if missing, `400` if path escapes root). |
| `POST /api/watch` | Body `{"dirs":["<rel>",…]}` — the exact set of directories the browser currently cares about (parents of open files + expanded folders). The server reconciles inotify watches to exactly this set (the root is always watched), adding and removing as needed. Paths that escape root are ignored. `204` on success. |
| `GET /api/events` | SSE stream; emits change announcements (see below). |

### File watching (on-demand)

The server does **not** watch the whole tree. It watches only the root plus the
directory set most recently posted to `/api/watch`. This keeps the inotify
footprint proportional to what the user has open, not to the size of the tree.

- A watch is added when a folder is expanded or a file is opened, and removed
  when that folder is collapsed or the tab is closed — the browser sends the
  full desired set; the server diffs and applies it.
- Raw filesystem events are debounced (~100ms) so one save becomes one
  announcement.
- Edit to an existing markdown file → `{"type":"change","path":"<file rel>"}`.
- Add / remove / rename inside a watched directory `D` →
  `{"type":"tree","path":"<D rel>"}` — the browser reloads just that one
  directory level, not the whole tree.

### Tree delivery (lazy)

Each `GET /api/tree?path=<rel>` lists a single directory level — no recursion,
no full-tree walk, no caching needed. The browser builds the tree incrementally
as the user expands folders, so opening the viewer is O(one directory) regardless
of how deep or large the overall tree is.

### Scaling to large trees

The original design walked and watched the entire tree on every load, which is
fine for a small docs folder but pathological for a monorepo root (hundreds of
thousands of directories, exceeding the inotify watch limit, and a multi-second
walk per page load). The lazy/on-demand model above removes both costs: load is
one directory level; watches track only what is open; and noise directories are
never descended into for listing or search.

## Frontend

### Layout

Two-zone shell. The TOC lives in the left sidebar, stacked below the tree.

```
┌────────────┬────────────────────────────────────┐
│  Tree      │  Tab bar                            │
│  ────────  ├────────────────────────────────────┤
│  TOC       │                                     │
│ (sidebar)  │  Rendered document (active tab)     │
│            │                                     │
└────────────┴────────────────────────────────────┘
```

A collapse control hides the entire left rail for distraction-free reading.

### Components (each one job)

- **Tree navigator** — fetches the root level from `/api/tree`, renders
  collapsible folders/files. Expanding a folder lazily fetches
  `/api/tree?path=<dir>` (once; cached in the DOM) and renders its children;
  collapsing hides them. Expanding/collapsing a folder or opening/closing a
  file updates the desired watch set, which is POSTed (debounced) to
  `/api/watch`. Clicking a file opens it in a tab.
- **Tab manager** — owns open documents `{path, title, scrollPos}` and the
  active tab. Clicking a tree file already open just activates its tab. Tabs
  close via a close button or middle-click. The "is this path open?" query
  lives here.
- **Renderer** — pure function `(markdown) → html`. Pipeline: `markdown-it`
  (GFM: tables, strikethrough, task lists via plugins) → fenced code blocks
  highlighted by `highlight.js` → ` ```mermaid ` blocks emitted as
  `<pre class="mermaid">` then rendered by `mermaid.js` after insertion.
- **TOC** — after a render, walks the active document's headings (h1–h3) and
  builds a clickable outline in the sidebar; clicking scrolls to the heading.
  Updates when the active tab changes. Hidden when a doc has few headings.
- **Theme** — dark/light toggle persisted in `localStorage`; switches a CSS
  class and re-initializes mermaid with the matching theme so diagrams match.

### State

Plain in-memory JS objects: open tabs, active path, theme. No router, no
framework.

## Live Reload Data Flow

One SSE connection is opened on page load and held for the session, with the
browser's native auto-reconnect.

**On a `change` event for `<path>`:**

1. Tab manager checks whether `<path>` is open in any tab.
2. If not open → ignore.
3. If open → refetch `/api/file?path=<path>` and re-run the render pipeline for
   that tab.
   - Active tab: preserve scroll position across re-render by ratio (content
     height may change).
   - Background tab: mark with an "updated" dot; re-render (or lazy-render on
     next activation) without switching focus.

**On a `tree` event for directory `<D>`:** if `<D>`'s level is currently loaded
in the navigator, refetch `/api/tree?path=<D>` and re-render just that level
(preserving the expansion state of descendants where possible). Any open tab
whose file no longer exists is flagged (dimmed title + "missing" marker), not
auto-closed.

**On SSE reconnect:** reload the root level and any expanded levels, re-post the
watch set, and re-render open tabs once, to catch anything missed while
disconnected.

Rule: *the server announces what changed; the browser updates only what is
visible and affected.*

## Error Handling & Edge Cases

- **Path escapes root** (`..`, absolute, symlink-out) → `400`, file never
  read. The one hard security line.
- **File missing/deleted while open** → `/api/file` returns `404`; the tab
  shows an inline "file no longer exists" notice rather than a blank pane.
- **Malformed mermaid diagram** → caught per-block; renders an inline error box
  with the message, so one bad diagram doesn't break the document.
- **Huge file** → client-side synchronous render is capped at a sane size
  (e.g. 5 MB); larger files show a "too large to preview" notice instead of
  freezing the tab.
- **Non-markdown / binary file** → tree lists only `.md`/`.markdown`; if a path
  is forced anyway it is treated as text.
- **SSE unsupported / proxy buffering** → if the stream never connects, fall
  back to a manual refresh affordance; core viewing still works without live
  reload.
- **Empty root / no markdown files** → tree shows a friendly empty state.

## Testing

### Server (Go, `go test`)

- Tree endpoint: correct JSON from a temp-dir fixture; filters to
  `.md`/`.markdown`; directories-first ordering.
- File endpoint: returns raw content; `404` on missing; **`400` on path-escape
  attempts** (`..`, absolute, symlink-out) — the security boundary gets the
  most cases.
- SSE: write to a watched temp file → assert a debounced `change` event with
  the right relative path; create/delete a file → assert a `tree` event.
- Debounce: multiple rapid writes collapse into one announcement.

### Frontend (light, no heavy harness)

- Renderer pure function `(markdown) → html` against a fake DOM (jsdom or a tiny
  test page): GFM tables, task lists, code highlighting, and mermaid blocks
  becoming `<pre class="mermaid">`. Rendering correctness concentrates here.
- Tab manager logic (open / activate-existing / close / "is path open?") as
  plain functions, no DOM.

### End-to-end smoke test

Start the binary on a fixture dir, hit each endpoint, assert status + shape.
Keeps the seam honest without full browser automation — appropriate for a
personal tool.

**Testing bias:** the security boundary (path escapes) and the rendering
pipeline get the real coverage; UI glue gets light touch.

## Open Questions / Future

- Full-text search across documents (deferred; filename filter only in v1).
- Optional offline mode by vendoring JS libraries into the binary.
