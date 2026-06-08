import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecent, RECENT_MS } from './recency.js';

test('isRecent is true within the window', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(now - 1000, now), true);
});

test('isRecent is false at or past the window edge', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(now - RECENT_MS, now), false);
  assert.equal(isRecent(now - RECENT_MS - 1, now), false);
});

test('isRecent is false for missing or zero mtime', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(0, now), false);
  assert.equal(isRecent(undefined, now), false);
});

test('isRecent treats a future mtime as recent', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(now + 5000, now), true);
});
