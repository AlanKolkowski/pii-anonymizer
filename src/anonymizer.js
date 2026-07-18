import { findTokens } from './tokens.js';
import { resolveOccurrences, renderResolvedText } from './substitution.js';
import identifierPatterns from './pipeline/data/identifier-patterns.json' with { type: 'json' };

const INFLECTION_SUFFIXES = ['a', 'ą', 'ę', 'em', 'owi', 'u', 'ie'];
const ADJECTIVAL_SURNAME_FAMILIES = [
  { lemma: 'ski', forms: ['ski', 'skiego', 'skiemu', 'skim', 'skich'] },
  { lemma: 'ska', forms: ['ska', 'skiej', 'ską'] },
  { lemma: 'cki', forms: ['cki', 'ckiego', 'ckiemu', 'ckim', 'ckich'] },
  { lemma: 'cka', forms: ['cka', 'ckiej', 'cką'] },
  { lemma: 'dzki', forms: ['dzki', 'dzkiego', 'dzkiemu', 'dzkim', 'dzkich'] },
  { lemma: 'dzka', forms: ['dzka', 'dzkiej', 'dzką'] },
];

function adjectivalSurnameStem(word) {
  for (const family of ADJECTIVAL_SURNAME_FAMILIES) {
    for (const form of family.forms) {
      if (word.endsWith(form) && word.length > form.length) {
        return { family: family.lemma, stem: word.slice(0, -form.length) };
      }
    }
  }
  return null;
}

function sameAdjectivalSurnameForm(a, b) {
  const left = adjectivalSurnameStem(a);
  const right = adjectivalSurnameStem(b);
  if (!left || !right) return null;
  return left.family === right.family && left.stem === right.stem;
}

function inflectionStems(word) {
  const stems = new Set([word]);
  for (const suffix of INFLECTION_SUFFIXES) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      stems.add(word.slice(0, -suffix.length));
    }
  }
  if (word.endsWith('ek') && word.length > 4) {
    stems.add(`${word.slice(0, -2)}k`);
  }
  if (word.endsWith('ka') && word.length > 4) {
    stems.add(word.slice(0, -1));
  }
  if (word.endsWith('kiem') && word.length > 6) {
    stems.add(`${word.slice(0, -4)}k`);
  }
  return stems;
}

function hasSharedInflectionStem(a, b) {
  const left = inflectionStems(a);
  const right = inflectionStems(b);
  for (const stem of left) {
    if (stem.length >= 3 && right.has(stem)) return true;
  }
  return false;
}

function wordsMatch(w1, w2) {
  const a = w1.toLowerCase();
  const b = w2.toLowerCase();
  if (a === b) return true;

  const surnameMatch = sameAdjectivalSurnameForm(a, b);
  if (surnameMatch !== null) return surnameMatch;

  return hasSharedInflectionStem(a, b);
}

