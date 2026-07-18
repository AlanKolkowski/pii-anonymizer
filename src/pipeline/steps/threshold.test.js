import { describe, it, expect, vi } from 'vitest';
import { createThresholdStep } from './threshold.js';

const thresholdStep = createThresholdStep();

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      // 'case-folded' mirrors the real B2 exception (entity-rules.js) so the
      // MF-1 tests below can prove the floor stays out of its way.
      PERSON_NAME: { threshold: 0.5, thresholdBySource: { 'case-folded': 0.8 } },
      PERSON_ROLE_OR_TITLE: { threshold: 0.6, thresholdBySource: { 'polish-q8': 0.75 } },
      // review-tier (type-tiers.js TYPE_TIERS, unmocked/real in this file) —
      // used by the MF-1 tests to prove the floor never touches review.
      PERSON_ATTRIBUTE: { threshold: 0.6, thresholdBySource: {} },
    };
    return map[type] || { threshold: 0, thresholdBySource: {} };
  },
  // Every test below that exercises the floor passes maskFloorOverride
  // explicitly (createThresholdStep's third argument) — this mocked export
  // only satisfies the default-parameter reference for calls that omit it
  // (e.g. the bare createThresholdStep() below), mirroring the real
  // entity-rules.js starting value.
  MASK_FLOOR: null,
}));

describe('thresholdStep', () => {
  it('drops entities with score below per-type threshold', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.49, source: 'multilang-q8' },
      { entity_group: 'PERSON_NAME', start: 6, end: 10, score: 0.51, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.51);
  });

  it('accepts score equal to threshold (>=)', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.5, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('applies per-source threshold when entity.source matches', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.7, source: 'polish-q8' },
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 6, end: 10, score: 0.7, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].source).toBe('multilang-q8');
  });

  it('falls back to per-type threshold for sources not in thresholdBySource', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.59, source: 'regex' },
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 6, end: 10, score: 0.6, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.6);
  });

  it('falls back to per-type threshold when entity.source is an array', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.6, source: ['polish-q8', 'multilang-q8'] },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('keeps everything for types with default threshold 0', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'EMAIL_ADDRESS', start: 0, end: 5, score: 0.01, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
  });
});

describe('createThresholdStep overrides', () => {
  it('replaces the configured per-type threshold when an override is given', () => {
    const step = createThresholdStep({ PERSON_NAME: 0.3 });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.35, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('leaves types without an override on the configured threshold', () => {
    const step = createThresholdStep({ PERSON_NAME: 0.3 });
    const result = step(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.59, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('still lets a per-source threshold win over the override', () => {
    const step = createThresholdStep({ PERSON_ROLE_OR_TITLE: 0.1 });
    const result = step(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.7, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });
});

// MF-1 (MASK-FLOOR-DESIGN.md §2.2/§2.3/§2.4): tier-aware floor for the
// `mask` tier's per-type thresholds. `tierOpts` is the third-position
// argument here (overrides, tierOpts, maskFloorOverride) — the same
// {allMask, tierOverrides} object createPostprocessSteps threads into
// dedup/backfill via bindTierOf (default.js), no second configuration
// channel. `maskFloorOverride` defaults to entity-rules.js's real
// MASK_FLOOR (null today) when omitted — every test below passes it
// explicitly so it never depends on that default.
describe('createThresholdStep — MF-1 mask floor', () => {
  it('RED baseline: with the floor off (MASK_FLOOR=null) a below-threshold mask candidate is dropped, exactly like today', () => {
    const step = createThresholdStep({}, { allMask: false }, null);
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.45, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('2.3.1: allMask:false + MASK_FLOOR=0.4 rescues a mask-tier PERSON_NAME at 0.45 (below the 0.5 base threshold)', () => {
    const step = createThresholdStep({}, { allMask: false }, 0.4);
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.45, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('2.3.1: the identical score with MASK_FLOOR=null is dropped (the floor is the only thing that changed)', () => {
    const step = createThresholdStep({}, { allMask: false }, null);
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.45, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('2.3.1: a review-tier PERSON_ATTRIBUTE at the same score is NOT rescued — the floor only ever touches the mask tier', () => {
    const step = createThresholdStep({}, { allMask: false }, 0.4);
    const result = step(ctx([
      { entity_group: 'PERSON_ATTRIBUTE', start: 0, end: 5, score: 0.45, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('2.3.1: a case-folded PERSON_NAME candidate at the same score is NOT rescued — source thresholds are outside the floor\'s reach (§2.2 pkt 3)', () => {
    const step = createThresholdStep({}, { allMask: false }, 0.4);
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.45, source: 'case-folded' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('2.3.2: allMask:true reproduces today\'s output byte-for-byte no matter the MASK_FLOOR value', () => {
    for (const floor of [null, 0.4, 0.6, 1]) {
      const step = createThresholdStep({}, { allMask: true }, floor);
      const result = step(ctx([
        { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.45, source: 'multilang-q8' },
      ]));
      expect(result.entities, `floor=${floor}`).toHaveLength(0);
    }
  });

  it('2.3.3: forceTier "mask" below the type\'s own threshold but above the floor survives', () => {
    const step = createThresholdStep({}, { allMask: false }, 0.4);
    const result = step(ctx([
      { entity_group: 'PERSON_ATTRIBUTE', start: 0, end: 5, score: 0.45, source: 'multilang-q8', forceTier: 'mask' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('2.3.3: tierOverrides demoting PERSON_NAME to "pass" keeps the floor from applying', () => {
    const step = createThresholdStep({}, { allMask: false, tierOverrides: { PERSON_NAME: 'pass' } }, 0.4);
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.45, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  // 2.3.4: no fuzzing dependency in this repo (package.json has none) — a
  // deterministic combinatorial sweep stands in for the property test.
  // Claim: prógEfektywny(floor) <= prógEfektywny(null) for every entity and
  // config, observable as survival monotonicity — anything that survives
  // WITHOUT a floor must also survive WITH one (a floor only ever lowers
  // the bar, never raises it).
  it('2.3.4 (property): a floor never raises the effective threshold, for every score/type/source/tierOpts combination', () => {
    const scores = [0, 0.2, 0.35, 0.4, 0.45, 0.49, 0.5, 0.55, 0.6, 0.8, 1];
    const types = ['PERSON_NAME', 'PERSON_ATTRIBUTE', 'PERSON_ROLE_OR_TITLE', 'UNKNOWN_FUTURE_TYPE'];
    const sources = ['multilang-q8', 'case-folded', undefined, ['a', 'b']];
    const tierOptsGrid = [
      { allMask: true },
      { allMask: false },
      { allMask: false, tierOverrides: { PERSON_NAME: 'pass' } },
    ];
    const floors = [null, 0.3, 0.4, 0.6, 1];
    let checked = 0;

    for (const score of scores) {
      for (const entity_group of types) {
        for (const source of sources) {
          for (const tierOpts of tierOptsGrid) {
            const entity = { entity_group, start: 0, end: 5, score, source };
            const withoutFloor = createThresholdStep({}, tierOpts, null)(ctx([entity])).entities.length === 1;
            for (const floor of floors) {
              checked += 1;
              const withFloor = createThresholdStep({}, tierOpts, floor)(ctx([entity])).entities.length === 1;
              if (withoutFloor) {
                expect(withFloor, `regressed: entity=${JSON.stringify(entity)} tierOpts=${JSON.stringify(tierOpts)} floor=${floor}`).toBe(true);
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500); // sanity: the grid actually ran
  });
});
