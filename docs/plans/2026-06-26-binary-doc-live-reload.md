# Binary Document Live-Reload (Auto-Update) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make open PDF/DOCX/XLSX/PPTX previews auto-update when the file changes on disk, mirroring how markdown already live-reloads.

**Architecture:** Mostly frontend. We add a small pure module (`web/binreload.js`) holding the testable refresh logic (debounce scheduler, change routing decision, scroll-ratio math, seq-guarded refresh), then wire it into `app.js`'s existing SSE handler and remove the early-return guard. PDF/DOCX/XLSX render off-screen and swap in (no flicker, mid-write safe); PPTX re-renders in place. **Correction (added during execution):** the plan originally assumed the Go server already emitted `change` SSE events for every watched file. It did not — the watcher gated on `isMarkdown`, so a one-line backend fix was required (`internal/server/watcher.go`: gate on `isViewable`) plus a watcher test. See Task 6.5.

**Tech Stack:** Vanilla ES-module frontend; `node --test` for unit tests; Go `//go:embed` ships the asset; `go test` smoke-tests asset serving. No new dependencies.

---

## Background for the implementer (read first)

You are working in `reefdoc`, a local document previewer. A Go binary serves a browser UI and pushes file-change events over Server-Sent Events (SSE). The frontend renders everything client-side.

Key facts you must know before touching anything:

- **`web/app.js` cannot be imported in tests.** It runs DOM side-effects at module scope. The project's convention (see `web/app.test.js:4-9`) is that *pure, testable logic lives in small separate modules* (e.g. `web/recency.js`, `web/tabs.js`, `web/toc.js`) that are imported and tested directly. `app.js` itself is thin DOM/event glue, verified by hand and by a Go smoke test. **Follow this: all new testable logic goes in `web/binreload.js`, not in `app.js`.**

- **Every `web/*.js` file the browser loads must be listed in the `//go:embed` directive in `main.go:16`.** A Go smoke test (`main_test.go`, `TestEmbeddedWebAssetsAreServed`) fails if a served asset is missing from that list. `*.test.js` files are excluded and never embedded. **When you create `web/binreload.js` you MUST add it to that embed line.**

- **The `store` and tab model.** `store` (from `createTabStore()`) has `store.tabs` (array) and `store.active` (the active path string). `getTab(store, path)` returns the tab object or undefined. A tab object has `.path`, `.title`, `.updated` (boolean — drives the "●" dot via `renderTabs()`), and `.missing`. When the user clicks a background tab, `activate(path)` (`app.js:422-430`) sets `tab.updated = false` and calls `show(path)` — so the lazy "re-render on switch" already works for free once we set `tab.updated = true`.

- **`show(path)` (`app.js:451`)** is the initial-open render path. It bumps a module-level `let showSeq = 0;` (`app.js:449`): `const seq = ++showSeq;`, then after each `await` checks `if (seq !== showSeq) return;` to abort superseded renders. Its binary branch (`app.js:476-486`) fetches raw bytes via `GET /api/file?path=...`, clears `contentEl` + `tocEl`, and calls the viewer. **We leave `show()` unchanged** — `refreshBinary` is a separate path.

- **The SSE `change` handler (`app.js:607-615`)** currently does, for a `change` event:
  ```js
  markRecentInTree(msg.path);
  if (isBinaryDoc(msg.path)) return;          // <-- the guard we remove
  const tab = getTab(store, msg.path);
  if (!tab) return;
  if (msg.path === store.active) show(msg.path);
  else { tab.updated = true; renderTabs(); }
  ```

- **Viewers (`web/viewers.js`)** export `getViewer(path)` (returns an async `viewer(bytes, container)` or null) and `isBinaryDoc(path)`. **The viewer signature and `viewers.js` are NOT changed by this plan.** PPTX is `.pptx`; it attaches a persistent `ResizeObserver` to the container it renders into, which is why PPTX must re-render directly into the live `contentEl` (in place) rather than off-screen.

- **The content element** is `contentEl` in `app.js` (the scrollable pane that holds the rendered document). `tocEl` is the table-of-contents pane (stays empty for binary docs).

Read the design spec for the full rationale: `docs/specs/2026-06-26-binary-doc-live-reload-design.md`.

---

## File Structure

