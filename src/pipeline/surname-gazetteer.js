import gazetteer from './data/surname-gazetteer.json' with { type: 'json' };
import roleLexicon from './data/role-lexicon.json' with { type: 'json' };

// SG-lite (SURNAME-GAZETTEER-DESIGN.md §2.2 pkt 5-6): matcher for surnames
// colliding with common nouns. Case-SENSITIVE downward — emission only for
// title-case and ALL-CAPS forms (a capital letter IS the onymic signal;
// lowercase is the noun, never emitted) — the deliberate inverse of
// lexicon.js's case-insensitive role matching. A syntactic slot (S1-S5)
// promotes a match to the mask layer; a slotless title-case match is only
// ever OFFERED for review (forceTier 'review', consumed by ST-2's
// partition); sentence-start capitals without a slot say nothing and emit
// nothing (v1 — known FN class, measured on the holdout, closed by SG-full).

// Same value and same rationale as LEXICON_SCORE (src/pipeline/lexicon.js):
// not 1.0 (the regex tier wins overlaps regardless of span width — measured
// B4 regression), inside DEDUP_SCORE_EPSILON of the models' 0.85-0.999 so
// overlaps take the "close scores → wider span" branch (§2.2 pkt 7).
const GAZETTEER_SCORE = 0.95;

// Slot separator budget: ≤ 3 whitespace/punctuation characters, never
// across a sentence boundary (§2.2 pkt 6).
const NEIGHBOR_WINDOW = 48;

function upper(form) {
  return form.toLocaleUpperCase('pl');
}

const FORM_TO_ENTRY = new Map();
for (const entry of gazetteer.entries) {
  for (const form of entry.forms) {
    FORM_TO_ENTRY.set(form, entry);
    FORM_TO_ENTRY.set(upper(form), entry);
  }
}

function alternation(values) {
  const escaped = values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  escaped.sort((a, b) => b.length - a.length);
  return escaped.join('|');
}

const NAMES_ALT = alternation(gazetteer.firstNames.flatMap((n) => [n, upper(n)]));
const S1_BEFORE_RE = new RegExp(`(?<![\\p{L}])(${NAMES_ALT})\\s{1,3}$`, 'u');
const S1_AFTER_RE = new RegExp(`^\\s{1,3}(${NAMES_ALT})(?![\\p{L}])`, 'u');
const S2_INITIAL_RE = /(?<![\p{L}\p{N}])\p{Lu}\.\s{0,3}$/u;
const TITLES_ALT = alternation(gazetteer.titles.flatMap((t) => (t === t.toLowerCase() ? [t] : [t, upper(t)])));
const S3_TITLE_RE = new RegExp(`(?<![\\p{L}])(${TITLES_ALT})\\s{1,3}$`, 'u');
const ROLE_FORMS_ALT = alternation(roleLexicon.nonEntity.flatMap((e) => e.forms));
const S4_ROLE_RE = new RegExp(`(?<![\\p{L}])(${ROLE_FORMS_ALT})[:\\s]{1,3}$`, 'iu');
const PHRASES_ALT = alternation(gazetteer.functionPhrases);
const S5_PHRASE_RE = new RegExp(`(?<![\\p{L}])(${PHRASES_ALT})\\s{1,3}$`, 'iu');

const LETTER_RUN_RE = /\p{L}+/gu;
// Separate sticky regex for the hyphen extension so it never shares
// lastIndex state with the main matchAll scan.
const STICKY_RUN_RE = /\p{L}+/uy;

function isUpperChar(ch) {
  return ch !== undefined && /\p{Lu}/u.test(ch);
}

function segmentContaining(segments, pos) {
  for (const segment of segments ?? []) {
    if (pos >= segment.offset && pos < segment.offset + segment.text.length) return segment;
  }
  return null;
}

function sentenceStartIndex(segment) {
  const leading = segment.text.match(/^\s*/)[0].length;
  return segment.offset + leading;
}

