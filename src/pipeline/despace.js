import { foldWord } from './case-fold.js';

// OS-1 (OCR-SPACING-DESIGN.md §2): detection of OCR-spaced words
// ("W r ó b l e w s k a") and construction of the glued segment variant the
// second NER pass runs on. Deliberately NARROW (§1): only runs of single
// letters separated by single spaces. Partial spacings ("Wr ó blewska"),
// glue-ups ("BożenaWróblewska"), hyphenation carries ("Wr-\nóblewską") and
// glyph substitutions stay out of scope — they remain named FNs, not this
// module's problem.
//
// The offset map is TRANSIENT and local to one ner-phase step (§0): the
// pipeline never rewrites ctx.text, entity offsets always point at the
// original, so origPos lives only between "build variant" and "map the
// candidates back" inside createDespacedNerStep. If it ever needs to
// outlive the step, that is tripwire T1 (§2.6) — stop, don't patch.

const MIN_WORD_TOKENS = 4;
const MAX_PHRASE_GAP = 3;

const LETTER_RE = /\p{L}/u;
const UPPER_RE = /\p{Lu}/u;
const LOWER_RE = /\p{Ll}/u;
const ALL_WHITESPACE_RE = /^\s+$/;

function isLetter(ch) {
  return ch !== undefined && LETTER_RE.test(ch);
}

function isUpper(ch) {
  return UPPER_RE.test(ch);
}

function isLower(ch) {
  return LOWER_RE.test(ch);
}

// A "bare" letter: exactly one \p{L} with a non-letter (or text boundary) on
// both sides (§2.2 pkt 1). "J." is excluded by construction — the dot glues
// to the letter, so the letter's right neighbor check still passes, but the
// CHAIN can never continue through it (continuation requires a single space
// next), leaving a 1-token run below MIN_WORD_TOKENS.
function isBareLetterAt(text, i) {
  return isLetter(text[i]) && !isLetter(text[i - 1]) && !isLetter(text[i + 1]);
}

// Maximal chains of bare letters joined by exactly one space. Any other
// joiner (two spaces, tab, newline, dot, bracket) ends the chain — those are
// word boundaries or exclusions per the grammar.
function collectChains(text) {
  const chains = [];
  let i = 0;
  while (i < text.length) {
    if (!isBareLetterAt(text, i)) {
      i += 1;
      continue;
    }
    const chain = [i];
    let p = i;
    while (text[p + 1] === ' ' && isBareLetterAt(text, p + 2)) {
      p += 2;
      chain.push(p);
    }
    chains.push(chain);
    i = p + 1;
  }
  return chains;
}

// Polish has no capitals inside a word (§2.2 pkt 1): a lower→UPPER transition
// between chain tokens is a word boundary ("B o ż e n a W r ó b l e w s k a"
// → "Bożena" + "Wróblewska"). This is also what leaves a lowercase preposition
// behind: "w T o r u n i u" splits into [w] (too short, discarded) and
// "Toruniu". Symmetrically, an all-caps run has no lowercase inside either,
// so UPPER→lower after ≥2 uppercase letters ends the caps word — that keeps
// a trailing spaced preposition ("W O J E W Ó D Z K I w P o z n a n i u")
// from destroying the class-C word it follows. After only ONE uppercase
// letter, upper→lower is the normal interior of a title-case word ("W r ó…")
// and must not split.
function splitAtCaseTransitions(text, chain) {
  const words = [];
  let current = [chain[0]];
  for (let k = 1; k < chain.length; k++) {
    const prev = text[chain[k - 1]];
    const next = text[chain[k]];
    const lowerToUpper = isLower(prev) && isUpper(next);
    const capsRunEnds = isUpper(prev) && isLower(next)
      && current.length >= 2 && current.every((p) => isUpper(text[p]));
    if (lowerToUpper || capsRunEnds) {
      words.push(current);
      current = [];
    }
    current.push(chain[k]);
  }
  words.push(current);
  return words;
}

// Class T (title-case): uppercase first token + all-lowercase rest — a
// spaced-out proper noun. Class C (caps): all tokens uppercase — a spaced-out
// header/acronym-style word. Anything else (all-lowercase emphasis spacing
// "p o s t a n a w i a", mixed cases) has no class: silence, zero cost.
// Minimum N=4 letters; 3-letter words would need gazetteer/name-list
// confirmation (O-OS-1) which v1 doesn't have, so they stay silent.
function classifyWord(text, letters) {
  if (letters.length < MIN_WORD_TOKENS) return null;
  const first = text[letters[0]];
  const rest = letters.slice(1);
  if (isUpper(first) && rest.every((p) => isLower(text[p]))) return 'T';
  if (isUpper(first) && rest.every((p) => isUpper(text[p]))) return 'C';
  return null;
}

/**
 * Detects spaced-out words and groups adjacent ones (gap of 1–3 whitespace
 * characters, nothing else in between) into phrases, so the variant can show
 * the model a full "Imię Nazwisko" instead of two lone words.
 *
 * @param {string} text - one segment's text (local coordinates)
 * @returns {Array<{start: number, end: number, words: Array<{start: number,
 *   end: number, letters: number[], wordClass: 'T'|'C'}>}>}
 */
