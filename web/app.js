import mermaid from 'mermaid';
import { createRenderer } from './render.js';
import { createTabStore, openTab, closeTab, getTab } from './tabs.js';
import { buildToc, slugify } from './toc.js';
import { createFavorites, isFavorite, toggleFavorite, listFavorites } from './favorites.js';
import { isRecent } from './recency.js';
import { renderAllium } from './allium.js';
import { getViewer, isBinaryDoc } from './viewers.js';
import { createBinaryRefresher, routeBinaryChange } from './binreload.js';

const render = createRenderer();
const store = createTabStore();
const expandedDirs = new Set();          // dir paths currently expanded (visible)
const levelContainers = new Map();       // dir path -> its children container element

const el = (id) => document.getElementById(id);

// ---- Directory / file SVG icons ----
const ICON_FOLDER =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25c0-.69.56-1.25 1.25-1.25h2.69c.33 0 .65.13.88.37L7.5 3.5h6.25c.69 0 1.25.56 1.25 1.25v7.5c0 .69-.56 1.25-1.25 1.25H2.75c-.69 0-1.25-.56-1.25-1.25z"/></svg>';
const ICON_FOLDER_OPEN =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25c0-.69.56-1.25 1.25-1.25h2.69c.33 0 .65.13.88.37L7.5 3.5h6.25c.69 0 1.25.56 1.25 1.25v.4H4.6c-.74 0-1.39.5-1.57 1.22L1.5 11.3z"/><path fill="currentColor" d="M3.05 7.16A1.25 1.25 0 0 1 4.26 6.2h10.6c.42 0 .72.4.61.81l-1.25 4.55c-.15.54-.64.92-1.2.92H2.2c-.42 0-.72-.4-.61-.81z"/></svg>';
const ICON_FILE =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M4 1.5h5.19c.2 0 .39.08.53.22l3.06 3.06c.14.14.22.33.22.53v8.44c0 .69-.56 1.25-1.25 1.25H4c-.69 0-1.25-.56-1.25-1.25V2.75C2.75 2.06 3.31 1.5 4 1.5z"/></svg>';

function makeIcon(isDir, open) {
  const span = document.createElement('span');
  span.className = 'icon ' + (isDir ? 'icon-dir' : 'icon-file');
  span.innerHTML = isDir ? (open ? ICON_FOLDER_OPEN : ICON_FOLDER) : ICON_FILE;
  return span;
}

// A small accent dot marking a file modified within the recent window.
function makeRecentDot() {
  const dot = document.createElement('span');
  dot.className = 'recent-dot';
  dot.title = 'Updated in the last 24h';
  return dot;
}

// Ensure the file row for `path` shows a recent dot (used on live `change`
// events). No-op for directories or rows not currently rendered — for a newly
// created file the `change` event arrives before the row exists, so the dot is
// applied later via the `tree` event's reloadLevel -> renderNode path instead.
function markRecentInTree(path) {
  const item = findTreeItem(path);
  if (!item || item.querySelector('.recent-dot')) return;
  // Insert before the star to keep the [icon][label][dot][star] row order.
  // File rows always carry a star, but fall back to append if one is absent.
  const star = item.querySelector('.star');
  if (star) item.insertBefore(makeRecentDot(), star);
  else item.appendChild(makeRecentDot());
}

const FAV_KEY = 'reefdoc-favorites';
const favorites = createFavorites(loadFavorites());

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}
function saveFavorites() {
  localStorage.setItem(FAV_KEY, JSON.stringify(listFavorites(favorites)));
}
function toggleFav(path, isDir) {
  toggleFavorite(favorites, path, isDir);
  saveFavorites();
  renderFavorites();
  refreshStars();
}

// A clickable ☆/★ control bound to a file or directory path. Click toggles
// favorite and does NOT open/expand anything.
function makeStar(path, isDir) {
  const on = isFavorite(favorites, path);
  const star = document.createElement('span');
  star.className = 'star' + (on ? ' on' : '');
  star.textContent = on ? '★' : '☆';
  star.title = 'Toggle favorite';
  star.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(path, isDir); });
  return star;
}

