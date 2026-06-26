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
