# Markdown Change Highlighting

Visualize which blocks changed when a markdown file auto-reloads, so the user immediately sees what's different without re-reading the entire document.

## Mechanism

DOM-level diff of `#content`'s direct block children before and after re-render. Uses a longest-common-subsequence (LCS) match on a lightweight key (tag name + trimmed textContent) to identify unchanged, modified, inserted, and removed blocks.

## Visual Indicators

| Situation | Indicator | Lifetime |
|-----------|-----------|----------|
| Modified block | Yellow background fade (1.5s) + accent left border | Border stays until next reload |
| Inserted block | Same as modified | Same |
| Removed block(s) | Thin dashed gap line with "×N" count if multiple | Until next reload |

## Files

### New: `web/changemark.js`

Exports:
- `snapshotBlocks(container)` — returns an array of `{tag, text, html}` for each direct block child
- `markChanges(container, oldSnapshot)` — diffs new children against snapshot, applies classes and inserts gap markers

### Modified: `web/app.css`

- `.rf-changed` — 3px left border using `var(--rf-change-border, var(--accent))`
- `.rf-changed-flash` — `@keyframes rf-flash` yellow background that fades to transparent over 1.5s
- `.rf-removed-marker` — thin dashed horizontal line, muted color, optional "×N" label centered

### Modified: `web/app.js`

- Store snapshot on `tab.blockSnapshot` before calling `show()` for the active tab on SSE change event
- After `show()` completes (including `runMermaid()`), call `markChanges(contentEl, tab.blockSnapshot)`
- Then take a fresh snapshot for the next reload: `tab.blockSnapshot = snapshotBlocks(contentEl)`
- Skip highlighting when no prior snapshot exists (first load, tab switch)

### Modified: `main.go`

- Add `web/changemark.js` to the `//go:embed` list

## Dark Mode

The flash animation and border color adapt via CSS custom properties already defined in `:root` / `body[data-theme="dark"]`. The yellow flash uses a semi-transparent warm tone that works in both themes.

## Edge Cases

- **First load / tab switch**: no snapshot → clean render, no highlighting
- **Mermaid diagrams**: `markChanges()` runs after `await runMermaid()` so mermaid-mutated DOM is the final state that gets compared next time
- **Scroll restore**: runs after `markChanges()` — gap markers are very thin (~8px) and don't meaningfully shift scroll
- **Large documents**: LCS operates on block-level children (typically <100), negligible performance cost
- **Allium files**: same treatment — they render to standard block HTML

## LCS Algorithm

Simple O(n*m) dynamic programming on the block key array. For typical markdown documents (10-80 blocks), this completes in <1ms. Blocks match when their key (tag + first 200 chars of textContent) is identical. Matched blocks with different `outerHTML` are marked as "modified".
