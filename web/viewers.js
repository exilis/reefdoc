// viewers.js — client-side preview of binary document formats.
//
// A registry maps a file extension to an async viewer:
//   viewer(bytes: ArrayBuffer, container: HTMLElement) => Promise<void>
//
// Each viewer lazy-imports its (heavy) CDN library on first use, so the
// markdown-only path pays nothing. Rendering is best-effort: a viewer may throw
// and the caller lets the failure surface (no special error UI).

// Cache of dynamically imported modules, keyed by importmap specifier.
const moduleCache = new Map();

// lazyImport resolves a module from the importmap specifier, caching it so the
// CDN fetch happens at most once per session.
export async function lazyImport(specifier) {
  if (!moduleCache.has(specifier)) {
    moduleCache.set(specifier, import(specifier));
  }
  return moduleCache.get(specifier);
}

function ext(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

// registry is populated in later tasks. Each entry: extension -> async viewer.
const registry = {
  '.pdf': viewPdf,
  '.docx': viewDocx,
  '.xlsx': viewXlsx,
  '.pptx': viewPptx,
};

// getViewer returns the viewer function for a path, or null for text/unknown.
export function getViewer(path) {
  return registry[ext(path)] || null;
}

// isBinaryDoc reports whether a path is one reefdoc previews via a viewer.
export function isBinaryDoc(path) {
  return getViewer(path) !== null;
}

// --- viewers (implemented in later tasks) ---

async function viewPdf(bytes, container) {
  throw new Error('pdf viewer not yet implemented');
}
async function viewDocx(bytes, container) {
  throw new Error('docx viewer not yet implemented');
}
async function viewXlsx(bytes, container) {
  throw new Error('xlsx viewer not yet implemented');
}
async function viewPptx(bytes, container) {
  throw new Error('pptx viewer not yet implemented');
}
