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
