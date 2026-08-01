import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getViewer, isBinaryDoc, mediaKind, isMedia, renderMedia } from './viewers.js';

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