export function couldBeSamePerson(name1, name2) {
  const words1 = name1.split(/\s+/);
  const words2 = name2.split(/\s+/);

  if (words1.length === words2.length) {
    return words1.every((w, i) => wordsMatch(w, words2[i]));
  }

  // Different word count: check if all words of the shorter name
  // match a subset of the longer name's words
  const [shorter, longer] =
    words1.length < words2.length ? [words1, words2] : [words2, words1];

  const used = new Set();
  for (const sw of shorter) {
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && wordsMatch(sw, longer[i])) {
        used.add(i);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function createNameNormalizer() {
  const groups = [];

  return function (name) {
    for (const group of groups) {
      if (couldBeSamePerson(name, group.canonical)) {
        return group.canonical;
      }
    }
    groups.push({ canonical: name });
    return name;
  };
}

function ingestSource({ text, entities }, state) {
  for (const entity of entities) {
    const value = text.slice(entity.start, entity.end);
    const type = entity.entity_group;
    let normalizedValue = value;
    if (type === 'PERSON_NAME') {
      normalizedValue = state.normalizeName(value);
    } else if (type === 'ORGANIZATION_NAME') {
      normalizedValue = value.toLowerCase();
    }
    const canonicalKey = `${type}::${normalizedValue}`;

    if (!state.seen[canonicalKey]) {
      let token;
      do {
        state.counters[type] = (state.counters[type] || 0) + 1;
        token = `[${type}_${state.counters[type]}]`;
      } while (state.reserved.has(token));
      state.seen[canonicalKey] = token;
      state.legend[token] = value;
    }

    const rawKey = `${type}::${value}`;
    if (rawKey !== canonicalKey) {
      state.seen[rawKey] = state.seen[canonicalKey];
    }
  }
}

function collectReservedTokens(texts) {
  const reserved = new Set();
  for (const text of texts) {
    if (!text) continue;
    for (const t of findTokens(text)) reserved.add(t.token);
  }
  return reserved;
}
export function buildTokenMap(entities, originalText) {
  const state = {
    counters: {},
    seen: {},
    legend: {},
    normalizeName: createNameNormalizer(),
    reserved: collectReservedTokens([originalText]),
  };
  ingestSource({ text: originalText, entities }, state);
  return { seen: state.seen, legend: state.legend };
}

export function buildTokenMapMulti(sources) {
  const state = {
    counters: {},
    seen: {},
    legend: {},
    normalizeName: createNameNormalizer(),
    reserved: collectReservedTokens(sources.map((s) => s.text)),
  };
  for (const source of sources) ingestSource(source, state);
  return { seen: state.seen, legend: state.legend };
}

export function applyTokens(text, entities, seen) {
  const positionsSeen = new Set();
  const unique = [];
  for (const entity of entities) {
    const posKey = `${entity.start}:${entity.end}`;
    if (!positionsSeen.has(posKey)) {
      positionsSeen.add(posKey);
      unique.push(entity);
    }
  }
  unique.sort((a, b) => b.start - a.start);

  let result = text;
  for (const entity of unique) {
    const value = text.slice(entity.start, entity.end);
    const key = `${entity.entity_group}::${value}`;
    const token = seen[key];
    result = result.slice(0, entity.start) + token + result.slice(entity.end);
  }
  return result;
}

export function anonymizeText(text, entities) {
  const { seen, legend } = buildTokenMap(entities, text);
  return { anonymized: applyTokens(text, entities, seen), legend };
}

export function aggregateEntities(rawTokens, originalText) {
  // Reconstruct character positions by finding each sub-word in the text
  let pos = 0;
  const tokens = rawTokens.map((token) => {
    const idx = originalText.indexOf(token.word, pos);
    const start = idx >= 0 ? idx : pos;
    const end = start + token.word.length;
    pos = end;
    return { ...token, start, end };
  });

  // Merge consecutive tokens of the same entity type.
  // Allow index gaps of ≤2 (handles spaces between phone digits, etc.)
  // Merge regardless of B-/I- prefix (handles models that tag all tokens as B-)
  const groups = [];
  let current = null;

  for (const token of tokens) {
    const type = token.entity.replace(/^[BI]-/, '');

    const shouldMerge =
      current &&
      current.type === type &&
      token.index - current.lastIndex <= 2;

    if (shouldMerge) {
      current.end = token.end;
      current.scores.push(token.score);
      current.lastIndex = token.index;
    } else {
      if (current) groups.push(current);
      current = {
        type,
        start: token.start,
        end: token.end,
        scores: [token.score],
        lastIndex: token.index,
      };
    }
  }
  if (current) groups.push(current);

  return groups.map((g) => ({
    entity_group: g.type,
    start: g.start,
    end: g.end,
    score: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
  }));
}

export function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [{ text, offset: 0 }];

  // Find break points: prefer paragraph boundaries (\n\n), fallback to lines (\n)
  const breaks = [];
  for (const m of text.matchAll(/\n\n+/g)) {
    breaks.push(m.index + m[0].length);
  }
  if (breaks.length === 0) {
    for (const m of text.matchAll(/\n/g)) {
      breaks.push(m.index + 1);
    }
  }

  // Greedily pack complete segments into chunks
  const chunks = [];
  let from = 0;
  let lastFit = 0;

  for (const bp of breaks) {
    if (bp - from > maxChars) {
      const splitAt = lastFit > from ? lastFit : bp;
      chunks.push({ text: text.slice(from, splitAt), offset: from });
      from = splitAt;
    }
    lastFit = bp;
  }

  // Emit remaining text
  if (from < text.length) {
    chunks.push({ text: text.slice(from, text.length), offset: from });
  }

  return chunks;
}

const EMAIL_ANCHORED_RE = /^[\w.+-]+@[\w.-]+\.\w{2,}/;
const EMAIL_LOCAL_CHAR = /[\w.+-]/;
const EMAIL_DOMAIN_CHAR = /[\w.-]/;

function findEmailEntities(text) {
  const entities = [];
  let searchFrom = 0;
  let lastEnd = 0; // matches never overlap, mirroring global-regex semantics
  let at;
  while ((at = text.indexOf('@', searchFrom)) !== -1) {
    let start = at;
    while (start > lastEnd && EMAIL_LOCAL_CHAR.test(text[start - 1])) start--;
    if (start === at) { searchFrom = at + 1; continue; }
    let end = at + 1;
    while (end < text.length && EMAIL_DOMAIN_CHAR.test(text[end])) end++;
    const m = EMAIL_ANCHORED_RE.exec(text.slice(start, end));
    if (m) {
      entities.push({
        entity_group: 'EMAIL_ADDRESS',
        start,
        end: start + m[0].length,
        score: 1.0,
        source: 'regex',
      });
      lastEnd = start + m[0].length;
      searchFrom = lastEnd;
    } else {
      searchFrom = at + 1;
    }
  }
  return entities;
}

// ── Checksum-validated identifiers (A1: EVAL-RECALL-AUDIT §8) ─────────
//
// PESEL/NIP/REGON/IBAN carry an official check digit. Separators (spaces,
// NBSP, hyphens, a single mid-token line break from a scan or a wrapped
// table cell) are stripped before validating so re-typed or scanned
// variants don't defeat detection — but a candidate that fails its checksum
// is never emitted: precision comes from the arithmetic, not from
// surrounding context. Two OCR-confusable glyphs (lowercase "l" for "1",
// uppercase "O" for "0") are tolerated inside a digit run for the same
// reason low-DPI scans corrupt these documents in the first place.
// KRS has no public check digit, so it stays context-gated on a literal
// "KRS" label instead of arithmetic.

function peselChecksumValid(d) {
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  return ((10 - (sum % 10)) % 10) === (d.charCodeAt(10) - 48);
}

function nipChecksumValid(d) {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  const check = sum % 11;
  return check !== 10 && check === (d.charCodeAt(9) - 48);
}

function regon9ChecksumValid(d) {
  const weights = [8, 9, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  const check = sum % 11;
  return (check === 10 ? 0 : check) === (d.charCodeAt(8) - 48);
}

function regon14ChecksumValid(d) {
  const weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  const check = sum % 11;
  return (check === 10 ? 0 : check) === (d.charCodeAt(13) - 48);
}

// compact: uppercase, country code + digits only (no separators), e.g.
// "PL61109010140000071219812874".
function ibanChecksumValid(compact) {
  if (!/^[A-Z]{2}\d+$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

const ID_SEPARATOR = '[ \\u00a0\\n-]';
const OCR_DIGIT_CHAR_RE = /[0-9lO]/;
const DIGIT_CLUSTER_RE = new RegExp(`[0-9lO](?:${ID_SEPARATOR}?[0-9lO]){5,59}`, 'g');

function toDigitChar(ch) {
  if (ch === 'l') return '1';
  if (ch === 'O') return '0';
  return ch;
}

function countNewlines(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++;
  return n;
}

// Offsets (into `raw`) and OCR-corrected values of every digit-or-confusable
// character in a matched cluster, so callers can slide a window over
// `digits` and map back to exact character spans in the original text.
function digitPositions(raw) {
  const offsets = [];
  let digits = '';
  for (let i = 0; i < raw.length; i++) {
    if (OCR_DIGIT_CHAR_RE.test(raw[i])) {
      offsets.push(i);
      digits += toDigitChar(raw[i]);
    }
  }
  return { offsets, digits };
}

// "KRS 0000876123" / "KRS nr. 0000876123" / "KRS: 0000876123" — narrow,
// literal-label gate for the one identifier in this family with no check
// digit at all.
const KRS_CONTEXT_RE = /\bKRS\b\s*(?:nr\.?|numer)?\s*[:.]?\s*$/iu;
function hasKrsContext(text, upTo) {
  return KRS_CONTEXT_RE.test(text.slice(Math.max(0, upTo - 20), upTo));
}

// VAT-EU registrations prefix the NIP with the country code: "PL 9481234560".
// Only extends a span that already passed the NIP checksum on its own.
const NIP_VAT_PREFIX_RE = /PL[  ]?$/;
function vatPrefixStart(text, upTo) {
  const windowStart = Math.max(0, upTo - 3);
  const m = NIP_VAT_PREFIX_RE.exec(text.slice(windowStart, upTo));
  return m ? windowStart + m.index : upTo;
}

function isSeparatorChar(ch) {
  return ch === ' ' || ch === ' ' || ch === '\n' || ch === '-';
}

// A window may only start/end at the edge of the maximal cluster or right
// next to an actual separator — never mid-run. Without this, a checksum can
// coincidentally validate on a slice that straddles two unrelated numbers
// (the tail of one PESEL + the head of the next, separated by one space) or
// nests inside a longer valid one (a 14-digit REGON contains its parent
// organization's 9-digit REGON as a real prefix — both are legitimate on
// their own, but a window is never "half of one number, half of another").
function isCleanBoundary(raw, rawStart, rawEnd) {
  const beforeOk = rawStart === 0 || isSeparatorChar(raw[rawStart - 1]);
  const afterOk = rawEnd === raw.length || isSeparatorChar(raw[rawEnd]);
  return beforeOk && afterOk;
}

// PESEL (11), NIP/KRS (10), REGON (9 or 14) — all share one scan because
// they're indistinguishable by shape alone at several lengths (a 10-digit
// run could be a NIP or a KRS) and can sit adjacent to each other in lists.
// Every valid-length, cleanly-bounded window inside a maximal
// digit-and-separator cluster is tried independently (not just the whole
// cluster), so two identifiers separated by a single space don't shadow
// each other.
function findNumericIdentifierEntities(text) {
  const entities = [];
  for (const m of text.matchAll(DIGIT_CLUSTER_RE)) {
    const raw = m[0];
    const clusterStart = m.index;
    const { offsets, digits } = digitPositions(raw);

    for (const len of [9, 10, 11, 14]) {
      for (let start = 0; start + len <= digits.length; start++) {
        const rawStart = offsets[start];
        const rawEnd = offsets[start + len - 1] + 1;
        if (!isCleanBoundary(raw, rawStart, rawEnd)) continue;

        const window = digits.slice(start, start + len);
        let type = null;
        let extendForVat = false;
        if (len === 11 && peselChecksumValid(window)) {
          type = 'PERSON_IDENTIFIER';
        } else if (len === 9 && regon9ChecksumValid(window)) {
          type = 'ORGANIZATION_IDENTIFIER';
        } else if (len === 14 && regon14ChecksumValid(window)) {
          type = 'ORGANIZATION_IDENTIFIER';
        } else if (len === 10) {
          if (nipChecksumValid(window)) {
            type = 'ORGANIZATION_IDENTIFIER';
            extendForVat = true;
          } else if (hasKrsContext(text, clusterStart + rawStart)) {
            type = 'ORGANIZATION_IDENTIFIER';
          }
        }
        if (!type) continue;
        if (countNewlines(raw.slice(rawStart, rawEnd)) > 1) continue;

        const entityEnd = clusterStart + rawEnd;
        const entityStart = extendForVat
          ? vatPrefixStart(text, clusterStart + rawStart)
          : clusterStart + rawStart;

        entities.push({ entity_group: type, start: entityStart, end: entityEnd, score: 1.0, source: 'regex' });
      }
    }
  }
  return entities;
}

// ── Court/bailiff docket numbers (A2: EVAL-RECALL-AUDIT §8) ────────────
//
// [roman division]? + repertorium code + number/year (+ "upr") — own-case
// docket numbers, not published case-law citations. The whitelist
// deliberately excludes Supreme Court repertoria (CZP, CSKP, CSK, …): those
// are what published judgments are cited by (adw_32's trap), and stay a
// documented limitation (B1/C5) rather than something this pattern reaches
// for with a context heuristic that could misfire either way.
const COURT_REPERTORIUM = ['ACa', 'GC', 'KM', 'Nc', 'Ns', 'Co', 'C', 'K'];
const ROMAN_DIVISION = '(?:X{1,2}|IX|IV|V?I{1,3})';
const DOCKET_RE = new RegExp(
  `\\b(?:${ROMAN_DIVISION}\\s+)?(?:${COURT_REPERTORIUM.join('|')})\\s+\\d{1,6}/\\d{2,4}(?:\\s+upr\\b)?\\b`,
  'g',
);

function findDocketNumberEntities(text) {
  const entities = [];
  for (const m of text.matchAll(DOCKET_RE)) {
    entities.push({ entity_group: 'DOCUMENT_REFERENCE', start: m.index, end: m.index + m[0].length, score: 1.0, source: 'regex' });
  }
  return entities;
}

// VIN (vehicle identification number): 17 chars, uppercase letters minus
// I/O/Q (visually confusable with 1/0) plus digits, mixing at least one of
// each. Structural precision — no checksum needed, the restricted alphabet
// and fixed length are themselves a strong signal. Closes the
// VIN→DOCUMENT_REFERENCE type confusion in the audit's confusion matrix
// (§5.1) — RECALL-90-DESIGN.md R-2.
const VIN_RE = /\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/g;

function findVehicleIdentifierEntities(text) {
  const entities = [];
  for (const m of text.matchAll(VIN_RE)) {
    entities.push({ entity_group: 'VEHICLE_IDENTIFIER', start: m.index, end: m.index + m[0].length, score: 1.0, source: 'regex' });
  }
  return entities;
}

// ── Context-anchored official-document identifiers (HC-2: H-3-CLOSURE-DESIGN.md §5) ──
//
// Closes H-3 case (a): formats findRegexEntities never produced ANY
// candidate for (dowód osobisty, prawo jazdy, tablica rejestracyjna), so a
// same-type "mask" candidate never existed to compete with the model's
// mistaken "pass" guess (DOCUMENT_REFERENCE) at dedup. Anchors and
// blocklists live in identifier-patterns.json (§5.1 pt 1); this file holds
// only the pattern skeletons and the one arithmetic validator (R-DOW), same
// split as the A1 family above.
//
// A context anchor is a plain lexical pattern found ANYWHERE in a bounded
// backward window from the candidate — not required to sit immediately
// before it — but the window never crosses a paragraph break (§5.1 pt 3):
// an anchor from a previous, unrelated paragraph must not license a match.
function paragraphSafeWindow(text, upTo, maxWindow) {
  const rawStart = Math.max(0, upTo - maxWindow);
  const slice = text.slice(rawStart, upTo);
  const lastBreak = slice.lastIndexOf('\n\n');
  return lastBreak === -1 ? slice : slice.slice(lastBreak + 2);
}

function hasContextAnchor(text, upTo, maxWindow, anchorRegexes) {
  const window = paragraphSafeWindow(text, upTo, maxWindow);
  return anchorRegexes.some((re) => re.test(window));
}

function compileAnchors(patternSources) {
  return patternSources.map((src) => new RegExp(src, 'iu'));
}

// Single optional separator between an identifier's letter/digit groups —
// deliberately a SUBSET of ID_SEPARATOR (no `\n`): a line break inside a
// short 9-char token is OCR/scan residue this v1 doesn't chase (§5.1 pt 2,
// consistent with the R-ST-5 limitation already accepted for the A1 family).
const SINGLE_SEP_OPT = '[ \\u00a0-]?';
const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_])';

// R-DOW: Polish national ID card ("dowód osobisty") number — 3 uppercase
// letters (series) + 6 digits (fold OCR l→1, O→0, same as the A1 family),
// first digit is a check digit over the whole 9-character token (letters
// valued A=10..Z=35, weights 7-3-1 for the letters and 7-3-1-7-3 for the
// five digits that follow the check digit — H-3-CLOSURE-DESIGN.md §5.2,
// confirmed by hand against both corpus vectors: DKR 744829 valid, BMA
// 733701 invalid). Two independent paths, either one emits:
//   (A) arithmetic — checksum valid AND the 3-letter prefix is not on the
//       acronym blocklist (O-HC-3: KRS/NIP/VAT/... also fit the bare shape
//       and pass the checksum on a ~1/10 chance, R-HC-3) — no context
//       needed, same "precision from arithmetic" house style as PESEL/NIP.
//   (B) context-anchored — checksum invalid (a scanned/re-typed number can
//       have a genuinely broken check digit) but a literal "dowód
//       osobisty" / "dow. os." / "seria i nr" mention sits in the
//       preceding window.
const DOW_DATA = identifierPatterns.dowodOsobisty;
const DOW_BLOCKLIST = new Set(DOW_DATA.blocklistPrefixes);
const DOW_CONTEXT_ANCHORS = compileAnchors(DOW_DATA.contextAnchors);
const DOW_CONTEXT_WINDOW = DOW_DATA.contextWindow;

const DOW_LETTER_WEIGHTS = [7, 3, 1];
const DOW_DIGIT_WEIGHTS = [7, 3, 1, 7, 3];

function dowChecksumValid(letters, digits) {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += DOW_LETTER_WEIGHTS[i] * (letters.charCodeAt(i) - 55);
  for (let i = 0; i < 5; i++) sum += DOW_DIGIT_WEIGHTS[i] * (digits.charCodeAt(i + 1) - 48);
  return (sum % 10) === (digits.charCodeAt(0) - 48);
}

const DOW_CANDIDATE_RE = new RegExp(
  `${WORD_EDGE_BEFORE}([A-Z]{3})${SINGLE_SEP_OPT}([0-9lO]{6})${WORD_EDGE_AFTER}`,
  'gu',
);

function findDowodOsobistyEntities(text) {
  const entities = [];
  for (const m of text.matchAll(DOW_CANDIDATE_RE)) {
    const letters = m[1];
    const digits = [...m[2]].map(toDigitChar).join('');
    const start = m.index;
    const end = start + m[0].length;

    if (dowChecksumValid(letters, digits) && !DOW_BLOCKLIST.has(letters)) {
      entities.push({ entity_group: 'PERSON_IDENTIFIER', start, end, score: 1.0, source: 'regex' });
      continue;
    }
    if (hasContextAnchor(text, start, DOW_CONTEXT_WINDOW, DOW_CONTEXT_ANCHORS)) {
      entities.push({ entity_group: 'PERSON_IDENTIFIER', start, end, score: 1.0, source: 'regex' });
    }
  }
  return entities;
}

// R-PJ: Polish driving-licence number, 5/2/4 digit groups
// ("NNNNN/NN/RRRR", OCR-folded like the rest of the A1/HC-2 family).
// Context-anchor ONLY, never bare (H-3-CLOSURE-DESIGN.md §5.3): the exact
// same shape is how invoice/accounting document numbers are written
// ("Faktura VAT nr 12345/07/2024") — a bare pattern would mask invoice
// numbers as PERSON_IDENTIFIER in every business letter. The anchor
// ("prawo/prawa/prawem jazdy") only needs to appear somewhere in the
// preceding window, not immediately before the number — real sentences
// interpose "nr"/"numer"/"seria" between the phrase and the digits.
const PJ_DATA = identifierPatterns.prawoJazdy;
const PJ_CONTEXT_ANCHORS = compileAnchors(PJ_DATA.contextAnchors);
const PJ_CONTEXT_WINDOW = PJ_DATA.contextWindow;

const PJ_CANDIDATE_RE = new RegExp(
  `${WORD_EDGE_BEFORE}[0-9lO]{5}/[0-9lO]{2}/[0-9lO]{4}${WORD_EDGE_AFTER}`,
  'gu',
);

function findPrawoJazdyEntities(text) {
  const entities = [];
  for (const m of text.matchAll(PJ_CANDIDATE_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (hasContextAnchor(text, start, PJ_CONTEXT_WINDOW, PJ_CONTEXT_ANCHORS)) {
      entities.push({ entity_group: 'PERSON_IDENTIFIER', start, end, score: 1.0, source: 'regex' });
    }
  }
  return entities;
}

// Polish IBAN (PL + 26 digits) and bare NRB (26 digits, no country code —
// mod-97 validated as if "PL" were prepended, per the audit contract).
const IBAN_PL_RE = new RegExp(`\\bPL${ID_SEPARATOR}?(?:[0-9lO]${ID_SEPARATOR}?){25}[0-9lO]\\b`, 'gi');
const NRB_BARE_RE = new RegExp(`(?<![A-Za-z0-9])(?:[0-9lO]${ID_SEPARATOR}?){25}[0-9lO](?![A-Za-z0-9])`, 'g');

function findIbanEntities(text) {
  const entities = [];
  const claimedSpans = [];

  for (const m of text.matchAll(IBAN_PL_RE)) {
    const raw = m[0];
    if (countNewlines(raw) > 1) continue;
    const { digits } = digitPositions(raw);
    if (digits.length !== 26) continue;
    if (!ibanChecksumValid(`PL${digits}`)) continue;
    const start = m.index;
    const end = m.index + raw.length;
    entities.push({ entity_group: 'BANK_ACCOUNT_IDENTIFIER', start, end, score: 1.0, source: 'regex' });
    claimedSpans.push([start, end]);
  }

  for (const m of text.matchAll(NRB_BARE_RE)) {
    const raw = m[0];
    if (countNewlines(raw) > 1) continue;
    const start = m.index;
    const end = m.index + raw.length;
    if (claimedSpans.some(([s, e]) => start < e && s < end)) continue;
    const { digits } = digitPositions(raw);
    if (digits.length !== 26) continue;
    if (!ibanChecksumValid(`PL${digits}`)) continue;
    entities.push({ entity_group: 'BANK_ACCOUNT_IDENTIFIER', start, end, score: 1.0, source: 'regex' });
  }

  return entities;
}

// ── Financial amounts (A4: EVAL-RECALL-AUDIT §8) ───────────────────────
//
// Thousands groups accept either a dot or whitespace (incl. NBSP) as
// separator — "15.000,00 zł" (scanned-invoice dot grouping) alongside the
// existing "15 000,00 zł" — or no grouping at all ("1500 zł"); the decimal
// (grosze) part is optional. Currency can follow the number (zł/PLN/EUR) or
// precede it (PLN/EUR, ISO-code style: "PLN 4.200"). Boundaries use
// \p{L}/\d lookaround rather than \b: "ł" isn't an ASCII word character, so
// a trailing \b never fires after "zł" and would silently make the whole
// suffix pattern inert. Percentages and "p.p." are excluded by
// construction — neither is a currency token this pattern reaches for.
const AMOUNT_NUMBER = '(?:\\d{1,3}(?:[.\\s]\\d{3})+|\\d+)(?:,\\d{2})?';
const AMOUNT_NOT_BEFORE = '(?<![\\p{L}\\d])';
const AMOUNT_NOT_AFTER = '(?![\\p{L}\\d])';
const AMOUNT_SUFFIX_RE = new RegExp(`${AMOUNT_NOT_BEFORE}${AMOUNT_NUMBER}\\s?(?:zł|PLN|EUR)${AMOUNT_NOT_AFTER}`, 'gu');
const AMOUNT_PREFIX_RE = new RegExp(`${AMOUNT_NOT_BEFORE}(?:PLN|EUR)\\s${AMOUNT_NUMBER}${AMOUNT_NOT_AFTER}`, 'gu');

export function findRegexEntities(text) {
  const patterns = [
    { regex: /(?<!\d)\+?\d{2}[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, entity_group: 'PHONE_NUMBER' },
    { regex: /(?<!\d)\+?48[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g, entity_group: 'PHONE_NUMBER' },
    { regex: AMOUNT_SUFFIX_RE, entity_group: 'FINANCIAL_AMOUNT' },
    { regex: AMOUNT_PREFIX_RE, entity_group: 'FINANCIAL_AMOUNT' },
  ];

  const entities = [
    ...findEmailEntities(text),
    ...findNumericIdentifierEntities(text),
    ...findIbanEntities(text),
    ...findVehicleIdentifierEntities(text),
    ...findDocketNumberEntities(text),
    ...findDowodOsobistyEntities(text),
    ...findPrawoJazdyEntities(text),
  ];
  for (const { regex, entity_group } of patterns) {
    for (const m of text.matchAll(regex)) {
      entities.push({
        entity_group,
        start: m.index,
        end: m.index + m[0].length,
        score: 1.0,
        source: 'regex',
      });
    }
  }
  return entities;
}

const WORD_BOUNDARY = /[\s,;:()„""–\-]/;
const MAX_SNAP = 6; // max chars to expand in either direction

export function snapToWordBoundaries(entities, text) {
  return entities.map((entity) => {
    let { start, end } = entity;

    // Expand start to the beginning of the word (max MAX_SNAP chars)
    const minStart = Math.max(0, start - MAX_SNAP);
    while (start > minStart && !WORD_BOUNDARY.test(text[start - 1])) start--;

    // Expand end to the end of the word (max MAX_SNAP chars)
    const maxEnd = Math.min(text.length, end + MAX_SNAP);
    while (end < maxEnd && !WORD_BOUNDARY.test(text[end])) end++;

    if (start === entity.start && end === entity.end) return entity;
    return { ...entity, start, end };
  });
}


const DEDUP_SCORE_EPSILON = 0.1;

// Bucket key used when deduplicateEntities is called without a tier
// resolver — every entity lands in the one bucket, so the per-tier frontier
// below degenerates into the original single-pass arbitration exactly.
const SINGLE_TIER_BUCKET = Symbol('dedup-single-bucket');

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function isPreciseRegexEntity(entity) {
  return entity.source === 'regex' && entity.score === 1.0;
}

// The largest contiguous run of `entity`'s span left uncovered by any span
// in `overlapping`, or null if nothing remains. Character-coverage based
// (like snap's word-boundary walk) rather than interval subtraction, since
// several overlapping regex spans can carve out disjoint gaps.
function largestUncoveredRemainder(entity, overlapping) {
  const len = entity.end - entity.start;
  const covered = new Array(len).fill(false);
  for (const r of overlapping) {
    const from = Math.max(r.start, entity.start);
    const to = Math.min(r.end, entity.end);
    for (let i = from; i < to; i++) covered[i - entity.start] = true;
  }

  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i <= len; i++) {
    const uncovered = i < len && !covered[i];
    if (uncovered && runStart === -1) runStart = i;
    if (!uncovered && runStart !== -1) {
      if (i - runStart > bestLen) { bestLen = i - runStart; bestStart = runStart; }
      runStart = -1;
    }
  }
  if (bestLen === 0) return null;
  return { start: entity.start + bestStart, end: entity.start + bestStart + bestLen };
}

// A trimmed remainder is only kept when it's glued directly to the regex
// match with no word boundary at the cut — e.g. one extra digit the regex's
// clean-boundary check left out. Without this, trimming would resurrect
// unrelated leading/trailing context (e.g. "457 dni): " ahead of a precisely
// regex-matched amount) as a same-type entity of its own, over-masking text
// that was never part of the identifier. `text` is optional: callers that
// don't have it (or don't pass it) get the old, safe "drop entirely"
// behavior instead of guessing.
function isGluedRemainder(text, entity, remainder) {
  if (!text) return false;
  const cutOnLeft = remainder.start > entity.start;
  const cutOnRight = remainder.end < entity.end;
  if (cutOnLeft && WORD_BOUNDARY.test(text[remainder.start])) return false;
  if (cutOnRight && WORD_BOUNDARY.test(text[remainder.end - 1])) return false;
  return true;
}

// A model entity fully covered by a same-type precise regex match is
// redundant — drop it. One only partially covered is trimmed to its largest
// remaining uncovered run instead of dropped outright: a model span wider
// than the regex match (e.g. it also caught a trailing character the regex
// couldn't validate) must not lose the part the regex didn't reach
// (EVAL-RECALL-AUDIT §8 A6 — REGON in adw_11 leaked this way).
function trimOrDropCoveredByPreciseRegex(entities, text) {
  const preciseRegexEntities = entities.filter(isPreciseRegexEntity);
  if (preciseRegexEntities.length === 0) return entities;

  const result = [];
  for (const entity of entities) {
    if (isPreciseRegexEntity(entity)) {
      result.push(entity);
      continue;
    }
    const overlapping = preciseRegexEntities.filter(
      (regexEntity) => regexEntity.entity_group === entity.entity_group && spansOverlap(regexEntity, entity),
    );
    if (overlapping.length === 0) {
      result.push(entity);
      continue;
    }
    const fullyCovered = overlapping.some((r) => r.start <= entity.start && r.end >= entity.end);
    if (fullyCovered) continue;

    const remainder = largestUncoveredRemainder(entity, overlapping);
    if (remainder && isGluedRemainder(text, entity, remainder)) {
      result.push({ ...entity, start: remainder.start, end: remainder.end });
    }
  }
  return result;
}

// ST-2 H-1 (SCOPE-TIERS-DESIGN.md §3.2 pkt 3): optional third argument
// `tierOf` — (entity) => 'mask'|'review'|'pass' — makes overlap arbitration
// tier-aware. Omitted (all existing call sites), every entity shares
// SINGLE_TIER_BUCKET and the loop below is exactly today's single-pass
// arbitration. Given, overlaps only arbitrate within the same effective
// tier: a wide W3 span (e.g. an organization name) must never suppress a
// nested W1 span (e.g. the person's name inside it) merely because it
// happened to win the scan-order race — both survive untouched, and each
// tier keeps its own independent "frontier" (last kept entry) so a chain
// like mask/pass/mask (bridged by an unrelated pass span in between) still
// arbitrates the two mask entities against each other correctly.
export function deduplicateEntities(entities, text, tierOf) {
  if (entities.length <= 1) return entities;

  const candidates = trimOrDropCoveredByPreciseRegex(entities, text);
  candidates.sort((a, b) => a.start - b.start || b.score - a.score);

  const result = [];
  const frontier = new Map(); // tier bucket -> index of its last-kept entry in `result`

  for (const curr of candidates) {
    const bucket = tierOf ? tierOf(curr) : SINGLE_TIER_BUCKET;
    const idx = frontier.get(bucket);
    const prev = idx === undefined ? undefined : result[idx];

    if (prev && curr.start < prev.end) {
      // Perfect-score (regex) entities are precise — prefer them over wider NER
      const prevPerfect = prev.score === 1.0;
      const currPerfect = curr.score === 1.0;
      if (prevPerfect !== currPerfect) {
        if (currPerfect) result[idx] = curr;
      } else {
        // Same precision tier: when scores are close (within epsilon), prefer
        // wider span; when scores differ meaningfully, trust the higher score
        // (NER emitting a greedy wider candidate with much lower confidence
        // usually means it's over-extending into punctuation or context).
        const prevSpan = prev.end - prev.start;
        const currSpan = curr.end - curr.start;
        const scoresClose = Math.abs(curr.score - prev.score) <= DEDUP_SCORE_EPSILON;
        if (scoresClose) {
          if (currSpan > prevSpan) result[idx] = curr;
        } else if (curr.score > prev.score) {
          result[idx] = curr;
        }
      }
    } else {
      frontier.set(bucket, result.length);
      result.push(curr);
    }
  }

  // Cross-tier survivors can interleave result's insertion order (a later
  // same-tier replacement can land behind an already-pushed different-tier
  // entry) — re-sort so output stays start-ordered regardless of tierOf.
  // No-op for the single-bucket path: it's already produced in this order.
  result.sort((a, b) => a.start - b.start || b.score - a.score);
  return result;
}

// Facade over the S2 substitution engine (SHARED-FOUNDATION-DESIGN.md §4.3):
// empty decisions and an identity resolver reduce to exactly today's
// behavior, so all four deanonymization sinks keep working unchanged.
export function deanonymizeText(text, legend) {
  return renderResolvedText(resolveOccurrences(text, { legend }), text);
}