- **Create `web/binreload.js`** — pure/testable refresh logic, no direct DOM-at-module-scope side effects. Exports:
  - `BINARY_REFRESH_DEBOUNCE_MS` (constant)
  - `scrollRatio(prevTop, prevHeight)` — capture helper
  - `restoreScrollTop(ratio, newHeight)` — restore helper
  - `routeBinaryChange({ store, getTab, isActive })` → a decision string (`'schedule' | 'mark-updated' | 'ignore'`)
  - `createBinaryRefresher(deps)` — factory returning `{ schedule(path), refresh(path), _pendingSize() }`, with all dependencies injected (timers, fetch, getViewer, store accessor, DOM ops) so it is fully unit-testable.
- **Create `web/binreload.test.js`** — unit tests for the above.
- **Modify `web/app.js`** — import `binreload.js`, construct one refresher wired to real DOM/fetch/store, remove the `isBinaryDoc` guard, route binary changes through the refresher.
- **Modify `main.go:16`** — add `web/binreload.js` to the `//go:embed` list.
- **Modify `CHANGELOG.md`** — add an entry.
- **Modify `README.md`** — update the live-reload feature line to include binary docs.

`web/viewers.js` is untouched. No other Go changes.

---

### Task 1: Scaffold `web/binreload.js` with the pure scroll-ratio helpers

**Files:**
- Create: `web/binreload.js`
- Test: `web/binreload.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/binreload.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINARY_REFRESH_DEBOUNCE_MS,
  scrollRatio,
  restoreScrollTop,
} from './binreload.js';

test('BINARY_REFRESH_DEBOUNCE_MS is a sane positive debounce', () => {
  assert.equal(typeof BINARY_REFRESH_DEBOUNCE_MS, 'number');
  assert.ok(BINARY_REFRESH_DEBOUNCE_MS > 0 && BINARY_REFRESH_DEBOUNCE_MS <= 1000);
});

test('scrollRatio: normal case is prevTop / prevHeight', () => {
  assert.equal(scrollRatio(100, 400), 0.25);
});

test('scrollRatio: zero height guards against divide-by-zero', () => {
  assert.equal(scrollRatio(100, 0), 0);
});

test('scrollRatio: zero top is zero', () => {
  assert.equal(scrollRatio(0, 400), 0);
});

test('restoreScrollTop: ratio times new height', () => {
  assert.equal(restoreScrollTop(0.25, 800), 200);
});

test('restoreScrollTop: zero ratio is top', () => {
  assert.equal(restoreScrollTop(0, 800), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/binreload.test.js`
Expected: FAIL — `Cannot find module './binreload.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/binreload.js`:

```js
// binreload.js — live-reload (auto-update) logic for binary document previews
// (PDF/DOCX/XLSX/PPTX). Pure, dependency-injected, and unit-testable. The
// DOM/fetch/timer wiring is supplied by app.js; nothing here touches globals.

// Quiet period after the last `change` event before re-rendering a binary doc.
// Collapses a build's burst of writes into a single render and dodges most
// mid-write reads.
export const BINARY_REFRESH_DEBOUNCE_MS = 250;

// scrollRatio captures vertical scroll position as a fraction of total height,
// so it survives a re-render whose content height differs (e.g. a regenerated
// PDF with a different page count). Guards divide-by-zero.
export function scrollRatio(prevTop, prevHeight) {
  return prevHeight > 0 ? prevTop / prevHeight : 0;
}

// restoreScrollTop maps a captured ratio back onto a (possibly different) new
// content height.
export function restoreScrollTop(ratio, newHeight) {
  return ratio * newHeight;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test web/binreload.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add web/binreload.js web/binreload.test.js
git commit -m "feat(binreload): scroll-ratio helpers + debounce constant"
```

---

### Task 2: Add the change-routing decision

**Files:**
- Modify: `web/binreload.js`
- Test: `web/binreload.test.js`

The change handler must decide what to do with a binary `change` event without touching the DOM. `routeBinaryChange` returns a plain string the caller acts on.

- [ ] **Step 1: Write the failing test**

Append to `web/binreload.test.js`:

