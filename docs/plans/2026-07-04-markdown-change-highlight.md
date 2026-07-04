# Markdown Change Highlighting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a markdown (or Allium) file auto-reloads via live reload, visually highlight which blocks changed — yellow fade for attention, persistent left border until next reload, and gap markers where blocks were removed.

**Architecture:** A new `web/changemark.js` module provides pure functions for snapshotting block children and diffing them via LCS. `app.js` calls snapshot before re-render and markChanges after. CSS handles all visual effects (no JS timers). The module follows the same dependency-injected, unit-testable pattern as `binreload.js`.

**Tech Stack:** Vanilla JS (ES modules), CSS animations, `node:test` for unit tests.

## Global Constraints

- No external dependencies — all logic is vanilla JS.
- Follow the existing `web/*.js` pattern: pure exported functions, tested with `node --test`.
- New JS files must be added to the `//go:embed` directive in `main.go` (line 16).
- CSS variables must work in both light and dark themes.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `web/changemark.js` | Create | `snapshotBlocks()`, `computeDiff()`, `markChanges()` — pure diff + DOM marking |
| `web/changemark.test.js` | Create | Unit tests for snapshot, LCS diff, and marking logic |
| `web/app.css` | Modify | `.rf-changed`, `.rf-changed-flash`, `.rf-removed-marker` styles |
| `web/app.js` | Modify | Import changemark, wire snapshot/mark into SSE handler + show() |
| `main.go` | Modify | Add `web/changemark.js` to embed list |

---

### Task 1: Core diff engine — `web/changemark.js` + tests

**Files:**
- Create: `web/changemark.js`
- Create: `web/changemark.test.js`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces:
  - `snapshotBlocks(container: Element) → Array<{tag: string, text: string, html: string}>` — snapshots direct element children
  - `computeDiff(oldSnap: Array<{tag, text, html}>, newSnap: Array<{tag, text, html}>) → Array<{type: 'keep'|'modify'|'insert'|'remove', newIndex?: number, oldIndex?: number, count?: number}>` — returns an ordered list of diff ops
  - `applyMarks(container: Element, ops: Array<DiffOp>) → void` — adds CSS classes and inserts gap markers

- [ ] **Step 1: Write failing tests for `snapshotBlocks`**

In `web/changemark.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotBlocks, computeDiff } from './changemark.js';

// Minimal DOM shim for testing — snapshotBlocks just reads .tagName,
// .textContent, and .outerHTML from direct element children.
function makeContainer(blocks) {
  return {
    children: blocks.map(([tag, text, html]) => ({
      nodeType: 1,
      tagName: tag.toUpperCase(),
      textContent: text,
      outerHTML: html || `<${tag}>${text}</${tag}>`,
    })),
  };
}

test('snapshotBlocks: captures tag, trimmed text (max 200 chars), and html', () => {
  const c = makeContainer([
    ['p', '  Hello world  ', '<p>Hello world</p>'],
    ['h1', 'Title', '<h1>Title</h1>'],
  ]);
  const snap = snapshotBlocks(c);
  assert.deepEqual(snap, [
    { tag: 'P', text: 'Hello world', html: '<p>Hello world</p>' },
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
  ]);
});

test('snapshotBlocks: truncates text to 200 chars for key matching', () => {
  const long = 'x'.repeat(300);
  const c = makeContainer([['p', long, `<p>${long}</p>`]]);
  const snap = snapshotBlocks(c);
  assert.equal(snap[0].text.length, 200);
});

test('snapshotBlocks: empty container returns empty array', () => {
  assert.deepEqual(snapshotBlocks({ children: [] }), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test web/changemark.test.js`
Expected: FAIL — `changemark.js` does not exist yet.

- [ ] **Step 3: Implement `snapshotBlocks`**

In `web/changemark.js`:

```js
export function snapshotBlocks(container) {
  const result = [];
  for (const child of container.children) {
    if (child.nodeType !== 1) continue;
    const text = (child.textContent || '').trim().slice(0, 200);
    result.push({ tag: child.tagName, text, html: child.outerHTML });
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify `snapshotBlocks` passes**

Run: `node --test web/changemark.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Write failing tests for `computeDiff`**

