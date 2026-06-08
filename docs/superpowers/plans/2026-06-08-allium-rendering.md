# Allium Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `.allium` files in reefdoc as structured, syntax-highlighted cards with TOC integration.

**Architecture:** A new `web/allium.js` module splits source into top-level declaration blocks via brace-counting, registers an Allium highlight.js language, and renders each block as a `<section>` card with an `<h3>` header. The existing `querySelectorAll('h1,h2,h3')` TOC scan in `app.js` picks up those headers with no changes to `toc.js`.

**Tech Stack:** vanilla JS (ES modules), highlight.js 11.9.0, node:test for JS unit tests, Go `go test ./...` for the embed smoke test.

---

## File map

| File | Change |
|---|---|
| `web/allium.js` | **Create** — block splitter, renderer, hljs language |
| `web/allium.test.js` | **Create** — unit tests for splitBlocks and renderAllium |
| `web/app.js` | **Modify** line 1 (import) and line 388 (render call) |
| `web/app.css` | **Modify** — append allium card styles |
| `main.go` | **Modify** line 16 — add `web/allium.js` to `//go:embed` |

> **Note:** `go test ./...` will fail if `web/allium.js` exists on disk but is not in the `//go:embed` directive (the smoke test `TestEmbeddedWebAssetsAreServed` catches this). Run `npm test` for JS-only tasks 1–3; run `go test ./...` only after Task 4 adds the embed.

---

### Task 1: Block splitter — `splitBlocks`

**Files:**
- Create: `web/allium.test.js`
- Create: `web/allium.js`

- [ ] **Step 1: Write the failing tests**

Create `web/allium.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks } from './allium.js';

test('splitBlocks: single entity block', () => {
  const src = 'entity Foo {\n  name: String\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'entity');
  assert.equal(blocks[0].name, 'Foo');
  assert.equal(blocks[0].body, src);
});

test('splitBlocks: two blocks separated by blank line', () => {
  const src = 'entity Foo {\n  x: Integer\n}\n\nrule Bar {\n  when: Foo.created\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].keyword, 'entity');
  assert.equal(blocks[0].name, 'Foo');
  assert.equal(blocks[1].keyword, 'rule');
  assert.equal(blocks[1].name, 'Bar');
});

test('splitBlocks: single-line use declaration', () => {
  const src = 'use "some/path.allium" as foo';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'use');
  assert.equal(blocks[0].name, '"some/path.allium" as foo');
  assert.equal(blocks[0].body, src);
});

test('splitBlocks: multi-word keyword external entity', () => {
  const src = 'external entity Role { title: String }';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'external entity');
  assert.equal(blocks[0].name, 'Role');
});

test('splitBlocks: braces inside -- comments do not affect depth', () => {
  const src = 'entity Foo {\n  -- comment with { braces }\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'entity');
});

test('splitBlocks: nameless block (config)', () => {
  const src = 'config {\n  timeout: Duration = 30.seconds\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'config');
  assert.equal(blocks[0].name, '');
});

test('splitBlocks: blank source returns empty array', () => {
  assert.deepEqual(splitBlocks(''), []);
  assert.deepEqual(splitBlocks('  \n  '), []);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm test
```

Expected: 7 failures — `splitBlocks` not exported.

- [ ] **Step 3: Implement splitBlocks**

Create `web/allium.js`:

```js
const BLOCK_KEYWORDS = [
  'external entity', 'entity', 'variant', 'rule', 'surface',
  'contract', 'invariant', 'value', 'config', 'given', 'actor',
];
const LINE_KEYWORDS = ['open question', 'deferred', 'default', 'use'];

export function splitBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const bkw = BLOCK_KEYWORDS.find(kw => line.startsWith(kw));
    if (bkw) {
      const afterKw = line.slice(bkw.length).trim();
      const braceIdx = afterKw.indexOf('{');
      const name = (braceIdx >= 0 ? afterKw.slice(0, braceIdx) : afterKw).trim();
      const start = i;
      let depth = countBraces(line);
      i++;
      while (i < lines.length && depth > 0) {
        depth += countBraces(lines[i]);
        i++;
      }
      blocks.push({ keyword: bkw, name, body: lines.slice(start, i).join('\n') });
      continue;
    }

    const lkw = LINE_KEYWORDS.find(kw => line.startsWith(kw));
    if (lkw) {
      blocks.push({ keyword: lkw, name: line.slice(lkw.length).trim(), body: line });
      i++;
      continue;
    }

    i++;
  }

  return blocks;
}

function countBraces(line) {
  const commentIdx = line.indexOf('--');
  const code = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  let depth = 0;
  for (const ch of code) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm test
```

