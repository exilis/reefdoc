import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFavorites, isFavorite, toggleFavorite, listFavorites } from './favorites.js';

test('createFavorites seeds from an initial list', () => {
  const s = createFavorites(['a.md', 'b.md']);
  assert.equal(isFavorite(s, 'a.md'), true);
  assert.equal(isFavorite(s, 'c.md'), false);
});

test('createFavorites with no argument is empty', () => {
  const s = createFavorites();
  assert.deepEqual(listFavorites(s), []);
});

test('toggleFavorite adds then removes, returning the new state', () => {
  const s = createFavorites();
  assert.equal(toggleFavorite(s, 'x.md'), true);
  assert.equal(isFavorite(s, 'x.md'), true);
  assert.equal(toggleFavorite(s, 'x.md'), false);
  assert.equal(isFavorite(s, 'x.md'), false);
});

test('listFavorites returns sorted paths', () => {
  const s = createFavorites(['guide/b.md', 'a.md']);
  toggleFavorite(s, 'guide/a.md');
  assert.deepEqual(listFavorites(s), ['a.md', 'guide/a.md', 'guide/b.md']);
});

test('seeding dedupes duplicate paths', () => {
  const s = createFavorites(['a.md', 'a.md']);
  assert.equal(listFavorites(s).length, 1);
});
