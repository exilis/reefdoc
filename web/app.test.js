import { test } from 'node:test';
import assert from 'node:assert/strict';

// resolvePath lives in app.js which has DOM side-effects at module scope
// and cannot be imported headlessly. Duplicate the pure function here.
function resolvePath(base, href) {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return new URL(href, 'file:///' + dir).pathname.slice(1);
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
