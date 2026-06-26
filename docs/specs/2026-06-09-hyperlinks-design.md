# Hyperlinks Between Documents

**Date:** 2026-06-09
**Status:** Approved

## Goal

Enable navigation between files within reefdoc via:
1. Standard Markdown links (`[text](./path/to/file.md)`) that open the target in a new reefdoc tab instead of navigating the browser.
2. Allium `use "path"` declarations rendered as clickable links that open the referenced file in a new reefdoc tab.

External URLs (`http://`, `https://`) continue to open in a normal browser tab.

## Approach

Click delegation on the rendered content container. A single `click` listener attached once in `app.js` intercepts all `<a>` tag clicks within the content area. It decides:

- **External href** (`http://`, `https://`, `mailto:`, `#anchor`): do nothing — browser handles it normally.
- **Local href**: prevent default, resolve the path, call `openTab(resolvedPath)`.

No changes to the markdown-it pipeline. Allium `use` blocks are updated at render time to emit an `<a>` tag for the quoted path; the same delegation listener handles the click.

## Components

### `app.js` — click delegation

Attach one listener to the content container after the DOM is ready:

```js
contentEl.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || /^(https?:|mailto:|#)/.test(href)) return;
  e.preventDefault();
  openTab(resolvePath(currentFilePath(), href));
});
```

`currentFilePath()` returns the path of the currently active tab.

### `app.js` — path resolution

```js
function resolvePath(base, href) {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  const resolved = new URL(href, 'file:///' + dir).pathname.slice(1);
  return resolved;
}
```

Handles `./sibling`, `../parent/file`, and `/root-relative` paths. Leading slash on root-relative hrefs is stripped so the path matches the server's file API format.

### `allium.js` — `use` block rendering

In `renderBlock`, when `keyword === 'use'`, extract the path from `name` (strip surrounding quotes) and render it as an `<a>`:

```js
if (keyword === 'use') {
  const path = name.replace(/^"|"$/g, '');
  // render: use <a href="path">"path"</a>
}
```

Quotes are preserved visually inside the link so the output still reads as valid Allium syntax.

## Path Resolution Examples

| Current file | Link href | Resolved path |
|---|---|---|
| `docs/guide/intro.md` | `./sibling.md` | `docs/guide/sibling.md` |
| `docs/guide/intro.md` | `../specs/core.allium` | `docs/specs/core.allium` |
| `docs/guide/intro.md` | `/entities/user.allium` | `entities/user.allium` |
| `specs/core.allium` | `./base.allium` | `specs/base.allium` |

## Testing

**`allium.test.js`**: Add a test asserting that `renderAllium('use "./entities/user.allium"')` produces HTML containing `<a href="./entities/user.allium">`.

**`app.js` tests** (new or inline): Simulate a `click` event on a mock `<a href="./other.md">` inside the content container and verify:
- `openTab` is called with the correctly resolved path.
- `preventDefault` was called.
- A click on `<a href="https://example.com">` does not call `openTab`.

## Out of Scope

- Anchor links within the same document (`#section-id`).
- Link validation (no warning if the target file doesn't exist).
- History / back-navigation between tabs.
