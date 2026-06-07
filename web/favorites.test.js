import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFavorites, isFavorite, toggleFavorite, listFavorites } from './favorites.js';

test('createFavorites seeds from entries and migrates legacy strings', () => {
  const s = createFavorites([{ path: 'a.md', isDir: false }, 'b.md', { path: 'docs', isDir: true }]);
  assert.equal(isFavorite(s, 'a.md'), true);
  assert.equal(isFavorite(s, 'b.md'), true);
  assert.equal(isFavorite(s, 'docs'), true);
  assert.equal(isFavorite(s, 'nope'), false);
});

test('createFavorites with no argument is empty', () => {
  assert.deepEqual(listFavorites(createFavorites()), []);
});

test('toggleFavorite stores isDir and returns the new state', () => {
  const s = createFavorites();
  assert.equal(toggleFavorite(s, 'docs', true), true);
  assert.deepEqual(listFavorites(s), [{ path: 'docs', isDir: true }]);
  assert.equal(toggleFavorite(s, 'docs', true), false);
  assert.deepEqual(listFavorites(s), []);
});

test('toggleFavorite defaults isDir to false (file)', () => {
  const s = createFavorites();
  toggleFavorite(s, 'a.md');
  assert.deepEqual(listFavorites(s), [{ path: 'a.md', isDir: false }]);
});

test('listFavorites returns entries sorted by path', () => {
  const s = createFavorites(['guide/b.md', 'a.md', { path: 'guide', isDir: true }]);
  assert.deepEqual(listFavorites(s).map((e) => e.path), ['a.md', 'guide', 'guide/b.md']);
});

test('legacy string seed defaults to isDir:false', () => {
  const s = createFavorites(['a.md']);
  assert.deepEqual(listFavorites(s), [{ path: 'a.md', isDir: false }]);
});

test('seeding dedupes duplicate paths', () => {
  const s = createFavorites(['a.md', 'a.md']);
  assert.equal(listFavorites(s).length, 1);
});