Expected: 7 passing for `splitBlocks`, all others from existing test files still pass.

- [ ] **Step 5: Commit**

```bash
git add web/allium.js web/allium.test.js
git commit -m "feat(allium): add splitBlocks — brace-counting block splitter"
```

---

### Task 2: Renderer + hljs language — `renderAllium`

**Files:**
- Modify: `web/allium.test.js` — add renderAllium tests
- Modify: `web/allium.js` — add hljs import, language registration, renderAllium

- [ ] **Step 1: Add the failing tests**

Replace the import line in `web/allium.test.js`:
```js
import { splitBlocks, renderAllium } from './allium.js';
```

Append these tests to `web/allium.test.js`:

```js
test('renderAllium: section has correct class and id', () => {
  const html = renderAllium('entity Foo {\n  x: Integer\n}');
  assert.match(html, /class="allium-block allium-block--entity"/);
  assert.match(html, /id="entity-foo"/);
});

test('renderAllium: h3 contains keyword badge then name', () => {
  const html = renderAllium('entity Foo {\n  x: Integer\n}');
  assert.match(html, /<h3 class="allium-block-header"><span class="allium-kw">entity<\/span> <span class="allium-name">Foo<\/span><\/h3>/);
});

test('renderAllium: multi-word keyword uses hyphen slug in class and id', () => {
  const html = renderAllium('external entity Role { title: String }');
  assert.match(html, /allium-block--external-entity/);
  assert.match(html, /id="external-entity-role"/);
});

test('renderAllium: body is syntax-highlighted', () => {
  const html = renderAllium('entity Foo {\n  x: Integer\n}');
  assert.match(html, /hljs-/);
});

test('renderAllium: empty source returns placeholder', () => {
  assert.match(renderAllium(''), /class="empty"/);
});
```

- [ ] **Step 2: Run to confirm they fail**

```
npm test
```

Expected: 5 new failures — `renderAllium` not exported.

- [ ] **Step 3: Implement renderAllium and register the hljs language**

Prepend the following to `web/allium.js` (before the existing constants):

```js
import hljs from 'highlight.js';

hljs.registerLanguage('allium', () => ({
  name: 'Allium',
  contains: [
    { className: 'comment', begin: '--', end: '$' },
    { className: 'string', begin: '"', end: '"' },
    {
      className: 'type',
      match: /\b(String|Integer|Boolean|Timestamp|Duration|Date|Any|Set|List|Money|Path)\b/,
    },
    {
      className: 'literal',
      match: /\b(now|this|true|false|null)\b/,
    },
    {
      className: 'keyword',
      match: /\b(entity|variant|rule|surface|contract|invariant|value|config|given|actor|external|default|deferred|use|when|requires|ensures|let|for|in|where|if|else|not|and|or|implies|transitions|becomes|created|exists|facing|context|exposes|provides|related|contracts|demands|fulfils|timeout|within)\b/,
    },
    { className: 'number', match: /\b\d+(\.\d+)?\b/ },
  ],
}));
```

Append the following to the bottom of `web/allium.js` (after `countBraces`):

