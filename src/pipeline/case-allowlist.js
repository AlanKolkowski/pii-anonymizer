// ST-5 (SCOPE-TIERS-DESIGN.md §5.2): the user's own case-signature allowlist.
// Entries are raw strings typed by the user ("Sygnatury mojej sprawy"); this
// module parses them into the canonical structure
//   [division roman]? [repertorium] [number]/[year] ["upr"]?
// and finds their occurrences in text with the contracted tolerances — and
// ONLY those. Nothing here guesses: an entry never matches another division,
// another number or another year (§5.2 pkt 2; property test in the suite).
//
// Persistence is the caller's contract, not this module's: the list lives in
// RAM for the session (O-ST-3 — a case signature identifies the case, so
// writing it to disk falls under the spirit of THREAT-MODEL D2).

// Literal roman division numerals (§5.2 pkt 2) — closed list, longest first
// so the regex alternation can't match a prefix of a longer numeral.
const ROMAN_DIVISIONS = [
  'XX', 'XIX', 'XVIII', 'XVII', 'XVI', 'XV', 'XIV', 'XIII', 'XII', 'XI',
  'X', 'IX', 'VIII', 'VII', 'VI', 'V', 'IV', 'III', 'II', 'I',
];
const ROMAN_ALT = ROMAN_DIVISIONS.join('|');
const ROMAN_SET = new Set(ROMAN_DIVISIONS);

// Whitespace tolerated INSIDE a signature occurrence: spaces, NBSP, tabs,
// and at most ONE line break ("pojedyncze złamanie linii") — a signature
// split across a blank line is not one occurrence.
const SPACEY = '[ \\t\\u00A0]';
const GAP = '(?:' + SPACEY + '+|' + SPACEY + '*\\n' + SPACEY + '*)';
// Around the slash whitespace (and one line break) is optional.
const SLASH = SPACEY + '*(?:\\n' + SPACEY + '*)?/' + SPACEY + '*(?:\\n' + SPACEY + '*)?';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses one raw allowlist entry into its structure, or null when the text
 * does not look like a signature (the caller decides how to surface that —
 * unparseable entries never silently match anything).
 *
 * @param {string} raw
 * @returns {null | { division: string|null, repertorium: string, number: string, year: string, upr: boolean }}
 */
export function parseSignature(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.normalize('NFC').replace(/\s+/g, ' ').replace(/ ?\/ ?/g, '/').trim();
  // The repertorium may carry one hyphenated suffix segment (e.g. "Nc-e", the
  // EPU / e-Sąd electronic-collection repertorium) — a plain letter run is
  // not enough to model real Polish repertoria. The division token (roman
  // numeral, checked below against a closed list) never has a hyphen.
  const m = /^(?:(\p{L}+) )?(\p{L}+(?:-\p{L}+)?) (\d+)\/(\d{2}|\d{4})( upr)?$/iu.exec(cleaned);
  if (!m) return null;
  const [, first, second, number, year, upr] = m;
  let division = null;
  const repertorium = second;
  if (first !== undefined) {
    // Two letter tokens: the first must be a literal roman division.
    if (!ROMAN_SET.has(first.toUpperCase())) return null;
    division = first.toUpperCase();
  }
  // A single letter token is always the repertorium, even when it happens to
  // look like a roman numeral — the structure requires a repertorium, and a
  // mistyped division-only entry simply never matches anything real.
  return { division, repertorium, number, year, upr: Boolean(upr) };
}

// Year tolerance (§5.2 pkt 2): a 2-digit entry also matches the 4-digit
// variant with the literal "20" prefix and vice versa; no other digit
// tolerance whatsoever.
function yearAlternation(year) {
  if (year.length === 2) return '(?:20' + year + '|' + year + ')';
  if (year.length === 4 && year.startsWith('20')) return '(?:' + year + '|' + year.slice(2) + ')';
  return year;
}

/**
 * Builds the occurrence regex for one parsed entry. Case-insensitive (OCR
 * and typing styles vary); an entry WITH a division matches only that
 * division; an entry WITHOUT one also matches occurrences carrying any
 * literal division — with the span extended over it, so the pismo is never
 * left with a dangling "I C" in front of the token (§5.2 pkt 2).
 */
export function buildSignatureRegex(parsed) {
  const division = parsed.division
    ? parsed.division + GAP
    : '(?:(?:' + ROMAN_ALT + ')' + GAP + ')?';
  const pattern = [
    '(?<![\\p{L}\\p{N}])',
    division,
    escapeRegex(parsed.repertorium),
    GAP,
    escapeRegex(parsed.number),
    SLASH,
    yearAlternation(parsed.year),
    '(?![\\p{L}\\p{N}])',
    // The "upr" suffix is always optional in matching regardless of the
    // entry; the masked span is whatever actually stands in the text.
    '(?:' + GAP + 'upr(?![\\p{L}\\p{N}]))?',
  ].join('');
  return new RegExp(pattern, 'giu');
}

/**
 * All occurrences of the allowlisted signatures in `text`, as [{start, end}]
 * spans. Unparseable entries are skipped (reported via parseSignature by
 * whoever owns the input UI). Overlapping spans from different entries are
 * left as-is — downstream dedup already resolves same-type overlaps.
 *
 * @param {string} text
 * @param {string[]} rawEntries
 */
export function findAllowlistedSignatures(text, rawEntries) {
  const spans = [];
  for (const raw of rawEntries ?? []) {
    const parsed = parseSignature(raw);
    if (!parsed) continue;
    for (const m of text.matchAll(buildSignatureRegex(parsed))) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}
