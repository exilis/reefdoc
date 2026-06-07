import mermaid from 'mermaid';
import { createRenderer } from './render.js';
import { createTabStore, openTab, closeTab, getTab } from './tabs.js';
import { buildToc, slugify } from './toc.js';

const render = createRenderer();
const store = createTabStore();
const expandedDirs = new Set();          // dir paths currently expanded (visible)
const levelContainers = new Map();       // dir path -> its children container element

const el = (id) => document.getElementById(id);
const treeEl = el('tree');
const searchEl = el('search');
const tabbarEl = el('tabbar');
const contentEl = el('content');
const tocEl = el('toc');
const filterEl = el('filter');

function currentTheme() {
  return document.body.getAttribute('data-theme');
}

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme() === 'dark' ? 'dark' : 'default',
  });
}

function parentDir(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// ---- Watch set ----
function desiredWatchDirs() {
  const dirs = new Set(expandedDirs);
  for (const t of store.tabs) dirs.add(parentDir(t.path));
  return [...dirs];
}

function postWatches() {
  fetch('/api/watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirs: desiredWatchDirs() }),
  }).catch(() => {});
}

let watchTimer = null;
function syncWatches() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(postWatches, 200);
}

// ---- Lazy tree ----
async function fetchLevel(path) {
  try {
    const res = await fetch('/api/tree?path=' + encodeURIComponent(path));
    if (!res.ok) return null;
    return await res.json(); // {path, children}
  } catch {
    return null;
  }
}

async function loadRootTree() {
  levelContainers.set('', treeEl);
  const data = await fetchLevel('');
  if (!data) {
    treeEl.innerHTML = '<p class="empty">Cannot reach the server.</p>';
    return;
  }
  await renderChildrenInto(treeEl, data.children);
}

async function renderChildrenInto(container, children) {
  container.innerHTML = '';
  if (!children || children.length === 0) {
    if (container === treeEl) {
      container.innerHTML = '<p class="empty">No markdown files found.</p>';
    }
    return;
  }
  for (const node of children) {
    const wrap = renderNode(node);
    container.appendChild(wrap);
    // re-expand a directory that was previously expanded (e.g. after reload)
    if (node.isDir && expandedDirs.has(node.path)) {
      const kids = wrap.querySelector('.tree-children');
      const item = wrap.querySelector('.tree-item');
      await expandDir(node.path, kids, item);
    }
  }
}

function renderNode(node) {
  const wrap = document.createElement('div');
  const item = document.createElement('div');
  item.className = 'tree-item ' + (node.isDir ? 'tree-dir' : 'tree-file');
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = node.name;
  item.appendChild(label);
  wrap.appendChild(item);

  if (node.isDir) {
    const kids = document.createElement('div');
    kids.className = 'tree-children';
    kids.style.display = 'none';
    wrap.appendChild(kids);
    levelContainers.set(node.path, kids);
    item.addEventListener('click', () => {
      if (expandedDirs.has(node.path)) collapseDir(node.path, kids, item);
      else expandDir(node.path, kids, item);
    });
  } else {
    item.addEventListener('click', () => open(node.path, node.name));
  }
  return wrap;
}

async function expandDir(path, kids, item) {
  expandedDirs.add(path);
  item.classList.add('expanded');
  const data = await fetchLevel(path);
  if (!expandedDirs.has(path)) return; // collapsed while the level was loading
  if (data) await renderChildrenInto(kids, data.children);
  if (!expandedDirs.has(path)) return; // collapsed during child render
  kids.style.display = '';
  syncWatches();
}

function collapseDir(path, kids, item) {
  // collapsing a folder removes it AND any expanded descendants from the set,
  // so the watch set mirrors exactly what is visible/open.
  for (const d of [...expandedDirs]) {
    if (d === path || d.startsWith(path + '/')) expandedDirs.delete(d);
  }
  item.classList.remove('expanded');
  kids.style.display = 'none';
  syncWatches();
}

// Reload just one directory level (on a tree SSE event for that dir).
async function reloadLevel(path) {
  const container = levelContainers.get(path);
  if (!container) return;                       // not currently shown
  if (path !== '' && !expandedDirs.has(path)) return; // collapsed
  const data = await fetchLevel(path);
  if (!data) return;
  await renderChildrenInto(container, data.children);
}

