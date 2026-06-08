# Hyperlinks Between Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable markdown links and Allium `use` paths to open target files in a new reefdoc tab instead of navigating the browser.

**Architecture:** A single delegated `click` listener on `contentEl` in `app.js` intercepts all local `<a>` clicks and calls the existing `open(path, title)` function with the resolved path. Allium `use` blocks are updated at render time in `allium.js` to emit an `<a href>` for the quoted path; the same listener handles those clicks. External and anchor URLs pass through to the browser unchanged.

**Tech Stack:** Vanilla ES modules, `node:test` for unit tests, Node.js built-in `URL` for path resolution.

---

### Task 1: Render `use` paths as links in `allium.js`

**Files:**
- Modify: `web/allium.js` — `renderBlock` function (~line 87)
- Modify: `web/allium.test.js` — add test at end of file

- [ ] **Step 1: Write the failing test**

Add to the end of `web/allium.test.js`:

```js
test('renderAllium: use block renders quoted path as an anchor', () => {
  const html = renderAllium('use "./specs/core.allium"');
  assert.match(html, /<a href="\.\/specs\/core\.allium">/);
  assert.match(html, /"\.\/specs\/core\.allium"<\/a>/);
  assert.match(html, /class="allium-body"/);
});

test('renderAllium: use block with alias still links the path', () => {
  const html = renderAllium('use "specs/base.allium" as base');
  assert.match(html, /<a href="specs\/base\.allium">/);
  assert.match(html, / as base/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test
```

Expected: two new tests FAIL — the `<a href>` pattern is not found in the current output.

- [ ] **Step 3: Update `renderBlock` in `web/allium.js`**

Replace the `bodyHtml` assignment (the line starting `const bodyHtml = LINE_KEYWORDS...`) with:

```js
let bodyHtml;
if (keyword === 'use') {
  const pathMatch = name.match(/^"([^"]+)"/);
  if (pathMatch) {
    const path = pathMatch[1];
    const after = escHtml(name.slice(pathMatch[0].length));
    bodyHtml = `<code class="allium-body"><span class="hljs-keyword">use</span> <a href="${escHtml(path)}">"${escHtml(path)}"</a>${after}</code>`;
  } else {
    bodyHtml = `<code class="allium-body">${highlighted}</code>`;
  }
} else {
  bodyHtml = LINE_KEYWORDS.includes(keyword)
    ? `<code class="allium-body">${highlighted}</code>`
    : `<pre class="hljs allium-body"><code>${highlighted}</code></pre>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test
```

Expected: all tests PASS including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add web/allium.js web/allium.test.js
git commit -m "feat(allium): render use paths as clickable links"
```

---

### Task 2: Add `resolvePath` and test it

**Files:**
- Modify: `web/app.js` — add `resolvePath` function before the scroll listener (~line 449)
- Create: `web/app.test.js` — unit tests for `resolvePath`

`app.js` has DOM-bound module-level code (`document.getElementById`) that prevents headless import, so `resolvePath` is duplicated inline in the test file. The implementation in `app.js` and the copy in `app.test.js` must stay in sync.

- [ ] **Step 1: Write `web/app.test.js` with failing tests**

Create `web/app.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// resolvePath lives in app.js which has DOM side-effects at module scope
// and cannot be imported headlessly. Duplicate the pure function here.
function resolvePath(base, href) {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return new URL(href, 'file:///' + dir).pathname.slice(1);
}

test('resolvePath: sibling file via ./', () => {
  assert.equal(resolvePath('docs/guide/intro.md', './sibling.md'), 'docs/guide/sibling.md');
});

test('resolvePath: parent directory via ../', () => {
  assert.equal(resolvePath('docs/guide/intro.md', '../specs/core.allium'), 'docs/specs/core.allium');
});

test('resolvePath: root-relative path strips leading slash', () => {
  assert.equal(resolvePath('docs/guide/intro.md', '/entities/user.allium'), 'entities/user.allium');
});

test('resolvePath: file at root with relative link', () => {
  assert.equal(resolvePath('intro.md', './other.allium'), 'other.allium');
});

test('resolvePath: no active tab (empty base) with root-relative link', () => {
  assert.equal(resolvePath('', '/specs/core.allium'), 'specs/core.allium');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test
```

Expected: all five new tests FAIL — `resolvePath` is not defined.

- [ ] **Step 3: Add `resolvePath` to `web/app.js`**

Add the following function in `web/app.js` just before the scroll listener (the line `contentEl.addEventListener('scroll', ...)`):

```js
function resolvePath(base, href) {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return new URL(href, 'file:///' + dir).pathname.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test
```

Expected: all tests PASS. (The `app.test.js` tests use the inline copy — this step confirms the logic is correct before wiring it up.)

- [ ] **Step 5: Commit**

```bash
git add web/app.js web/app.test.js
git commit -m "feat(links): add resolvePath for local link resolution"
```

---

### Task 3: Wire up click delegation in `app.js`

**Files:**
- Modify: `web/app.js` — add listener after `resolvePath` function, before the scroll listener

This task has no isolated unit test — `app.js` cannot be imported without a browser DOM. Correctness is verified by running the app in Task 4.

- [ ] **Step 1: Add the click delegation listener**

In `web/app.js`, directly after the `resolvePath` function added in Task 2 (and still before `contentEl.addEventListener('scroll', ...)`), add:

```js
contentEl.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || /^(https?:|mailto:|#)/.test(href)) return;
  e.preventDefault();
  const resolved = resolvePath(store.active || '', href);
  const title = resolved.slice(resolved.lastIndexOf('/') + 1);
  open(resolved, title);
});
```

- [ ] **Step 2: Run tests to confirm no regressions**

```
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app.js
git commit -m "feat(links): open local document links in a new tab"
```

---

### Task 4: Verify in the running app

- [ ] **Step 1: Build and start the server**

```bash
go build -o reefdoc . && ./reefdoc .
```

Expected: server starts at `http://127.0.0.1:8080`.

- [ ] **Step 2: Verify markdown link opens in a new tab**

Open any `.md` file that contains a relative link to another `.md` or `.allium` file (or add one temporarily). Click the link. Expected: the target file opens in a new reefdoc tab without the browser navigating away.

- [ ] **Step 3: Verify allium `use` path opens in a new tab**

Open an `.allium` file that contains a `use "path"` declaration. Click the linked path. Expected: the referenced file opens in a new reefdoc tab.

- [ ] **Step 4: Verify external links still open in the browser**

Click a `https://` link in a markdown document. Expected: opens in a new browser tab normally, reefdoc tab is unchanged.

- [ ] **Step 5: Verify `#anchor` links in TOC still scroll**

Click a TOC entry in a markdown document. Expected: scrolls within the page as before, no new tab opened.

- [ ] **Step 6: Commit if any fixes were needed; otherwise proceed**

```bash
git add -p
git commit -m "fix(links): <describe any fix>"
```