// §2.2 pkt 5: a match adjacent to a hyphen extends over the other
// capitalized part (also one from outside the list) — one candidate for the
// whole double-barrelled span.
function extendDoubleBarrelled(text, start, end) {
  if (text[end] === '-' && isUpperChar(text[end + 1])) {
    STICKY_RUN_RE.lastIndex = end + 1;
    const m = STICKY_RUN_RE.exec(text);
    if (m) end = m.index + m[0].length;
  }
  if (text[start - 1] === '-') {
    let runStart = start - 1;
    while (runStart > 0 && /\p{L}/u.test(text[runStart - 1])) runStart -= 1;
    if (runStart < start - 1 && isUpperChar(text[runStart])) start = runStart;
  }
  return [start, end];
}

function detectSlot({ text, start, end, segment, entities }) {
  const segStart = segment.offset;
  const segEnd = segment.offset + segment.text.length;
  const before = text.slice(Math.max(segStart, start - NEIGHBOR_WINDOW), start);
  const after = text.slice(end, Math.min(segEnd, end + NEIGHBOR_WINDOW));

  const s1Before = S1_BEFORE_RE.exec(before);
  if (s1Before) return { start: start - (before.length - s1Before.index), end };
  const s1After = S1_AFTER_RE.exec(after);
  if (s1After) return { start, end: end + s1After.index + s1After[0].length };

  const s2 = S2_INITIAL_RE.exec(before);
  if (s2) return { start: start - (before.length - s2.index), end };

  if (S3_TITLE_RE.test(before)) return { start, end };

  // S3, role-entity flavor: a PERSON_ROLE_OR_TITLE detected by the model or
  // B4's lexicon ends just before the candidate — reuse of an existing
  // detection as the slot signal, not a second list (§2.2 pkt 6).
  const roleAdjacent = (entities ?? []).some((e) =>
    e.entity_group === 'PERSON_ROLE_OR_TITLE'
    && e.end <= start
    && start - e.end <= 3
    && e.end > segStart
    && /^[\s:,]*$/.test(text.slice(e.end, start)));
  if (roleAdjacent) return { start, end };

  if (S4_ROLE_RE.test(before)) return { start, end };
  if (S5_PHRASE_RE.test(before)) return { start, end };
  return null;
}

/**
 * All gazetteer candidates in `text`. Slot matches come out plain (their
 * effective tier is the type's — mask); slotless title-case matches carry
 * forceTier 'review'; lowercase forms, slotless slotOnly entries and
 * slotless sentence-start capitals emit nothing.
 *
 * @param {string} text
 * @param {Array<{text: string, offset: number}>} segments - sentence
 *   segments (slot adjacency never crosses a sentence boundary; sentence
 *   starts are read from here)
 * @param {Array<object>} [entities] - entities detected so far (S3's
 *   role-adjacency signal)
 */
export function findGazetteerEntities(text, segments, entities = []) {
  const found = [];
  const emitted = new Set();
  for (const m of text.matchAll(LETTER_RUN_RE)) {
    const entry = FORM_TO_ENTRY.get(m[0]);
    if (!entry) continue;

    const [start, end] = extendDoubleBarrelled(text, m.index, m.index + m[0].length);
    // Both parts of a double-barrelled name can be gazetteer forms — one
    // candidate per extended span is enough.
    if (emitted.has(`${start}:${end}`)) continue;
    emitted.add(`${start}:${end}`);
    const segment = segmentContaining(segments, start);
    if (!segment) continue;

    const slot = detectSlot({ text, start, end, segment, entities });
    if (slot) {
      found.push({
        entity_group: 'PERSON_NAME',
        start: slot.start,
        end: slot.end,
        score: GAZETTEER_SCORE,
        source: 'gazetteer',
      });
      continue;
    }

    if (entry.slotOnly) continue;
    if (start === sentenceStartIndex(segment)) continue;
    found.push({
      entity_group: 'PERSON_NAME',
      start,
      end,
      score: GAZETTEER_SCORE,
      source: 'gazetteer',
      forceTier: 'review',
    });
  }
  return found;
}
