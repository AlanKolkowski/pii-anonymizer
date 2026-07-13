import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSpecialCategoryEntities } from './special-category-lexicon.js';
import { deduplicateEntities } from '../anonymizer.js';
import specialCategoryLexicon from './data/special-category-lexicon.json' with { type: 'json' };

const REPO_ROOT = join(import.meta.dirname, '../..');

function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

describe('findSpecialCategoryEntities — per-entry coverage (B3)', () => {
  // RECALL-90-DESIGN.md §2.3: "test jednostkowy per wzorzec (pozytyw + negatyw
  // z pliku leksykonu, test iteruje po danych)" — generated straight from the
  // data file so every entry is provably matched, with the correct category/
  // score/source, and provably does NOT fire on its own negative example.

  it.each(specialCategoryLexicon.entries)('"$id" ($category): examplePositive is matched with the right category/score/source', (entry) => {
    const matches = findSpecialCategoryEntities(entry.examplePositive);
    const own = matches.filter((m) => m.entity_group === entry.category);
    expect(own.length, `expected at least one ${entry.category} match in: ${entry.examplePositive}`).toBeGreaterThan(0);
    for (const m of own) {
      expect(m.source).toBe('lexicon');
      // Deliberately NOT 1.0 — see SCORE comment in special-category-lexicon.js.
      expect(m.score).toBeGreaterThanOrEqual(0.9);
      expect(m.score).toBeLessThan(1.0);
    }
  });

  it.each(specialCategoryLexicon.entries)('"$id" ($category): exampleNegative produces no match of this category', (entry) => {
    const matches = findSpecialCategoryEntities(entry.exampleNegative);
    const own = matches.filter((m) => m.entity_group === entry.category);
    expect(
      own,
      `exampleNegative for "${entry.id}" unexpectedly matched: ${JSON.stringify(own.map((m) => entry.exampleNegative.slice(m.start, m.end)))}`,
    ).toEqual([]);
  });

  // RECALL-90-DESIGN.md §2.3 pkt 2 / GATE-RECALL-90 G4: a span narrower than
  // the fact it's meant to cover is a CRITICAL bug (masks the anchor, leaves
  // the disease/offence/union name in the clear). This is the gate's own
  // acceptance test, run per pattern rather than asserted by hand per case.
  it.each(specialCategoryLexicon.entries)('"$id" ($category): the matched span covers mustCover, and mustCover does not survive in the residue', (entry) => {
    const matches = findSpecialCategoryEntities(entry.examplePositive);
    const match = matches.find((m) => m.entity_group === entry.category);
    expect(match, `no ${entry.category} match found for "${entry.id}"`).toBeDefined();

    const span = entry.examplePositive.slice(match.start, match.end);
    expect(span, `span "${span}" does not contain mustCover "${entry.mustCover}"`).toContain(entry.mustCover);

    const residue = entry.examplePositive.slice(0, match.start) + entry.examplePositive.slice(match.end);
    expect(residue, `mustCover "${entry.mustCover}" leaked into the residue outside the matched span`).not.toContain(entry.mustCover);
  });
});

