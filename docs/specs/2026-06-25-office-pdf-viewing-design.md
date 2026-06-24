# Office & PDF File Viewing — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming) — ready for implementation plan

## Summary

Extend reefdoc to browse and preview four binary document formats —
**PDF, DOCX, XLSX, and PPTX** — alongside the existing markdown / mermaid /
allium support. Rendering happens **client-side** in the browser, consistent
with reefdoc's "thin server, client renders everything" architecture. The Go
binary remains a file API; it gains only the ability to list these files in the
tree and serve their raw bytes with a correct Content-Type.

## Goals

- List `.pdf`, `.docx`, `.xlsx`, `.pptx` files in the file-tree navigator.
- Open such a file in a tab and render a **static preview** in the content pane.
- Keep the server thin: no server-side rendering or format conversion.
- Pay zero cost on the markdown-only path (renderer libraries load lazily).

## Non-Goals (YAGNI)

Explicitly out of scope for this work:

- Table of contents for binary documents.
- Live-reload (re-render on disk change) for binary documents.
- Favorites (☆) for binary files.
- Scroll-position restore for binary documents.
- Server-side rendering, conversion, or thumbnailing.
- Download / "open externally" fallback UI.
- Offline / vendored renderer libraries (CDN is acceptable).
- Pixel-perfect PPTX fidelity.
- In-document link interception for binary content.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering location | Client-side | Matches existing architecture; availability of mature client-side renderers (PDF.js, SheetJS, docx-preview, a PPTX lib). |
| PPTX scope | Included, lower fidelity accepted | "Browse to see the content," not pixel-perfect. |
| Byte delivery | One endpoint (`/api/file`), branch on extension | Minimal surface change; reuses existing path-safety logic. |
| Library delivery | CDN, lazy-loaded on first use | Consistent with current mermaid / highlight.js pattern; no cost to markdown path. |
| Feature integration | Minimal / static preview | Simplest, clearest scope. No TOC / live-reload / favorites / scroll-restore for binary files. |
| Error handling | Best-effort, no special error UI | reefdoc is a previewer, not a file manager. |
| Size cap | No cap for binary types | Browser / renderer handles whatever it gets. Existing 5MB cap stays on the text path only. |

## Architecture

### Server (Go) — thin, two small changes

1. **Tree listing recognizes the new extensions.** `tree.go` currently gates
   tree membership on `isMarkdown()`. Introduce a broader `isViewable()` that
   includes the existing text extensions (`.md`, `.markdown`, `.allium`) plus
   `.pdf`, `.docx`, `.xlsx`, `.pptx`. The `Node` JSON shape is unchanged
   (name / path / isDir / modTime); the frontend decides how to render based on
   extension.

2. **`/api/file` serves binary correctly.** `handleFile` currently always sets
   `Content-Type: text/plain; charset=utf-8`, which corrupts binary bytes. Set
   the Content-Type by extension instead:
   - `.md`, `.markdown`, `.allium` → `text/plain; charset=utf-8` (unchanged)
   - `.pdf` → `application/pdf`
   - `.docx` / `.xlsx` / `.pptx` → their official MIME types (or
     `application/octet-stream`; the frontend reads `ArrayBuffer` regardless, so
     the exact MIME mainly matters for PDF.js and browser sniffing)

   All existing path-safety logic (`SafeJoin`, symlink resolution) is untouched
   and still applies. No new endpoint and no server-side size logic.

### Frontend — renderer registry (`web/viewers.js`)

A new module owns all binary rendering behind one interface. The registry maps
file extension → an async viewer function:

```
viewer(bytes /* ArrayBuffer */, container /* HTMLElement */) => Promise<void>
```

Each viewer is responsible for lazy-loading its CDN library (cached after first
load), rendering into the container, and letting any failure surface naturally
(best-effort — no special error UI).

**Four viewers**, each a small, focused, independently testable unit:

- `pdf` → **PDF.js**, renders pages to canvas elements stacked in the container.
- `docx` → **docx-preview** (docx → styled HTML into the container).
- `xlsx` → **SheetJS**, parses the workbook and renders sheet(s) as HTML table(s).
- `pptx` → a **PPTX library** (lower fidelity accepted).

**Public surface of the module:**

- `getViewer(path)` → the viewer fn for that extension, or `null` if the path is
  not a binary viewable type.
- `lazyLoad(url)` → injects a `<script>` once and resolves when ready (mirrors
  how mermaid / highlight.js come from CDN). CDN URLs pin exact library versions.

### Integration — the single branch in `show()`

`show()` (app.js, currently line 357) gains one branch point:

```
1. fetch('/api/file?path=…')
2. handle 404 → existing "no longer exists" path (unchanged)
3. viewer = getViewer(path)
4. if viewer is null  → TEXT PATH (existing, unchanged):
      res.text(), enforce MAX_BYTES (5MB), markdown/allium render,
      assignHeadingIds, renderToc, runMermaid, restoreScroll
5. if viewer is non-null → BINARY PATH (new):
      bytes = await res.arrayBuffer()       (no size cap)
      clear tocEl                            (binary types have no TOC)
      await viewer(bytes, contentEl)
      (the showSeq guard still applies so a superseded load is discarded)
```

### Consequences of the "minimal / static" decision (made explicit)

- **No TOC** for binary types — `tocEl` is cleared on the binary path.
- **No live-reload** — the SSE `change` handler (app.js, ~line 496) currently
  calls `show()` for the active tab. Guard it so binary tabs do not re-render on
  disk changes. Tabs still open / close / activate normally.
- **No favorites for binary files** — the tree still lists them and they open on
  click, but the ☆ star is omitted on binary file rows (`renderNode`, app.js,
  ~line 259). This is a small, accepted UI inconsistency (some file rows show a
  star, some do not); showing a non-persisting star would be worse.
- **No scroll-restore** — the binary path does not call `restoreScroll`.
- **In-document link clicking** (app.js, ~line 454) stays on the text path only;
  binary viewers render their own content with no interception.

## Testing

Follow the existing split (`go test ./...` + `npm test` via `node --test`).

- **Go:** extend `tree_test.go` to assert the new extensions appear in the
  navigator; extend `server_test.go` to assert `/api/file` returns the correct
  Content-Type per extension and serves binary bytes intact.
- **JS:** unit-test `viewers.js` registry logic — `getViewer()` returns the
  right viewer per extension and `null` for text / unknown extensions. The
  CDN-backed render functions are not unit-tested (they depend on external libs
  loaded in a real browser) and are covered by manual verification.

**Manual verification:** drop a sample `.pdf`, `.docx`, `.xlsx`, `.pptx` into a
served folder; confirm each lists in the tree, opens in a tab, and renders.
Confirm the markdown path is completely unaffected.

## Risks & Caveats

- **PPTX fidelity** is the weakest of the four — accepted up front.
- **CDN dependency** for these viewers slightly dents the "local-only" branding;
  documented as a known trade-off, consistent with the current mermaid /
  highlight.js approach.
- **Large files with no cap** could make a tab sluggish — accepted; the browser
  / renderer handles it.
- **CDN library API churn** — mitigated by pinning exact versions in the
  lazy-load URLs.

## Documentation

On implementation: update the README feature list and add a CHANGELOG entry.
