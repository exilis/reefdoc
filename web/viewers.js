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
  '.json': viewJson,
};

// getViewer returns the viewer function for a path, or null for text/unknown.
export function getViewer(path) {
  return registry[ext(path)] || null;
}

// isBinaryDoc reports whether a path is one reefdoc previews via a viewer.
export function isBinaryDoc(path) {
  return getViewer(path) !== null;
}

// --- media (video / image / audio) ---
// Media is NOT a binary-doc viewer: the client never fetches media bytes.
// The native element streams straight from the server URL, which supports
// HTTP Range requests, so multi-hundred-MB videos play and seek fine.
const mediaKinds = {
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.gif': 'image', '.webp': 'image', '.svg': 'image',
  '.wav': 'audio', '.mp3': 'audio',
};

// mediaKind returns 'video' | 'image' | 'audio' for media paths, else null.
export function mediaKind(path) {
  return mediaKinds[ext(path)] || null;
}

// isMedia reports whether a path is a media file reefdoc plays inline.
export function isMedia(path) {
  return mediaKind(path) !== null;
}

// renderMedia mounts the native element for a media file into container:
// <video controls> / <img> / <audio controls>, streaming from src.
export function renderMedia(kind, src, name, container) {
  const doc = container.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.className = 'media-doc media-' + kind;
  let el;
  if (kind === 'video') {
    el = doc.createElement('video');
    el.controls = true;
    el.preload = 'metadata';
  } else if (kind === 'audio') {
    el = doc.createElement('audio');
    el.controls = true;
    el.preload = 'metadata';
  } else {
    el = doc.createElement('img');
    el.alt = name;
  }
  el.src = src;
  wrap.appendChild(el);
  container.appendChild(wrap);
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
  const wb = XLSX.read(bytes, { type: 'buffer' });
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
  const { init } = await lazyImport('pptx-preview');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'pptx-doc';
  container.appendChild(wrap);

  // pptx-preview renders at a fixed pixel size, so render at a crisp base
  // width and then scale the result down with a CSS transform so the whole
  // slide fits inside the content pane (both width and height). `stage` holds
  // the rendered slide at base size; `fit` reserves the scaled box in layout
  // and re-fits on resize (a transform alone does not shrink the layout box).
  const BASE_W = 1280;
  const BASE_H = Math.round(BASE_W * 0.5625); // 16:9
  const fit = document.createElement('div');
  fit.className = 'pptx-fit';
  const stage = document.createElement('div');
  stage.className = 'pptx-stage';
  stage.style.width = BASE_W + 'px';
  stage.style.height = BASE_H + 'px';
  fit.appendChild(stage);
  wrap.appendChild(fit);

  const previewer = init(stage, { width: BASE_W, height: BASE_H });
  await previewer.preview(bytes);

  const refit = () => {
    // Available area: content pane inner box minus its padding.
    const cs = getComputedStyle(container);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(1, container.clientWidth - padX);
    const availH = Math.max(1, container.clientHeight - padY);
    const scale = Math.min(availW / BASE_W, availH / BASE_H, 1);
    stage.style.transform = `scale(${scale})`;
    // Reserve the scaled footprint so the flex column sizes correctly.
    fit.style.width = BASE_W * scale + 'px';
    fit.style.height = BASE_H * scale + 'px';
  };
  refit();
  // Re-fit on any change to the content pane's size (window resize, sidebar
  // drag, etc). The observer disconnects itself once this slide is removed
  // from the pane (e.g. when another document is opened and clears it).
  const ro = new ResizeObserver(() => {
    if (!container.contains(wrap)) {
      ro.disconnect();
      return;
    }
    refit();
  });
  ro.observe(container);
}

// --- JSON (pretty, syntax-highlighted, collapsible) ---
// Not a CDN-backed viewer: JSON needs no library. Decodes the raw bytes,
// parses, and builds a collapsible, syntax-coloured tree. Invalid JSON falls
// back to the raw text (best-effort, per the viewer contract at the top).
async function viewJson(bytes, container) {
  const doc = container.ownerDocument;
  container.innerHTML = '';
  const text = new TextDecoder('utf-8').decode(bytes);
  const wrap = doc.createElement('div');
  wrap.className = 'json-doc';
  container.appendChild(wrap);

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    wrap.className = 'json-doc json-invalid';
    const note = doc.createElement('p');
    note.className = 'json-error';
    note.textContent = 'Invalid JSON (' + err.message + ') — showing raw text.';
    const pre = doc.createElement('pre');
    pre.className = 'json-raw';
    pre.textContent = text;
    wrap.appendChild(note);
    wrap.appendChild(pre);
    return;
  }

  wrap.appendChild(jsonNode(doc, data, null, true));
}

