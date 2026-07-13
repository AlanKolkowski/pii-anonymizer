// B2 (RECALL-90-DESIGN.md §2.2): case-folding for the second NER pass over
// fully-capitalised segments (komparycje, nagłówki, oznaczenia stron), where
// both models are trained on naturally-capitalised text and lose the proper-
// noun signal.
//
// Technical foundation (§2.2): folding an uppercase Polish token to Title
// Case is a 1:1 transformation on UTF-16 code units — Ż→ż, Ł→ł, Ó→ó, etc.
// all preserve length, and Polish target text contains neither Turkish İ
// (which lowercases to a 2-unit "i̇") nor German ẞ. That property is what
// lets the caller reuse candidate offsets from the folded text unchanged
// against the original — no offset-mapping layer. Folding is done per
// character (not `.toLowerCase()` on the whole tail) and every single
// mapping is verified length-preserving before use, so if that assumption
// is ever wrong for some input, folding fails open (returns null) instead
// of silently shifting offsets.

const LETTER_RUN_RE = /\p{L}+/gu;
// Gates *detection* only (RECALL-90-DESIGN.md §2.2 step 1: "segmenty
// zawierające >=1 słowo >=3 liter") — a segment with just a 2-letter
// uppercase preposition ("W", "DO", "OD") does not by itself look like a
// header/komparycja. Folding itself (step 2) is NOT re-qualified by this
// threshold: every uppercase token in a *qualifying* segment gets folded,
// short ones included, so "ODWOŁANIE OD DECYZJI..." doesn't come out as
// the inconsistent "Odwołanie OD Decyzji..." — see isUppercaseRun below.
const MIN_QUALIFYING_WORD_LENGTH = 3;

function isUppercaseRun(word) {
  return !/\p{Ll}/u.test(word) && /\p{Lu}/u.test(word);
}

function isQualifyingUppercaseWord(word) {
  return word.length >= MIN_QUALIFYING_WORD_LENGTH && isUppercaseRun(word);
}

/**
 * True if `text` contains at least one whole word of >=3 letters that is
 * fully uppercase (no lowercase letters mixed in — excludes e.g. "ZUSem").
 * Cheap, synchronous — used to decide whether a segment is worth the
 * second-pass inference cost at all.
 */
export function hasUppercaseSignal(text) {
  for (const m of text.matchAll(LETTER_RUN_RE)) {
    if (isQualifyingUppercaseWord(m[0])) return true;
  }
  return false;
}

/**
 * Folds one fully-uppercase word to Title Case: first character unchanged,
 * every subsequent character lowercased individually. Returns null (fail
 * open) if any single character's lowercase form does not preserve that
 * character's own UTF-16 length.
 */
export function foldWord(word) {
  const chars = Array.from(word);
  let rest = '';
  for (let i = 1; i < chars.length; i++) {
    const lowered = chars[i].toLowerCase();
    if (lowered.length !== chars[i].length) return null;
    rest += lowered;
  }
  return chars[0] + rest;
}

/**
 * Folds every fully-uppercase word (>=3 letters) in `text` to Title Case,
 * leaving everything else (spaces, punctuation, shorter/mixed-case tokens)
 * untouched. Returns null — fail open, caller skips the segment entirely —
 * if folding is not proven length-preserving for the whole string, so a
 * caller can never end up with offsets that silently drift.
 */
export function foldUppercaseSegmentText(text) {
  let ok = true;
  const folded = text.replace(LETTER_RUN_RE, (word) => {
    if (!ok || !isUppercaseRun(word)) return word;
    const result = foldWord(word);
    if (result === null) { ok = false; return word; }
    return result;
  });
  if (!ok || folded.length !== text.length) return null;
  return folded;
}

/**
 * Builds the folded-text variant of every segment worth a second pass:
 * segments with no qualifying uppercase word, or whose fold fails the
 * length-preservation guard, are simply omitted (zero cost, zero candidates
 * — never a crash). Offsets are copied through unchanged (see module doc).
 *
 * @param {Array<{text: string, offset: number}>} segments
 * @returns {Array<{text: string, offset: number}>}
 */
export function buildFoldedSegments(segments) {
  const out = [];
  for (const segment of segments) {
    if (!hasUppercaseSignal(segment.text)) continue;
    const folded = foldUppercaseSegmentText(segment.text);
    if (folded === null) continue;
    out.push({ text: folded, offset: segment.offset });
  }
  return out;
}