Append to `web/changemark.test.js`:

```js
test('computeDiff: identical snapshots → all keep', () => {
  const snap = [
    { tag: 'P', text: 'Hello', html: '<p>Hello</p>' },
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
  ];
  const ops = computeDiff(snap, snap);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'keep', newIndex: 1 },
  ]);
});

test('computeDiff: modified block (same key, different html)', () => {
  const old = [{ tag: 'P', text: 'Hello', html: '<p>Hello</p>' }];
  const now = [{ tag: 'P', text: 'Hello', html: '<p><strong>Hello</strong></p>' }];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [{ type: 'modify', newIndex: 0 }]);
});

test('computeDiff: inserted block', () => {
  const old = [{ tag: 'P', text: 'A', html: '<p>A</p>' }];
  const now = [
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
  ];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'insert', newIndex: 1 },
  ]);
});

test('computeDiff: removed block', () => {
  const old = [
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
  ];
  const now = [{ tag: 'P', text: 'A', html: '<p>A</p>' }];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'remove', count: 1 },
  ]);
});

test('computeDiff: multiple consecutive removals collapse into one op', () => {
  const old = [
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
    { tag: 'P', text: 'C', html: '<p>C</p>' },
  ];
  const now = [{ tag: 'H1', text: 'Title', html: '<h1>Title</h1>' }];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'remove', count: 3 },
  ]);
});

test('computeDiff: empty old → all inserts', () => {
  const now = [{ tag: 'P', text: 'A', html: '<p>A</p>' }];
  const ops = computeDiff([], now);
  assert.deepEqual(ops, [{ type: 'insert', newIndex: 0 }]);
});

test('computeDiff: empty new → all removes', () => {
  const old = [
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
  ];
  const ops = computeDiff(old, []);
  assert.deepEqual(ops, [{ type: 'remove', count: 2 }]);
});

test('computeDiff: interleaved insert and remove', () => {
  const old = [
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
    { tag: 'P', text: 'Old para', html: '<p>Old para</p>' },
  ];
  const now = [
    { tag: 'P', text: 'New para', html: '<p>New para</p>' },
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
  ];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'insert', newIndex: 0 },
    { type: 'keep', newIndex: 1 },
    { type: 'remove', count: 1 },
  ]);
});
```

- [ ] **Step 6: Implement `computeDiff`**

Append to `web/changemark.js`:

```js
function blockKey(snap) {
  return snap.tag + '\0' + snap.text;
}

export function computeDiff(oldSnap, newSnap) {
  const oldKeys = oldSnap.map(blockKey);
  const newKeys = newSnap.map(blockKey);

  // LCS via standard DP
  const m = oldKeys.length, n = newKeys.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldKeys[i] === newKeys[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the DP table to produce ops
  const ops = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldKeys[i] === newKeys[j]) {
      // Matched key — keep or modify depending on html equality
      ops.push(oldSnap[i].html === newSnap[j].html
        ? { type: 'keep', newIndex: j }
        : { type: 'modify', newIndex: j });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: 'insert', newIndex: j });
      j++;
    } else {
      // Count consecutive removals
      let count = 0;
      while (i < m && (j >= n || (oldKeys[i] !== newKeys[j] && dp[i + 1][j] > dp[i][j + 1]))) {
        count++; i++;
      }
      // Fallback: if we didn't advance (tie-breaking edge), consume one
      if (count === 0) { count = 1; i++; }
      ops.push({ type: 'remove', count });
    }
  }
  return ops;
}
```

- [ ] **Step 7: Run tests to verify `computeDiff` passes**

Run: `node --test web/changemark.test.js`
Expected: All tests PASS.

- [ ] **Step 8: Write failing tests for `applyMarks`**

Append to `web/changemark.test.js`:

```js
// Lightweight DOM shim for applyMarks testing.
function makeElement(tag, text) {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    textContent: text,
    outerHTML: `<${tag}>${text}</${tag}>`,
    nodeType: 1,
    classList: {
      add(c) { classes.add(c); },
      contains(c) { return classes.has(c); },
    },
    _classes: classes,
  };
  return el;
}

function makeLiveContainer(elements) {
  const kids = [...elements];
  const inserted = []; // track insertBefore calls for assertions
  return {
    children: kids,
    insertBefore(newEl, refEl) {
      const idx = kids.indexOf(refEl);
      if (idx === -1) kids.push(newEl);
      else kids.splice(idx, 0, newEl);
      inserted.push({ el: newEl, beforeIndex: idx });
    },
    appendChild(newEl) { kids.push(newEl); inserted.push({ el: newEl, beforeIndex: -1 }); },
    _inserted: inserted,
  };
}

import { applyMarks } from './changemark.js';

test('applyMarks: modified block gets rf-changed and rf-changed-flash', () => {
  const el0 = makeElement('p', 'Hello');
  const container = makeLiveContainer([el0]);
  const ops = [{ type: 'modify', newIndex: 0 }];
  applyMarks(container, ops);
  assert.ok(el0._classes.has('rf-changed'));
  assert.ok(el0._classes.has('rf-changed-flash'));
});

test('applyMarks: inserted block gets rf-changed and rf-changed-flash', () => {
  const el0 = makeElement('p', 'A');
  const el1 = makeElement('p', 'B');
  const container = makeLiveContainer([el0, el1]);
  const ops = [
    { type: 'keep', newIndex: 0 },
    { type: 'insert', newIndex: 1 },
  ];
  applyMarks(container, ops);
  assert.ok(!el0._classes.has('rf-changed'));
  assert.ok(el1._classes.has('rf-changed'));
  assert.ok(el1._classes.has('rf-changed-flash'));
});

test('applyMarks: remove inserts a gap marker', () => {
  const el0 = makeElement('p', 'A');
  const container = makeLiveContainer([el0]);
  const ops = [
    { type: 'keep', newIndex: 0 },
    { type: 'remove', count: 2 },
  ];
  applyMarks(container, ops, { createElement: (tag) => {
    const m = makeElement(tag, '');
    m.className = '';
    m._attrs = {};
    m.setAttribute = (k, v) => { m._attrs[k] = v; };
    return m;
  }});
  // A gap marker was appended after the last keep
  assert.equal(container._inserted.length, 1);
  const marker = container._inserted[0].el;
  assert.ok(marker.className.includes('rf-removed-marker'));
  assert.equal(marker._attrs['data-label'], '×2');
});

test('applyMarks: keep blocks are untouched', () => {
  const el0 = makeElement('p', 'A');
  const container = makeLiveContainer([el0]);
  applyMarks(container, [{ type: 'keep', newIndex: 0 }]);
  assert.equal(el0._classes.size, 0);
});
```

- [ ] **Step 9: Implement `applyMarks`**

Append to `web/changemark.js`:

```js
export function applyMarks(container, ops, { createElement } = {}) {
  const create = createElement || ((tag) => document.createElement(tag));
  // Map newIndex → the actual DOM child. container.children is a live
  // HTMLCollection in real DOM or a plain array in tests.
  const kids = [...container.children].filter(c => c.nodeType === 1);

  // Walk ops and apply classes / insert markers.  We track a cursor into
  // the live children list; inserts from gap markers shift it.
  let cursor = 0;
  for (const op of ops) {
    if (op.type === 'keep') {
      cursor = op.newIndex + 1;
    } else if (op.type === 'modify' || op.type === 'insert') {
      const el = kids[op.newIndex];
      if (el) {
        el.classList.add('rf-changed');
        el.classList.add('rf-changed-flash');
      }
      cursor = op.newIndex + 1;
    } else if (op.type === 'remove') {
      const marker = create('div');
      marker.className = 'rf-removed-marker';
      if (op.count > 1) marker.setAttribute('data-label', '×' + op.count);
      // Insert after the element at cursor position, or append
      const ref = kids[cursor];
      if (ref) container.insertBefore(marker, ref);
      else container.appendChild(marker);
    }
  }
}
```

