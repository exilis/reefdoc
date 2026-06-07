import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToc, slugify } from './toc.js';

test('slugify lowercases and dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('slugify preserves non-ascii letters (japanese, accented)', () => {
  assert.equal(slugify('東京 タワー'), '東京-タワー');
  assert.equal(slugify('Café Menu'), 'café-menu');
});

test('slugify collapses internal whitespace runs', () => {
  assert.equal(slugify('a   b'), 'a-b');
});

test('buildToc keeps levels 1-3 only', () => {
  const headings = [
    { level: 1, text: 'Title', id: 'title' },
    { level: 2, text: 'Sub', id: 'sub' },
    { level: 4, text: 'Deep', id: 'deep' },
  ];
  const toc = buildToc(headings);
  assert.equal(toc.length, 2);
  assert.deepEqual(toc.map((h) => h.level), [1, 2]);
});
