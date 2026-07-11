// N-7 (LOCAL-VERIFIER-DESIGN.md §4.1): near-identical but not-quite-matching
// case signatures in one document — "I C 123/26" vs "I C 123/25" — usually a
// typo rather than two genuinely different cases.
const SIGNATURE_PATTERN = /\b([IVXLCM]{1,6})\s+([A-Za-złńśćóąęż]{1,6})\s+(\d{1,5}\/\d{2,4})\b/g;

// Standard DP edit distance (insert/delete/substitute), small strings only.
function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[rows - 1][cols - 1];
}

const MAX_VARIANT_DISTANCE = 2;

export function checkSignatureVariants(text) {
  const occurrences = [...text.matchAll(SIGNATURE_PATTERN)].map((match) => ({
    text: match[0],
    index: match.index,
    length: match[0].length,
  }));

  const distinct = [...new Set(occurrences.map((o) => o.text))];
  if (distinct.length < 2) return [];

  const flaggedPairs = new Set();
  for (let i = 0; i < distinct.length; i++) {
    for (let j = i + 1; j < distinct.length; j++) {
      const a = distinct[i];
      const b = distinct[j];
      if (a === b) continue;
      const distance = levenshtein(a, b);
      if (distance > 0 && distance <= MAX_VARIANT_DISTANCE) {
        flaggedPairs.add(a);
        flaggedPairs.add(b);
      }
    }
  }
  if (flaggedPairs.size === 0) return [];

  const variantList = [...flaggedPairs].sort().join('” / „');
  return occurrences
    .filter((o) => flaggedPairs.has(o.text))
    .map((o) => ({
      checker: 'N-7',
      severity: 'średnia',
      message: `Możliwe warianty tej samej sygnatury akt w piśmie: „${variantList}".`,
      index: o.index,
      length: o.length,
      quote: o.text,
    }));
}
