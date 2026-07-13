import specialCategoryLexicon from './data/special-category-lexicon.json' with { type: 'json' };

// B3 (RECALL-90-DESIGN.md §2.3): context-anchored lexicon for art. 9-10 RODO
// special-category facts (health, criminal record, trade union membership —
// the three categories with proven full leaks, EVAL-RECALL-AUDIT.md #2/#11/
// #30 — plus a deliberately minimal closed list for the remaining art. 9
// categories). Unlike lexicon.js's B4-lite (flat lemma -> fixed span),
// matching here is ANCHOR + COMPLEMENT: each entry's `pattern` matches only
// the contextual trigger phrase; the span is then extended forward to the
// nearest phrase-ending punctuation or coordinating conjunction, capped at
// MAX_COMPLEMENT_CHARS past the anchor. The span must cover the special FACT
// itself (the disease name / offence / union), not the whole sentence.

// Same dedup-arbitration reasoning as LEXICON_SCORE in lexicon.js, mirrored
// for the opposite direction: here OUR span is normally the wide, correct
// one (the models don't see these descriptive phrases at all — that's the
// diagnosis), so a same-type model candidate is usually a narrower subset of
// ours and score===1.0's "perfect tier always wins" would already do the
// right thing. But it is not guaranteed a model candidate is never wider
// (e.g. a coordinating-conjunction cutoff ahead of where a model's own span
// ends) — keeping the score below 1.0 routes any such overlap through
// dedup's "close scores -> prefer the wider span" branch instead of an
// unconditional perfect-tier veto, so a genuinely wider correct span (from
// either side) still wins on width, not on an artifact of source.
const SCORE = 0.95;

const MAX_COMPLEMENT_CHARS = 60;

// Phrase-ending punctuation, a line break, or a coordinating conjunction
// (spójnik współrzędny) as its own whitespace-delimited word — whichever
// comes first ends the complement. Known limitation: an abbreviation's
// internal period (e.g. "sygn." mid-complement) is not distinguished from a
// real sentence-ending period, unlike trimTrailingPunctuationStep — accepted
// for v1 (RECALL-B3-NOTES.md), not hit by any current corpus example.
const STOP_RE = /[,.;\n]|\s(?:i|oraz|lub|albo|ale|a|czy|ani)(?=\s|$)/giu;

function extendToComplementEnd(text, anchorEnd) {
  const windowEnd = Math.min(text.length, anchorEnd + MAX_COMPLEMENT_CHARS);
  const window = text.slice(anchorEnd, windowEnd);
  STOP_RE.lastIndex = 0;
  const m = STOP_RE.exec(window);
  let end = m ? anchorEnd + m.index : windowEnd;
  // Trim a trailing whitespace run left by either stop condition (the
  // conjunction branch consumes its leading \s, the window/cap branch can
  // land mid-whitespace) so the span never ends on bare whitespace.
  while (end > anchorEnd && /\s/.test(text[end - 1])) end--;
  return end;
}

// `\p{L}` boundary (not `\b`), same rationale as lexicon.js's buildPattern:
// `\b` does not treat Polish diacritics as word characters. Case-insensitive
// for the same reason B4-lite is: a literal anchor match does not lose
// meaning on a fully-capitalised span (headers/komparycje).
const MATCHERS = specialCategoryLexicon.entries.map((entry) => ({
  id: entry.id,
  category: entry.category,
  regex: new RegExp(`(?<![\\p{L}])(?:${entry.pattern})(?![\\p{L}])`, 'giu'),
}));

export function findSpecialCategoryEntities(text) {
  const raw = [];
  for (const { id, category, regex } of MATCHERS) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      const start = m.index;
      const anchorEnd = m.index + m[0].length;
      const end = extendToComplementEnd(text, anchorEnd);
      raw.push({ start, end, category, id });
    }
  }

  // Greedy longest-match-first, non-overlapping — mirrors lexicon.js. Two
  // anchors (possibly different categories) firing on overlapping text keep
  // only the single widest fact span; cross-source arbitration against the
  // HF models happens later in dedupStep, same as every other source.
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

  return accepted.map(({ start, end, category }) => ({
    entity_group: category,
    start,
    end,
    score: SCORE,
    source: 'lexicon',
  }));
}