describe('special-category-lexicon.json — internal consistency', () => {
  it('has at least one entry', () => {
    expect(specialCategoryLexicon.entries.length).toBeGreaterThan(0);
  });

  it('every entry has the required fields', () => {
    for (const entry of specialCategoryLexicon.entries) {
      expect(typeof entry.id, `missing id`).toBe('string');
      expect(typeof entry.category, `"${entry.id}" missing category`).toBe('string');
      expect(typeof entry.pattern, `"${entry.id}" missing pattern`).toBe('string');
      expect(typeof entry.examplePositive, `"${entry.id}" missing examplePositive`).toBe('string');
      expect(typeof entry.exampleNegative, `"${entry.id}" missing exampleNegative`).toBe('string');
      expect(typeof entry.mustCover, `"${entry.id}" missing mustCover`).toBe('string');
      expect(entry.mustCover.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = specialCategoryLexicon.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every pattern compiles as a valid regex', () => {
    for (const entry of specialCategoryLexicon.entries) {
      expect(() => new RegExp(`(?<![\\p{L}])(?:${entry.pattern})(?![\\p{L}])`, 'giu'), `"${entry.id}" pattern failed to compile`).not.toThrow();
    }
  });

  // Every category this file emits for must actually be wired into
  // ENTITY_SOURCES with 'lexicon' as an allowed source, or sourceFilterStep
  // silently discards every candidate (RECALL-B-NOTES.md lesson from B4-lite).
  it('every category used here is one of the seven art. 9-10 types B3 targets', () => {
    const known = new Set([
      'CRIMINAL_OFFENCE_DATA', 'HEALTH_DATA', 'TRADE_UNION_MEMBERSHIP',
      'RELIGION_OR_BELIEF', 'POLITICAL_OPINION', 'SEXUAL_ORIENTATION', 'ETHNIC_ORIGIN',
    ]);
    for (const entry of specialCategoryLexicon.entries) {
      expect(known.has(entry.category), `"${entry.id}" uses unexpected category "${entry.category}"`).toBe(true);
    }
  });
});

describe('findSpecialCategoryEntities — boundary safety (real corpus near-misses, CRIMINAL_OFFENCE_DATA)', () => {
  it('does not match "skazan" as a substring of "wskazano"/"wskazanej" (adw_12/adw_28)', () => {
    expect(findSpecialCategoryEntities('W umowie wskazano rachunek bankowy do zapłaty.')).toEqual([]);
    expect(findSpecialCategoryEntities('Kwota nigdy nie udzielona w kwocie wskazanej w pozwie.')).toEqual([]);
  });

  it('requires "w sprawie karnej": a bare civil-judgment citation does not match (adw_32)', () => {
    const text = 'Analogiczne stanowisko zajęto w wyroku z dnia 14 maja 2021 r. (V CSKP 12/21).';
    expect(findSpecialCategoryEntities(text)).toEqual([]);
  });

  it('DOES match "niekarany" as CRIMINAL_OFFENCE_DATA (adw_30) — a deliberate, spec-mandated detection', () => {
    // RECALL-90-DESIGN.md §2.3 pkt 1: "oświadczenie o niekaralności to też
    // dana art. 10". adw_30's ground truth does not currently annotate this
    // token (RECALL-B3-NOTES.md documents the gap) — per §3.5 pkt 2, a
    // GT<->pattern divergence is a signal to fix the pattern, never the GT,
    // and the pattern here is correct per spec; this is a corpus gap, not a
    // bug in this module.
    const text = 'Stawił się oskarżony Jan Kowalski, lat 40, żonaty, dwoje dzieci, niekarany.';
    const matches = findSpecialCategoryEntities(text);
    const crime = matches.filter((m) => m.entity_group === 'CRIMINAL_OFFENCE_DATA');
    expect(crime).toHaveLength(1);
    expect(text.slice(crime[0].start, crime[0].end)).toBe('niekarany');
  });
});

describe('findSpecialCategoryEntities — adw_38_kategorie_szczegolne golden regression', () => {
  // EVAL-RECALL-AUDIT.md leaks #2, #11, #30 all come from this document.
  // Read straight from test-data/adversarial so this can never drift from
  // the actual corpus fixture (mirrors lexicon.test.js's adw_34 golden test).
  // At this commit (criminal category only) only leak #2 is closed; #11
  // (HEALTH_DATA) and #30 (TRADE_UNION_MEMBERSHIP) are closed in later
  // commits in this branch, and this test grows with them.
  const text = normalizeEol(readFileSync(
    join(REPO_ROOT, 'test-data/adversarial/adw_38_kategorie_szczegolne.txt'),
    'utf8',
  ));
  const matches = findSpecialCategoryEntities(text);

  function coveredBy(start, end) {
    return matches.some((m) => m.start <= start && m.end >= end);
  }

  it('leak #2 (CRIMINAL_OFFENCE_DATA "skazany prawomocnym wyrokiem za przywłaszczenie mienia") is fully covered', () => {
    // Ground truth span [237, 291) — matched exactly.
    expect(coveredBy(237, 291)).toBe(true);
    const m = matches.find((e) => e.entity_group === 'CRIMINAL_OFFENCE_DATA');
    expect(m).toMatchObject({ start: 237, end: 291 });
  });
});

describe('findSpecialCategoryEntities — trap documents produce zero matches', () => {
  // RECALL-90-DESIGN.md B3 acceptance criterion: "zero nowych FP na
  // pułapkach adw_32/33/34". Read straight from the corpus fixtures.
  it.each([
    'adw_32_pulapki_prawne.txt',
    'adw_33_pulapki_nazwy.txt',
    'adw_34_role_generyczne.txt',
  ])('%s produces zero special-category matches', (filename) => {
    const text = normalizeEol(readFileSync(join(REPO_ROOT, 'test-data/adversarial', filename), 'utf8'));
    expect(findSpecialCategoryEntities(text)).toEqual([]);
  });
});

describe('findSpecialCategoryEntities — dedup interaction with model spans', () => {
  it('our wide anchor+complement span wins over a narrower same-type model candidate nested at the same start', () => {
    const text = 'Pozwany był uprzednio skazany prawomocnym wyrokiem za przywłaszczenie mienia.';
    const wide = 'skazany prawomocnym wyrokiem za przywłaszczenie mienia';
    const narrow = 'przywłaszczenie mienia';
    const lexiconSpan = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'CRIMINAL_OFFENCE_DATA');
    expect(text.slice(lexiconSpan.start, lexiconSpan.end)).toBe(wide);

    const narrowStart = text.indexOf(narrow);
    const modelSpan = { entity_group: 'CRIMINAL_OFFENCE_DATA', start: narrowStart, end: narrowStart + narrow.length, score: 0.9, source: 'polish-fp16' };

    const result = deduplicateEntities([modelSpan, lexiconSpan], text);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].start, result[0].end)).toBe(wide);
  });

  it('no true regex (score 1.0) source is ever accidentally shadowed by a special-category lexicon match', () => {
    const text = 'Sygnatura I C 1445/25, pozwany skazany za oszustwo.';
    const regexSpan = { entity_group: 'DOCUMENT_REFERENCE', start: 11, end: 22, score: 1.0, source: 'regex' };
    const lexiconSpan = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'CRIMINAL_OFFENCE_DATA');
    const result = deduplicateEntities([regexSpan, lexiconSpan], text);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.source === 'regex')).toEqual(regexSpan);
  });
});

describe('findSpecialCategoryEntities — span extension mechanics', () => {
  it('stops at the nearest comma', () => {
    const text = 'Pozwany był skazany za oszustwo, mimo apelacji.';
    const m = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'CRIMINAL_OFFENCE_DATA');
    expect(text.slice(m.start, m.end)).toBe('skazany za oszustwo');
  });

  it('leaves the span as just the anchor when immediately followed by a terminator (no complement to extend into)', () => {
    const text = 'Oskarżony, lat 30, niekarany.';
    const m = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'CRIMINAL_OFFENCE_DATA');
    expect(text.slice(m.start, m.end)).toBe('niekarany');
  });

  it('returns entities sorted by start offset', () => {
    const text = 'Skazany za oszustwo. Ukarany za wykroczenie drogowe.';
    const matches = findSpecialCategoryEntities(text);
    const starts = matches.map((m) => m.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
