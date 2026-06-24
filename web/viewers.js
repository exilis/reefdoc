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
  const pdfjs = await lazyImport('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
  // copy bytes — pdf.js may transfer/detach the buffer
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'pdf-doc';
  container.appendChild(wrap);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
}
async function viewDocx(bytes, container) {
  const docx = await lazyImport('docx-preview');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'docx-doc';
  container.appendChild(wrap);
  await docx.renderAsync(bytes, wrap);
}
async function viewXlsx(bytes, container) {
  const XLSX = await lazyImport('xlsx');
  const wb = XLSX.read(bytes, { type: 'array' });
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'xlsx-doc';
  container.appendChild(wrap);
  for (const name of wb.SheetNames) {
    const heading = document.createElement('h2');
    heading.textContent = name;
    wrap.appendChild(heading);
    const table = document.createElement('div');
    table.className = 'xlsx-sheet';
    table.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[name]);
    wrap.appendChild(table);
  }
}
async function viewPptx(bytes, container) {
  throw new Error('pptx viewer not yet implemented');
}
