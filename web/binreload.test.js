import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINARY_REFRESH_DEBOUNCE_MS,
  scrollRatio,
  restoreScrollTop,
  routeBinaryChange,
} from './binreload.js';
import { createBinaryRefresher } from './binreload.js';

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

test('refresh: network error during fetch never rejects and leaves preview untouched', async () => {
  const h = makeRefreshHarness();
  h.deps.fetchBytes = async () => { throw new Error('network down'); };
  const r = createBinaryRefresher(h.deps);
  await r.refresh('a.pdf'); // must resolve, not reject
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
