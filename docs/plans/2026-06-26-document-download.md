# Document Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tab-bar button that downloads the currently-open document (original bytes, original filename) for every document type reefdoc can open.

**Architecture:** The Go `/api/file` handler gains an opt-in `?download=1` mode that sets a sanitized `Content-Disposition: attachment` header; all existing path-safety, symlink, content-type, and byte-reading behavior is unchanged. The vanilla-JS frontend adds a right-aligned download button in a new tab-bar row that navigates to that URL for the active document, letting the browser save natively.

**Tech Stack:** Go (`net/http`, `httptest`), vanilla JS (ES modules), `node:test` for JS unit tests.

**Spec:** `docs/specs/2026-06-26-document-download-design.md`

---

## File Structure

- `internal/server/server.go` — add `?download=1` handling + a `dispositionFilename` sanitizer helper in `handleFile`.
- `internal/server/server_test.go` — Go tests for the header, body integrity, sanitization, and inline-preservation.
- `web/index.html` — wrap `#tabbar` in `#tabbar-row` and add `#download-btn`.
- `web/app.js` — add a pure `downloadUrl(path)` builder, a `refreshDownloadButton()` visibility helper, the click handler, and calls into the active-document lifecycle.
- `web/app.test.js` — JS unit tests for `downloadUrl` (duplicated pure function, matching the `resolvePath` pattern).
- `web/app.css` — style `#tabbar-row` and `#download-btn`.

---

## Task 1: Server — `?download=1` sets a sanitized `Content-Disposition` header

**Files:**
- Modify: `internal/server/server.go` (the `handleFile` function, lines 57-78, and add a helper near `contentType` at the file end)
- Test: `internal/server/server_test.go`

- [ ] **Step 1: Write the failing tests**

Add these tests to the end of `internal/server/server_test.go`:

```go
func TestHandleFile_DownloadSetsContentDisposition(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "report.pdf"), []byte("PDFDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=report.pdf&download=1", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	got := rec.Header().Get("Content-Disposition")
	want := `attachment; filename="report.pdf"`
	if got != want {
		t.Fatalf("Content-Disposition %q, want %q", got, want)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("Content-Type %q, want application/pdf", ct)
	}
	if rec.Body.String() != "PDFDATA" {
		t.Fatalf("body %q", rec.Body.String())
	}
}

func TestHandleFile_DownloadUsesBasename(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "intro.md"), []byte("# hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=docs/intro.md&download=1", nil))
	if got := rec.Header().Get("Content-Disposition"); got != `attachment; filename="intro.md"` {
		t.Fatalf("Content-Disposition %q, want basename intro.md", got)
	}
}

func TestHandleFile_DownloadSanitizesFilename(t *testing.T) {
	root := t.TempDir()
	// A filename containing a double-quote and a control character. If the OS
	// allows the file to be created, the header must not contain a raw " or
	// control byte that could break or inject the header.
	name := "a\"b\x01.md"
	if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
		t.Skipf("OS rejected test filename: %v", err)
	}
	s := New(root, NewBroker(), fstest.MapFS{}, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path="+name+"&download=1", nil))
	cd := rec.Header().Get("Content-Disposition")
	if strings.ContainsAny(cd[len("attachment; filename=\""):], "\x01") {
		t.Fatalf("control char leaked into header: %q", cd)
	}
	// The quoted filename value must not contain a raw double-quote.
	inner := strings.TrimSuffix(strings.TrimPrefix(cd, `attachment; filename="`), `"`)
	if strings.Contains(inner, `"`) {
		t.Fatalf("raw double-quote leaked into filename value: %q", cd)
	}
}

