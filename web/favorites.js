// Pure favorites model: favorited entries keyed by path, each tagged file/dir.
// Persistence (localStorage) and DOM live in app.js; this module is pure.
export function createFavorites(initial = []) {
  const items = new Map();
  for (const entry of initial) {
    if (typeof entry === 'string') {
      items.set(entry, { path: entry, isDir: false }); // migrate legacy string form
    } else if (entry && typeof entry.path === 'string') {
      items.set(entry.path, { path: entry.path, isDir: !!entry.isDir });
    }
  }
  return { items };
}

export function isFavorite(store, path) {
  return store.items.has(path);
}

// Toggles a path and returns its new state (true = now a favorite).
export function toggleFavorite(store, path, isDir = false) {
  if (store.items.has(path)) {
    store.items.delete(path);
    return false;
  }
  store.items.set(path, { path, isDir: !!isDir });
  return true;
}

// Returns favorited entries {path, isDir} sorted by path.
export function listFavorites(store) {
  return [...store.items.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
}
