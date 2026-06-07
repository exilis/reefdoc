// Pure favorites model: a set of favorited file paths. Persistence (localStorage)
// and DOM rendering live in app.js; this module is pure and unit-testable.
export function createFavorites(initial = []) {
  return { paths: new Set(initial) };
}

export function isFavorite(store, path) {
  return store.paths.has(path);
}

// Toggles a path and returns its new state (true = now a favorite).
export function toggleFavorite(store, path) {
  if (store.paths.has(path)) {
    store.paths.delete(path);
    return false;
  }
  store.paths.add(path);
  return true;
}

// Returns the favorited paths sorted alphabetically.
export function listFavorites(store) {
  return [...store.paths].sort();
}
