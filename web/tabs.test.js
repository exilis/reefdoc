import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStore, openTab, closeTab, isOpen, getTab } from './tabs.js';

test('openTab adds and activates', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  assert.equal(s.active, 'a.md');
  assert.equal(s.tabs.length, 1);
});

test('opening an already-open path just activates it', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  openTab(s, 'b.md', 'b');
  openTab(s, 'a.md', 'a');
  assert.equal(s.active, 'a.md');
  assert.equal(s.tabs.length, 2);
});

test('isOpen reflects state', () => {
  const s = createTabStore();
  assert.equal(isOpen(s, 'a.md'), false);
  openTab(s, 'a.md', 'a');
  assert.equal(isOpen(s, 'a.md'), true);
});

test('closeTab activates a neighbor', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  openTab(s, 'b.md', 'b');
  closeTab(s, 'b.md');
  assert.equal(s.active, 'a.md');
  assert.equal(s.tabs.length, 1);
});

test('closing the last tab clears active', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  closeTab(s, 'a.md');
  assert.equal(s.active, null);
  assert.equal(getTab(s, 'a.md'), null);
});
