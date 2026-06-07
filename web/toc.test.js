import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToc, slugify } from './toc.js';

test('slugify lowercases and dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
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