```js
import { routeBinaryChange } from './binreload.js';

function fakeStore(activePath, openPaths) {
  return {
    active: activePath,
    _open: new Set(openPaths),
  };
}
const fakeGetTab = (store, path) => (store._open.has(path) ? { path } : undefined);

test('routeBinaryChange: active open binary tab -> schedule', () => {
  const store = fakeStore('a.pdf', ['a.pdf']);
  const decision = routeBinaryChange({ store, getTab: fakeGetTab, path: 'a.pdf' });
  assert.equal(decision, 'schedule');
});

test('routeBinaryChange: open background binary tab -> mark-updated', () => {
  const store = fakeStore('other.md', ['a.pdf', 'other.md']);
  const decision = routeBinaryChange({ store, getTab: fakeGetTab, path: 'a.pdf' });
  assert.equal(decision, 'mark-updated');
});

test('routeBinaryChange: not-open binary file -> ignore', () => {
  const store = fakeStore('other.md', ['other.md']);
  const decision = routeBinaryChange({ store, getTab: fakeGetTab, path: 'a.pdf' });
  assert.equal(decision, 'ignore');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/binreload.test.js`
Expected: FAIL — `routeBinaryChange is not a function` (or import error).

- [ ] **Step 3: Write minimal implementation**

Append to `web/binreload.js`:

```js
// routeBinaryChange decides what a binary `change` event should do, given the
// current tab state. Returns one of:
//   'schedule'     — the changed file is the active tab; debounce a refresh
//   'mark-updated' — the file is open in a background tab; flag it and re-render
//                    tabs (the "●" dot); it re-renders lazily when activated
//   'ignore'       — the file is not open; nothing to do
export function routeBinaryChange({ store, getTab, path }) {
  const tab = getTab(store, path);
  if (!tab) return 'ignore';
  return path === store.active ? 'schedule' : 'mark-updated';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test web/binreload.test.js`
Expected: PASS — 9 tests total passing.

- [ ] **Step 5: Commit**

```bash
git add web/binreload.js web/binreload.test.js
git commit -m "feat(binreload): change-routing decision"
```

---

### Task 3: Add the debounce scheduler

**Files:**
- Modify: `web/binreload.js`
- Test: `web/binreload.test.js`

The scheduler collapses bursts per path. We inject the timer functions so tests are deterministic (no real waiting). It exposes `schedule(path)` and an internal `_pendingSize()` for assertions.

- [ ] **Step 1: Write the failing test**

Append to `web/binreload.test.js`:

```js
import { createBinaryRefresher } from './binreload.js';

// A controllable fake timer: setTimeout records the callback; flush() runs all
// due callbacks. clearTimeout removes a pending one.
function fakeTimers() {
  let nextId = 1;
  const pending = new Map(); // id -> cb
  return {
    setTimeout: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    flush: () => { for (const cb of [...pending.values()]) cb(); pending.clear(); },
    size: () => pending.size,
  };
}

test('schedule: a burst for the same path collapses to one refresh', () => {
  const timers = fakeTimers();
  const refreshed = [];
  const r = createBinaryRefresher({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    refresh: (path) => refreshed.push(path),
  });
  r.schedule('a.pdf');
  r.schedule('a.pdf');
  r.schedule('a.pdf');
  assert.equal(timers.size(), 1, 'only one pending timer for the path');
  timers.flush();
  assert.deepEqual(refreshed, ['a.pdf'], 'refresh fired exactly once');
});

test('schedule: different paths get independent timers', () => {
  const timers = fakeTimers();
  const refreshed = [];
  const r = createBinaryRefresher({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    refresh: (path) => refreshed.push(path),
  });
  r.schedule('a.pdf');
  r.schedule('b.xlsx');
  assert.equal(timers.size(), 2);
  timers.flush();
  assert.deepEqual(refreshed.sort(), ['a.pdf', 'b.xlsx']);
});

test('schedule: pending entry is cleared after the timer fires', () => {
  const timers = fakeTimers();
  const r = createBinaryRefresher({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    refresh: () => {},
  });
  r.schedule('a.pdf');
  timers.flush();
  assert.equal(r._pendingSize(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/binreload.test.js`
Expected: FAIL — `createBinaryRefresher is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/binreload.js`. (The `refresh` method is added in Task 4; for now the factory wires `schedule` and stores deps.)