func TestHandleFile_NoDownloadParamOmitsContentDisposition(t *testing.T) {
	s, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/file?path=a.md", nil))
	if cd := rec.Header().Get("Content-Disposition"); cd != "" {
		t.Fatalf("Content-Disposition should be absent for inline requests, got %q", cd)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/server/ -run TestHandleFile_Download -v`
Expected: FAIL — `Content-Disposition` header is empty (feature not implemented yet).

- [ ] **Step 3: Implement the `?download=1` handling and sanitizer**

In `internal/server/server.go`, modify `handleFile` so that after the existing `w.Header().Set("Content-Type", contentType(abs))` line (line 76) and before writing the body, it conditionally sets the disposition header. The full updated tail of `handleFile`:

```go
	w.Header().Set("Content-Type", contentType(abs))
	if r.URL.Query().Get("download") == "1" {
		name := dispositionFilename(filepath.Base(abs))
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	}
	_, _ = w.Write(data)
}
```

Then add this helper at the end of `internal/server/server.go` (next to `contentType`):

```go
// dispositionFilename returns a value safe to embed in a quoted
// Content-Disposition filename. It drops control characters and escapes
// backslashes and double-quotes so the header cannot be broken or injected.
// Path safety is enforced elsewhere; this only produces a valid header value.
func dispositionFilename(base string) string {
	var b strings.Builder
	for _, r := range base {
		switch {
		case r < 0x20 || r == 0x7f:
			// drop control characters
		case r == '"' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}
```

`filepath` and `strings` are already imported in this file (lines 9-10), so no import changes are needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/server/ -run TestHandleFile -v`
Expected: PASS for all `TestHandleFile_*` tests (new and existing).

- [ ] **Step 5: Run the full Go suite to confirm no regressions**

Run: `go test ./...`
Expected: PASS (all packages).

- [ ] **Step 6: Commit**

```bash
git add internal/server/server.go internal/server/server_test.go
git commit -m "feat(server): add ?download=1 mode to /api/file"
```

---

## Task 2: Frontend — pure `downloadUrl` builder + unit tests

**Files:**
- Modify: `web/app.js` (add the `downloadUrl` function near `resolvePath`, ~line 556)
- Test: `web/app.test.js`

The download URL builder is a pure function. Because `app.js` has DOM side-effects at module scope and cannot be imported headlessly, the test duplicates the pure function exactly as `app.test.js` already does for `resolvePath`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `web/app.test.js`:

```js
// downloadUrl lives in app.js which has DOM side-effects at module scope and
// cannot be imported headlessly. Duplicate the pure function here (matches the
// resolvePath pattern above).
function downloadUrl(path) {
  return '/api/file?path=' + encodeURIComponent(path) + '&download=1';
}

test('downloadUrl: builds the download URL for a simple path', () => {
  assert.equal(downloadUrl('a.md'), '/api/file?path=a.md&download=1');
});

test('downloadUrl: encodes spaces and slashes in nested paths', () => {
  assert.equal(
    downloadUrl('my docs/report.pdf'),
    '/api/file?path=my%20docs%2Freport.pdf&download=1'
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the new `downloadUrl` tests are present but, if you have not yet added the duplicated function, the test file errors. (If you added the duplicated helper in the test file in Step 1, the tests will PASS immediately — that is acceptable for a pure-duplication test; the real verification is that `app.js` ships the same function in Step 3.)

- [ ] **Step 3: Add the real `downloadUrl` to `web/app.js`**

In `web/app.js`, add this function immediately above `resolvePath` (currently at line 556):

```js
// Build the URL that downloads a document's original bytes. The server responds
// with Content-Disposition: attachment, so the browser saves rather than renders.
function downloadUrl(path) {
  return '/api/file?path=' + encodeURIComponent(path) + '&download=1';
}
```

- [ ] **Step 4: Run the JS tests to confirm they pass**

Run: `npm test`
Expected: PASS (all tests, including the two new `downloadUrl` cases).

- [ ] **Step 5: Commit**

```bash
git add web/app.js web/app.test.js
git commit -m "feat(app): add downloadUrl builder"
```

---

## Task 3: Frontend — download button markup and styling

**Files:**
- Modify: `web/index.html` (lines 48-51, the `#main` block)
- Modify: `web/app.css` (append new rules)

- [ ] **Step 1: Wrap the tab bar and add the button in `web/index.html`**

Replace the current `#main` block (lines 48-51):

```html
  <main id="main">
    <div id="tabbar"></div>
    <article id="content"><p class="empty">Select a file from the tree.</p></article>
  </main>
```

with:

```html
  <main id="main">
    <div id="tabbar-row">
      <div id="tabbar"></div>
      <button id="download-btn" title="Download this document" hidden>⤓</button>
    </div>
    <article id="content"><p class="empty">Select a file from the tree.</p></article>
  </main>
```

- [ ] **Step 2: Add styling to `web/app.css`**

Append to `web/app.css`. These rules reuse the project's existing theme variables (`--bg`, `--fg`, `--border`, defined in `:root` and `body[data-theme="dark"]` at the top of `web/app.css`) and mirror the existing `#theme-toggle` control. Note the existing `#tabbar` rule (line 23) already sets `display:flex; flex:0 0 auto; ...`; wrapping it in `#tabbar-row` does not require changing that rule — the row is a new flex parent and `#tabbar` becomes a flex child within it.

```css
#tabbar-row { display:flex; align-items:stretch; border-bottom:1px solid var(--border); }
#tabbar-row #tabbar { flex:1 1 auto; min-width:0; border-bottom:none; }
#download-btn { flex:0 0 auto; align-self:center; margin:0 8px; padding:4px 8px;
                font-size:15px; line-height:1; cursor:pointer; background:var(--bg);
                color:var(--fg); border:1px solid var(--border); border-radius:4px; }
#download-btn:hover { background:var(--border); }
```

Note: the existing `#tabbar` rule sets its own `border-bottom`; moving that border onto `#tabbar-row` (and overriding `#tabbar` with `border-bottom:none`) keeps a single continuous bottom border across the full row including the button area.

- [ ] **Step 3: Verify the page renders with the button hidden**

Run: `go build -o reefdoc . && ./reefdoc ./docs`
Then open `http://127.0.0.1:8080` in a browser. Expected: the layout is unchanged and no download button is visible (it is `hidden` because no document is open yet). Stop the server (Ctrl-C) when done.

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/app.css
git commit -m "feat(app): add download button markup and styling"
```

---

## Task 4: Frontend — wire the button into the active-document lifecycle

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Add the button element reference**

In `web/app.js`, alongside the existing element references (after line 157 where `tocEl` is defined), add:

```js
const downloadBtn = el('download-btn');
```

- [ ] **Step 2: Add the `refreshDownloadButton` helper and click handler**

In `web/app.js`, immediately after the `downloadUrl` function added in Task 2, add:

```js
// Show the download button only when a document is active; clicking it triggers
// a native browser download of the active document's original bytes.
function refreshDownloadButton() {
  downloadBtn.hidden = !store.active;
}

downloadBtn.addEventListener('click', () => {
  if (!store.active) return;
  const a = document.createElement('a');
  a.href = downloadUrl(store.active);
  a.download = ''; // hint the browser to save; server filename still wins
  document.body.appendChild(a);
  a.click();
  a.remove();
});
```

- [ ] **Step 3: Call `refreshDownloadButton` wherever the active document changes**

Add a `refreshDownloadButton();` call in each of these four places in `web/app.js`:

In `open()` (after `renderTabs();`, around line 416):
```js
  renderTabs();
  refreshDownloadButton();
```

In `activate()` (after `renderTabs();`, around line 427):
```js
  renderTabs();
  refreshDownloadButton();
```

In `doClose()` — at the end of the function (after the `if (store.active) { ... } else { ... }` block, around line 445), add:
```js
  refreshDownloadButton();
```

In the boot/session-restore block, after the session's `renderTabs();` call (around line 729) and also in the `else if (bootPath)` path the button is handled by `open()`. To cover the no-session/no-bootPath case explicitly, add a single call after the entire boot restore block (after line 735):
```js
refreshDownloadButton();
```

- [ ] **Step 4: Manually verify the button behavior**

Run: `go build -o reefdoc . && ./reefdoc ./docs`
Open `http://127.0.0.1:8080`. Expected behavior:
1. With no document open, the button is hidden.
2. Open a markdown file from the tree — the download button appears in the tab-bar row.
3. Click it — the browser downloads the original `.md` file with its correct name.
4. Open a PDF (if one exists under `./docs`, or create one) — clicking downloads the original PDF.
5. Close all tabs — the button disappears.
Stop the server (Ctrl-C) when done.

- [ ] **Step 5: Run all tests to confirm no regressions**

Run: `go test ./... && npm test`
Expected: PASS for both suites.

- [ ] **Step 6: Commit**

```bash
git add web/app.js
git commit -m "feat(app): wire download button to active document lifecycle"
```

---

## Task 5: Documentation

**Files:**
- Modify: `README.md` (Features list, lines 36-47)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the feature to the README features list**

In `README.md`, add a bullet to the Features list (after line 46, the "Hyperlinks between documents" bullet or in a sensible position):

```markdown
- Download the open document (original file) with one click
```

- [ ] **Step 2: Add a CHANGELOG entry**

Open `CHANGELOG.md`, read its existing format, and add an entry matching that format describing: "Download the currently-open document via a tab-bar button (works for all document types; serves the original bytes via `/api/file?download=1`)." Follow the existing heading/version convention exactly — do not invent a new format.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: announce document download feature"
```

---

## Self-Review Notes

- **Spec coverage:** Server `?download=1` + sanitized `Content-Disposition` (Task 1) covers the Server Change section. `downloadUrl` (Task 2), button markup (Task 3), and lifecycle wiring (Task 4) cover the Frontend Change section. Edge cases (no doc open → hidden button; deleted file → existing 404; special filenames → `dispositionFilename`; large files → unchanged read path) are all addressed. Testing section maps to Task 1 (Go) and Task 2 (JS).
- **Placeholder scan:** No TBDs. The only deferral is the CHANGELOG format, which is intentionally "match the existing convention" since the format is project-defined.
- **Type/name consistency:** `downloadUrl`, `refreshDownloadButton`, `#download-btn`, `#tabbar-row`, and `dispositionFilename` are used consistently across all tasks.
