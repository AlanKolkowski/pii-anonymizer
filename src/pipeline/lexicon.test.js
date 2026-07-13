import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findLexiconEntities } from './lexicon.js';
import { deduplicateEntities } from '../anonymizer.js';
import roleLexicon from './data/role-lexicon.json' with { type: 'json' };

const REPO_ROOT = join(import.meta.dirname, '../..');

function onlyGroups(entities) {
  return [...new Set(entities.map((e) => e.entity_group))];
}

describe('findLexiconEntities — per-entry coverage (B4-lite)', () => {
  // RECALL-90-DESIGN.md §2.4: "test jednostkowy per wpis leksykonu (formy
  // fleksyjne i skróty)" — generated straight from the data file so every
  // entry is provably matched and every match is provably score 1.0 /
  // source 'lexicon' / the correct span, with no hand-copied duplication
  // of the list to drift out of sync with it.
  for (const entry of roleLexicon.entity) {
    const forms = [...entry.forms, ...(entry.abbreviations || [])];
    it.each(forms)(`"${entry.lemma}": matches form/abbreviation %s in a sentence`, (form) => {
      const text = `Pismo podpisał(a) ${form} w imieniu strony.`;
      const idx = text.indexOf(form);
      const matches = findLexiconEntities(text);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        entity_group: 'PERSON_ROLE_OR_TITLE',
        start: idx,
        end: idx + form.length,
        source: 'lexicon',
      });
      // Deliberately NOT 1.0 — see LEXICON_SCORE comment in lexicon.js
      // (dedup interaction with wider, correct model spans).
      expect(matches[0].score).toBeGreaterThanOrEqual(0.75);
      expect(matches[0].score).toBeLessThan(1.0);
      expect(text.slice(matches[0].start, matches[0].end)).toBe(form);
    });
  }

  it.each(roleLexicon.entity)('"$lemma": examplePositive text is matched', (entry) => {
    const matches = findLexiconEntities(entry.examplePositive);
    expect(matches.length, `expected at least one match in: ${entry.examplePositive}`).toBeGreaterThan(0);
  });

  it.each(roleLexicon.entity)('"$lemma": exampleNegative text produces no match for this lemma\'s forms', (entry) => {
    const matches = findLexiconEntities(entry.exampleNegative);
    const forms = new Set([...entry.forms, ...(entry.abbreviations || [])].map((f) => f.toLowerCase()));
    for (const m of matches) {
      const matchedText = entry.exampleNegative.slice(m.start, m.end).toLowerCase();
      expect(forms.has(matchedText), `exampleNegative for "${entry.lemma}" unexpectedly matched "${matchedText}"`).toBe(false);
    }
  });
});

