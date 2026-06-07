// filterTree returns a pruned copy of the tree keeping files whose name
// matches the query (case-insensitive) and the directories that contain them.
// An empty query returns the original tree. No match yields an empty root.
export function filterTree(node, query) {
  const q = query.trim().toLowerCase();
  if (!q) return node;
  return prune(node, q) || { ...node, children: [] };
}

function prune(node, q) {
  if (!node.isDir) {
    return node.name.toLowerCase().includes(q) ? node : null;
  }
  const kids = (node.children || []).map((c) => prune(c, q)).filter(Boolean);
  if (kids.length === 0) return null;
  return { ...node, children: kids };
}
