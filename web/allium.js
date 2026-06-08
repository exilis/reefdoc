import hljs from 'highlight.js';

hljs.registerLanguage('allium', () => ({
  name: 'Allium',
  contains: [
    { className: 'comment', begin: '--', end: '$' },
    { className: 'string', begin: '"', end: '"' },
    {
      className: 'type',
      match: /\b(String|Integer|Boolean|Timestamp|Duration|Date|Any|Set|List|Money|Path)\b/,
    },
    {
      className: 'literal',
      match: /\b(now|this|true|false|null)\b/,
    },
    {
      className: 'keyword',
      match: /\b(entity|variant|rule|surface|contract|invariant|value|config|given|actor|external|default|deferred|use|when|requires|ensures|let|for|in|where|if|else|not|and|or|implies|transitions|becomes|created|exists|facing|context|exposes|provides|related|contracts|demands|fulfils|timeout|within)\b/,
    },
    { className: 'number', match: /\b\d+(\.\d+)?\b/ },
  ],
}));

const BLOCK_KEYWORDS = [
  'external entity', 'entity', 'variant', 'rule', 'surface',
  'contract', 'invariant', 'value', 'config', 'given', 'actor',
];
const LINE_KEYWORDS = ['open question', 'deferred', 'default', 'use'];

export function splitBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const bkw = BLOCK_KEYWORDS.find(kw =>
      line.startsWith(kw) && (line.length === kw.length || line[kw.length] === ' '));
    if (bkw) {
      const afterKw = line.slice(bkw.length).trim();
      const commentCut = afterKw.indexOf('--');
      const codePart = commentCut >= 0 ? afterKw.slice(0, commentCut) : afterKw;
      const braceIdx = codePart.indexOf('{');
      const name = (braceIdx >= 0 ? codePart.slice(0, braceIdx) : codePart).trim();
      const start = i;
      let depth = countBraces(line);
      i++;
      while (i < lines.length && depth > 0) {
        depth += countBraces(lines[i]);
        i++;
      }
      blocks.push({ keyword: bkw, name, body: lines.slice(start, i).join('\n') });
      continue;
    }

    const lkw = LINE_KEYWORDS.find(kw =>
      line.startsWith(kw) && (line.length === kw.length || line[kw.length] === ' '));
    if (lkw) {
      blocks.push({ keyword: lkw, name: line.slice(lkw.length).trim(), body: line });
      i++;
      continue;
    }

    i++;
  }

  return blocks;
}

function countBraces(line) {
  const commentIdx = line.indexOf('--');
  const code = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  let depth = 0;
  for (const ch of code) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

export function renderAllium(source) {
  const blocks = splitBlocks(source);
  if (blocks.length === 0) return '<p class="empty">Empty spec.</p>';
  return blocks.map(renderBlock).join('\n');
}

function renderBlock({ keyword, name, body }) {
  const skw = keyword.replace(/\s+/g, '-');
  const slugName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = slugName ? `${skw}-${slugName}` : skw;
  const highlighted = hljs.highlight(body, { language: 'allium' }).value;
  let bodyHtml;
  if (keyword === 'use') {
    const pathMatch = name.match(/^"([^"]+)"/);
    if (pathMatch) {
      const path = pathMatch[1];
      const after = escHtml(name.slice(pathMatch[0].length));
      bodyHtml = `<code class="allium-body"><span class="hljs-keyword">use</span> <a href="${escHtml(path)}">"${escHtml(path)}"</a>${after}</code>`;
    } else {
      bodyHtml = `<code class="allium-body">${highlighted}</code>`;
    }
  } else {
    bodyHtml = LINE_KEYWORDS.includes(keyword)
      ? `<code class="allium-body">${highlighted}</code>`
      : `<pre class="hljs allium-body"><code>${highlighted}</code></pre>`;
  }
  const nameSpan = name ? ` <span class="allium-name">${escHtml(name)}</span>` : '';
  return `<section class="allium-block allium-block--${skw}"><h3 id="${id}" class="allium-block-header"><span class="allium-kw">${escHtml(keyword)}</span>${nameSpan}</h3>${bodyHtml}</section>`;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
