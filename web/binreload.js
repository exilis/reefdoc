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

// defaultRefresh re-renders an already-open, ACTIVE binary document after its
// file changed on disk. Behavior (see design spec):
//   - latest-wins via the shared seq guard (nextSeq/currentSeq)
//   - proportional scroll capture + restore
//   - PDF/DOCX/XLSX: render off-screen, swap in only on success (no flicker,
//     mid-write safe — a failed parse leaves the previous preview intact)
//   - PPTX: render in place into the live contentEl (its ResizeObserver reads
//     the live container), accepting brief flicker
// Must never reject: the debounce timer calls it without awaiting.
async function defaultRefresh(deps, path) {
  const { store, contentEl, getViewer, isPptx, fetchBytes, makeOffscreen,
          swap, nextSeq, currentSeq, setScrollTop } = deps;

  // Tab may have changed during the debounce window.
  if (path !== store.active) return;

  const seq = nextSeq();
  const prevTop = contentEl.scrollTop;
  const prevHeight = contentEl.scrollHeight;

  let res;
  try {
    res = await fetchBytes(path);
  } catch {
    return; // network error — keep the current preview
  }
  if (!res || !res.ok) return;             // file gone / error — keep preview
  if (seq !== currentSeq()) return;        // superseded by a newer render

  const bytes = res.bytes;
  const viewer = getViewer(path);
  if (!viewer) return;

  if (isPptx(path)) {
    // In-place exception: clear and render directly into the live element.
    if (seq !== currentSeq()) return;
    contentEl.innerHTML = '';
    try {
      await viewer(bytes, contentEl);
    } catch {
      // Leave whatever partial state; next change event retries. No swap path.
      return;
    }
    if (seq !== currentSeq()) return;
    setScrollTop(restoreScrollTop(scrollRatio(prevTop, prevHeight), contentEl.scrollHeight));
    return;
  }

  // Off-screen path for PDF/DOCX/XLSX.
  const offscreen = makeOffscreen();
  try {
    await viewer(bytes, offscreen);
  } catch {
    return; // half-written / bad parse — keep the previous good preview
  }
  if (seq !== currentSeq()) return;        // superseded; drop the off-screen work
  swap(offscreen);                          // move nodes into contentEl, remove offscreen
  setScrollTop(restoreScrollTop(scrollRatio(prevTop, prevHeight), contentEl.scrollHeight));
}
