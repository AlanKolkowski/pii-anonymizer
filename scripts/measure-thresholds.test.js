// MF-2 (MASK-FLOOR-DESIGN.md §3.2): golden test on a hand-built, spreparowany
// mini-cache — three documents, one case each (recovers-leak / fragment /
// clean FP) — no models, no disk I/O, laptop-safe. Shape mirrors exactly
// what cache-ner-for-thresholds.mjs writes: { name, expected, nerCtx: {
// text, segments, entities } }.
import { describe, it, expect } from 'vitest';
import {
  sweep,
  metricsForType,
  classifyCandidate,
  leakRecovery,
  rescuedByFloor,
  isDroppedToday,
  sweepMaskFloor,
  scoreHistogram,
  MASK_FLOOR_GRID,
} from './measure-thresholds.mjs';

// PERSON_NAME's real base threshold is 0.5 (entity-rules.js) — every
// candidate below is scored 0.45 so it is unambiguously "dropped today"
// and unambiguously rescued by any floor >= 0.45 (e.g. the 0.4 grid
// point). source:'multilang-fp32' is PERSON_NAME's real authoritative
// source (entity-sources.js ENTITY_SOURCES.PERSON_NAME), so sourceFilterStep
// (part of the real postprocess chain exercised via sweepMaskFloor/
// scoreHistogram) keeps these candidates rather than silently dropping them
// for an unrelated reason.

// Doc 1 — "recovers-leak": one low-score candidate, nothing else detects
// this GT span at all — a full leak at baseline, closed by the floor.
const DOC1 = {
  name: 'doc1-recovers-leak',
  expected: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, text: 'Jan Kowalski' }],
  nerCtx: {
    text: 'Jan Kowalski przyszedl do sadu.',
    segments: [{ text: 'Jan Kowalski przyszedl do sadu.', offset: 0 }],
    entities: [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45, source: 'multilang-fp32' },
    ],
  },
};

// Doc 2 — "fragment": a wide, high-score candidate ALREADY covers the GT
// span at baseline (0.9 clears the 0.5 threshold today); a second, low-score
// candidate is a narrower sub-span of the SAME mention. The floor rescues
// the narrow one from the raw-candidate gate, but it doesn't close a fresh
// leak — the GT was never leaking.
const DOC2 = {
  name: 'doc2-fragment',
  expected: [{ entity_group: 'PERSON_NAME', start: 0, end: 10, text: 'Anna Nowak' }],
  nerCtx: {
    text: 'Anna Nowak przyszla do biura.',
    segments: [{ text: 'Anna Nowak przyszla do biura.', offset: 0 }],
    entities: [
      { entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9, source: 'multilang-fp32' },
      { entity_group: 'PERSON_NAME', start: 5, end: 10, score: 0.45, source: 'multilang-fp32' },
    ],
  },
};

// Doc 3 — "no-coverage": a low-score candidate with no ground truth at all
// (a spurious detection) — the floor would let through a clean FP.
const DOC3 = {
  name: 'doc3-no-coverage',
  expected: [],
  nerCtx: {
    text: 'Poniedzialek byl ciezki.',
    segments: [{ text: 'Poniedzialek byl ciezki.', offset: 0 }],
    entities: [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45, source: 'multilang-fp32' },
    ],
  },
};

const FIXTURE_CACHE = [DOC1, DOC2, DOC3];

