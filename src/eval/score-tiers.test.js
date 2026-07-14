import { describe, it, expect } from 'vitest';
import { scoreReviewCoverage, basketNoise, scoreDocumentTiers, aggregateTiers } from './score-tiers.js';

describe('scoreReviewCoverage', () => {
  it('vacuously covers when there is nothing to cover (total=0 → coverage=1)', () => {
    const r = scoreReviewCoverage([], [], []);
    expect(r).toEqual({ total: 0, hits: 0, misses: [], coverage: 1 });
  });

  it('counts a fully-covered entity as a hit and reports its coverage', () => {
    const exp = { entity_group: 'LOCATION', start: 0, end: 6, text: 'Toruń.' };
    const r = scoreReviewCoverage([exp], [{ start: 0, end: 6 }], []);
    expect(r.total).toBe(1);
    expect(r.hits).toBe(1);
    expect(r.coverage).toBe(1);
  });

  it('counts an uncovered entity as a miss', () => {
    const exp = { entity_group: 'LOCATION', start: 0, end: 6, text: 'Toruń.' };
    const r = scoreReviewCoverage([exp], [], []);
    expect(r.hits).toBe(0);
    expect(r.misses).toEqual([exp]);
  });
});

describe('basketNoise', () => {
  it('counts a review candidate with no overlapping GT entity of any kind', () => {
    const noise = basketNoise(
      [{ entity_group: 'LOCATION', start: 40, end: 46 }],
      [{ entity_group: 'LOCATION', start: 0, end: 6 }],
    );
    expect(noise).toBe(1);
  });

  it('does not count a candidate that overlaps a GT entity, even of a different tier', () => {
    // Overlaps a mask-tier GT entity — a tier/type question, not "points at nothing".
    const noise = basketNoise(
      [{ entity_group: 'LOCATION', start: 0, end: 6 }],
      [{ entity_group: 'PERSON_NAME', start: 0, end: 6 }],
    );
    expect(noise).toBe(0);
  });
});

// Golden scoring (SCOPE-TIERS-DESIGN.md §6.5): a hand-built mini-corpus with
// known, hand-counted numbers in all three sections — proves the aggregate
// math without touching a real eval run.
describe('golden: W1/W2/W3 aggregate over a hand-built mini-corpus', () => {
  const docs = [
    {
      // mask-tier hit: exact-boundary PERSON_NAME match.
      name: 'golden_mask',
      expected: [{ entity_group: 'PERSON_NAME', start: 0, end: 4, text: 'Anna' }],
      predicted: [{ entity_group: 'PERSON_NAME', start: 0, end: 4, score: 0.9, source: 'test' }],
    },
    {
      // review-tier hit, plus one spurious review candidate elsewhere in
      // the document with no GT counterpart at all (the "szum kosza" case).
      name: 'golden_review',
      expected: [{ entity_group: 'LOCATION', start: 10, end: 16, text: 'Toruń.' }],
      predicted: [
        { entity_group: 'LOCATION', start: 10, end: 16, score: 0.7, source: 'test' },
        { entity_group: 'LOCATION', start: 40, end: 46, score: 0.6, source: 'test' },
      ],
    },
    {
      // pass-tier entity: dropped from metrics entirely, just counted.
      name: 'golden_pass',
      expected: [{ entity_group: 'ORGANIZATION_NAME', start: 0, end: 10, text: 'Sąd Okr. ' }],
      predicted: [],
    },
    {
      // both a W1 miss and a W2 miss — nothing detected at all.
      name: 'golden_misses',
      expected: [
        { entity_group: 'PERSON_NAME', start: 0, end: 5, text: 'Piotr' },
        { entity_group: 'HEALTH_DATA', start: 20, end: 30, text: 'depresja  ' },
      ],
      predicted: [],
    },
  ];

  const perDoc = docs.map(d => scoreDocumentTiers(d));
  const agg = aggregateTiers(perDoc);

  it('W1: TP=1 (golden_mask) FP=0 FN=1 (golden_misses) → P=1, R=0.5', () => {
    expect(agg.w1.overall.tp).toBe(1);
    expect(agg.w1.overall.fp).toBe(0);
    expect(agg.w1.overall.fn).toBe(1);
    expect(agg.w1.overall.precision).toBe(1);
    expect(agg.w1.overall.recall).toBe(0.5);
    expect(agg.w1.overall.f1).toBeCloseTo(2 / 3, 10);
  });

  it('W1 byType: only PERSON_NAME appears (LOCATION/HEALTH_DATA are not mask-tier)', () => {
    expect(Object.keys(agg.w1.overallByType)).toEqual(['PERSON_NAME']);
    expect(agg.w1.overallByType.PERSON_NAME).toMatchObject({ tp: 1, fp: 0, fn: 1 });
  });

  it('W2: 2 review GT entities (golden_review + golden_misses), 1 covered → 50%', () => {
    expect(agg.w2.total).toBe(2);
    expect(agg.w2.hits).toBe(1);
    expect(agg.w2.coverage).toBe(0.5);
  });

  it('W2 noise: 1 unmatched review candidate across 4 documents → avg 0.25/doc', () => {
    expect(agg.w2.noiseTotal).toBe(1);
    expect(agg.w2.avgNoisePerDoc).toBeCloseTo(0.25, 10);
  });

  it('W3: 1 pass-tier GT entity dropped (golden_pass), never scored', () => {
    expect(agg.w3.droppedTotal).toBe(1);
  });
});

// Required by §6.5 explicitly ("Dodatkowo test: encja review zamaskowana
// przez W1 liczona jako pokryta") — a review-tier GT entity fully covered
// only by a MASK-tier prediction (no review-tier prediction at all) must
// still count as a W2 hit. Hidden beats shown.
describe('golden: a review-tier GT entity masked by W1 counts as covered', () => {
  it('"wdowiec" (PERSON_ATTRIBUTE, review) hidden under a PERSON_NAME (mask) span is covered', () => {
    const doc = {
      name: 'golden_masked_review',
      expected: [{ entity_group: 'PERSON_ATTRIBUTE', start: 0, end: 7, text: 'wdowiec' }],
      predicted: [{ entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.99, source: 'test' }],
    };
    const scored = scoreDocumentTiers(doc);
    expect(scored.w2.total).toBe(1);
    expect(scored.w2.hits).toBe(1);
    expect(scored.w2.coverage).toBe(1);
  });
});

// Required by §6.5 ("test ekwiwalencji {FINANCIAL_AMOUNT, INCOME_COMPENSATION}
// dziedziczonej w W2"): W2 coverage has no type-match requirement at all
// (§6.2 pt 3), so any type equivalence from W1 (O-R90-3) is inherited for
// free — a FINANCIAL_AMOUNT GT entity is covered by an INCOME_COMPENSATION
// candidate at the same span with no special-casing required.
describe('golden: W2 coverage is type-agnostic (inherits W1 equivalence classes for free)', () => {
  it('FINANCIAL_AMOUNT GT entity is covered by an INCOME_COMPENSATION candidate', () => {
    const doc = {
      name: 'golden_equivalence',
      expected: [{ entity_group: 'FINANCIAL_AMOUNT', start: 0, end: 10, text: '1000 zł.  ' }],
      predicted: [{ entity_group: 'INCOME_COMPENSATION', start: 0, end: 10, score: 0.8, source: 'test' }],
    };
    const scored = scoreDocumentTiers(doc);
    expect(scored.w2.hits).toBe(1);
    expect(scored.w2.total).toBe(1);
  });
});
