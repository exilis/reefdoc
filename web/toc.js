// slugify turns heading text into a DOM id used for in-page anchors.
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

// buildToc keeps only headings within [minLevel, maxLevel].
// Each heading is { level, text, id }.
export function buildToc(headings, minLevel = 1, maxLevel = 3) {
  return headings.filter((h) => h.level >= minLevel && h.level <= maxLevel);
}