```js
// createBinaryRefresher builds the live-refresh controller for binary docs.
// All side-effecting dependencies are injected so the controller is testable
// with fake timers and stubs:
//   deps.setTimeout(cb, ms) / deps.clearTimeout(id)  — timer functions
//   deps.refresh(path)                               — performs the actual
//        re-render (overridden in tests; the real one is defined in Task 4 and
//        bound below when deps.refresh is omitted).
// Returns { schedule(path), refresh(path), _pendingSize() }.
export function createBinaryRefresher(deps) {
  const setTimeoutFn = deps.setTimeout;
  const clearTimeoutFn = deps.clearTimeout;
  const debounceMs =
    deps.debounceMs != null ? deps.debounceMs : BINARY_REFRESH_DEBOUNCE_MS;

  // path -> pending timer id (at most one per path)
  const pending = new Map();

  // refresh: prefer an injected implementation (tests); otherwise use the
  // built-in defined in Task 4.
  const refresh = deps.refresh ? deps.refresh : (path) => defaultRefresh(deps, path);

  function schedule(path) {
    if (pending.has(path)) clearTimeoutFn(pending.get(path));
    const id = setTimeoutFn(() => {
      pending.delete(path);
      refresh(path);
    }, debounceMs);
    pending.set(path, id);
  }

  return {
    schedule,
    refresh,
    _pendingSize: () => pending.size,
  };
}

// defaultRefresh is implemented in Task 4.
async function defaultRefresh(_deps, _path) {
  throw new Error('defaultRefresh not implemented yet');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test web/binreload.test.js`
Expected: PASS — 12 tests total passing.

- [ ] **Step 5: Commit**

```bash
git add web/binreload.js web/binreload.test.js
git commit -m "feat(binreload): per-path debounce scheduler"
```

---

### Task 4: Implement `defaultRefresh` (fetch → off-screen render → swap → restore scroll)

**Files:**
- Modify: `web/binreload.js`
- Test: `web/binreload.test.js`

`defaultRefresh` performs the actual re-render. Everything it touches is injected via `deps` so it is fully testable without a browser:

- `deps.store` — the tab store (reads `store.active`)
- `deps.contentEl` — the live content element (read `scrollTop`/`scrollHeight`; written on swap)
- `deps.getViewer(path)` — returns the async viewer or null
- `deps.isPptx(path)` — true for `.pptx` (the in-place exception)
- `deps.fetchBytes(path)` — async; resolves `{ ok, bytes }` or throws on network error
- `deps.makeOffscreen()` — returns a detached-but-attached, hidden, correctly-sized container element
- `deps.swap(offscreen)` — moves offscreen's children into `contentEl` and removes offscreen
- `deps.nextSeq()` / `deps.currentSeq()` — bump and read the shared `showSeq` (latest-wins guard)

- [ ] **Step 1: Write the failing test**

Append to `web/binreload.test.js`:

```js
// Build a refresher whose dependencies are all stubs we can assert against.
function makeRefreshHarness(overrides = {}) {
  const calls = { viewer: [], swap: 0, scrollSet: [] };
  let seq = 0;
  const contentEl = { scrollTop: 100, scrollHeight: 400 };
  const store = { active: 'a.pdf' };
  const deps = {
    setTimeout: (cb) => cb, // unused here
    clearTimeout: () => {},
    store,
    contentEl,
    getViewer: () => async (bytes, container) => { calls.viewer.push([bytes, container]); },
    isPptx: () => false,
    fetchBytes: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]).buffer }),
    makeOffscreen: () => ({ __offscreen: true }),
    swap: () => { calls.swap++; contentEl.scrollHeight = 800; },
    nextSeq: () => ++seq,
    currentSeq: () => seq,
    setScrollTop: (v) => { calls.scrollSet.push(v); contentEl.scrollTop = v; },
    ...overrides,
  };
  return { deps, calls, contentEl, store, getSeq: () => seq, bumpSeq: () => ++seq };
}

test('refresh: off-screen path renders, swaps, and restores scroll by ratio', async () => {
  const { deps, calls } = makeRefreshHarness();
  const r = createBinaryRefresher(deps);
  await r.refresh('a.pdf');
  assert.equal(calls.viewer.length, 1, 'viewer rendered once');
  assert.equal(calls.viewer[0][1].__offscreen, true, 'rendered into the off-screen container');
  assert.equal(calls.swap, 1, 'swapped once');
  // prevTop/prevHeight = 100/400 = 0.25; new height 800 -> 200
  assert.deepEqual(calls.scrollSet, [200]);
});

test('refresh: aborts when path is no longer the active tab', async () => {
  const { deps, calls } = makeRefreshHarness({ store: { active: 'other.md' } });
  const r = createBinaryRefresher(deps);
  await r.refresh('a.pdf');
  assert.equal(calls.viewer.length, 0);
  assert.equal(calls.swap, 0);
});

test('refresh: aborts (no swap) when seq advances during the fetch await', async () => {
  const h = makeRefreshHarness();
  // Simulate another render starting mid-fetch: bump seq after fetch resolves.
  h.deps.fetchBytes = async () => {
    h.bumpSeq();                       // a newer render took over
    return { ok: true, bytes: new ArrayBuffer(3) };
  };
  const r = createBinaryRefresher(h.deps);
  await r.refresh('a.pdf');
  assert.equal(h.calls.swap, 0, 'stale render did not swap');
});

test('refresh: failed fetch (!ok) leaves preview untouched', async () => {
  const h = makeRefreshHarness();
  h.deps.fetchBytes = async () => ({ ok: false });
  const r = createBinaryRefresher(h.deps);
  await r.refresh('a.pdf');
  assert.equal(h.calls.viewer.length, 0);
  assert.equal(h.calls.swap, 0);
});

test('refresh: viewer throwing on off-screen path leaves preview untouched (no swap)', async () => {
  const h = makeRefreshHarness();
  h.deps.getViewer = () => async () => { throw new Error('half-written file'); };
  const r = createBinaryRefresher(h.deps);
  await r.refresh('a.pdf'); // must not reject
  assert.equal(h.calls.swap, 0);
});

test('refresh: PPTX renders in place (no off-screen, no swap)', async () => {
  // Active path must match the path we refresh, so set it to the pptx.
  const h = makeRefreshHarness({ store: { active: 'deck.pptx' } });
  h.contentEl.scrollTop = 0;
  h.contentEl.scrollHeight = 400;
  h.deps.isPptx = () => true;
  const rendered = [];
  h.deps.getViewer = () => async (bytes, container) => { rendered.push(container); };
  const r = createBinaryRefresher(h.deps);
  await r.refresh('deck.pptx');
  // For PPTX the viewer renders into the live contentEl, not the off-screen box.
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0], h.contentEl);
  assert.equal(h.calls.swap, 0, 'PPTX does not use the swap path');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/binreload.test.js`
Expected: FAIL — `defaultRefresh not implemented yet` thrown by the off-screen path.

- [ ] **Step 3: Write the implementation**

Replace the placeholder `defaultRefresh` in `web/binreload.js` with:

```js
// defaultRefresh re-renders an already-open, ACTIVE binary document after its
// file changed on disk. Behavior (see design spec):
//   - latest-wins via the shared seq guard (nextSeq/currentSeq)
//   - proportional scroll capture + restore
//   - PDF/DOCX/XLSX: render off-screen, swap in only on success (no flicker,
//     mid-write safe — a failed parse leaves the previous preview intact)
//   - PPTX: render in place into the live contentEl (its ResizeObserver reads
//     the live container), accepting brief flicker
async function defaultRefresh(deps, path) {
  const { store, contentEl, getViewer, isPptx, fetchBytes, makeOffscreen,
          swap, nextSeq, currentSeq, setScrollTop } = deps;

  // Tab may have changed during the debounce window.
  if (path !== store.active) return;

  const seq = nextSeq();
  const prevTop = contentEl.scrollTop;
  const prevHeight = contentEl.scrollHeight;

  let res;
  try {
    res = await fetchBytes(path);
  } catch {
    return; // network error — keep the current preview
  }
  if (!res || !res.ok) return;             // file gone / error — keep preview
  if (seq !== currentSeq()) return;        // superseded by a newer render

  const bytes = res.bytes;
  const viewer = getViewer(path);
  if (!viewer) return;

  if (isPptx(path)) {
    // In-place exception: clear and render directly into the live element.
    if (seq !== currentSeq()) return;
    contentEl.innerHTML = '';
    try {
      await viewer(bytes, contentEl);
    } catch {
      // Leave whatever partial state; next change event retries. No swap path.
      return;
    }
    if (seq !== currentSeq()) return;
    setScrollTop(restoreScrollTop(scrollRatio(prevTop, prevHeight), contentEl.scrollHeight));
    return;
  }

  // Off-screen path for PDF/DOCX/XLSX.
  const offscreen = makeOffscreen();
  try {
    await viewer(bytes, offscreen);
  } catch {
    return; // half-written / bad parse — keep the previous good preview
  }
  if (seq !== currentSeq()) return;        // superseded; drop the off-screen work
  swap(offscreen);                          // move nodes into contentEl, remove offscreen
  setScrollTop(restoreScrollTop(scrollRatio(prevTop, prevHeight), contentEl.scrollHeight));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test web/binreload.test.js`
