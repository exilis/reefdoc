// binreload.js — live-reload (auto-update) logic for binary document previews
// (PDF/DOCX/XLSX/PPTX). Pure, dependency-injected, and unit-testable. The
// DOM/fetch/timer wiring is supplied by app.js; nothing here touches globals.

// Quiet period after the last `change` event before re-rendering a binary doc.
// Collapses a build's burst of writes into a single render and dodges most
// mid-write reads.
export const BINARY_REFRESH_DEBOUNCE_MS = 250;

// scrollRatio captures vertical scroll position as a fraction of total height,
// so it survives a re-render whose content height differs (e.g. a regenerated
// PDF with a different page count). Guards divide-by-zero.
export function scrollRatio(prevTop, prevHeight) {
  return prevHeight > 0 ? prevTop / prevHeight : 0;
}

// restoreScrollTop maps a captured ratio back onto a (possibly different) new
// content height.
export function restoreScrollTop(ratio, newHeight) {
  return ratio * newHeight;
}

// routeBinaryChange decides what a binary `change` event should do, given the
// current tab state. Returns one of:
//   'schedule'     — the changed file is the active tab; debounce a refresh
//   'mark-updated' — the file is open in a background tab; flag it and re-render
//                    tabs (the "●" dot); it re-renders lazily when activated
//   'ignore'       — the file is not open; nothing to do
export function routeBinaryChange({ store, getTab, path }) {
  const tab = getTab(store, path);
  if (!tab) return 'ignore';
  return path === store.active ? 'schedule' : 'mark-updated';
}
