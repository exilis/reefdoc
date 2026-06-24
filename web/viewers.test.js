import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getViewer, isBinaryDoc } from './viewers.js';

test('getViewer returns a function for each binary doc type', () => {
  for (const path of ['a.pdf', 'b.docx', 'c.xlsx', 'd.pptx']) {
    assert.equal(typeof getViewer(path), 'function', path);
  }
});

test('getViewer is case-insensitive on the extension', () => {
  assert.equal(typeof getViewer('REPORT.PDF'), 'function');
  assert.equal(typeof getViewer('Sheet.XlsX'), 'function');
});

test('getViewer returns null for text and unknown types', () => {
  for (const path of ['a.md', 'b.markdown', 'c.allium', 'd.txt', 'noext']) {
    assert.equal(getViewer(path), null, path);
  }
});

test('isBinaryDoc mirrors getViewer', () => {
  assert.equal(isBinaryDoc('x.pdf'), true);
  assert.equal(isBinaryDoc('x.md'), false);
});