describe('findLexiconEntities — boundary and overlap behavior', () => {
  it('does not match a lemma as a substring of an unrelated longer word (word-boundary safety)', () => {
    const text = 'Adwokatura jest samorządem zawodowym reprezentującym adwokatów.';
    const matches = findLexiconEntities(text);
    expect(matches).toEqual([]);
  });

  it('prefers the longer compound title over a nested bare lemma (longest-match-first)', () => {
    const text = 'Umowę podpisał dyrektor generalny spółki.';
    const matches = findLexiconEntities(text);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('dyrektor generalny');
  });

  it('still matches a bare lemma when no longer compound is present', () => {
    const text = 'Aneks podpisał dyrektor oddziału.';
    const matches = findLexiconEntities(text);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('dyrektor');
  });

  it('matches case-insensitively but preserves original casing in the span (ALL-CAPS header)', () => {
    const text = 'RADCA PRAWNY JAN KOWALSKI, pełnomocnik powoda';
    const matches = findLexiconEntities(text);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('RADCA PRAWNY');
  });

  it('matches a multi-word abbreviation written with internal spacing ("r. pr.")', () => {
    const text = 'Pismo sporządził r. pr. Jan Kowalski.';
    const matches = findLexiconEntities(text);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('r. pr.');
  });

  it('does not match role-procedural words at all (nonEntity list is not wired to emit)', () => {
    const text = 'Powód, pozwana, wnioskodawca i uczestnik stawili się na rozprawie.';
    expect(findLexiconEntities(text)).toEqual([]);
  });

  it('returns entities sorted by start offset', () => {
    const text = 'Umowę podpisali: adwokat Jan Kowalski oraz notariusz Anna Nowak.';
    const matches = findLexiconEntities(text);
    const starts = matches.map((m) => m.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe('findLexiconEntities — adw_34_role_generyczne golden negative test', () => {
  // RECALL-90-DESIGN.md §2.4: "adw_34 jako test negatywny w całości" — the
  // corpus's dedicated trap document, entirely generic procedural roles,
  // expected = []. Read straight from test-data/adversarial so this test
  // can never drift from the actual corpus fixture.
  const text = readFileSync(
    join(REPO_ROOT, 'test-data/adversarial/adw_34_role_generyczne.txt'),
    'utf8',
  );

  it('the fixture itself is non-trivial (sanity: contains every trap role word)', () => {
    for (const word of ['Powód', 'Pozwana', 'Biegły', 'przewodniczący', 'Komornik', 'wierzyciela', 'dłużnika', 'Pełnomocnik', 'wnioskodawczyni', 'uczestnik', 'kuratora', 'Zamawiający', 'wykonawcą', 'kredytobiorca', 'kredytodawcę']) {
      expect(text, `expected fixture to contain "${word}"`).toContain(word);
    }
  });

  it('produces zero PERSON_ROLE_OR_TITLE entities', () => {
    const matches = findLexiconEntities(text);
    expect(matches, `expected zero matches, got: ${JSON.stringify(matches.map((m) => text.slice(m.start, m.end)))}`).toEqual([]);
  });
});

describe('findLexiconEntities — dedup interaction with wider model spans (regression)', () => {
  // Measured regression on the synthetic corpus during B4-lite development:
  // multilang-fp32 already detects "Kierownik ds. Marketingu" / "Dyrektor HR"
  // / "apl. adw." in full. A bare-lemma lexicon match nested at the same
  // start ("Kierownik" / "Dyrektor" / "adw.") must NOT evict that wider,
  // correct span through deduplicateEntities — see LEXICON_SCORE in
  // lexicon.js. These reproduce the exact failure shape end-to-end through
  // the real dedup function, not just findLexiconEntities in isolation.
  it('a wider, high-confidence model span survives dedup against a nested bare-lemma lexicon match (same start)', () => {
    const text = 'Umowę podpisał Kierownik ds. Marketingu Jan Kowalski.';
    const wide = 'Kierownik ds. Marketingu';
    const narrow = 'Kierownik';
    const start = text.indexOf(wide);
    expect(start).toBe(text.indexOf(narrow)); // same start, by construction of the failure mode
    const modelSpan = { entity_group: 'PERSON_ROLE_OR_TITLE', start, end: start + wide.length, score: 0.9985, source: 'multilang-fp32' };
    const lexiconSpan = findLexiconEntities(text).find((e) => e.start === start);
    expect(text.slice(lexiconSpan.start, lexiconSpan.end)).toBe(narrow);

    const result = deduplicateEntities([modelSpan, lexiconSpan], text);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].start, result[0].end)).toBe(wide);
    expect(result[0].source).toBe('multilang-fp32');
  });

  it('a wider, lower-confidence model span still survives when within DEDUP_SCORE_EPSILON of the lexicon score', () => {
    const text = 'Reprezentowana przez: Prezesa Zarządu – Pana Nowaka.';
    const wide = 'Prezesa Zarządu – Pana';
    const narrow = 'Prezesa Zarządu';
    const start = text.indexOf(wide);
    expect(start).toBe(text.indexOf(narrow));
    const modelSpan = { entity_group: 'PERSON_ROLE_OR_TITLE', start, end: start + wide.length, score: 0.8787, source: 'multilang-fp32' };
    const lexiconSpan = findLexiconEntities(text).find((e) => e.start === start);
    expect(text.slice(lexiconSpan.start, lexiconSpan.end)).toBe(narrow);

    const result = deduplicateEntities([modelSpan, lexiconSpan], text);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].start, result[0].end)).toBe(wide);
  });

  it('the narrower lexicon match wins outright against a genuinely low-confidence, barely-above-threshold model guess', () => {
    // Below dedup's "close" window (diff > DEDUP_SCORE_EPSILON): a model
    // score this low is exactly the "over-extending into punctuation or
    // context" case the existing dedup comment already documents — trusting
    // the deterministic lexicon match here is correct, not a regression.
    const text = 'W dokumencie wskazano notariusza jako świadka podpisu.';
    const wide = 'notariusza jako świadka';
    const narrow = 'notariusza';
    const start = text.indexOf(wide);
    expect(start).toBe(text.indexOf(narrow));
    const modelSpan = { entity_group: 'PERSON_ROLE_OR_TITLE', start, end: start + wide.length, score: 0.76, source: 'multilang-fp32' };
    const lexiconSpan = findLexiconEntities(text).find((e) => e.start === start);
    expect(text.slice(lexiconSpan.start, lexiconSpan.end)).toBe(narrow);

    const result = deduplicateEntities([modelSpan, lexiconSpan], text);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('lexicon');
  });

  it('no true regex (score 1.0) source is ever accidentally shadowed by a lexicon match', () => {
    // Sanity: A1/A2/A4's score===1.0 "perfect tier" behavior in
    // deduplicateEntities must remain untouched by this module's score choice.
    const text = 'Sygnatura I C 1445/25, radca prawny.';
    const regexSpan = { entity_group: 'DOCUMENT_REFERENCE', start: 11, end: 22, score: 1.0, source: 'regex' };
    const result = deduplicateEntities([regexSpan], text);
    expect(result).toEqual([regexSpan]);
  });
});