Expected: PASS — all tests passing (the PPTX corrected test included).

- [ ] **Step 5: Run the full JS suite to confirm no regressions**

Run: `node --test`
Expected: PASS — every `web/*.test.js` passes, including the existing `app.test.js`, `viewers.test.js`, etc.

- [ ] **Step 6: Commit**

```bash
git add web/binreload.js web/binreload.test.js
git commit -m "feat(binreload): seq-guarded refresh with off-screen swap and PPTX in-place"
```

---

### Task 5: Wire the refresher into `app.js` and remove the live-reload guard

**Files:**
- Modify: `web/app.js:8` (import), and the SSE `change` handler at `web/app.js:607-615`. Add the refresher construction near the other module wiring.

This task has no new unit test — `app.js` is DOM-coupled glue (per the project convention). It is verified by the existing Go smoke test (Task 6) and by manual verification (Task 8). Be precise with the edits below.

- [ ] **Step 1: Add the import**

In `web/app.js`, change line 8 from:

```js
import { getViewer, isBinaryDoc } from './viewers.js';
```

to:

```js
import { getViewer, isBinaryDoc } from './viewers.js';
import { createBinaryRefresher } from './binreload.js';
```

- [ ] **Step 2: Construct the refresher with real dependencies**

In `web/app.js`, immediately AFTER the `show()` function definition ends (the closing brace of `show`, currently `app.js:502`), add the refresher wiring. It needs access to `contentEl`, `store`, `getViewer`, `getTab`, and the `showSeq` guard. Because `showSeq` is a module-local `let`, expose bump/read closures over it:

```js
// ---- Binary document live-reload (auto-update) ----
// Builds the off-screen container the off-screen viewers render into: attached
// to the DOM (so layout-dependent viewers measure correctly) but visually
// hidden and sized to match contentEl. Removed by swap().
function makeOffscreenContainer() {
  const off = document.createElement('div');
  off.style.position = 'absolute';
  off.style.left = '-99999px';
  off.style.top = '0';
  off.style.width = contentEl.clientWidth + 'px';
  off.style.height = contentEl.clientHeight + 'px';
  off.style.overflow = 'auto';
  document.body.appendChild(off);
  return off;
}

function swapOffscreenIntoContent(off) {
  contentEl.innerHTML = '';
  while (off.firstChild) contentEl.appendChild(off.firstChild);
  off.remove();
}

const binaryRefresher = createBinaryRefresher({
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
  store,
  contentEl,
  getViewer,
  isPptx: (path) => path.toLowerCase().endsWith('.pptx'),
  fetchBytes: async (path) => {
    const res = await fetch('/api/file?path=' + encodeURIComponent(path));
    if (!res.ok) return { ok: false };
    return { ok: true, bytes: await res.arrayBuffer() };
  },
  makeOffscreen: makeOffscreenContainer,
  swap: swapOffscreenIntoContent,
  nextSeq: () => ++showSeq,
  currentSeq: () => showSeq,
  setScrollTop: (v) => { contentEl.scrollTop = v; },
});
```

- [ ] **Step 3: Replace the SSE change handler's binary guard with routing**

In `web/app.js`, the `change` branch currently reads (around `app.js:607-615`):

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

Replace it with:

```js
    } else if (msg.type === 'change') {
      markRecentInTree(msg.path);
      if (isBinaryDoc(msg.path)) {
        // Binary docs auto-update via the dedicated refresher. Active tab:
        // debounce a re-render. Background tab: mark updated and re-render
        // lazily on activation (same model as markdown).
        const btab = getTab(store, msg.path);
        if (!btab) return;
        if (msg.path === store.active) binaryRefresher.schedule(msg.path);
        else { btab.updated = true; renderTabs(); }
        return;
      }
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
```