describe('MF-2 pure helpers (unit-level, hand-built entity lists)', () => {
  describe('classifyCandidate', () => {
    it('recovers-leak: candidate overlaps a GT span with zero reference coverage', () => {
      const gt = [{ entity_group: 'PERSON_NAME', start: 0, end: 12 }];
      const candidate = { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45 };
      expect(classifyCandidate(candidate, gt, [])).toBe('recovers-leak');
    });

    it('fragment: candidate overlaps a GT span the reference already fully covers', () => {
      const gt = [{ entity_group: 'PERSON_NAME', start: 0, end: 10 }];
      const reference = [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9 }];
      const candidate = { entity_group: 'PERSON_NAME', start: 5, end: 10, score: 0.45 };
      expect(classifyCandidate(candidate, gt, reference)).toBe('fragment');
    });

    it('no-coverage: candidate overlaps no GT span of its type', () => {
      const candidate = { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45 };
      expect(classifyCandidate(candidate, [], [])).toBe('no-coverage');
    });

    it('is type-scoped: a same-position GT entity of a DIFFERENT type does not count as overlap', () => {
      const gt = [{ entity_group: 'LOCATION', start: 0, end: 12 }];
      const candidate = { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45 };
      expect(classifyCandidate(candidate, gt, [])).toBe('no-coverage');
    });
  });

  describe('leakRecovery', () => {
    it('counts a mask-tier, weight>=4 GT entity that goes from 0% to >0% coverage', () => {
      const gt = [{ entity_group: 'PERSON_NAME', start: 0, end: 12 }];
      const off = [];
      const floored = [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45 }];
      expect(leakRecovery(gt, off, floored)).toHaveLength(1);
    });

    it('does not count a GT entity already covered at baseline', () => {
      const gt = [{ entity_group: 'PERSON_NAME', start: 0, end: 10 }];
      const off = [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9 }];
      const floored = off; // unchanged
      expect(leakRecovery(gt, off, floored)).toHaveLength(0);
    });

    it('respects minWeight (PERSON_ROLE_OR_TITLE is weight 1 — never a "full leak" recovery in the weight>=4 sense)', () => {
      const gt = [{ entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5 }];
      const off = [];
      const floored = [{ entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.45 }];
      expect(leakRecovery(gt, off, floored, { minWeight: 4 })).toHaveLength(0);
    });

    it('ignores review-tier and pass-tier GT types entirely', () => {
      const gt = [{ entity_group: 'LOCATION', start: 0, end: 5 }]; // review tier
      const off = [];
      const floored = [{ entity_group: 'LOCATION', start: 0, end: 5, score: 0.9 }];
      expect(leakRecovery(gt, off, floored)).toHaveLength(0);
    });
  });

  describe('rescuedByFloor / isDroppedToday', () => {
    it('floor=null always rescues nothing (self-consistency)', () => {
      const raw = [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45, source: 'multilang-fp32' }];
      expect(rescuedByFloor(raw, null)).toEqual([]);
    });

    it('a candidate below the floor is still not rescued', () => {
      const raw = [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.2, source: 'multilang-fp32' }];
      expect(rescuedByFloor(raw, 0.4)).toEqual([]);
    });

    it('a candidate in [floor, threshold) is rescued', () => {
      const raw = [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.45, source: 'multilang-fp32' }];
      expect(rescuedByFloor(raw, 0.4)).toHaveLength(1);
    });

    it('isDroppedToday agrees with the real PERSON_NAME threshold (0.5)', () => {
      expect(isDroppedToday({ entity_group: 'PERSON_NAME', score: 0.45, source: 'multilang-fp32' })).toBe(true);
      expect(isDroppedToday({ entity_group: 'PERSON_NAME', score: 0.9, source: 'multilang-fp32' })).toBe(false);
    });
  });
});

