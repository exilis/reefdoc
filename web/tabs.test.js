import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStore, openTab, closeTab, isOpen, getTab, dirOf, vanishedTabs } from './tabs.js';

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

test('closing a non-active tab leaves active unchanged', () => {
  const s = createTabStore();
  openTab(s, 'a.md', 'a');
  openTab(s, 'b.md', 'b'); // active = b.md
  closeTab(s, 'a.md');
  assert.equal(s.active, 'b.md');
  assert.equal(s.tabs.length, 1);
});

test('closing a path that is not open is a no-op', () => {
  const s = createTabStore();
  closeTab(s, 'ghost.md');
  assert.equal(s.tabs.length, 0);
  assert.equal(s.active, null);
});

test('dirOf returns parent directory of a file path', () => {
  assert.equal(dirOf('a.pdf'), '');
  assert.equal(dirOf('docs/x.md'), 'docs');
  assert.equal(dirOf('a/b/c.md'), 'a/b');
});

test('vanishedTabs returns open tabs in dir that are absent from the listing', () => {
  const s = createTabStore();
  openTab(s, 'a.pdf', 'a');
  openTab(s, 'b.pdf', 'b');
  // a.pdf is gone, b.pdf still present
  assert.deepEqual(vanishedTabs(s, '', ['b.pdf']), ['a.pdf']);
});

test('vanishedTabs does not return a tab still present in the listing', () => {
  const s = createTabStore();
  openTab(s, 'a.pdf', 'a');
  assert.deepEqual(vanishedTabs(s, '', ['a.pdf']), []);
});

test('vanishedTabs ignores tabs in a different directory', () => {
  const s = createTabStore();
  openTab(s, 'docs/x.md', 'x'); // lives in docs, not root
  // refreshing root listing; docs/x.md is absent here but lives elsewhere
  assert.deepEqual(vanishedTabs(s, '', []), []);
});

test('vanishedTabs on an empty store returns []', () => {
  const s = createTabStore();
  assert.deepEqual(vanishedTabs(s, '', []), []);
});