// ---- Search ----
let searchTimer = null;
filterEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = filterEl.value.trim();
  if (!q) { showTreeView(); return; }
  searchTimer = setTimeout(() => runSearch(q), 200);
});

function showTreeView() {
  document.getElementById('tree-section').style.display = '';
  searchEl.style.display = 'none';
  searchEl.innerHTML = '';
}

async function runSearch(q) {
  let data;
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  document.getElementById('tree-section').style.display = 'none';
  searchEl.style.display = '';
  searchEl.innerHTML = '';
  if (!data.results || data.results.length === 0) {
    searchEl.innerHTML = '<p class="empty">No matches.</p>';
    return;
  }
  for (const r of data.results) {
    const item = document.createElement('div');
    item.className = 'tree-item tree-file';
    item.title = r.path;
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = r.path;
    item.appendChild(label);
    item.addEventListener('click', () => open(r.path, r.name));
    searchEl.appendChild(item);
  }
  if (data.truncated) {
    const more = document.createElement('p');
    more.className = 'empty';
    more.textContent = 'Showing first ' + data.results.length + ' — refine your search.';
    searchEl.appendChild(more);
  }
}

// ---- Tabs ----
function renderTabs() {
  tabbarEl.innerHTML = '';
  for (const tab of store.tabs) {
    const t = document.createElement('div');
    t.className = 'tab' +
      (tab.path === store.active ? ' active' : '') +
      (tab.updated ? ' updated' : '') +
      (tab.missing ? ' missing' : '');
    const title = document.createElement('span');
    title.textContent = tab.title;
    title.addEventListener('click', () => activate(tab.path));
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); doClose(tab.path); });
    t.appendChild(title);
    t.appendChild(close);
    t.addEventListener('mousedown', (e) => { if (e.button === 1) doClose(tab.path); });
    tabbarEl.appendChild(t);
  }
}

async function open(path, title) {
  openTab(store, path, title); // idempotent: adds if new, always activates
  renderTabs();
  syncWatches();
  await show(path);
}

function activate(path) {
  store.active = path;
  const tab = getTab(store, path);
  if (tab) tab.updated = false;
  renderTabs();
  show(path);
}

function doClose(path) {
  closeTab(store, path);
  renderTabs();
  syncWatches();
  if (store.active) show(store.active);
  else {
    contentEl.innerHTML = '<p class="empty">Select a file from the tree.</p>';
    tocEl.innerHTML = '';
  }
}

// ---- Render a document ----
const MAX_BYTES = 5 * 1024 * 1024;
let showSeq = 0;

async function show(path) {
  const tab = getTab(store, path);
  if (!tab) return;
  const seq = ++showSeq;

  let res;
  try {
    res = await fetch('/api/file?path=' + encodeURIComponent(path));
  } catch (err) {
    if (seq !== showSeq) return;
    contentEl.innerHTML = '<p class="empty">Cannot reach the server.</p>';
    tocEl.innerHTML = '';
    return;
  }
  if (seq !== showSeq) return;

  if (res.status === 404) {
    tab.missing = true;
    renderTabs();
    contentEl.innerHTML = '<p class="empty">This file no longer exists.</p>';
    tocEl.innerHTML = '';
    return;
  }
  tab.missing = false;
  const text = await res.text();
  if (seq !== showSeq) return;
  if (text.length > MAX_BYTES) {
    contentEl.innerHTML = '<p class="empty">File too large to preview.</p>';
    tocEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = render(text);
  assignHeadingIds();
  renderToc();
  await runMermaid();
  if (seq !== showSeq) return;
  restoreScroll(tab);
}

function assignHeadingIds() {
  const seen = new Set();
  contentEl.querySelectorAll('h1,h2,h3').forEach((h) => {
    const base = h.id || slugify(h.textContent);
    let id = base, n = 2;
    while (seen.has(id)) id = base + '-' + n++;
    seen.add(id);
    h.id = id;
  });
}

function renderToc() {
  const headings = [...contentEl.querySelectorAll('h1,h2,h3')].map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent,
    id: h.id,
  }));
  const entries = buildToc(headings);
  tocEl.innerHTML = '';
  if (entries.length < 2) return;
  for (const e of entries) {
    const a = document.createElement('a');
    a.href = '#' + e.id;
    a.className = 'lvl-' + e.level;
    a.textContent = e.text;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById(e.id)?.scrollIntoView({ behavior: 'smooth' });
    });
    tocEl.appendChild(a);
  }
}

