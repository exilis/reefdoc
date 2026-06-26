// Pure tab-state model. A tab: { path, title, scrollRatio, updated, missing }.
export function createTabStore() {
  return { tabs: [], active: null };
}

export function openTab(store, path, title) {
  if (!store.tabs.some((t) => t.path === path)) {
    store.tabs.push({ path, title, scrollRatio: 0, updated: false, missing: false });
  }
  store.active = path;
  return store;
}

export function closeTab(store, path) {
  const i = store.tabs.findIndex((t) => t.path === path);
  if (i === -1) return store;
  store.tabs.splice(i, 1);
  if (store.active === path) {
    store.active = store.tabs.length ? store.tabs[Math.max(0, i - 1)].path : null;
  }
  return store;
}

export function isOpen(store, path) {
  return store.tabs.some((t) => t.path === path);
}

export function getTab(store, path) {
  return store.tabs.find((t) => t.path === path) || null;
}

// dirOf returns the parent directory (slash path, '' for root) of a file path.
export function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// vanishedTabs returns the paths of open tabs whose file lived directly in
// `dir` but is no longer present in `presentPaths` (the freshly-listed children
// of that directory). Used to detect deletions: a `tree` event refreshes a
// directory listing, and any open tab from that directory missing from the new
// listing was deleted.
export function vanishedTabs(store, dir, presentPaths) {
  const present = new Set(presentPaths);
  return store.tabs
    .map((t) => t.path)
    .filter((p) => dirOf(p) === dir && !present.has(p));
}
