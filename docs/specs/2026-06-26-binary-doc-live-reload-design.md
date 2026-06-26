# Binary Document Live-Reload (Auto-Update) — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming) — ready for implementation plan

## Summary

Make office and PDF previews **auto-update** when the underlying file changes
on disk, the same way markdown and allium files already do. Today binary
document previews (PDF, DOCX, XLSX, PPTX) are **static** — opening one renders a
snapshot, and editing the file on disk does nothing until you manually reopen
the tab. This was a deliberate non-goal of the original office/PDF viewing work
(see `2026-06-25-office-pdf-viewing-design.md`, "Non-Goals"); this design
reverses that decision for live-reload and scroll-restore.

The change is **mostly frontend**. It removes the client guard and adds a
dedicated, debounced, flicker-free refresh path for binary documents.

> **Correction (post-implementation):** this design originally assumed the Go
> server already emitted a `change` SSE event for every watched file regardless
> of type. That was wrong — the watcher gated change events on `isMarkdown`, so
> binary documents never emitted one. A one-line backend fix was required
> (`internal/server/watcher.go`: gate on `isViewable` instead of `isMarkdown`),
> plus a watcher test. See the "Backend" row in Key Decisions.

## Goals

- When an **open, active** binary document changes on disk, its preview
  re-renders automatically.
- When an **open, background** binary tab changes, mark it updated (the "•"
  dot) and re-render lazily when the user switches to it — identical to the
  markdown model.
- Best-effort **scroll-position restore** across a refresh (proportional, so a
  regenerated PDF with a different page count keeps you roughly in place).
- **No flicker** and **no broken preview** when a file is read mid-write:
  render the new preview off-screen and only swap it in on success; on failure,
  leave the previous good preview untouched.
- Collapse rapid bursts of `change` events (e.g. a build rewriting the file)
  into a single render.
- Zero behavioral change to the markdown / allium live-reload path.

## Non-Goals (YAGNI)

- Server-side rendering, conversion, or diffing of binary documents.
- Pixel-perfect scroll restoration (page-anchored PDF scroll, cell-anchored
  XLSX scroll). A proportional `scrollTop` ratio is sufficient.
- Per-format "update" viewer contract (re-rendering remains a generic
  off-screen swap; viewers are unchanged except as noted for PPTX).
- A special "file may be mid-write" error UI. On a failed parse we silently
  keep the last good preview and let the next change event retry.
- Off-screen-swap polish for PPTX (see Key Decisions — PPTX renders in place).

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Active vs. background tabs | Mirror markdown exactly | One mental model; reuses the existing `tab.updated` lazy-render path. |
| Scroll restore | Best-effort, proportional ratio | Keeps your place in large PDFs; robust to page-count changes across regenerations. |
| Flicker / mid-write safety | Render off-screen, then swap | No blank flash; a half-written file that fails to parse leaves the previous preview intact. |
| Burst handling | Debounce (~250ms) **and** `showSeq` guard | Debounce collapses write bursts and dodges most mid-write reads; the sequence guard supersedes an in-flight render if a newer trigger or tab-switch occurs. |
| PPTX refresh | In-place exception (clear + render into `contentEl`) | PPTX is the lowest-fidelity viewer and least likely to be live-regenerated; its `ResizeObserver` fitting reads the live container. Keeps `app.js` free of viewer internals. PDF/DOCX/XLSX use the off-screen swap. |
| Code structure | Dedicated `refreshBinary(path)` + scheduler, separate from `show()` | Scroll capture, off-screen swap, and debounce are live-refresh concerns that don't apply on first open. Keeps `show()` simple. |
| Backend | One-line fix | The watcher gated `change` events on `isMarkdown`; it now gates on `isViewable` (markdown + the four binary formats) so binary writes emit `change`. (Original design wrongly assumed no backend change was needed.) |

## Architecture

### Control flow

The SSE `change` handler in `connectSSE` (`web/app.js`) currently does:

```
change → markRecentInTree(path)
       → if isBinaryDoc(path) return        // the guard being removed
       → markdown: re-show active, or mark background tab updated
```

New behavior:

```
change → markRecentInTree(path)
       → if isBinaryDoc(path):
             tab = getTab(store, path)
             if !tab: return                          // not open → nothing to do
             if path === store.active:
                 scheduleBinaryRefresh(path)          // debounced
             else:
                 tab.updated = true; renderTabs()     // lazy, same as markdown
             return
       → (markdown / allium path: unchanged)
```

Switching **to** a background binary tab marked `updated` runs the normal
`show(path)` open path (full render from top). No special casing is needed for
the switch itself.

### Scheduler (debounce)

A module-level `Map<path, timerId>` holds at most one pending refresh per path,
so two open binary documents have independent timers.

```
scheduleBinaryRefresh(path):
    clearTimeout(pending.get(path))
    pending.set(path, setTimeout(() => {
        pending.delete(path)
        refreshBinary(path)
    }, BINARY_REFRESH_DEBOUNCE_MS))   // ~250ms
```

### refreshBinary(path)

Only ever invoked for the active binary tab.