// Sync every rendered file item's star to current favorite state.
function refreshStars() {
  document.querySelectorAll('.tree-item[data-path]').forEach((item) => {
    const star = item.querySelector('.star');
    if (!star) return;
    const on = isFavorite(favorites, item.dataset.path);
    star.classList.toggle('on', on);
    star.textContent = on ? '★' : '☆';
  });
}

// Find the tree item element (within the file tree) for a path.
function findTreeItem(path) {
  for (const elx of document.querySelectorAll('#tree .tree-item[data-path]')) {
    if (elx.dataset.path === path) return elx;
  }
  return null;
}

// Expand one already-rendered directory (no-op if already expanded or absent).
async function expandPath(p) {
  if (expandedDirs.has(p)) return;
  const kids = levelContainers.get(p);
  const item = findTreeItem(p);
  if (kids && item) await expandDir(p, kids, item);
}

// Reveal a directory in the tree: unfold the Files section,
// expand each ancestor down to the target, scroll it into view, and flash it.
async function revealDir(path) {
  const treeSection = el('tree-section');
  if (treeSection.classList.contains('folded')) {
    treeSection.classList.remove('folded');
    localStorage.setItem('reefdoc-fold-tree-section', '0');
  }
  let prefix = '';
  for (const seg of path.split('/')) {
    prefix = prefix ? prefix + '/' + seg : seg;
    await expandPath(prefix);
  }
  const item = findTreeItem(path);
  if (item) {
    item.scrollIntoView({ block: 'center' });
    item.classList.add('flash');
    setTimeout(() => item.classList.remove('flash'), 900);
  }
}

function renderFavorites() {
  const favEl = el('favorites');
  const favs = listFavorites(favorites);
  favEl.innerHTML = '';
  if (favs.length === 0) {
    favEl.innerHTML = '<p class="empty">No favorites yet — click ☆ next to a file or folder.</p>';
    return;
  }
  for (const { path, isDir } of favs) {
    const base = path.slice(path.lastIndexOf('/') + 1) || path;
    const item = document.createElement('div');
    item.className = 'tree-item tree-file';
    item.dataset.path = path;
    item.title = path;
    item.appendChild(makeIcon(isDir, false));
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = base;
    item.appendChild(label);
    item.appendChild(makeStar(path, isDir));
    item.addEventListener('click', () => (isDir ? revealDir(path) : open(path, base)));
    favEl.appendChild(item);
  }
}
const treeEl = el('tree');
const tabbarEl = el('tabbar');
const contentEl = el('content');
const tocEl = el('toc');

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
  item.appendChild(makeIcon(node.isDir, node.isDir && expandedDirs.has(node.path)));
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
    item.dataset.path = node.path;
    item.appendChild(makeStar(node.path, true));
  } else {
    item.dataset.path = node.path;
    if (isRecent(node.modTime)) item.appendChild(makeRecentDot());
    // Binary documents are static previews and cannot be favorited.
    if (!isBinaryDoc(node.path)) item.appendChild(makeStar(node.path, false));
    item.addEventListener('click', () => open(node.path, node.name));
  }
  return wrap;
}

async function expandDir(path, kids, item) {
  expandedDirs.add(path);
  item.classList.add('expanded');
  const ic = item.querySelector('.icon');
  if (ic) ic.innerHTML = ICON_FOLDER_OPEN;
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
  const ic = item.querySelector('.icon');
  if (ic) ic.innerHTML = ICON_FOLDER;
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

// ---- URL <-> active target sync ----
// The active document path lives in the URL hash (#path=<encoded path>) so a
// browser reload reopens the same target instead of resetting to the root.
// Hash (not query string) means no server-side SPA fallback is needed.
let suppressHashSync = false; // guards against reacting to our own hash writes

function pathFromHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  const params = new URLSearchParams(h);
  const p = params.get('path');
  return p || null;
}

