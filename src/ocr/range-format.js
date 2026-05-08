export function formatOcrRanges(pages, totalPages) {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (totalPages != null && sorted.length === totalPages) {
    return 'wszystkie strony';
  }
  if (sorted.length === 1) {
    return `strona ${sorted[0]}`;
  }
  const groups = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    groups.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  groups.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `strony ${groups.join(', ')}`;
}
