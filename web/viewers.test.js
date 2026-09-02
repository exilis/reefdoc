import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getViewer, isBinaryDoc, mediaKind, isMedia, renderMedia, jsonPrimitiveText, jsonNode } from './viewers.js';

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

test('mediaKind maps every media extension to its kind', () => {
  const cases = {
    'a.mp4': 'video', 'b.webm': 'video', 'c.mov': 'video',
    'd.png': 'image', 'e.jpg': 'image', 'f.jpeg': 'image',
    'g.gif': 'image', 'h.webp': 'image', 'i.svg': 'image',
    'j.wav': 'audio', 'k.mp3': 'audio',
  };
  for (const [path, kind] of Object.entries(cases)) {
    assert.equal(mediaKind(path), kind, path);
  }
});

test('mediaKind is case-insensitive and null for non-media', () => {
  assert.equal(mediaKind('CLIP.MP4'), 'video');
  assert.equal(mediaKind('Shot.PnG'), 'image');
  for (const path of ['a.md', 'b.pdf', 'c.txt', 'noext']) {
    assert.equal(mediaKind(path), null, path);
  }
});

test('isMedia mirrors mediaKind', () => {
  assert.equal(isMedia('x.mp4'), true);
  assert.equal(isMedia('x.md'), false);
});

test('media files are NOT binary docs (bytes must never be fetched)', () => {
  for (const path of ['a.mp4', 'b.png', 'c.mp3']) {
    assert.equal(isBinaryDoc(path), false, path);
    assert.equal(getViewer(path), null, path);
  }
});

// Minimal DOM stand-in: enough for renderMedia (createElement/appendChild).
function fakeContainer() {
  const makeEl = (tagName) => ({
    tagName,
    children: [],
    appendChild(c) { this.children.push(c); },
  });
  const doc = { createElement: makeEl };
  const container = makeEl('div');
  container.ownerDocument = doc;
  return container;
}

test('renderMedia builds a <video controls> streaming from src', () => {
  const container = fakeContainer();
  renderMedia('video', '/api/file?path=clip.mp4', 'clip.mp4', container);
  const wrap = container.children[0];
  assert.equal(wrap.className, 'media-doc media-video');
  const el = wrap.children[0];
  assert.equal(el.tagName, 'video');
  assert.equal(el.controls, true);
  assert.equal(el.preload, 'metadata');
  assert.equal(el.src, '/api/file?path=clip.mp4');
});

test('renderMedia builds an <img> with the filename as alt', () => {
  const container = fakeContainer();
  renderMedia('image', '/api/file?path=shot.png', 'shot.png', container);
  const el = container.children[0].children[0];
  assert.equal(el.tagName, 'img');
  assert.equal(el.alt, 'shot.png');
  assert.equal(el.src, '/api/file?path=shot.png');
});

test('renderMedia builds an <audio controls>', () => {
  const container = fakeContainer();
  renderMedia('audio', '/api/file?path=song.mp3', 'song.mp3', container);
  const el = container.children[0].children[0];
  assert.equal(el.tagName, 'audio');
  assert.equal(el.controls, true);
});

// --- JSON viewer ---

test('getViewer returns a function for .json (case-insensitive)', () => {
  assert.equal(typeof getViewer('data.json'), 'function');
  assert.equal(typeof getViewer('DATA.JSON'), 'function');
  assert.equal(isBinaryDoc('x.json'), true);
});

test('jsonPrimitiveText maps each JSON primitive to a type class + text', () => {
  assert.deepEqual(jsonPrimitiveText(null), { cls: 'json-null', text: 'null' });
  assert.deepEqual(jsonPrimitiveText('hi'), { cls: 'json-string', text: '"hi"' });
  assert.deepEqual(jsonPrimitiveText(3.5), { cls: 'json-number', text: '3.5' });
  assert.deepEqual(jsonPrimitiveText(true), { cls: 'json-boolean', text: 'true' });
});

// Minimal DOM stand-in for jsonNode: elements are plain objects; the methods
// jsonNode calls (appendChild/setAttribute/addEventListener) are stubbed.
function fakeDoc() {
  const makeEl = () => ({
    className: '', textContent: '', children: [], attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
  });
  return { createElement: makeEl };
}

test('jsonNode renders a primitive with its type class (no comma when last)', () => {
  const n = jsonNode(fakeDoc(), 42, null, true);
  const head = n.children[0];
  const span = head.children[head.children.length - 1];
  assert.equal(span.className, 'json-number');
  assert.equal(span.textContent, '42');
});

test('jsonNode appends a trailing comma when the item is not the last sibling', () => {
  const n = jsonNode(fakeDoc(), 42, null, false);
  const head = n.children[0];
  const last = head.children[head.children.length - 1];
  assert.equal(last.className, 'json-punct');
  assert.equal(last.textContent, ',');
});

test('jsonNode renders an object with a leading toggle and a quoted key', () => {
  const n = jsonNode(fakeDoc(), { name: 'x' }, null, true);
  const head = n.children[0];
  assert.equal(head.children[0].className, 'json-toggle');
  const kids = n.children.find((c) => c.className === 'json-children');
  assert.ok(kids, 'has a json-children block');
  const childHead = kids.children[0].children[0];
  const keySpan = childHead.children.find((s) => s.className === 'json-key');
  assert.equal(keySpan.textContent, '"name"');
});

test('jsonNode renders array elements with no index prefix, comma-separated', () => {
  const n = jsonNode(fakeDoc(), [true, false], null, true);
  const kids = n.children.find((c) => c.className === 'json-children');
  const firstHead = kids.children[0].children[0];
  // no key/index label on array elements
  assert.equal(firstHead.children.find((s) => s.className === 'json-index'), undefined);
  assert.equal(firstHead.children.find((s) => s.className === 'json-key'), undefined);
  // first element (not last) ends with a comma; last does not
  assert.equal(firstHead.children[firstHead.children.length - 1].textContent, ',');
  const secondHead = kids.children[1].children[0];
  assert.equal(secondHead.children[secondHead.children.length - 1].textContent, 'false');
});

test('jsonNode renders an empty object as bare braces without a toggle', () => {
  const n = jsonNode(fakeDoc(), {}, null, true);
  const head = n.children[0];
  assert.equal(head.children[0].className, 'json-punct');
  assert.equal(head.children[0].textContent, '{}');
});

test('jsonPrimitiveText renders newlines in strings as real line breaks', () => {
  const r = jsonPrimitiveText('line1\nline2');
  assert.equal(r.cls, 'json-string json-multiline');
  assert.equal(r.text, '"line1\nline2"'); // real newline, still quoted
  // quotes/backslashes stay escaped even in multiline
  assert.equal(jsonPrimitiveText('a\n"b"\\c').text, '"a\n\\"b\\"\\\\c"');
});
