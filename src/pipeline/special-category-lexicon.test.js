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

describe('findSpecialCategoryEntities — boundary safety (real corpus near-misses, HEALTH_DATA)', () => {
  it('does not match "cierpi" as a substring of first-person "Cierpię" (pismo_03)', () => {
    expect(findSpecialCategoryEntities('Cierpię na następujące schorzenia, udokumentowane poniżej:')).toEqual([]);
  });

  it('requires "z powodu": "zwolnieniem lekarskim" alone does not match (adw_05)', () => {
    expect(findSpecialCategoryEntities('Sąd usprawiedliwił nieobecność zwolnieniem lekarskim.')).toEqual([]);
  });

  it('requires "z powodu": "zwolnienie od kosztów" (fee waiver) does not match (adw_25)', () => {
    expect(findSpecialCategoryEntities('Powód wniósł o zwolnienie od kosztów sądowych.')).toEqual([]);
  });

  it('requires the closed addiction-object list: generic "uzależniona od" (depends on) does not match', () => {
    expect(findSpecialCategoryEntities('Wysokość odszkodowania jest uzależniona od stopnia przyczynienia się poszkodowanego.')).toEqual([]);
  });

  it('requires the specific disability/incapacity qualifier: "orzeczenie o kosztach" does not match', () => {
    expect(findSpecialCategoryEntities('Sąd wydał orzeczenie o kosztach postępowania.')).toEqual([]);
  });
});

describe('findSpecialCategoryEntities — adw_38_kategorie_szczegolne golden regression', () => {
  // EVAL-RECALL-AUDIT.md leaks #2, #11, #30 all come from this document.
  // Read straight from test-data/adversarial so this can never drift from
  // the actual corpus fixture (mirrors lexicon.test.js's adw_34 golden test).
  // At this commit (criminal + health) #2 and #11 are closed; #30
  // (TRADE_UNION_MEMBERSHIP) is closed in a later commit, and this test
  // grows with it.
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

  it('leak #11 (HEALTH_DATA "epizodu depresyjnego", ground truth [192,212)) is fully covered by a wider span', () => {
    // Anchor "zwolnieniu z powodu" is not itself in ground truth (only the
    // disease name is) so this is a superset match, not an exact one —
    // still zero leak, since charCoverage (src/eval/analyze.js) is
    // type/boundary-agnostic: any predicted span union covering the GT
    // range counts as fully covered.
    expect(coveredBy(192, 212)).toBe(true);
  });

  it('also catches the first HEALTH_DATA instance exactly ("choruje na cukrzycę typu 2", ground truth [47,73))', () => {
    const m = matches.find((e) => e.entity_group === 'HEALTH_DATA' && e.start === 47);
    expect(m).toMatchObject({ start: 47, end: 73 });
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

  it('our wide HEALTH_DATA span wins over a narrower same-type model candidate nested at the same start', () => {
    const text = 'Powódka od 2019 r. choruje na cukrzycę typu 2 i pozostaje pod opieką poradni.';
    const wide = 'choruje na cukrzycę typu 2';
    const narrow = 'cukrzycę typu 2';
    const lexiconSpan = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'HEALTH_DATA');
    expect(text.slice(lexiconSpan.start, lexiconSpan.end)).toBe(wide);

    const narrowStart = text.indexOf(narrow);
    const modelSpan = { entity_group: 'HEALTH_DATA', start: narrowStart, end: narrowStart + narrow.length, score: 0.98, source: 'multilang-fp32' };

    const result = deduplicateEntities([modelSpan, lexiconSpan], text);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].start, result[0].end)).toBe(wide);
  });

  it('a genuinely wider, close-scoring model span still wins over ours (no "perfect tier" veto — mirrors B4-lite\'s LEXICON_SCORE reasoning)', () => {
    const text = 'Choruje na cukrzycę i nadciśnienie przewlekłe, co potwierdza dokumentacja.';
    const lexiconSpan = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'HEALTH_DATA');
    // Our complement stops at the coordinating conjunction "i" by design.
    expect(text.slice(lexiconSpan.start, lexiconSpan.end)).toBe('Choruje na cukrzycę');

    const wide = 'Choruje na cukrzycę i nadciśnienie przewlekłe';
    const modelSpan = { entity_group: 'HEALTH_DATA', start: 0, end: wide.length, score: 0.9, source: 'multilang-fp32' };

    const result = deduplicateEntities([modelSpan, lexiconSpan], text);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].start, result[0].end)).toBe(wide);
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

  it('stops at a standalone coordinating conjunction ("i") without consuming it', () => {
    const text = 'Choruje na astmę i nie może pracować w pełnym wymiarze.';
    const m = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'HEALTH_DATA');
    expect(text.slice(m.start, m.end)).toBe('Choruje na astmę');
  });

  it('does not treat a letter sequence merely containing a conjunction word as a stop (e.g. "Warszawie" contains no standalone "a")', () => {
    const text = 'Choruje na boreliozę rozpoznaną w klinice w Warszawie ostatniej zimy.';
    const m = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'HEALTH_DATA');
    // Stops at the sentence-ending period, not at any "a"/"w" inside a longer word.
    expect(text.slice(m.start, m.end)).toBe('Choruje na boreliozę rozpoznaną w klinice w Warszawie ostatniej zimy');
  });

  it('caps the complement at 60 characters past the anchor when no terminator appears sooner', () => {
    const complement = 'x'.repeat(80);
    const text = `Choruje na ${complement}.`;
    const m = findSpecialCategoryEntities(text).find((e) => e.entity_group === 'HEALTH_DATA');
    const spanText = text.slice(m.start, m.end);
    // Truncated well before the trailing period — the full 80-x complement
    // (plus its terminating period) never makes it into the span.
    expect(spanText).not.toContain(`${complement}.`);
    expect(spanText.length).toBeLessThan('Choruje na '.length + complement.length);
  });

  it('returns entities sorted by start offset', () => {
    const text = 'Choruje na astmę. Skazany za oszustwo. Ukarany za wykroczenie drogowe.';
    const matches = findSpecialCategoryEntities(text);
    const starts = matches.map((m) => m.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