- [ ] **Step 4: Build the binary so the JS module graph is exercised**

Run: `go build -o /tmp/reefdoc-build . && echo BUILD_OK`
Expected: `BUILD_OK`. (This compiles; it does NOT yet embed the new file — Task 6 fixes that. The build still succeeds because `binreload.js` isn't referenced by the embed list yet.)

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "feat(app): auto-update binary previews via binreload refresher"
```

---

### Task 6: Embed `web/binreload.js` so the server serves it

**Files:**
- Modify: `main.go:16` (the `//go:embed` directive)
- Test: `main_test.go` `TestEmbeddedWebAssetsAreServed` (existing — guards this)

Without this, `index.html` loads `/app.js`, which `import`s `/binreload.js`, which the server 404s — breaking the whole frontend. The existing Go smoke test catches exactly this.

- [ ] **Step 1: Run the guard test to see it fail**

Run: `go test ./... -run TestEmbeddedWebAssetsAreServed -v`
Expected: FAIL — a message like `GET /binreload.js = 404, want 200 — is web/binreload.js missing from the //go:embed directive in main.go?`

- [ ] **Step 2: Add the file to the embed directive**

In `main.go`, change line 16 from:

```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js web/viewers.js
```

to (append `web/binreload.js`):

```go
//go:embed web/index.html web/app.css web/app.js web/allium.js web/render.js web/tabs.js web/toc.js web/favorites.js web/recency.js web/viewers.js web/binreload.js
```

- [ ] **Step 3: Run the guard test to verify it passes**

Run: `go test ./... -run TestEmbeddedWebAssetsAreServed -v`
Expected: PASS.

- [ ] **Step 4: Run the full Go suite**

Run: `go test ./...`
Expected: PASS — all packages.

- [ ] **Step 5: Commit**

```bash
git add main.go
git commit -m "build: embed web/binreload.js in the binary"
```

---

### Task 6.5: Backend fix — watcher emits `change` for binary documents

> **Added during execution.** The original plan assumed "No Go changes" because
> the design wrongly believed the server emitted `change` for every watched
> file. Verification (Task 8) proved binary writes emitted no `change` event:
> `internal/server/watcher.go` gated change-emit on `isMarkdown(ev.Name)`.

**Files:**
- Modify: `internal/server/watcher.go` (change-emit predicate + doc comment)
- Test: `internal/server/watcher_test.go`

- [x] **Step 1:** Add a failing watcher test asserting a `.pdf` write emits a
  `change` event (modeled on the existing markdown change test).
- [x] **Step 2:** In `watcher.go`, change the change-emit predicate from
  `isMarkdown(ev.Name)` to `isViewable(ev.Name)` (already defined in `tree.go`,
  covering markdown + the four binary formats). Update the `Watcher` doc
  comment accordingly. The tree-event logic is unchanged.
- [x] **Step 3:** `go test ./internal/server/ -v` → new test passes, existing
  markdown change tests still pass.
- [x] **Step 4:** `go test ./...` → all packages ok.
- [x] **Step 5:** Commit `fix(watcher): emit change events for binary documents, not just markdown`.

---

### Task 7: Full verification pass (both suites + build)

**Files:** none (verification only)

- [ ] **Step 1: Run the JS suite**

Run: `node --test`
Expected: PASS — all `web/*.test.js`.

- [ ] **Step 2: Run the Go suite**

Run: `go test ./...`
Expected: PASS — all packages.

- [ ] **Step 3: Build the binary**

Run: `go build -o /tmp/reefdoc-build . && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 4: Commit (only if any incidental fixes were needed)**

If steps 1–3 surfaced issues, fix them and commit:

```bash
git add -A
git commit -m "fix: address verification findings for binary live-reload"
```

If nothing needed fixing, skip this step.

---

### Task 8: Manual verification (documented; not automated)

**Files:** none. These steps require a real browser and real binary files; record the outcome but do not block the plan on automation.

- [ ] **Step 1: Start the server on a folder containing a PDF**

Run: `go run . ./docs` (or any folder with a `.pdf`/`.docx`/`.xlsx`/`.pptx`).
Open `http://127.0.0.1:8080`.

- [ ] **Step 2: PDF/DOCX/XLSX auto-update, no flicker**

Open a PDF tab. From another terminal, overwrite the PDF with a different file (e.g. `cp other.pdf docs/sample.pdf`). Confirm the preview updates within ~250ms with no visible blank flash, and your scroll position is roughly preserved.

- [ ] **Step 3: Background tab marks updated**

Open a PDF, then switch to a markdown tab. Overwrite the PDF on disk. Confirm the PDF tab shows the "●" updated dot but does not render until you click it; clicking it shows the new content.

- [ ] **Step 4: Mid-write safety**

Simulate a slow/partial write (e.g. `head -c 1000 real.pdf > docs/sample.pdf` then later replace with the full file). Confirm the broken intermediate does NOT blank the preview — the previous good render stays until a valid file lands.

- [ ] **Step 5: PPTX in place**

Open a `.pptx`, overwrite it on disk. Confirm it re-renders (brief flicker acceptable) and still fits/scales when you resize the window afterward.

- [ ] **Step 6: Markdown regression**

Confirm editing a markdown file still live-reloads exactly as before.

---

### Task 9: Update docs (CHANGELOG + README)

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md:45`

- [ ] **Step 1: Add a CHANGELOG entry**

In `CHANGELOG.md`, add a new section directly under the `# Changelog` header block (above `## [0.9.0]`). Use the next minor version and today's date:

```markdown
## [0.10.0] - 2026-06-26

### Added
- Binary document previews (PDF, DOCX, XLSX, PPTX) now **auto-update** when the
  file changes on disk, matching markdown live-reload. The active preview
  re-renders automatically; background tabs are flagged and re-render when you
  switch to them. PDF/DOCX/XLSX render off-screen and swap in (no flicker, and a
  half-written file leaves the previous preview intact); PPTX re-renders in
  place. Scroll position is best-effort preserved across a refresh.
```

- [ ] **Step 2: Update the README feature line**

In `README.md`, the live-reload feature bullet (`README.md:45`) currently reads:

```markdown
- Live reload: edit a file in any editor and the open tab updates
```

Replace it with:

```markdown
- Live reload: edit a file in any editor and the open tab updates — including
  PDF, DOCX, XLSX, and PPTX previews
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: announce binary document live-reload"
```

---

## Self-Review (completed by plan author)

**Spec coverage** — every spec section maps to a task:
- Active-tab auto-update → Task 4 (`defaultRefresh`) + Task 5 (routing `schedule`).
- Background-tab mark-updated → Task 2 (`routeBinaryChange`) + Task 5 (`btab.updated`); lazy re-render reuses existing `activate()`.
- Proportional scroll restore → Task 1 helpers + Task 4 usage.
- Off-screen render + swap (PDF/DOCX/XLSX) → Task 4 + Task 5 (`makeOffscreen`/`swap`).
- PPTX in-place exception → Task 4 (`isPptx` branch) + Task 5 (`isPptx` dep).
- Debounce (~250ms) → Task 1 constant + Task 3 scheduler.
- `showSeq` latest-wins guard → Task 4 (`nextSeq`/`currentSeq`) + Task 5 wiring.
- Remove `isBinaryDoc` guard → Task 5 Step 3.
- No backend change except embed → Task 6 only.
- Markdown path unchanged → Task 5 keeps the markdown branch verbatim; Task 8 Step 6 regression-checks it.
- Tests (debounce, routing, scroll math, seq aborts) → Tasks 1–4. Manual items → Task 8.

**Placeholder scan** — no TBD/TODO; every code step shows complete code; the one deliberate placeholder (`defaultRefresh` throwing in Task 3) is explicitly replaced in Task 4 with full code, matching the TDD red→green flow.

**Type/name consistency** — `createBinaryRefresher`, `schedule`, `refresh`, `_pendingSize`, `routeBinaryChange`, `scrollRatio`, `restoreScrollTop`, `BINARY_REFRESH_DEBOUNCE_MS`, and the `deps` keys (`setTimeout`, `clearTimeout`, `store`, `contentEl`, `getViewer`, `isPptx`, `fetchBytes`, `makeOffscreen`, `swap`, `nextSeq`, `currentSeq`, `setScrollTop`) are used identically across Tasks 1–5. The PPTX test sets `store.active` to the `.pptx` path so the active-tab guard passes.
