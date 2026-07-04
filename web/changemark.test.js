import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotBlocks, computeDiff } from './changemark.js';

// Minimal DOM shim for testing — snapshotBlocks just reads .tagName,
// .textContent, and .outerHTML from direct element children.
function makeContainer(blocks) {
  return {
    children: blocks.map(([tag, text, html]) => ({
      nodeType: 1,
      tagName: tag.toUpperCase(),
      textContent: text,
      outerHTML: html || `<${tag}>${text}</${tag}>`,
    })),
  };
}

test('snapshotBlocks: captures tag, trimmed text (max 200 chars), and html', () => {
  const c = makeContainer([
    ['p', '  Hello world  ', '<p>Hello world</p>'],
    ['h1', 'Title', '<h1>Title</h1>'],
  ]);
  const snap = snapshotBlocks(c);
  assert.deepEqual(snap, [
    { tag: 'P', text: 'Hello world', html: '<p>Hello world</p>' },
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
  ]);
});

test('snapshotBlocks: truncates text to 200 chars for key matching', () => {
  const long = 'x'.repeat(300);
  const c = makeContainer([['p', long, `<p>${long}</p>`]]);
  const snap = snapshotBlocks(c);
  assert.equal(snap[0].text.length, 200);
});

test('snapshotBlocks: empty container returns empty array', () => {
  assert.deepEqual(snapshotBlocks({ children: [] }), []);
});

test('computeDiff: identical snapshots → all keep', () => {
  const snap = [
    { tag: 'P', text: 'Hello', html: '<p>Hello</p>' },
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
  ];
  const ops = computeDiff(snap, snap);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'keep', newIndex: 1 },
  ]);
});

test('computeDiff: modified block (same key, different html)', () => {
  const old = [{ tag: 'P', text: 'Hello', html: '<p>Hello</p>' }];
  const now = [{ tag: 'P', text: 'Hello', html: '<p><strong>Hello</strong></p>' }];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [{ type: 'modify', newIndex: 0 }]);
});

test('computeDiff: inserted block', () => {
  const old = [{ tag: 'P', text: 'A', html: '<p>A</p>' }];
  const now = [
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
  ];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'insert', newIndex: 1 },
  ]);
});

test('computeDiff: removed block', () => {
  const old = [
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
  ];
  const now = [{ tag: 'P', text: 'A', html: '<p>A</p>' }];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'remove', count: 1 },
  ]);
});

test('computeDiff: multiple consecutive removals collapse into one op', () => {
  const old = [
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
    { tag: 'P', text: 'C', html: '<p>C</p>' },
  ];
  const now = [{ tag: 'H1', text: 'Title', html: '<h1>Title</h1>' }];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'keep', newIndex: 0 },
    { type: 'remove', count: 3 },
  ]);
});

test('computeDiff: empty old → all inserts', () => {
  const now = [{ tag: 'P', text: 'A', html: '<p>A</p>' }];
  const ops = computeDiff([], now);
  assert.deepEqual(ops, [{ type: 'insert', newIndex: 0 }]);
});

test('computeDiff: empty new → all removes', () => {
  const old = [
    { tag: 'P', text: 'A', html: '<p>A</p>' },
    { tag: 'P', text: 'B', html: '<p>B</p>' },
  ];
  const ops = computeDiff(old, []);
  assert.deepEqual(ops, [{ type: 'remove', count: 2 }]);
});

test('computeDiff: interleaved insert and remove', () => {
  const old = [
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
    { tag: 'P', text: 'Old para', html: '<p>Old para</p>' },
  ];
  const now = [
    { tag: 'P', text: 'New para', html: '<p>New para</p>' },
    { tag: 'H1', text: 'Title', html: '<h1>Title</h1>' },
  ];
  const ops = computeDiff(old, now);
  assert.deepEqual(ops, [
    { type: 'insert', newIndex: 0 },
    { type: 'keep', newIndex: 1 },
    { type: 'remove', count: 1 },
  ]);
});

// Lightweight DOM shim for applyMarks testing.
function makeElement(tag, text) {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    textContent: text,
    outerHTML: `<${tag}>${text}</${tag}>`,
    nodeType: 1,
    classList: {
      add(c) { classes.add(c); },
      contains(c) { return classes.has(c); },
    },
    _classes: classes,
  };
  return el;
}

function makeLiveContainer(elements) {
  const kids = [...elements];
  const inserted = []; // track insertBefore calls for assertions
  return {
    children: kids,
    insertBefore(newEl, refEl) {
      const idx = kids.indexOf(refEl);
      if (idx === -1) kids.push(newEl);
      else kids.splice(idx, 0, newEl);
      inserted.push({ el: newEl, beforeIndex: idx });
    },
    appendChild(newEl) { kids.push(newEl); inserted.push({ el: newEl, beforeIndex: -1 }); },
    _inserted: inserted,
  };
}

import { applyMarks } from './changemark.js';

test('applyMarks: modified block gets rf-changed and rf-changed-flash', () => {
  const el0 = makeElement('p', 'Hello');
  const container = makeLiveContainer([el0]);
  const ops = [{ type: 'modify', newIndex: 0 }];
  applyMarks(container, ops);
  assert.ok(el0._classes.has('rf-changed'));
  assert.ok(el0._classes.has('rf-changed-flash'));
});

test('applyMarks: inserted block gets rf-changed and rf-changed-flash', () => {
  const el0 = makeElement('p', 'A');
  const el1 = makeElement('p', 'B');
  const container = makeLiveContainer([el0, el1]);
  const ops = [
    { type: 'keep', newIndex: 0 },
    { type: 'insert', newIndex: 1 },
  ];
  applyMarks(container, ops);
  assert.ok(!el0._classes.has('rf-changed'));
  assert.ok(el1._classes.has('rf-changed'));
  assert.ok(el1._classes.has('rf-changed-flash'));
});

test('applyMarks: remove inserts a gap marker', () => {
  const el0 = makeElement('p', 'A');
  const container = makeLiveContainer([el0]);
  const ops = [
    { type: 'keep', newIndex: 0 },
    { type: 'remove', count: 2 },
  ];
  applyMarks(container, ops, { createElement: (tag) => {
    const m = makeElement(tag, '');
    m.className = '';
    m._attrs = {};
    m.setAttribute = (k, v) => { m._attrs[k] = v; };
    return m;
  }});
  // A gap marker was appended after the last keep
  assert.equal(container._inserted.length, 1);
  const marker = container._inserted[0].el;
  assert.ok(marker.className.includes('rf-removed-marker'));
  assert.equal(marker._attrs['data-label'], '×2');
});

test('applyMarks: keep blocks are untouched', () => {
  const el0 = makeElement('p', 'A');
  const container = makeLiveContainer([el0]);
  applyMarks(container, [{ type: 'keep', newIndex: 0 }]);
  assert.equal(el0._classes.size, 0);
});
