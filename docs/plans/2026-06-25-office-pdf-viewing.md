# Office & PDF File Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let reefdoc list and preview `.pdf`, `.docx`, `.xlsx`, and `.pptx` files in the browser, rendered entirely client-side.

**Architecture:** The Go server stays a thin file API — it gains a broader "viewable" extension set for the tree and serves binary bytes with a correct Content-Type. The frontend gets a new `web/viewers.js` registry mapping extension → an async viewer function (PDF.js, docx-preview, SheetJS, a PPTX lib), each lazy-loaded from CDN on first use. `app.js`'s `show()` branches once: text files take the existing markdown/allium path; binary files read an `ArrayBuffer` and hand it to the viewer. Binary files are static previews — no TOC, live-reload, favorites, or scroll-restore.

**Tech Stack:** Go 1.23 (stdlib `net/http`, `fsnotify`), vanilla JS ES modules with an importmap to CDN (`+esm`) builds, PDF.js, docx-preview, SheetJS (xlsx), a PPTX preview library. Tests: `go test ./...` and `node --test` (`npm test`).

**Spec:** `docs/specs/2026-06-25-office-pdf-viewing-design.md`

---

## File Structure

**Server (Go):**
- Modify `internal/server/tree.go` — add `isViewable()` (text + binary extensions) and use it in `ListDir`.
- Modify `internal/server/tree_test.go` — assert binary extensions list in the tree.
- Modify `internal/server/server.go` — set Content-Type by extension in `handleFile`.
- Modify `internal/server/server_test.go` — assert Content-Type and intact binary bytes.

**Frontend (JS):**
- Create `web/viewers.js` — registry: `getViewer(path)` + per-format async viewers + `lazyLoad`/dynamic-import helper.
- Create `web/viewers.test.js` — unit-test `getViewer()` routing.
- Modify `web/app.js` — branch in `show()`; omit star on binary rows in `renderNode`; guard SSE `change` handler so binary tabs don't live-reload.
- Modify `web/index.html` — add viewer libraries to the importmap.
- Modify `main.go` — add `web/viewers.js` to the `//go:embed` directive.

**Docs:**
- Modify `README.md` — feature list.
- Modify `CHANGELOG.md` — new entry.

---

## Task 1: Server recognizes binary extensions in the tree

**Files:**
- Modify: `internal/server/tree.go` (lines 20-23, 55)
- Test: `internal/server/tree_test.go`

- [ ] **Step 1: Write the failing test**

Add to `internal/server/tree_test.go`:

```go
func TestListDir_ListsBinaryDocs(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "slides.pptx"))
	writeFile(t, filepath.Join(root, "report.docx"))
	writeFile(t, filepath.Join(root, "data.xlsx"))
	writeFile(t, filepath.Join(root, "manual.pdf"))
	writeFile(t, filepath.Join(root, "notes.md"))
	writeFile(t, filepath.Join(root, "ignore.txt"))

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	// files sorted case-insensitively; ignore.txt excluded
	want := []string{"data.xlsx", "manual.pdf", "notes.md", "report.docx", "slides.pptx"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("got %v want %v", names, want)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestListDir_ListsBinaryDocs -v`
Expected: FAIL — only `notes.md` appears (binary files filtered out by `isMarkdown`).

- [ ] **Step 3: Add `isViewable` and use it**

In `internal/server/tree.go`, keep `isMarkdown` as-is and add below it (after line 23):

```go
// isViewable reports whether a file should appear in the tree: the text
// formats reefdoc renders inline plus the binary document formats it previews
// client-side (pdf/docx/xlsx/pptx).
func isViewable(name string) bool {
	if isMarkdown(name) {
		return true
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf", ".docx", ".xlsx", ".pptx":
		return true
	}
	return false
}
```

Then in `ListDir`, change the file gate (currently `} else if isMarkdown(name) {` at line 55) to:

```go
		} else if isViewable(name) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/server/ -run TestListDir_ListsBinaryDocs -v`
Expected: PASS

- [ ] **Step 5: Run the full server package tests**

Run: `go test ./internal/server/`
Expected: PASS (existing markdown/allium tree tests still pass — `isViewable` is a superset of `isMarkdown`).

- [ ] **Step 6: Commit**

```bash
git add internal/server/tree.go internal/server/tree_test.go
git commit -m "feat(tree): list pdf/docx/xlsx/pptx files in the navigator"
```

---