describe('role-lexicon.json — internal consistency (disjointness)', () => {
  // RECALL-90-DESIGN.md §2.4 pkt 3: "wpis nie może być jednocześnie encją
  // i blocklistą (test spójności)". Runs against the real data file, not a
  // copy, so it fails the moment the file drifts out of consistency.
  const entityForms = new Set();
  for (const entry of roleLexicon.entity) {
    for (const f of [...entry.forms, ...(entry.abbreviations || [])]) {
      entityForms.add(f.toLowerCase());
    }
  }
  const nonEntityForms = new Set();
  for (const entry of roleLexicon.nonEntity) {
    for (const f of entry.forms) nonEntityForms.add(f.toLowerCase());
  }

  it('has at least one entity entry and one nonEntity entry', () => {
    expect(roleLexicon.entity.length).toBeGreaterThan(0);
    expect(roleLexicon.nonEntity.length).toBeGreaterThan(0);
  });

  it('no form/abbreviation is listed as both an entity trigger and a non-entity (blocklist) form', () => {
    const overlap = [...entityForms].filter((f) => nonEntityForms.has(f));
    expect(overlap).toEqual([]);
  });

  it('every entity entry has at least one form or abbreviation', () => {
    for (const entry of roleLexicon.entity) {
      const total = entry.forms.length + (entry.abbreviations || []).length;
      expect(total, `"${entry.lemma}" has no forms and no abbreviations`).toBeGreaterThan(0);
    }
  });

  it('every entity entry has a positive and a negative example', () => {
    for (const entry of roleLexicon.entity) {
      expect(typeof entry.examplePositive, `"${entry.lemma}" missing examplePositive`).toBe('string');
      expect(typeof entry.exampleNegative, `"${entry.lemma}" missing exampleNegative`).toBe('string');
      expect(entry.examplePositive.length).toBeGreaterThan(0);
      expect(entry.exampleNegative.length).toBeGreaterThan(0);
    }
  });

  it('every nonEntity entry has a reason', () => {
    for (const entry of roleLexicon.nonEntity) {
      expect(typeof entry.reason, `"${entry.lemma}" missing reason`).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate lemmas within the entity list', () => {
    const lemmas = roleLexicon.entity.map((e) => e.lemma);
    expect(new Set(lemmas).size).toBe(lemmas.length);
  });

  it('has no duplicate lemmas within the nonEntity list', () => {
    const lemmas = roleLexicon.nonEntity.map((e) => e.lemma);
    expect(new Set(lemmas).size).toBe(lemmas.length);
  });
});
