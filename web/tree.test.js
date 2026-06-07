import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTree } from './tree.js';

const tree = {
  name: 'root', path: '', isDir: true, children: [
    { name: 'guide', path: 'guide', isDir: true, children: [
      { name: 'intro.md', path: 'guide/intro.md', isDir: false },
      { name: 'setup.md', path: 'guide/setup.md', isDir: false },
    ]},
    { name: 'readme.md', path: 'readme.md', isDir: false },
  ],
};

test('empty query returns the tree unchanged', () => {
  assert.equal(filterTree(tree, ''), tree);
});

test('matches files case-insensitively and keeps parent dirs', () => {
  const out = filterTree(tree, 'INTRO');
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].name, 'guide');
  assert.equal(out.children[0].children.length, 1);
  assert.equal(out.children[0].children[0].name, 'intro.md');
});

test('no match yields an empty root', () => {
  const out = filterTree(tree, 'zzz');
  assert.equal(out.children.length, 0);
});