function syncUrl(path, { push = false } = {}) {
  if (path && pathFromHash() === path) return;  // already in sync
  if (!path && !pathFromHash()) return;         // already cleared
  // Clearing: keep the path+query, drop only the hash, so the bar reads clean.
  const target = path
    ? '#path=' + encodeURIComponent(path)
    : location.pathname + location.search;
  suppressHashSync = true;
  try {
    if (push) history.pushState(null, '', target);
    else history.replaceState(null, '', target);
  } finally {
    // pushState/replaceState don't emit hashchange, but clear the guard anyway.
    setTimeout(() => { suppressHashSync = false; }, 0);
  }
}

function titleFor(path) {
  const tab = getTab(store, path);
  if (tab) return tab.title;
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

// ---- Session persistence ----
// The full tab session (open tabs, active tab, scroll position) is saved to
// localStorage so a reload restores every open document, not just the active
// one. Only durable fields are stored; transient flags (updated, missing) are
// recomputed at runtime.
const SESSION_KEY = 'reefdoc-session';

function saveSession() {
  try {
    const data = {
      active: store.active,
      tabs: store.tabs.map((t) => ({
        path: t.path,
        title: t.title,
        scrollRatio: t.scrollRatio || 0,
      })),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // storage full / disabled — degrade silently, session just won't persist.
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs)) return null;
    const tabs = data.tabs
      .filter((t) => t && typeof t.path === 'string')
      .map((t) => ({
        path: t.path,
        title: typeof t.title === 'string' ? t.title : titleFor(t.path),
        scrollRatio: typeof t.scrollRatio === 'number' ? t.scrollRatio : 0,
        updated: false,
        missing: false,
      }));
    if (!tabs.length) return null;
    const active = tabs.some((t) => t.path === data.active) ? data.active : tabs[0].path;
    return { tabs, active };
  } catch {
    return null;
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
  syncUrl(path, { push: true });
  renderTabs();
  syncWatches();
  saveSession();
  await show(path);
}

function activate(path) {
  store.active = path;
  const tab = getTab(store, path);
  if (tab) tab.updated = false;
  syncUrl(path, { push: true });
  renderTabs();
  saveSession();
  show(path);
}

function doClose(path) {
  closeTab(store, path);
  renderTabs();
  syncWatches();
  saveSession();
  if (store.active) {
    syncUrl(store.active);
    show(store.active);
  } else {
    syncUrl(null);
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

  const viewer = getViewer(path);
  if (viewer) {
    // Binary document: read raw bytes (no size cap) and render a static
    // preview. No TOC, no scroll-restore. Best-effort — let failures surface.
    const bytes = await res.arrayBuffer();
    if (seq !== showSeq) return;
    tocEl.innerHTML = '';
    contentEl.innerHTML = '';
    await viewer(bytes, contentEl);
    return;
  }

  const text = await res.text();
  if (seq !== showSeq) return;
  if (text.length > MAX_BYTES) {
    contentEl.innerHTML = '<p class="empty">File too large to preview.</p>';
    tocEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = path.endsWith('.allium') ? renderAllium(text) : render(text);
  assignHeadingIds();
  renderToc();
  await runMermaid();
  if (seq !== showSeq) return;
  restoreScroll(tab);
}

// ---- Binary document live-reload (auto-update) ----
// Builds the off-screen container the off-screen viewers render into: attached
// to the DOM (so layout-dependent viewers measure correctly) but visually
// hidden and sized to match contentEl. Removed by swap().
function makeOffscreenContainer() {
  const off = document.createElement('div');
  off.style.position = 'absolute';
  off.style.left = '-99999px';
  off.style.top = '0';
  off.style.width = contentEl.clientWidth + 'px';
  off.style.height = contentEl.clientHeight + 'px';
  off.style.overflow = 'auto';
  document.body.appendChild(off);
  return off;
}

function swapOffscreenIntoContent(off) {
  contentEl.innerHTML = '';
  while (off.firstChild) contentEl.appendChild(off.firstChild);
  off.remove();
}

const binaryRefresher = createBinaryRefresher({
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
  store,
  contentEl,
  getViewer,
  isPptx: (path) => path.toLowerCase().endsWith('.pptx'),
  fetchBytes: async (path) => {
    const res = await fetch('/api/file?path=' + encodeURIComponent(path));
    if (res.status === 404) return { ok: false, missing: true };
    if (!res.ok) return { ok: false };
    return { ok: true, bytes: await res.arrayBuffer() };
  },
  makeOffscreen: makeOffscreenContainer,
  swap: swapOffscreenIntoContent,
  nextSeq: () => ++showSeq,
  currentSeq: () => showSeq,
  setScrollTop: (v) => { contentEl.scrollTop = v; },
  onMissing: (path) => {
    const tab = getTab(store, path);
    if (tab) tab.missing = true;
    renderTabs();
    contentEl.innerHTML = '<p class="empty">This file no longer exists.</p>';
    tocEl.innerHTML = '';
  },
});

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

function resolvePath(base, href) {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return decodeURIComponent(new URL(href, 'file:///' + dir).pathname.slice(1));
}

contentEl.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || /^(https?:|mailto:|file:|#)/.test(href)) return;
  e.preventDefault();
  const resolved = resolvePath(store.active || '', href);
  const title = resolved.slice(resolved.lastIndexOf('/') + 1);
  open(resolved, title);
});

let scrollSaveTimer = null;
contentEl.addEventListener('scroll', () => {
  const tab = getTab(store, store.active);
  if (tab && contentEl.scrollHeight > 0) {
    tab.scrollRatio = contentEl.scrollTop / contentEl.scrollHeight;
    // Debounce: persist the scroll position at most once every 300ms.
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(saveSession, 300);
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
      markRecentInTree(msg.path);
      if (isBinaryDoc(msg.path)) {
        // Binary docs auto-update via the dedicated refresher. Active tab:
        // debounce a re-render. Background tab: mark updated and re-render
        // lazily on activation (same model as markdown).
        switch (routeBinaryChange({ store, getTab, path: msg.path })) {
          case 'schedule':
            binaryRefresher.schedule(msg.path);
            break;
          case 'mark-updated': {
            const btab = getTab(store, msg.path);
            if (btab) { btab.updated = true; renderTabs(); }
            break;
          }
        }
        return;
      }
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
  for (const id of ['fav-section', 'tree-section', 'toc-section']) {
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
renderFavorites();
loadRootTree();
connectSSE();

// Restore the previous session: reopen every tab, restore scroll positions, and
// activate the right document. A URL hash (deep link / shared URL) takes
// precedence over the saved active tab.
const session = loadSession();
const bootPath = pathFromHash();
if (session) {
  store.tabs = session.tabs;
  // If the URL points at a path that wasn't in the saved session, add it.
  if (bootPath && !getTab(store, bootPath)) {
    store.tabs.push({
      path: bootPath, title: titleFor(bootPath),
      scrollRatio: 0, updated: false, missing: false,
    });
  }
  store.active = (bootPath && getTab(store, bootPath)) ? bootPath : session.active;
  syncUrl(store.active);
  renderTabs();
  syncWatches();
  saveSession();
  show(store.active);
} else if (bootPath) {
  open(bootPath, titleFor(bootPath));
}

// Back/forward navigation: open whatever target the URL now points at.
window.addEventListener('hashchange', () => {
  if (suppressHashSync) return; // ignore hash writes we made ourselves
  const path = pathFromHash();
  if (path) {
    if (path !== store.active) open(path, titleFor(path));
  } else if (store.active) {
    // Navigated back to a bare URL: clear the view.
    store.active = null;
    renderTabs();
    saveSession();
    contentEl.innerHTML = '<p class="empty">Select a file from the tree.</p>';
    tocEl.innerHTML = '';
  }
});