## Task 2: Server sends correct Content-Type for each file type

**Files:**
- Modify: `internal/server/server.go` (lines 71-77)
- Test: `internal/server/server_test.go`

- [ ] **Step 1: Write the failing tests**

Add to `internal/server/server_test.go`:

```go
func TestHandleFile_ContentTypeByExtension(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"a.md":        "text/plain; charset=utf-8",
		"spec.allium": "text/plain; charset=utf-8",
		"doc.pdf":     "application/pdf",
		"d.docx":      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"s.xlsx":      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"p.pptx":      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	}
	for name := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	for name, wantCT := range files {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path="+name, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: status %d", name, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != wantCT {
			t.Fatalf("%s: content-type %q, want %q", name, ct, wantCT)
		}
	}
}

func TestHandleFile_BinaryBytesIntact(t *testing.T) {
	root := t.TempDir()
	// bytes that are not valid UTF-8 — must survive round-trip unchanged
	raw := []byte{0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80}
	if err := os.WriteFile(filepath.Join(root, "b.pdf"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=b.pdf", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), raw) {
		t.Fatalf("body bytes %v, want %v", rec.Body.Bytes(), raw)
	}
}
```

Add `"bytes"` to the import block at the top of `server_test.go` (alphabetically first).

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/server/ -run 'TestHandleFile_ContentTypeByExtension|TestHandleFile_BinaryBytesIntact' -v`
Expected: FAIL — `ContentTypeByExtension` fails on the binary cases (server always sends `text/plain`). `BinaryBytesIntact` may pass already (bytes are written verbatim) but locks in the guarantee.

- [ ] **Step 3: Set Content-Type by extension**

In `internal/server/server.go`, replace the two final lines of `handleFile` (currently lines 76-77):

```go
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(data)
```

with:

```go
	w.Header().Set("Content-Type", contentType(abs))
	_, _ = w.Write(data)
```

Then add this helper at the end of `internal/server/server.go`:

```go
// contentType returns the response Content-Type for a served file. Text formats
// reefdoc renders inline are sent as UTF-8 text; binary document formats get
// their official MIME type so the browser and PDF.js handle them correctly.
func contentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".pdf":
		return "application/pdf"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	default:
		return "text/plain; charset=utf-8"
	}
}
```

`strings` and `path/filepath` are already imported in `server.go`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/server/ -run 'TestHandleFile_ContentTypeByExtension|TestHandleFile_BinaryBytesIntact' -v`
Expected: PASS

- [ ] **Step 5: Run the full server package + existing file test**

Run: `go test ./internal/server/`
Expected: PASS — `TestHandleFile_ReturnsContent` still passes (`a.md` → `text/plain`).

- [ ] **Step 6: Commit**

```bash
git add internal/server/server.go internal/server/server_test.go
git commit -m "feat(api): serve correct Content-Type for binary documents"
```

---

## Task 3: Frontend viewer registry — routing skeleton

This task creates `web/viewers.js` with `getViewer()` routing and the lazy-load helper, plus its unit test. The actual render functions are filled in across Tasks 4-7. Routing is what we unit-test (the CDN renderers need a real browser).

**Files:**
- Create: `web/viewers.js`
- Test: `web/viewers.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/viewers.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getViewer, isBinaryDoc } from './viewers.js';

test('getViewer returns a function for each binary doc type', () => {
  for (const path of ['a.pdf', 'b.docx', 'c.xlsx', 'd.pptx']) {
    assert.equal(typeof getViewer(path), 'function', path);
  }
});

test('getViewer is case-insensitive on the extension', () => {
  assert.equal(typeof getViewer('REPORT.PDF'), 'function');
  assert.equal(typeof getViewer('Sheet.XlsX'), 'function');
});

test('getViewer returns null for text and unknown types', () => {
  for (const path of ['a.md', 'b.markdown', 'c.allium', 'd.txt', 'noext']) {
    assert.equal(getViewer(path), null, path);
  }
});

test('isBinaryDoc mirrors getViewer', () => {
  assert.equal(isBinaryDoc('x.pdf'), true);
  assert.equal(isBinaryDoc('x.md'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/viewers.test.js`
Expected: FAIL — `Cannot find module './viewers.js'`.

- [ ] **Step 3: Create `web/viewers.js` with routing + lazy-load helper**

Create `web/viewers.js`:

```js
// viewers.js — client-side preview of binary document formats.
//
// A registry maps a file extension to an async viewer:
//   viewer(bytes: ArrayBuffer, container: HTMLElement) => Promise<void>
//
// Each viewer lazy-imports its (heavy) CDN library on first use, so the
// markdown-only path pays nothing. Rendering is best-effort: a viewer may throw
// and the caller lets the failure surface (no special error UI).

// Cache of dynamically imported modules, keyed by importmap specifier.
const moduleCache = new Map();

// lazyImport resolves a module from the importmap specifier, caching it so the
// CDN fetch happens at most once per session.
export async function lazyImport(specifier) {
  if (!moduleCache.has(specifier)) {
    moduleCache.set(specifier, import(specifier));
  }
  return moduleCache.get(specifier);
}

function ext(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

// registry is populated in Tasks 4-7. Each entry: extension -> async viewer.
const registry = {
  '.pdf': viewPdf,
  '.docx': viewDocx,
  '.xlsx': viewXlsx,
  '.pptx': viewPptx,
};

// getViewer returns the viewer function for a path, or null for text/unknown.
export function getViewer(path) {
  return registry[ext(path)] || null;
}

// isBinaryDoc reports whether a path is one reefdoc previews via a viewer.
export function isBinaryDoc(path) {
  return getViewer(path) !== null;
}

// --- viewers (implemented in later tasks) ---

async function viewPdf(bytes, container) {
  throw new Error('pdf viewer not yet implemented');
}
async function viewDocx(bytes, container) {
  throw new Error('docx viewer not yet implemented');
}
async function viewXlsx(bytes, container) {
  throw new Error('xlsx viewer not yet implemented');
}
async function viewPptx(bytes, container) {
  throw new Error('pptx viewer not yet implemented');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test web/viewers.test.js`
Expected: PASS — routing is exercised without ever calling the unimplemented viewers.

- [ ] **Step 5: Commit**

```bash
git add web/viewers.js web/viewers.test.js
git commit -m "feat(viewers): add binary-doc viewer registry and routing"
```

---

## Task 4: PDF viewer (PDF.js)

**Files:**
- Modify: `web/viewers.js` (the `viewPdf` stub)
- Modify: `web/index.html` (importmap)

PDF.js renders pages to canvas. It needs a worker; we load the ESM build and point `GlobalWorkerOptions.workerSrc` at the matching CDN worker. This is browser-only behavior — verified manually, not in `node --test`.

- [ ] **Step 1: Add PDF.js to the importmap**

In `web/index.html`, add to the `"imports"` object (after the mermaid line, line 16 — add a trailing comma to the mermaid entry):

```json
    "mermaid": "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/+esm",
    "pdfjs-dist": "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm"
```

- [ ] **Step 2: Implement `viewPdf`**

In `web/viewers.js`, replace the `viewPdf` stub with:

```js
async function viewPdf(bytes, container) {
  const pdfjs = await lazyImport('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
  // copy bytes — pdf.js may transfer/detach the buffer
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'pdf-doc';
  container.appendChild(wrap);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
}
```

- [ ] **Step 3: Run the registry tests (no regression)**

Run: `node --test web/viewers.test.js`
Expected: PASS — routing unchanged; `viewPdf` is not invoked by the tests.

- [ ] **Step 4: Manual verification**

Build and run, open a PDF:

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Open `http://127.0.0.1:8080`, drop a `.pdf` into `./docs`, click it in the tree. Expected: pages render stacked as canvases. The markdown files still render normally.

- [ ] **Step 5: Commit**

```bash
git add web/viewers.js web/index.html
git commit -m "feat(viewers): render PDF files with pdf.js"
```

---

## Task 5: DOCX viewer (docx-preview)

**Files:**
- Modify: `web/viewers.js` (the `viewDocx` stub)
- Modify: `web/index.html` (importmap)

`docx-preview` renders a docx (as a `Uint8Array`/`ArrayBuffer`/`Blob`) into a container element via `renderAsync(data, container)`.

- [ ] **Step 1: Add docx-preview to the importmap**

In `web/index.html`, append to the `"imports"` object (after the pdfjs-dist line; add a trailing comma to it):

```json
    "pdfjs-dist": "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/+esm",
    "docx-preview": "https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/+esm"
```

- [ ] **Step 2: Implement `viewDocx`**

In `web/viewers.js`, replace the `viewDocx` stub with:

```js
async function viewDocx(bytes, container) {
  const docx = await lazyImport('docx-preview');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'docx-doc';
  container.appendChild(wrap);
  await docx.renderAsync(bytes, wrap);
}
```

- [ ] **Step 3: Run the registry tests (no regression)**

Run: `node --test web/viewers.test.js`
Expected: PASS

- [ ] **Step 4: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Drop a `.docx` into `./docs`, click it. Expected: the document renders as styled HTML in the content pane.

- [ ] **Step 5: Commit**

```bash
git add web/viewers.js web/index.html
git commit -m "feat(viewers): render DOCX files with docx-preview"
```

---

## Task 6: XLSX viewer (SheetJS)

**Files:**
- Modify: `web/viewers.js` (the `viewXlsx` stub)
- Modify: `web/index.html` (importmap)

SheetJS reads the workbook from an `ArrayBuffer` (`read(data, { type: 'array' })`) and can emit an HTML table per sheet via `utils.sheet_to_html`.

- [ ] **Step 1: Add SheetJS to the importmap**

In `web/index.html`, append to the `"imports"` object (after the docx-preview line; add a trailing comma to it). SheetJS publishes its ESM build at a dedicated CDN path:

```json
    "docx-preview": "https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/+esm",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"
```

- [ ] **Step 2: Implement `viewXlsx`**

In `web/viewers.js`, replace the `viewXlsx` stub with:

```js
async function viewXlsx(bytes, container) {
  const XLSX = await lazyImport('xlsx');
  const wb = XLSX.read(bytes, { type: 'array' });
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'xlsx-doc';
  container.appendChild(wrap);
  for (const name of wb.SheetNames) {
    const heading = document.createElement('h2');
    heading.textContent = name;
    wrap.appendChild(heading);
    const table = document.createElement('div');
    table.className = 'xlsx-sheet';
    table.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[name]);
    wrap.appendChild(table);
  }
}
```

- [ ] **Step 3: Run the registry tests (no regression)**

Run: `node --test web/viewers.test.js`
Expected: PASS

- [ ] **Step 4: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Drop an `.xlsx` into `./docs`, click it. Expected: each sheet renders as a titled HTML table.

- [ ] **Step 5: Commit**

```bash
git add web/viewers.js web/index.html
git commit -m "feat(viewers): render XLSX files with SheetJS"
```

---

## Task 7: PPTX viewer (lower fidelity, accepted)

**Files:**
- Modify: `web/viewers.js` (the `viewPptx` stub)
- Modify: `web/index.html` (importmap)

PPTX has the weakest client-side story (accepted in the spec). Use `pptx-preview`, which renders a pptx `ArrayBuffer` into a target element. Its API: `init(container, { width, height })` returns a previewer with `preview(arrayBuffer)`.

- [ ] **Step 1: Add pptx-preview to the importmap**

In `web/index.html`, append to the `"imports"` object (after the xlsx line; add a trailing comma to it):

```json
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs",
    "pptx-preview": "https://cdn.jsdelivr.net/npm/pptx-preview@1.0.1/+esm"
```

- [ ] **Step 2: Implement `viewPptx`**

In `web/viewers.js`, replace the `viewPptx` stub with:

```js
async function viewPptx(bytes, container) {
  const { init } = await lazyImport('pptx-preview');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'pptx-doc';
  container.appendChild(wrap);
  const width = container.clientWidth || 960;
  const previewer = init(wrap, { width, height: Math.round(width * 0.5625) });
  await previewer.preview(bytes);
}
```

- [ ] **Step 3: Run the registry tests (no regression)**

Run: `node --test web/viewers.test.js`
Expected: PASS

- [ ] **Step 4: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Drop a `.pptx` into `./docs`, click it. Expected: slides render (lower fidelity than the original deck — acceptable). If `pptx-preview@1.0.1` proves unworkable in-browser, swap to `pptxjs`/`PPTXjs` with an equivalent init+preview call; the viewer's contract (`(bytes, container) => Promise<void>`) does not change.

- [ ] **Step 5: Commit**

```bash
git add web/viewers.js web/index.html
git commit -m "feat(viewers): render PPTX files (lower fidelity)"
```

---

## Task 8: Wire the binary path into `app.js` `show()`

**Files:**
- Modify: `web/app.js` (import line ~7; `show()` lines 357-395)

- [ ] **Step 1: Import the registry**

In `web/app.js`, after the existing imports (after line 7, `import { renderAllium } from './allium.js';`), add:

```js
import { getViewer } from './viewers.js';
```

- [ ] **Step 2: Branch in `show()`**

In `web/app.js`, locate the block in `show()` that currently reads (lines 380-395):

```js
  tab.missing = false;
  const text = await res.text();
  if (seq !== showSeq) return;
  if (text.length > MAX_BYTES) {
    contentEl.innerHTML = '<p class="empty">File too large to preview.</p>';
    tocEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = path.endsWith('.allium') ? renderAllium(text) : render(text);
  assignHeadingIds();
  renderToc();
  await runMermaid();
  if (seq !== showSeq) return;
  restoreScroll(tab);
}
```

Replace it with:

```js
  tab.missing = false;

  const viewer = getViewer(path);
  if (viewer) {
    // Binary document: read raw bytes (no size cap) and render a static
    // preview. No TOC, no scroll-restore. Best-effort — let failures surface.
    const bytes = await res.arrayBuffer();
    if (seq !== showSeq) return;
    tocEl.innerHTML = '';
    contentEl.innerHTML = '';
    await viewer(bytes, contentEl);
    return;
  }

  const text = await res.text();
  if (seq !== showSeq) return;
  if (text.length > MAX_BYTES) {
    contentEl.innerHTML = '<p class="empty">File too large to preview.</p>';
    tocEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = path.endsWith('.allium') ? renderAllium(text) : render(text);
  assignHeadingIds();
  renderToc();
  await runMermaid();
  if (seq !== showSeq) return;
  restoreScroll(tab);
}
```

- [ ] **Step 3: Run the JS test suite (no regression)**

Run: `npm test`
Expected: PASS — `app.js` is not directly unit-tested, but `viewers.test.js` and all existing tests pass. (If `npm test` runs every `*.test.js`, confirm none import `app.js` in a way that breaks under node; they don't — app.js is browser-only and untested here.)

- [ ] **Step 4: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Open a `.md` (renders markdown, TOC populated), then a `.pdf`/`.docx`/`.xlsx`/`.pptx` (renders preview, Outline empty). Switch between tabs — each re-renders correctly.

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "feat(app): route binary documents through the viewer registry"
```

---

## Task 9: Omit favorites star on binary file rows

Per the spec, binary files don't get favorites. The tree still lists them and they open on click, but no ☆ star is rendered on their rows.

**Files:**
- Modify: `web/app.js` (`renderNode`, the file branch at lines 259-264)

- [ ] **Step 1: Add a binary-doc check and guard the star**

In `web/app.js`, the file branch of `renderNode` currently reads (lines 259-264):

```js
  } else {
    item.dataset.path = node.path;
    if (isRecent(node.modTime)) item.appendChild(makeRecentDot());
    item.appendChild(makeStar(node.path, false));
    item.addEventListener('click', () => open(node.path, node.name));
  }
```

Replace with:

```js
  } else {
    item.dataset.path = node.path;
    if (isRecent(node.modTime)) item.appendChild(makeRecentDot());
    // Binary documents are static previews and cannot be favorited.
    if (!isBinaryDoc(node.path)) item.appendChild(makeStar(node.path, false));
    item.addEventListener('click', () => open(node.path, node.name));
  }
```

- [ ] **Step 2: Update the import to include `isBinaryDoc`**

In `web/app.js`, change the viewers import added in Task 8 to:

```js
import { getViewer, isBinaryDoc } from './viewers.js';
```

- [ ] **Step 3: Run the JS test suite (no regression)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

In the tree: markdown/allium rows show a ☆ on hover/always; `.pdf`/`.docx`/`.xlsx`/`.pptx` rows show no star. Clicking a binary row still opens it.

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "feat(tree): omit favorite star on binary document rows"
```

---

## Task 10: Skip live-reload for binary tabs

The SSE `change` handler re-renders the active tab on disk change. Binary documents are static previews (spec), so a `change` event for a binary file should not trigger a re-render.

**Files:**
- Modify: `web/app.js` (`connectSSE`, the `change` branch at lines 496-502)

- [ ] **Step 1: Guard the change handler**

In `web/app.js`, the `change` branch of `es.onmessage` in `connectSSE` currently reads (lines 496-502):

```js
    } else if (msg.type === 'change') {
      markRecentInTree(msg.path);
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
```

Replace with:

