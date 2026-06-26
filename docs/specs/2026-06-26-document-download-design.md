# Document Download — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming) — ready for implementation plan

## Summary

Let users download the **currently-open document** — the exact, original bytes
on disk — via a button in the tab bar. The button acts on the active document
and works for every document type reefdoc can open: markdown, allium, code/text,
and binary office formats (PDF, DOCX, XLSX, PPTX).

The browser performs the save natively. The existing `/api/file` endpoint gains
an opt-in `?download=1` mode that sets a `Content-Disposition: attachment`
header; the frontend adds a right-aligned download button in the tab-bar row
that navigates to that URL for the active document.

## Goals

- A single, clear download control tied to the **active** document.
- Works for **all** open document types, with no per-type special-casing.
- The downloaded file is the **original bytes on disk** with its **original
  filename** — not a re-rendered or converted form.
- Native browser download (correct filename, no client-side memory overhead for
  large files), without leaving the current page.
- Zero behavioral change to the existing inline `/api/file` behavior when
  `?download` is absent.

## Non-Goals (YAGNI)

- Downloading files from the tree without first opening them (active-document
  only).
- Exporting rendered/converted output (e.g. PDF-from-markdown, HTML export).
- Per-tab download icons.
- Bulk / multi-file download.
- Streaming optimization for large files (the current `os.ReadFile` path is
  reused unchanged).

## Server Change

In `handleFile` (`internal/server/server.go`):

- When the request carries `?download=1`, add the header:
  `Content-Disposition: attachment; filename="<basename>"`.
- `<basename>` is the base name of the requested path (e.g. `report.pdf` from
  `docs/report.pdf`).
- The filename is sanitized for use as a header value: the basename is quoted,
  and any `"` characters or control characters are stripped/escaped so the
  header cannot be broken or injected.
- All existing behavior is preserved: path safety via `SafeJoin`, symlink
  resolution back inside the root, `Content-Type` selection via `contentType`,
  and the `os.ReadFile` + write body. `Content-Disposition: attachment` only
  instructs the browser to save rather than display; the correct `Content-Type`
  (e.g. `application/pdf`) is still sent.
- When `?download` is absent, no `Content-Disposition` header is sent and
  behavior is byte-for-byte identical to today (inline rendering preserved).

Path traversal is already prevented by the existing guards; the sanitization
here is purely about producing a valid, safe `Content-Disposition` value.

## Frontend Change

### HTML (`web/index.html`)

Wrap the tab bar and a new download button in a header row so the button is
cleanly right-aligned without disturbing tab layout:

```html
<div id="tabbar-row">
  <div id="tabbar"></div>
  <button id="download-btn" title="Download this document" hidden>⤓</button>
</div>
```

The button is `hidden` by default and only shown when a document is active.

### Behavior (`web/app.js`)

- A `refreshDownloadButton()` helper toggles the button's visibility based on
  whether `store.active` is set. It is called wherever the active document
  changes: `open()`, `activate()`, `doClose()`, and session restore.
- On click, the button triggers a native download of the active document by
  navigating to:
  `/api/file?path=<encoded active path>&download=1`
  Because the server responds with `Content-Disposition: attachment`, the
  browser saves the file without navigating away from the page. Implementation
  uses a hidden `<a download>` element (or `window.location.assign`) pointed at
  that URL.
- The button operates only on `store.active`. When no document is open it is
  hidden, so there is no ambiguous state.

### Styling (`web/app.css`)

- Style `#tabbar-row` as a flex row: `#tabbar` takes the available width,
  `#download-btn` sits at the right edge.
- Style `#download-btn` consistently with existing controls (e.g.
  `#theme-toggle`, `.close`): hover state and theme-aware colors.

## Edge Cases

- **No document open:** button is `hidden`; nothing to download.
- **Active document deleted on disk:** the download request hits `/api/file`,
  which returns 404. No special handling beyond the existing 404 — the user
  already sees the "file no longer exists" message in the content pane. This is
  an acceptable edge race.
- **Filenames with special characters:** handled by sanitizing/quoting the
  `Content-Disposition` filename value (see Server Change).
- **Large files:** reuse the existing `os.ReadFile` + write path;
  `Content-Disposition` adds no memory overhead. Optimizing the in-memory read
  is out of scope.

## Testing

### Go (`internal/server/server_test.go`)

- `?download=1` produces `Content-Disposition: attachment; filename="..."` with
  the correct basename.
- The response body bytes are unchanged versus the inline response.
- A filename containing a `"` is safely escaped/stripped in the header.
- Without `?download`, no `Content-Disposition` header is sent (inline behavior
  preserved).

### JS (`web/app.test.js`)

- `downloadUrl(path)` builds the correct `&download=1` URL for the active path,
  including correct percent-encoding of spaces, slashes, and query-delimiter
  characters.

Note: `refreshDownloadButton()` and the click handler live in `web/app.js`,
which has module-scope DOM side effects and cannot be imported headlessly. Per
the project's established convention (see the `resolvePath` tests), only pure
functions are unit-tested; the trivial one-line visibility toggle
(`downloadBtn.hidden = !store.active`) is verified by inspection rather than a
headless test.
