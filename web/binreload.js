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

// createBinaryRefresher builds the live-refresh controller for binary docs.
// All side-effecting dependencies are injected so the controller is testable
// with fake timers and stubs:
//   deps.setTimeout(cb, ms) / deps.clearTimeout(id)  — timer functions
//   deps.refresh(path)                               — performs the actual
//        re-render (overridden in tests; the real one is defined in Task 4 and
//        bound below when deps.refresh is omitted).
// Returns { schedule(path), refresh(path), _pendingSize() }.
export function createBinaryRefresher(deps) {
  const setTimeoutFn = deps.setTimeout;
  const clearTimeoutFn = deps.clearTimeout;
  const debounceMs =
    deps.debounceMs != null ? deps.debounceMs : BINARY_REFRESH_DEBOUNCE_MS;

  // path -> pending timer id (at most one per path)
  const pending = new Map();

  // refresh: prefer an injected implementation (tests); otherwise use the
  // built-in defined in Task 4.
  const refresh = deps.refresh ? deps.refresh : (path) => defaultRefresh(deps, path);

  function schedule(path) {
    if (pending.has(path)) clearTimeoutFn(pending.get(path));
    const id = setTimeoutFn(() => {
      pending.delete(path);
      refresh(path);
    }, debounceMs);
    pending.set(path, id);
  }

  return {
    schedule,
    refresh,
    _pendingSize: () => pending.size,
  };
}

// defaultRefresh is implemented in Task 4.
async function defaultRefresh(_deps, _path) {
  throw new Error('defaultRefresh not implemented yet');
}
