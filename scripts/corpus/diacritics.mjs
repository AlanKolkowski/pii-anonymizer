// Deterministic diacritic degradation for the corpus 2.0 OCR-diacritics class
// (RECALL-90-DESIGN.md §2.5 class L7 / §3.4 point 3). Simulates the failure
// Alan reported (GATE §7): PaddleOCR's recognizer language-model prior can
// go EITHER way — stripping a diacritic ("Kołkowski" → "Kolkowski") or
// hallucinating one onto a plain letter that never had it ("Kolkowski" →
// "Kołkowski") — so degradation here is a single toggle map covering both
// directions per character, not a one-way strip.
//
// Pairs (exactly the nine named in the design doc): l↔ł, a↔ą, e↔ę, ó↔o,
// ś↔s, ż↔z, ź↔z, ć↔c, ń↔n. 'z' sits in two pairs (ż↔z and ź↔z) — stripping
// either ż or ź yields z, but "adding" a diacritic to a plain z always
// yields ż (the far more common Polish grapheme); this asymmetry is
// intentional, not a bug, and mirrors how real OCR confusions aren't
// perfectly invertible either.
const TOGGLE = {
  l: 'ł', ł: 'l', a: 'ą', ą: 'a', e: 'ę', ę: 'e', o: 'ó', ó: 'o',
  s: 'ś', ś: 's', z: 'ż', ż: 'z', ź: 'z', c: 'ć', ć: 'c', n: 'ń', ń: 'n',
  L: 'Ł', Ł: 'L', A: 'Ą', Ą: 'A', E: 'Ę', Ę: 'E', O: 'Ó', Ó: 'O',
  S: 'Ś', Ś: 'S', Z: 'Ż', Ż: 'Z', Ź: 'Z', C: 'Ć', Ć: 'C', N: 'Ń', Ń: 'N',
};

/** True if `text` contains at least one character this module can degrade —
 * callers should skip values with none rather than silently no-op. */
export function hasEligibleChar(text) {
  return [...text].some((ch) => TOGGLE[ch] !== undefined);
}

/** Degrades a single value by toggling a subset of its diacritic-eligible
 * characters (each swap is exactly one UTF-16 code unit for one — length is
 * always preserved, same invariant B2 relies on for case-folding). `fraction`
 * controls how much of the eligible-character set flips (rounded, at least
 * `minFlips`); the selection itself is a deterministic function of `rng`.
 * Returns `text` unchanged if there is nothing eligible to degrade. */
export function degradeDiacritics(rng, text, { fraction = 0.5, minFlips = 1 } = {}) {
  const chars = [...text];
  const eligible = [];
  for (let i = 0; i < chars.length; i++) {
    if (TOGGLE[chars[i]] !== undefined) eligible.push(i);
  }
  if (eligible.length === 0) return text;

  const count = Math.min(eligible.length, Math.max(minFlips, Math.round(eligible.length * fraction)));
  const chosen = new Set(pickIndices(rng, eligible, count));
  return chars.map((ch, i) => (chosen.has(i) ? TOGGLE[ch] : ch)).join('');
}

// Local Fisher-Yates-based sample-without-replacement over a small index
// array — deliberately not importing pickN from rng.mjs to keep this module
// dependency-free besides the rng function itself (it only needs draws, not
// the rest of the pool-selection surface).
function pickIndices(rng, indices, count) {
  const pool = indices.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Decides which occurrences (by index, 0..occurrenceCount-1) of a repeated
 * entity value get diacritic-degraded, per §3.4 point 3: applied to PART of
 * the occurrences, never all — the attack scenario is a mixture of forms in
 * one document (RECALL-90-DESIGN.md §2.5: one spelling backfills the other
 * via exact-match/coreference, so an all-degraded or all-clean document
 * can't exercise the failure). For 2+ occurrences this always returns a
 * proper non-empty, non-total subset. For 0 or 1 occurrences there is no
 * "mixture" to speak of, so the single occurrence (if any) is degraded. */
export function selectDegradedOccurrences(rng, occurrenceCount) {
  if (occurrenceCount <= 0) return new Set();
  if (occurrenceCount === 1) return new Set([0]);
  const degradedCount = 1 + Math.floor(rng() * (occurrenceCount - 1)); // in [1, occurrenceCount-1]
  return new Set(pickIndices(rng, Array.from({ length: occurrenceCount }, (_, i) => i), degradedCount));
}