export function detectSpacedPhrases(text) {
  const words = [];
  for (const chain of collectChains(text)) {
    for (const letters of splitAtCaseTransitions(text, chain)) {
      const wordClass = classifyWord(text, letters);
      if (!wordClass) continue;
      words.push({
        start: letters[0],
        end: letters[letters.length - 1] + 1,
        letters,
        wordClass,
      });
    }
  }
  if (words.length === 0) return [];

  words.sort((a, b) => a.start - b.start);
  const phrases = [];
  let current = null;
  for (const word of words) {
    const gap = current ? text.slice(current.end, word.start) : null;
    if (current && gap.length >= 1 && gap.length <= MAX_PHRASE_GAP && ALL_WHITESPACE_RE.test(gap)) {
      current.words.push(word);
      current.end = word.end;
    } else {
      current = { start: word.start, end: word.end, words: [word] };
      phrases.push(current);
    }
  }
  return phrases;
}

/**
 * Character-fidelity invariant from §2.2 pkt 2: every variant character that
 * is not an inserted phrase space is the SAME character at origPos[i] in the
 * original, and origPos is strictly increasing. This is the property that
 * makes the map trustworthy — a violation means masking would land on the
 * wrong characters (R-OS-1: a leak and content destruction at once), so the
 * builder fails open (returns null) instead of ever returning a broken map.
 *
 * Checked on the RAW glued variant, before class-C words are folded to Title
 * Case — folding intentionally changes the characters' case (§2.2 pkt 3) but
 * is length-preserving, so it composes with an already-verified map.
 */
export function checkDespaceInvariant(text, variant, origPos, insertedSpaces) {
  if (origPos.length !== variant.length) return false;
  for (let i = 0; i < variant.length; i++) {
    if (origPos[i] < 0 || origPos[i] >= text.length) return false;
    if (i > 0 && origPos[i] <= origPos[i - 1]) return false;
    if (insertedSpaces.has(i)) continue;
    if (text[origPos[i]] !== variant[i]) return false;
  }
  return true;
}

/**
 * Builds the glued variant of one segment: each spaced-out word is glued,
 * inter-word gaps inside a phrase become a single (recorded) space, and the
 * whole rest of the segment is copied through identically. Returns null when
 * there is nothing to do or when the invariant check fails (fail open —
 * caller skips the segment, status quo, never wrong offsets).
 *
 * @param {string} text - one segment's text
 * @returns {null | {
 *   variant: string,
 *   origPos: number[],           // variant index → original index (local)
 *   insertedSpaces: Set<number>, // variant indices of inserted phrase spaces
 *   words: Array<{variantStart: number, variantEnd: number,
 *                 start: number, end: number, wordClass: 'T'|'C'}>,
 * }}
 */
export function buildDespacedVariant(text) {
  const phrases = detectSpacedPhrases(text);
  if (phrases.length === 0) return null;

  let variant = '';
  const origPos = [];
  const insertedSpaces = new Set();
  const words = [];
  let src = 0;

  for (const phrase of phrases) {
    while (src < phrase.start) {
      origPos.push(src);
      variant += text[src];
      src += 1;
    }
    let previousWordEnd = null;
    for (const word of phrase.words) {
      if (previousWordEnd !== null) {
        // One space stands in for the whole 1–3-char gap; it maps to the
        // gap's first character so the map stays strictly increasing.
        insertedSpaces.add(variant.length);
        origPos.push(previousWordEnd);
        variant += ' ';
      }
      const variantStart = variant.length;
      for (const letterPos of word.letters) {
        origPos.push(letterPos);
        variant += text[letterPos];
      }
      words.push({
        variantStart,
        variantEnd: variant.length,
        start: word.start,
        end: word.end,
        wordClass: word.wordClass,
      });
      previousWordEnd = word.end;
    }
    src = phrase.end;
  }
  while (src < text.length) {
    origPos.push(src);
    variant += text[src];
    src += 1;
  }

  if (!checkDespaceInvariant(text, variant, origPos, insertedSpaces)) return null;

  // §2.2 pkt 3: glued class-C words get B2's Title Case fold ("WIELKOPOLSKI"
  // → "Wielkopolski") — without it both models stay blind to caps (B2's
  // diagnosis). foldWord is verified length-preserving per character; if it
  // ever fails (exotic input), the word simply stays unfolded — offsets are
  // never touched either way.
  for (const word of words) {
    if (word.wordClass !== 'C') continue;
    const glued = variant.slice(word.variantStart, word.variantEnd);
    const folded = foldWord(glued);
    if (folded !== null && folded.length === glued.length) {
      variant = variant.slice(0, word.variantStart) + folded + variant.slice(word.variantEnd);
    }
  }

  return { variant, origPos, insertedSpaces, words };
}

/**
 * Variant segments for the despaced NER pass, in the same {text, offset}
 * shape createNerStep consumes. origPos and word ranges stay LOCAL to the
 * segment; the step converts to global with segment.offset. Segments with no
 * detection (or a failed invariant) are omitted — zero cost, zero candidates.
 *
 * @param {Array<{text: string, offset: number}>} segments
 */
export function buildDespacedSegments(segments) {
  const out = [];
  for (const segment of segments) {
    const built = buildDespacedVariant(segment.text);
    if (!built) continue;
    out.push({
      text: built.variant,
      offset: segment.offset,
      origPos: built.origPos,
      words: built.words,
    });
  }
  return out;
}
