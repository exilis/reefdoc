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