- [ ] **Step 10: Run all tests**

Run: `node --test web/changemark.test.js`
Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add web/changemark.js web/changemark.test.js
git commit -m "feat: add changemark module — block-level LCS diff engine for markdown reload highlighting"
```

---

### Task 2: CSS styles for change indicators

**Files:**
- Modify: `web/app.css` (append after the existing `@keyframes reef-flash` block, around line 85)

**Interfaces:**
- Consumes: class names from Task 1 (`rf-changed`, `rf-changed-flash`, `rf-removed-marker`)
- Produces: visual styles (no JS interface)

- [ ] **Step 1: Add CSS custom properties for change highlight colors**

In `web/app.css`, add to the `:root` declaration on line 1:

```css
--rf-flash-light: rgba(255, 242, 127, 0.55);
--rf-flash-dark: rgba(255, 220, 80, 0.18);
```

(These go into the `:root` and `body[data-theme="dark"]` blocks respectively.)

Specifically, update line 1:
```css
:root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --border:#e2e2e2; --accent:#0b69c7; --sidebar:#fafafa; --rf-flash:rgba(255,242,127,0.55); }
```

Update line 2:
```css
body[data-theme="dark"] { --bg:#1e1e1e; --fg:#e6e6e6; --muted:#9aa; --border:#333; --accent:#5aa9ff; --sidebar:#252526; --rf-flash:rgba(255,220,80,0.18); }
```

- [ ] **Step 2: Add change highlight styles**

Append after the existing `.tree-item.flash` rule (line 85) in `web/app.css`:

```css
/* ---- Markdown change highlighting on live reload ---- */
.rf-changed { border-left:3px solid var(--accent); padding-left:4px; }
.rf-changed-flash { animation: rf-block-flash 1.5s ease-out; }
@keyframes rf-block-flash { from { background:var(--rf-flash); } to { background:transparent; } }
.rf-removed-marker { border-top:1px dashed var(--muted); margin:4px 0; height:0; overflow:hidden;
                     text-align:center; font-size:11px; color:var(--muted); line-height:0; position:relative; }
.rf-removed-marker[data-label]::after { content:attr(data-label); position:relative; top:-6px;
                                        background:var(--bg); padding:0 6px; font-size:10px; }
```

- [ ] **Step 3: Verify styles render correctly in both themes**

Manually create a test HTML file is not needed — styles will be tested via the E2E integration in Task 3. For now, visually inspect that the CSS parses without errors:

Run: `node -e "const fs=require('fs'); const css=fs.readFileSync('web/app.css','utf8'); console.log('CSS lines:', css.split('\\n').length, '- OK')"`
Expected: prints line count without error.

- [ ] **Step 4: Commit**

```bash
git add web/app.css
git commit -m "feat: CSS styles for markdown change highlighting (flash, border, gap marker)"
```

---

### Task 3: Wire into `app.js` and embed in `main.go`

**Files:**
- Modify: `web/app.js` (lines 1-9 imports, line 520 show(), lines 714-717 SSE handler)
- Modify: `main.go` (line 16 embed directive)

**Interfaces:**
- Consumes: `snapshotBlocks`, `computeDiff`, `applyMarks` from `web/changemark.js` (Task 1)
- Produces: integrated live-reload highlighting (no new exports)

- [ ] **Step 1: Add import**

In `web/app.js`, add after line 9 (the `binreload` import):

```js
import { snapshotBlocks, computeDiff, applyMarks } from './changemark.js';
```

- [ ] **Step 2: Modify `show()` to accept and apply change marks**

The current `show()` function (line 475) renders markdown at line 520 and runs mermaid at line 523. We need to:
1. Accept an optional `oldSnapshot` parameter
2. After mermaid completes, if `oldSnapshot` exists, diff and mark changes
3. Store the new snapshot on the tab

Replace the `show` function signature and the markdown rendering section. Change lines 475-526 to:

```js
async function show(path, { oldSnapshot } = {}) {
  const tab = getTab(store, path);
  if (!tab) return;
  const seq = ++showSeq;

  let res;
  try {
    res = await fetch('/api/file?path=' + encodeURIComponent(path));
  } catch (err) {
    if (seq !== showSeq) return;
    contentEl.innerHTML = '<p class="empty">Cannot reach the server.</p>';
    tocEl.innerHTML = '';
    return;
  }
  if (seq !== showSeq) return;

  if (res.status === 404) {
    tab.missing = true;
    renderTabs();
    contentEl.innerHTML = '<p class="empty">This file no longer exists.</p>';
    tocEl.innerHTML = '';
    return;
  }
  tab.missing = false;

  const viewer = getViewer(path);
  if (viewer) {
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

  if (oldSnapshot) {
    const newSnapshot = snapshotBlocks(contentEl);
    const ops = computeDiff(oldSnapshot, newSnapshot);
    applyMarks(contentEl, ops);
    tab.blockSnapshot = newSnapshot;
  } else {
    tab.blockSnapshot = snapshotBlocks(contentEl);
  }

  restoreScroll(tab);
}
```

- [ ] **Step 3: Modify SSE handler to pass snapshot**

In the SSE `change` handler (around line 714-717), change the markdown reload path from:

```js
const tab = getTab(store, msg.path);
if (!tab) return;
if (msg.path === store.active) show(msg.path);
else { tab.updated = true; renderTabs(); }
```

to:

```js
const tab = getTab(store, msg.path);
if (!tab) return;
if (msg.path === store.active) {
  const oldSnapshot = tab.blockSnapshot || null;
  show(msg.path, { oldSnapshot });
} else { tab.updated = true; renderTabs(); }
```

- [ ] **Step 4: Strip previous markers on re-render**

Before the `contentEl.innerHTML = ...` line in `show()`, add cleanup of any previous gap markers (they're injected DOM nodes not part of the rendered HTML, so `innerHTML =` already removes them — no action needed). The `rf-changed` and `rf-changed-flash` classes are on elements that get replaced by `innerHTML =`, so they're also automatically cleaned up. No extra cleanup code is needed.

Verify this reasoning: `contentEl.innerHTML = render(text)` replaces all children, so old markers and classes are gone. Confirmed — no cleanup step needed.

- [ ] **Step 5: Add `web/changemark.js` to the Go embed directive**

In `main.go` line 16, add `web/changemark.js` to the embed list. Change:

```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js web/viewers.js web/binreload.js
```

to:

```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js web/viewers.js web/binreload.js web/changemark.js
```

- [ ] **Step 6: Run the full test suite**

Run: `node --test`
Expected: All tests pass (including the new changemark tests).

- [ ] **Step 7: Build the Go binary**

Run: `go build -o /dev/null .`
Expected: Builds without errors (verifies the embed directive is correct).

- [ ] **Step 8: Commit**

```bash
git add web/app.js main.go
git commit -m "feat: wire markdown change highlighting into live reload"
```

---

### Task 4: Manual verification

**Files:** None (testing only)

**Interfaces:**
- Consumes: everything from Tasks 1-3

- [ ] **Step 1: Start the server**

Run: `go run . .` (serve the current directory)

- [ ] **Step 2: Open a markdown file in the browser**

Navigate to a `.md` file in the sidebar and open it.

- [ ] **Step 3: Edit the file and observe the highlight**

In a separate terminal, modify the markdown file (change a paragraph, add a new one, remove one). Observe:
- Modified paragraphs flash yellow and show a left blue border
- New paragraphs flash yellow and show a left blue border
- Removed paragraphs show a thin dashed gap line with "×N" if multiple
- The border persists until the next edit
- On the next edit, old borders disappear and new ones appear
- Dark mode shows the same behavior with adapted colors

- [ ] **Step 4: Verify edge cases**

- Switch to a different tab and back — no highlighting (clean render)
- Edit a `.allium` file — same highlighting behavior
- File with mermaid diagrams — highlighting still works after mermaid renders
