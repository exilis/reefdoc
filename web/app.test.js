import { test } from 'node:test';
import assert from 'node:assert/strict';

// resolvePath lives in app.js which has DOM side-effects at module scope
// and cannot be imported headlessly. Duplicate the pure function here.
function resolvePath(base, href) {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return decodeURIComponent(new URL(href, 'file:///' + dir).pathname.slice(1));
}

test('resolvePath: sibling file via ./', () => {
  assert.equal(resolvePath('docs/guide/intro.md', './sibling.md'), 'docs/guide/sibling.md');
});

test('resolvePath: parent directory via ../', () => {
  assert.equal(resolvePath('docs/guide/intro.md', '../specs/core.allium'), 'docs/specs/core.allium');
});

test('resolvePath: root-relative path strips leading slash', () => {
  assert.equal(resolvePath('docs/guide/intro.md', '/entities/user.allium'), 'entities/user.allium');
});

test('resolvePath: file at root with relative link', () => {
  assert.equal(resolvePath('intro.md', './other.allium'), 'other.allium');
});

test('resolvePath: no active tab (empty base) with root-relative link', () => {
  assert.equal(resolvePath('', '/specs/core.allium'), 'specs/core.allium');
});

test('resolvePath: decodes percent-encoded characters in path', () => {
  assert.equal(resolvePath('my docs/intro.md', './other.md'), 'my docs/other.md');
});

test('resolvePath: bare relative href without leading ./', () => {
  assert.equal(resolvePath('docs/guide/intro.md', 'sibling.md'), 'docs/guide/sibling.md');
});

// downloadUrl lives in app.js which has DOM side-effects at module scope and
// cannot be imported headlessly. Duplicate the pure function here (matches the
// resolvePath pattern above).
function downloadUrl(path) {
  return '/api/file?path=' + encodeURIComponent(path) + '&download=1';
}

test('downloadUrl: builds the download URL for a simple path', () => {
  assert.equal(downloadUrl('a.md'), '/api/file?path=a.md&download=1');
});

test('downloadUrl: encodes spaces and slashes in nested paths', () => {
  assert.equal(
    downloadUrl('my docs/report.pdf'),
    '/api/file?path=my%20docs%2Freport.pdf&download=1'
  );
});

test('downloadUrl: encodes query-delimiter characters in the path', () => {
  assert.equal(
    downloadUrl('a&b=c.md'),
    '/api/file?path=a%26b%3Dc.md&download=1'
  );
});
