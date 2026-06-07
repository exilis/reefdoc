import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from './render.js';

const render = createRenderer();

test('renders GFM tables', () => {
  const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<td>1<\/td>/);
});

test('renders task lists', () => {
  const html = render('- [x] done\n- [ ] todo');
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked/);
});

test('highlights fenced code', () => {
  const html = render('```js\nconst x = 1;\n```');
  assert.match(html, /class="hljs"/);
});

test('mermaid blocks become <pre class="mermaid">', () => {
  const html = render('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(html, /<pre class="mermaid">/);
  assert.match(html, /A--&gt;B/);
});

test('mermaid content is escaped, not executed as html', () => {
  const html = render('```mermaid\n<script>x</script>\n```');
  assert.match(html, /&lt;script&gt;/);
});
