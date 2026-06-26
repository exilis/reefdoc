# Allium spec rendering

**Date:** 2026-06-08
**Status:** Approved

## Goal

When a `.allium` file is opened in reefdoc, render it as a structured,
syntax-highlighted document rather than raw text. Top-level declarations appear
as distinct visual cards, and the TOC sidebar lists them as navigable anchors.

## Approach

Option B (chosen): regex-based block splitter + highlight.js syntax highlighting.
Allium's top-level structure is regular enough that brace-counting is reliable.
A full parser would be over-engineered for a display-only feature.

## Module structure

| File | Change | Purpose |
|---|---|---|
| `web/allium.js` | new | Block splitter, renderer, hljs language registration |
| `web/app.js` | one line | Route `.allium` files to `renderAllium` |
| `web/app.css` | additive | Card layout and per-keyword accent colors |
| `main.go` | one line | Add `web/allium.js` to `//go:embed` |
| `render.js`, `toc.js` | none | Untouched |

## Block splitting (`web/allium.js`)

Scan source line by line, producing `{ keyword, name, body }` objects.

**Brace-delimited block keywords** (depth-tracked):
`entity`, `variant`, `rule`, `surface`, `contract`, `invariant`, `value`,
`config`, `given`, `actor`, `external entity`

**Single-line declaration keywords** (emitted immediately):
`use`, `deferred`, `open question`, `default`

Algorithm:
1. For each line at column 0, check whether it starts with a known keyword.
2. If brace-delimited: accumulate lines while tracking `{`/`}` depth. Content
   after `--` on each line is excluded from brace counting (comment stripping).
3. When depth returns to 0, the block is complete.
4. Single-line declarations are captured as a zero-body block.

`body` carries the full raw source of the block (opener line + contents),
passed verbatim to the syntax highlighter.

## Block rendering

Each block renders as:

```html
<section class="allium-block allium-block--{slug-keyword}" id="{slug-keyword}-{slug-name}">
  <h3 class="allium-block-header"><span class="allium-kw">{keyword}</span> <span class="allium-name">{name}</span></h3>
  <pre class="hljs allium-body"><code>...highlighted body...</code></pre>
</section>
```

- `slug-keyword` is the keyword with spaces replaced by `-` (e.g. `external entity` → `external-entity`). Used in both the CSS modifier class and the `id` prefix so neither contains spaces.
- `id` is `{slug-keyword}-{slugified-name}`, matching the markdown anchor convention.
- The `<h3>` spans are emitted on one line with exactly one space between them so that `h3.textContent` (used by the TOC scan in `app.js`) reads as "{keyword} {name}" — e.g. "entity Foo".
- The `<h3>` is what `app.js`'s existing `querySelectorAll('h1,h2,h3')` TOC scan picks up — no changes to `toc.js` or the TOC-building logic needed.
- Single-line declarations (`use`, `deferred`, etc.) use the same `<section>`/`<h3>` structure but with a `<code>` span instead of a `<pre>` block for the body.

## Integration in `app.js`

```js
import { renderAllium } from './allium.js';

// existing render call becomes:
contentEl.innerHTML = tab.path.endsWith('.allium') ? renderAllium(text) : render(text);
```

## highlight.js language definition

Registered once at module load via `hljs.registerLanguage('allium', ...)`.

| Category | Tokens |
|---|---|
| Declaration keywords | `entity variant rule surface contract invariant value config given actor external default deferred use` |
| Rule-body keywords | `when requires ensures let for in where if else` |
| Operator/built-in keywords | `not and or implies transitions becomes created exists facing context exposes provides related contracts demands fulfils timeout within` |
| Built-in types | `String Integer Boolean Timestamp Duration Date Any Set List Money Path` |
| Literals | `now this true false null` |
| Line comments | `--` to end of line |
| Strings | double-quoted |

## Styles (`app.css`)

- `.allium-block` — card with left-border accent, bottom margin, subtle background tint
- `.allium-block-header` — flex row; resets `<h3>` margins/size so it reads as a card header
- `.allium-kw` — small monospace pill badge, muted accent color
- `.allium-name` — declaration name, larger, prominent, monospace
- Per-keyword accent colors via `.allium-block--entity` (blue), `.allium-block--rule` (amber), `.allium-block--surface` (green), etc.
- `.allium-body` — inherits `.hljs` block styling
- Both dark and light theme variants using existing CSS custom properties

## `main.go` embed

`web/allium.js` added to the `//go:embed` directive. Omitting this causes a
silent 404 and module graph failure at runtime (see: recency.js incident).

## Out of scope

- Cross-reference links between declarations (e.g. clicking an entity name in a
  rule navigates to its card) — deferred
- Rendering `.allium` files embedded in markdown fenced blocks — deferred
- Validating or pretty-printing Allium source — handled by the CLI, not reefdoc