```js
    } else if (msg.type === 'change') {
      markRecentInTree(msg.path);
      // Binary documents are static previews — do not live-reload them.
      if (isBinaryDoc(msg.path)) return;
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
```

(`isBinaryDoc` is already imported from Task 9.)

- [ ] **Step 2: Run the JS test suite (no regression)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Open a `.md` and edit it in your editor — the tab live-updates (unchanged behavior). Open a `.pdf`/`.docx` and touch the file on disk — the preview does NOT re-render (no flicker). The recent-dot still appears in the tree for the changed binary file.

- [ ] **Step 4: Commit**

```bash
git add web/app.js
git commit -m "feat(app): skip live-reload for static binary previews"
```

---

## Task 11: Embed `web/viewers.js` in the binary

The Go binary embeds web assets via an explicit `//go:embed` list. `viewers.js` must be added or the production binary won't serve it.

**Files:**
- Modify: `main.go` (line 16)

- [ ] **Step 1: Add viewers.js to the embed directive**

In `main.go`, change line 16 from:

```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js
```

to:

```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js web/viewers.js
```

- [ ] **Step 2: Build to verify the embed succeeds**

Run: `go build -o reefdoc .`
Expected: builds with no error. (A missing embedded file is a compile error, so a clean build confirms `web/viewers.js` is embedded.)

- [ ] **Step 3: Verify the served asset**

Run (in one shell): `./reefdoc ./docs`
Run (in another): `curl -s http://127.0.0.1:8080/viewers.js | head -3`
Expected: the first lines of `viewers.js` (the module comment), confirming it's served from the embedded FS. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add main.go
git commit -m "build: embed web/viewers.js in the binary"
```

---

## Task 12: Optional viewer styling

Give the binary previews sane layout (centered, readable width, page spacing). Light-touch — the renderers bring their own internal styles.

**Files:**
- Modify: `web/app.css`

- [ ] **Step 1: Append viewer styles**

Add to the end of `web/app.css`:

```css
/* Binary document previews */
.pdf-doc, .docx-doc, .xlsx-doc, .pptx-doc {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.pdf-page {
  max-width: 100%;
  height: auto;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.xlsx-doc { align-items: stretch; }
.xlsx-sheet { overflow-x: auto; }
.xlsx-sheet table { border-collapse: collapse; }
.xlsx-sheet td, .xlsx-sheet th {
  border: 1px solid var(--border, #ccc);
  padding: 2px 6px;
}
```

- [ ] **Step 2: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Open each binary type. Expected: PDF pages centered with a subtle shadow; spreadsheet tables have visible cell borders and scroll horizontally when wide.

- [ ] **Step 3: Commit**

```bash
git add web/app.css
git commit -m "style: layout for binary document previews"
```

---

## Task 13: Documentation

**Files:**
- Modify: `README.md` (Features list, lines 36-46)
- Modify: `CHANGELOG.md` (new top entry under the header)

- [ ] **Step 1: Update the README feature list**

In `README.md`, add to the Features bullet list (after the mermaid/allium bullets, around line 41):

```markdown
- Preview PDF, DOCX, XLSX, and PPTX files in the browser (rendered client-side)
```

Optionally update the one-line description near the top (line 6-9) to mention document previews.

- [ ] **Step 2: Add a CHANGELOG entry**

In `CHANGELOG.md`, insert below the header block (before the existing `## [0.8.1]` entry at line 8), choosing the next minor version:

```markdown
## [0.9.0] - 2026-06-25

### Added
- Browse and preview binary document formats in the browser: **PDF**
  (PDF.js), **DOCX** (docx-preview), **XLSX** (SheetJS), and **PPTX**
  (lower fidelity). These files now appear in the file tree and open in a
  tab as a static preview. Rendering is fully client-side; renderer
  libraries lazy-load from CDN on first use.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: announce PDF and Office document previews"
```

---

## Task 14: Full regression pass

- [ ] **Step 1: Run all Go tests**

Run: `go test ./...`
Expected: PASS

- [ ] **Step 2: Run all JS tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Build and smoke-test**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Confirm in the browser:
- Markdown / allium files render with TOC and live-reload (unchanged).
- A `.pdf`, `.docx`, `.xlsx`, `.pptx` each list in the tree, open in a tab, and render a preview.
- Binary rows show no favorite star; binary previews don't live-reload.
- Switching tabs between text and binary documents works without stale content.

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
git status   # expect clean; commit anything outstanding with an appropriate message
```
