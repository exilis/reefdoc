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