```js
export function renderAllium(source) {
  const blocks = splitBlocks(source);
  if (blocks.length === 0) return '<p class="empty">Empty spec.</p>';
  return blocks.map(renderBlock).join('\n');
}

function renderBlock({ keyword, name, body }) {
  const skw = keyword.replace(/\s+/g, '-');
  const slugName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = slugName ? `${skw}-${slugName}` : skw;
  const highlighted = hljs.highlight(body, { language: 'allium' }).value;
  const bodyHtml = LINE_KEYWORDS.includes(keyword)
    ? `<code class="allium-body">${highlighted}</code>`
    : `<pre class="hljs allium-body"><code>${highlighted}</code></pre>`;
  return `<section class="allium-block allium-block--${skw}" id="${id}"><h3 class="allium-block-header"><span class="allium-kw">${escHtml(keyword)}</span> <span class="allium-name">${escHtml(name)}</span></h3>${bodyHtml}</section>`;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npm test
```

Expected: all 12 tests pass (7 splitBlocks + 5 renderAllium).

- [ ] **Step 5: Commit**

```bash
git add web/allium.js web/allium.test.js
git commit -m "feat(allium): add renderAllium renderer and highlight.js language"
```

---

### Task 3: Add web/allium.js to main.go embed

**Files:**
- Modify: `main.go` line 16

- [ ] **Step 1: Add allium.js to the embed directive**

In `main.go`, change line 16 from:
```go
//go:embed web/index.html web/app.css web/app.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js
```
to:
```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js
```

- [ ] **Step 2: Run the full test suite**

```
go test ./...
```

Expected: `PASS` — `TestEmbeddedWebAssetsAreServed` confirms `web/allium.js` is embedded and served with 200.

- [ ] **Step 3: Commit**

```bash
git add main.go
git commit -m "feat(allium): embed web/allium.js in Go binary"
```

---

### Task 4: Wire app.js to route .allium files

**Files:**
- Modify: `web/app.js` line 1 (imports), line 388 (render call)

- [ ] **Step 1: Add the import**

In `web/app.js`, add `renderAllium` to the import block at the top. The existing imports are on lines 1–6; add as line 7:

```js
import { renderAllium } from './allium.js';
```

- [ ] **Step 2: Route .allium files**

In `web/app.js`, change line 388 from:
```js
  contentEl.innerHTML = render(text);
```
to:
```js
  contentEl.innerHTML = path.endsWith('.allium') ? renderAllium(text) : render(text);
```

- [ ] **Step 3: Run JS tests to confirm no regressions**

```
npm test
```

Expected: all tests still pass (app.js has no dedicated test file; existing module tests are unaffected).

- [ ] **Step 4: Commit**

```bash
git add web/app.js
git commit -m "feat(allium): route .allium files to renderAllium in app.js"
```

---

### Task 5: CSS styles for allium cards

**Files:**
- Modify: `web/app.css` — append styles

- [ ] **Step 1: Append allium card styles to app.css**

Add to the end of `web/app.css`:

```css
/* ---- Allium spec rendering ---- */
.allium-block { margin-bottom:20px; border-left:3px solid var(--accent); border-radius:0 4px 4px 0; background:var(--sidebar); overflow:hidden; }
.allium-block--rule { border-left-color:#c97c00; }
body[data-theme="dark"] .allium-block--rule { border-left-color:#e0a030; }
.allium-block--surface { border-left-color:#1a8a3c; }
body[data-theme="dark"] .allium-block--surface { border-left-color:#3dbf65; }
.allium-block--contract { border-left-color:#7b4fc4; }
body[data-theme="dark"] .allium-block--contract { border-left-color:#a97ee8; }
.allium-block-header { display:flex; align-items:center; gap:8px; margin:0; padding:8px 12px; font-size:13px; font-weight:normal; border-bottom:1px solid var(--border); }
.allium-kw { font-family:ui-monospace,monospace; font-size:11px; padding:1px 6px; border-radius:10px; background:var(--border); color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; }
.allium-name { font-family:ui-monospace,monospace; font-size:14px; font-weight:600; color:var(--fg); }
.allium-body { margin:0; padding:12px; border-radius:0; font-size:13px; }
```

- [ ] **Step 2: Run full test suite one final time**

```
npm test && go test ./...
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/app.css
git commit -m "feat(allium): add card styles for allium spec rendering"
```
