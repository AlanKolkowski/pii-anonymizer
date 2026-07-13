import roleLexicon from './data/role-lexicon.json' with { type: 'json' };

// B4-lite (RECALL-90-DESIGN.md §2.4): closed-list lexicon matcher for
// PERSON_ROLE_OR_TITLE. Mirrors the regex sources' conventions (source:
// 'lexicon', no `word`) so it composes with the rest of postprocess exactly
// like A1/A2/A4 do (see src/anonymizer.js) — with one deliberate exception,
// see LEXICON_SCORE below.
//
// `\p{L}` lookaround (not `\b`) for the same reason A4's amount patterns use
// it: `\b` does not treat Polish diacritics as word characters, so it would
// not reliably guard a boundary after e.g. "ł". Matching is case-insensitive
// (`i` flag) — unlike the HF models, a literal lexicon match does not lose
// meaning on a fully-capitalised span (headers/komparycje), so this also
// covers a slice of B2's territory for this one entity type at zero cost.

// NOT 1.0, on purpose. `deduplicateEntities` (src/anonymizer.js) treats any
// score===1.0 entity as an absolute-precision "regex tier" match that always
// beats an overlapping lower-score candidate, *regardless of span width* —
// correct for A1/A2/A4, whose checksum/pattern matches can never legitimately
// be narrower than the true entity. It is NOT correct here: a bare lemma
// ("kierownik") is a fully-confident STRING match but the real title can
// legitimately extend beyond any fixed form ("kierownik ds. Marketingu").
// Measured regression (synthetic corpus, B4-lite first pass): multilang-fp32
// had already caught "Kierownik ds. Marketingu" / "Dyrektor HR" / "apl. adw."
// in full; a same-start, score=1.0 lexicon match on just the bare lemma won
// the score===1.0 tiebreak outright and evicted the correct, wider model
// span — 4 TP became FN, precision and recall both fell. Keeping the score
// below 1.0 (and within DEDUP_SCORE_EPSILON=0.1 of the realistic 0.85-0.999
// range multilang-fp32 scores genuine title phrases at) routes the same
// overlap through dedup's "close scores → prefer the wider span" branch
// instead, which is the correct arbiter for this failure mode.
const LEXICON_SCORE = 0.95;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(form) {
  const escaped = escapeRegex(form).replace(/ /g, '\\s+');
  return `(?<![\\p{L}])${escaped}(?![\\p{L}])`;
}

const NON_ENTITY_FORMS_LOWER = new Set(
  roleLexicon.nonEntity.flatMap((entry) => entry.forms.map((f) => f.toLowerCase())),
);

const MATCHERS = roleLexicon.entity.flatMap((entry) =>
  [...entry.forms, ...(entry.abbreviations || [])].map((form) => ({
    lemma: entry.lemma,
    regex: new RegExp(buildPattern(form), 'giu'),
  })),
);

const ENTITY_GROUP = roleLexicon.entityGroup;

export function findLexiconEntities(text) {
  const raw = [];
  for (const { lemma, regex } of MATCHERS) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      const matched = m[0];
      // Defensive: entity/nonEntity forms are disjoint by construction
      // (proved by role-lexicon.consistency.test.js) — this is a belt-and-
      // suspenders runtime guard against a future edit breaking that.
      if (NON_ENTITY_FORMS_LOWER.has(matched.toLowerCase())) continue;
      raw.push({ start: m.index, end: m.index + matched.length, lemma });
    }
  }

  // Greedy longest-match-first, non-overlapping: prevents a bare lemma
  // ("dyrektor", "księgowa") from firing inside a longer compound title
  // ("dyrektor generalny", "główna księgowa") that also matched. Contract
  // requires multi-word titles taken whole (RECALL-90-DESIGN.md §2.4 pkt 4).
  raw.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const occupied = [];
  const accepted = [];
  for (const candidate of raw) {
    const overlaps = occupied.some(([s, e]) => candidate.start < e && s < candidate.end);
    if (overlaps) continue;
    occupied.push([candidate.start, candidate.end]);
    accepted.push(candidate);
  }
  accepted.sort((a, b) => a.start - b.start);

  return accepted.map(({ start, end }) => ({
    entity_group: ENTITY_GROUP,
    start,
    end,
    score: LEXICON_SCORE,
    source: 'lexicon',
  }));
}
