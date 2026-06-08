import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, renderAllium } from './allium.js';

test('splitBlocks: single entity block', () => {
  const src = 'entity Foo {\n  name: String\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'entity');
  assert.equal(blocks[0].name, 'Foo');
  assert.equal(blocks[0].body, src);
});

test('splitBlocks: two blocks separated by blank line', () => {
  const src = 'entity Foo {\n  x: Integer\n}\n\nrule Bar {\n  when: Foo.created\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].keyword, 'entity');
  assert.equal(blocks[0].name, 'Foo');
  assert.equal(blocks[1].keyword, 'rule');
  assert.equal(blocks[1].name, 'Bar');
});

test('splitBlocks: single-line use declaration', () => {
  const src = 'use "some/path.allium" as foo';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'use');
  assert.equal(blocks[0].name, '"some/path.allium" as foo');
  assert.equal(blocks[0].body, src);
});

test('splitBlocks: multi-word keyword external entity', () => {
  const src = 'external entity Role { title: String }';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'external entity');
  assert.equal(blocks[0].name, 'Role');
});

test('splitBlocks: braces inside -- comments do not affect depth', () => {
  const src = 'entity Foo {\n  -- comment with { braces }\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'entity');
});

test('splitBlocks: nameless block (config)', () => {
  const src = 'config {\n  timeout: Duration = 30.seconds\n}';
  const blocks = splitBlocks(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].keyword, 'config');
  assert.equal(blocks[0].name, '');
});

test('splitBlocks: blank source returns empty array', () => {
  assert.deepEqual(splitBlocks(''), []);
  assert.deepEqual(splitBlocks('  \n  '), []);
});

test('renderAllium: section has correct class and id', () => {
  const html = renderAllium('entity Foo {\n  x: Integer\n}');
  assert.match(html, /class="allium-block allium-block--entity"/);
  assert.match(html, /id="entity-foo"/);
});

test('renderAllium: h3 contains keyword badge then name', () => {
  const html = renderAllium('entity Foo {\n  x: Integer\n}');
  assert.match(html, /<h3 class="allium-block-header"><span class="allium-kw">entity<\/span> <span class="allium-name">Foo<\/span><\/h3>/);
});

test('renderAllium: multi-word keyword uses hyphen slug in class and id', () => {
  const html = renderAllium('external entity Role { title: String }');
  assert.match(html, /allium-block--external-entity/);
  assert.match(html, /id="external-entity-role"/);
});

test('renderAllium: body is syntax-highlighted', () => {
  const html = renderAllium('entity Foo {\n  x: Integer\n}');
  assert.match(html, /hljs-/);
});

test('renderAllium: empty source returns placeholder', () => {
  assert.match(renderAllium(''), /class="empty"/);
});