// jsonText makes a <span class=cls> with textContent s.
function jsonText(doc, s, cls) {
  const el = doc.createElement('span');
  el.className = cls;
  el.textContent = s;
  return el;
}

// jsonPrimitiveText maps a JSON primitive to its display class + text. Pure
// (no DOM) so the type/colour mapping is unit-testable on its own.
export function jsonPrimitiveText(value) {
  if (value === null) return { cls: 'json-null', text: 'null' };
  switch (typeof value) {
    case 'string':
      // A string with embedded newlines is shown across real lines (the
      // container is white-space: pre-wrap) so long multi-line values like a
      // message body are readable — quotes/backslashes are still escaped so the
      // string stays unambiguous. Single-line strings use JSON.stringify as-is.
      if (value.includes('\n')) {
        return {
          cls: 'json-string json-multiline',
          text: '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
        };
      }
      return { cls: 'json-string', text: JSON.stringify(value) };
    case 'number': return { cls: 'json-number', text: String(value) };
    case 'boolean': return { cls: 'json-boolean', text: String(value) };
    default: return { cls: 'json-unknown', text: String(value) };
  }
}

// jsonNode builds the DOM for one JSON value, laid out like `JSON.stringify(x,
// null, 2)`: 2-space indentation (via nesting), a "key": prefix for object
// members, no index prefix for array elements, and a trailing comma on every
// item except the last. Objects and arrays are additionally collapsible (a ▾/▸
// toggle folds them to `{…}` / `[…]`); primitives render as a type-coloured
// span. keyLabel is the object key (rendered quoted) or null for array elements
// and the root; isLast omits the trailing comma on the final sibling.
export function jsonNode(doc, value, keyLabel, isLast) {
  const node = doc.createElement('div');
  node.className = 'json-node';
  const head = doc.createElement('div');
  head.className = 'json-line';
  node.appendChild(head);

  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === 'object';
  // Array elements carry no key; object members carry their key string.
  const entries = isObj
    ? (isArr ? value.map((v) => [null, v]) : Object.entries(value))
    : [];

  const comma = (line) => { if (!isLast) line.appendChild(jsonText(doc, ',', 'json-punct')); };

  // Collapse toggle comes first, before the key, for non-empty objects/arrays.
  let toggle = null;
  if (isObj && entries.length > 0) {
    toggle = doc.createElement('span');
    toggle.className = 'json-toggle';
    toggle.setAttribute('role', 'button');
    toggle.tabIndex = 0;
    toggle.textContent = '▾';
    head.appendChild(toggle);
  }

  if (keyLabel !== null) {
    head.appendChild(jsonText(doc, JSON.stringify(keyLabel), 'json-key'));
    head.appendChild(jsonText(doc, ': ', 'json-punct'));
  }

  if (!isObj) {
    const p = jsonPrimitiveText(value);
    head.appendChild(jsonText(doc, p.text, p.cls));
    comma(head);
    return node;
  }

  const open = isArr ? '[' : '{';
  const close = isArr ? ']' : '}';
  if (entries.length === 0) {
    head.appendChild(jsonText(doc, open + close, 'json-punct'));
    comma(head);
    return node;
  }

  head.appendChild(jsonText(doc, open, 'json-punct'));
  const summary = jsonText(doc, ' … ' + close, 'json-summary');
  summary.hidden = true;
  head.appendChild(summary);
  const summaryComma = jsonText(doc, ',', 'json-punct');
  summaryComma.hidden = true;
  if (!isLast) head.appendChild(summaryComma);

  const kids = doc.createElement('div');
  kids.className = 'json-children';
  entries.forEach(([k, v], i) => kids.appendChild(jsonNode(doc, v, k, i === entries.length - 1)));
  node.appendChild(kids);

  const closer = doc.createElement('div');
  closer.className = 'json-line json-closer';
  closer.appendChild(jsonText(doc, close, 'json-punct'));
  comma(closer);
  node.appendChild(closer);

  let collapsed = false;
  const setCollapsed = (c) => {
    collapsed = c;
    toggle.textContent = c ? '▸' : '▾';
    kids.hidden = c;
    closer.hidden = c;
    summary.hidden = !c;
    summaryComma.hidden = !c;
  };
  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); }
  });
  return node;
}
