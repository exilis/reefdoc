export function snapshotBlocks(container) {
  const result = [];
  for (const child of container.children) {
    if (child.nodeType !== 1) continue;
    const text = (child.textContent || '').trim().slice(0, 200);
    result.push({ tag: child.tagName, text, html: child.outerHTML });
  }
  return result;
}

function blockKey(snap) {
  return snap.tag + '\0' + snap.text;
}

export function computeDiff(oldSnap, newSnap) {
  const oldKeys = oldSnap.map(blockKey);
  const newKeys = newSnap.map(blockKey);

  // LCS via standard DP
  const m = oldKeys.length, n = newKeys.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldKeys[i] === newKeys[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the DP table to produce ops
  const ops = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldKeys[i] === newKeys[j]) {
      // Matched key — keep or modify depending on html equality
      ops.push(oldSnap[i].html === newSnap[j].html
        ? { type: 'keep', newIndex: j }
        : { type: 'modify', newIndex: j });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: 'insert', newIndex: j });
      j++;
    } else {
      // Count consecutive removals
      let count = 0;
      while (i < m && (j >= n || (oldKeys[i] !== newKeys[j] && dp[i + 1][j] > dp[i][j + 1]))) {
        count++; i++;
      }
      // Fallback: if we didn't advance (tie-breaking edge), consume one
      if (count === 0) { count = 1; i++; }
      ops.push({ type: 'remove', count });
    }
  }
  return ops;
}

export function applyMarks(container, ops, { createElement } = {}) {
  const create = createElement || ((tag) => document.createElement(tag));
  // Map newIndex → the actual DOM child. container.children is a live
  // HTMLCollection in real DOM or a plain array in tests.
  const kids = [...container.children].filter(c => c.nodeType === 1);

  // Walk ops and apply classes / insert markers.  We track a cursor into
  // the live children list; inserts from gap markers shift it.
  let cursor = 0;
  for (const op of ops) {
    if (op.type === 'keep') {
      cursor = op.newIndex + 1;
    } else if (op.type === 'modify' || op.type === 'insert') {
      const el = kids[op.newIndex];
      if (el) {
        el.classList.add('rf-changed');
        el.classList.add('rf-changed-flash');
      }
      cursor = op.newIndex + 1;
    } else if (op.type === 'remove') {
      const marker = create('div');
      marker.className = 'rf-removed-marker';
      if (op.count > 1) marker.setAttribute('data-label', '×' + op.count);
      // Insert after the element at cursor position, or append
      const ref = kids[cursor];
      if (ref) container.insertBefore(marker, ref);
      else container.appendChild(marker);
    }
  }
}