async function runMermaid() {
  const blocks = [...contentEl.querySelectorAll('pre.mermaid')];
  for (const block of blocks) {
    try {
      const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), block.textContent);
      block.outerHTML = svg;
    } catch (err) {
      const box = document.createElement('div');
      box.className = 'mermaid-error';
      box.textContent = 'Mermaid error: ' + (err?.message || err);
      block.replaceWith(box);
    }
  }
}

function restoreScroll(tab) {
  contentEl.scrollTop = (tab.scrollRatio || 0) * contentEl.scrollHeight;
}

contentEl.addEventListener('scroll', () => {
  const tab = getTab(store, store.active);
  if (tab && contentEl.scrollHeight > 0) {
    tab.scrollRatio = contentEl.scrollTop / contentEl.scrollHeight;
  }
});

// ---- Live reload ----
function setLiveReloadOffline(offline) {
  let elx = document.getElementById('lr-status');
  if (offline) {
    if (!elx) {
      elx = document.createElement('button');
      elx.id = 'lr-status';
      elx.textContent = '⟲ Live reload offline — refresh';
      elx.title = 'Live updates are unavailable. Click to reload the current view.';
      elx.addEventListener('click', () => { loadRootTree(); if (store.active) show(store.active); });
      document.body.appendChild(elx);
    }
  } else if (elx) {
    elx.remove();
  }
}

function connectSSE() {
  let firstOpen = true;
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'tree') {
      reloadLevel(msg.path);
    } else if (msg.type === 'change') {
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
  };
  es.onopen = () => {
    setLiveReloadOffline(false);
    if (firstOpen) { firstOpen = false; return; }
    // reconnect: rebuild the tree (re-expanding open levels), re-post watches,
    // and refresh the active document.
    loadRootTree();
    postWatches();
    if (store.active) show(store.active);
  };
  es.onerror = () => setLiveReloadOffline(true);
}

// ---- Sidebar: foldable sections + drag-resize (persisted) ----
function makeDrag(handle, getBase, apply) {
  if (!handle) return;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, base = getBase();
    const move = (ev) => apply(base, ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function initSidebarLayout() {
  const sidebar = el('sidebar');
  const tocSection = el('toc-section');

  // restore persisted sizes + fold state
  const w = localStorage.getItem('reefdoc-sidebar-w');
  if (w) sidebar.style.width = w + 'px';
  const h = localStorage.getItem('reefdoc-toc-h');
  if (h) tocSection.style.flex = '0 0 ' + h + 'px';
  for (const id of ['tree-section', 'toc-section']) {
    if (localStorage.getItem('reefdoc-fold-' + id) === '1') el(id).classList.add('folded');
  }

  // fold toggles
  document.querySelectorAll('.section-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = el(header.dataset.target);
      section.classList.toggle('folded');
      localStorage.setItem('reefdoc-fold-' + header.dataset.target,
        section.classList.contains('folded') ? '1' : '0');
    });
  });

  // resize the tree/TOC split (drag #vsplit; dragging up grows the TOC)
  makeDrag(el('vsplit'), () => tocSection.offsetHeight, (base, dx, dy) => {
    const nh = Math.max(24, Math.min(sidebar.clientHeight - 120, base - dy));
    tocSection.style.flex = '0 0 ' + nh + 'px';
    localStorage.setItem('reefdoc-toc-h', Math.round(nh));
  });

  // resize the sidebar width (drag #sidebar-resize)
  makeDrag(el('sidebar-resize'), () => sidebar.offsetWidth, (base, dx) => {
    const nw = Math.max(150, Math.min(600, base + dx));
    sidebar.style.width = nw + 'px';
    localStorage.setItem('reefdoc-sidebar-w', Math.round(nw));
  });
}

// ---- Controls ----
el('theme-toggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('reefdoc-theme', next);
  el('hljs-theme').href =
    'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github' +
    (next === 'dark' ? '-dark' : '') + '.min.css';
  initMermaid();
  if (store.active) show(store.active);
});
el('sidebar-toggle').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
});

// ---- Boot ----
const savedTheme = localStorage.getItem('reefdoc-theme');
if (savedTheme) {
  document.body.setAttribute('data-theme', savedTheme);
  if (savedTheme === 'dark') {
    el('hljs-theme').href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
  }
}
initMermaid();
initSidebarLayout();
loadRootTree();
connectSSE();
