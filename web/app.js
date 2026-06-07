import mermaid from 'mermaid';
import { createRenderer } from './render.js';
import { createTabStore, openTab, closeTab, isOpen, getTab } from './tabs.js';
import { filterTree } from './tree.js';
import { buildToc, slugify } from './toc.js';

const render = createRenderer();
const store = createTabStore();
let fullTree = { name: 'root', path: '', isDir: true, children: [] };

const el = (id) => document.getElementById(id);
const treeEl = el('tree');
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

// ---- Tree rendering ----
async function loadTree() {
  const res = await fetch('/api/tree');
  fullTree = await res.json();
  renderTree();
}

function renderTree() {
  const filtered = filterTree(fullTree, filterEl.value);
  treeEl.innerHTML = '';
  for (const child of filtered.children || []) {
    treeEl.appendChild(renderNode(child));
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
    for (const c of node.children || []) kids.appendChild(renderNode(c));
    wrap.appendChild(kids);
    item.addEventListener('click', () => {
      kids.style.display = kids.style.display === 'none' ? '' : 'none';
    });
  } else {
    item.addEventListener('click', () => open(node.path, node.name));
  }
  return wrap;
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
  if (!isOpen(store, path)) openTab(store, path, title);
  else openTab(store, path, title); // just activates
  renderTabs();
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
  if (store.active) show(store.active);
  else { contentEl.innerHTML = '<p class="empty">Select a file from the tree.</p>'; tocEl.innerHTML = ''; }
}

// ---- Render a document into the content pane ----
const MAX_BYTES = 5 * 1024 * 1024;

async function show(path) {
  const tab = getTab(store, path);
  if (!tab) return;
  const res = await fetch('/api/file?path=' + encodeURIComponent(path));
  if (res.status === 404) {
    tab.missing = true;
    renderTabs();
    contentEl.innerHTML = '<p class="empty">This file no longer exists.</p>';
    tocEl.innerHTML = '';
    return;
  }
  tab.missing = false;
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    contentEl.innerHTML = '<p class="empty">File too large to preview.</p>';
    tocEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = render(text);
  assignHeadingIds();
  renderToc();
  await runMermaid();
  restoreScroll(tab);
}

function assignHeadingIds() {
  contentEl.querySelectorAll('h1,h2,h3').forEach((h) => {
    if (!h.id) h.id = slugify(h.textContent);
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

// ---- Live reload via SSE ----
function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'tree') {
      loadTree();
    } else if (msg.type === 'change') {
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
  };
  // On reconnect, refresh everything once.
  es.onopen = () => { loadTree(); if (store.active) show(store.active); };
}

// ---- Controls ----
filterEl.addEventListener('input', renderTree);
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
loadTree();
connectSSE();
