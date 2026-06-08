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
    const bkw = BLOCK_KEYWORDS.find(kw => line.startsWith(kw));
    if (bkw) {
      const afterKw = line.slice(bkw.length).trim();
      const braceIdx = afterKw.indexOf('{');
      const name = (braceIdx >= 0 ? afterKw.slice(0, braceIdx) : afterKw).trim();
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

    const lkw = LINE_KEYWORDS.find(kw => line.startsWith(kw));
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