```
1. if path !== store.active: return            // tab changed during debounce
2. seq = ++showSeq                             // reuse existing latest-wins guard
3. prevTop    = contentEl.scrollTop
   prevHeight = contentEl.scrollHeight
4. res = fetch raw bytes (same endpoint as show(), no size cap)
   - network error or !res.ok → return (keep current preview)
   - if seq !== showSeq → return (superseded)
   bytes = await res.arrayBuffer()
   - if seq !== showSeq → return
5. viewer = getViewer(path)
   PPTX  → in-place: contentEl.innerHTML = ''; await viewer(bytes, contentEl)
   other → off-screen container (attached, hidden, sized to match contentEl):
             await viewer(bytes, offscreen)
           - on throw → discard offscreen, return (keep current preview)
           - if seq !== showSeq → discard offscreen, return
           - swap: move offscreen child nodes into contentEl; remove offscreen
6. restore scroll (best-effort, proportional):
       ratio = prevHeight > 0 ? prevTop / prevHeight : 0
       contentEl.scrollTop = ratio * contentEl.scrollHeight
   tocEl stays empty (binary docs have no TOC).
```

**Off-screen container caveat.** Some viewers measure layout from the live
container (e.g. canvas sizing, `getComputedStyle`). The off-screen container is
therefore **attached to the DOM but visually hidden** and sized to match
`contentEl` (e.g. absolutely positioned off-screen with the same width/height),
so layout-dependent viewers measure correctly. It is removed after the swap.

**PPTX exception.** The PPTX viewer (`web/viewers.js`) attaches a persistent
`ResizeObserver` to the container it renders into and self-disconnects when its
wrapper leaves the pane. An off-screen-then-swap would leave that observer
watching the discarded off-screen node. To avoid leaking viewer internals into
`app.js`, PPTX re-renders **in place**: clear `contentEl` and render directly
into it. This accepts a brief flicker and loses mid-write safety **for PPTX
only**; PDF/DOCX/XLSX keep the off-screen swap.

**Sequence guard reuse.** `refreshBinary`, `show()`, and tab-switching all
bump/check the same `showSeq`. Whichever started last wins, so a manual tab
switch or a newer debounced refresh correctly cancels a stale in-flight render.

## Components touched

- `web/app.js`
  - Remove the `isBinaryDoc(msg.path)` early-return guard in `connectSSE`.
  - Add the binary branch to the `change` handler (active → schedule, background
    → mark updated).
  - Add `scheduleBinaryRefresh(path)` and the per-path debounce map.
  - Add `refreshBinary(path)` with off-screen swap (PDF/DOCX/XLSX) and in-place
    render (PPTX).
  - Add a small pure scroll-ratio helper (capture → restore) for testability.
- `web/viewers.js` — unchanged (existing viewer signature reused as-is).
- `web/app.test.js` (and/or a focused new test file) — new tests below.
- No Go changes.

## Testing

Existing tests: `web/*.test.js` (node test runner via `npm test`) plus
`go test ./...`. The viewers need CDN libs + canvas/DOM and are not run headless;
`viewers.test.js` only covers the registry. Accordingly we test the **new,
isolatable logic**, not the rendering itself.

Automated (unit):

1. **Debounce/scheduling** — a burst of `scheduleBinaryRefresh(path)` calls
   collapses into a single `refreshBinary` after the quiet period; distinct
   paths get independent timers. Use fake timers.
2. **Change-handler routing** — for a binary `change`: active tab → schedules a
   refresh; open background tab → sets `tab.updated` and re-renders tabs; no
   open tab → no-op. (This is the logic replacing the old `return` guard.)
3. **Scroll-ratio math** — `prevTop/prevHeight` capture and `ratio * newHeight`
   restore, including the `prevHeight === 0` guard, via the extracted pure
   helper.
4. **Sequence-guard aborts** — `refreshBinary` aborts when `path !== store.active`
   and when `showSeq` advances during an await, using stubbed fetch + viewer.

To make 1–4 testable, `refreshBinary` and the scheduler take their
dependencies (fetch, `getViewer`, content element, store) through the same
seam style the existing modules use (exported functions operating on a passed
`store`). The seam is kept minimal.

Manual verification (documented, not automated):

- Off-screen-render-then-swap produces correct pixels for PDF/DOCX/XLSX.
- No visible flicker on PDF/DOCX/XLSX refresh; brief flicker acceptable on PPTX.
- A file read mid-write (failed parse) leaves the previous preview intact.
- PPTX in-place re-render still fits/scales on subsequent window resize.
- Scroll position is roughly preserved across a refresh of a large PDF.

Regression: existing markdown/allium live-reload tests pass unchanged (that
branch of the handler is untouched).

## Risks

- **Off-screen measurement.** If a viewer reads layout before the swap and the
  hidden container is mis-sized, the render could be wrong. Mitigated by sizing
  the off-screen container to match `contentEl`. Manual verification covers it.
- **PPTX polish gap.** PPTX auto-update is flickerier and lacks mid-write
  safety. Accepted for v1; can be upgraded to the off-screen path later by
  re-establishing its observer on `contentEl` after the swap.
- **Debounce window tuning.** 250ms is a starting value; if builds write slower
  the first read may still catch a partial file, but the failed-parse-keeps-last
  -good behavior plus the next change event retrying makes this self-correcting.