describe('MF-2 golden: sweepMaskFloor / scoreHistogram on the 3-document fixture cache', () => {
  it('scoreHistogram: the 0.45 bin has exactly one candidate in each of the three buckets', async () => {
    const bins = await scoreHistogram(FIXTURE_CACHE, { enabledEntities: ['PERSON_NAME'] });
    expect(bins['0.45']).toEqual({ 'recovers-leak': 1, fragment: 1, 'no-coverage': 1 });
    // No other bin should exist — every fixture candidate scores exactly 0.45.
    expect(Object.keys(bins)).toEqual(['0.45']);
  });

  it('sweepMaskFloor: floor=null (off) is trivially all-zero — the self-consistency baseline', async () => {
    const [offRow] = await sweepMaskFloor(FIXTURE_CACHE, { enabledEntities: ['PERSON_NAME'], floors: [null] });
    expect(offRow).toMatchObject({ floor: null, leaksRecovered: 0, maskDelta: 0, byType: {} });
  });

  it('sweepMaskFloor: floor=0.4 recovers doc1\'s leak, leaves doc2\'s already-covered GT alone, and buckets all three cases correctly', async () => {
    const [row] = await sweepMaskFloor(FIXTURE_CACHE, { enabledEntities: ['PERSON_NAME'], floors: [0.4], minWeight: 4 });
    expect(row.leaksRecovered).toBe(1); // only doc1's GT was a full leak at baseline
    expect(row.byType.PERSON_NAME).toEqual({ 'recovers-leak': 1, fragment: 1, 'no-coverage': 1 });
    // doc1: 0 -> 1 mask (+1); doc2: dedup keeps only the wide candidate at
    // both floor=off and floor=0.4, so 1 -> 1 (+0); doc3: 0 -> 1 mask (+1).
    expect(row.maskDelta).toBe(2);
    const perDocByName = Object.fromEntries(row.perDoc.map((d) => [d.name, d]));
    expect(perDocByName['doc1-recovers-leak']).toMatchObject({ recovered: 1, maskDelta: 1 });
    expect(perDocByName['doc2-fragment']).toMatchObject({ recovered: 0, maskDelta: 0 });
    expect(perDocByName['doc3-no-coverage']).toMatchObject({ recovered: 0, maskDelta: 1 });
  });

  it('MASK_FLOOR_GRID (O-MF-1) matches the design\'s siatka: {off, 0.45, 0.40, 0.35, 0.30}', () => {
    expect(MASK_FLOOR_GRID).toEqual([null, 0.45, 0.40, 0.35, 0.30]);
  });

  it('sweeping the full O-MF-1 grid runs cleanly end to end (no exceptions, monotonic-shaped leaksRecovered)', async () => {
    const results = await sweepMaskFloor(FIXTURE_CACHE, { enabledEntities: ['PERSON_NAME'] });
    expect(results).toHaveLength(MASK_FLOOR_GRID.length);
    for (const row of results) {
      // Every grid point at or below 0.45 recovers doc1's leak; off (null)
      // and any floor below 0.45 (there are none in this grid) recover
      // nothing.
      expect(row.leaksRecovered).toBe(row.floor === null ? 0 : 1);
    }
  });
});

describe('MF-2 non-regression: the pre-existing per-type sweep() still works after the refactor', () => {
  it('sweep() reproduces the expected P/R swing across doc1\'s 0.45 candidate at thresholds 0.4 and 0.5', async () => {
    // sweep() is keyed by the two real corpus names; adversarial is left
    // empty on purpose (this fixture doesn't model it) — withRates()
    // reports null precision/recall for zero denominators, which is exactly
    // what an empty corpus should produce.
    const cache = { synthetic: [DOC1], adversarial: [] };
    const results = await sweep(cache, ['PERSON_NAME'], ['PERSON_NAME'], [0.4, 0.5]);

    const at04 = results.PERSON_NAME.find((r) => r.threshold === 0.4);
    expect(at04.synthetic).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });

    const at05 = results.PERSON_NAME.find((r) => r.threshold === 0.5);
    expect(at05.synthetic).toMatchObject({ tp: 0, fp: 0, fn: 1, recall: 0 });

    expect(results.PERSON_NAME.every((r) => r.adversarial.tp === 0 && r.adversarial.fp === 0 && r.adversarial.fn === 0)).toBe(true);
  });

  it('metricsForType still computes exact tp/fp/fn for a direct match', () => {
    const expected = [{ entity_group: 'PERSON_NAME', start: 0, end: 12 }];
    const predicted = [{ entity_group: 'PERSON_NAME', start: 0, end: 12 }];
    expect(metricsForType(expected, predicted, 'PERSON_NAME')).toEqual({ tp: 1, fp: 0, fn: 0 });
  });
});
