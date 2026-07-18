import { describe, it, expect } from 'vitest';
import { rulesFor, ENTITY_RULES, DEFAULT_RULE, MASK_FLOOR } from './entity-rules.js';
import { TYPE_TIERS } from './type-tiers.js';

describe('rulesFor', () => {
  it('returns DEFAULT_RULE for unknown types', () => {
    const rules = rulesFor('NOT_A_REAL_TYPE');
    expect(rules).toEqual(DEFAULT_RULE);
  });

  it('merges entity overrides onto DEFAULT_RULE', () => {
    const rules = rulesFor('PERSON_ROLE_OR_TITLE');
    expect(rules.threshold).toBe(0.9);
    expect(rules.blocklist).toEqual(['Pan', 'Pani', 'Nadawca']);
    expect(rules.blocklistPatterns.length).toBeGreaterThan(0);
    expect(rules.snap).toBe(true);
    expect(rules.trimTrailingPunctuation).toBe(true);
  });

  it('defaults blocklistPatterns to empty array for types without overrides', () => {
    expect(rulesFor('EMAIL_ADDRESS').blocklistPatterns).toEqual([]);
  });

  it('preserves DEFAULT_RULE.maxLength = null for unconfigured types', () => {
    expect(rulesFor('EMAIL_ADDRESS').maxLength).toBeNull();
  });

  it('returns a fresh object (callers may not mutate defaults)', () => {
    const a = rulesFor('PERSON_NAME');
    a.maxLength = 999;
    const b = rulesFor('PERSON_NAME');
    expect(b.maxLength).toBe(50);
  });
});

// MF-1 (MASK-FLOOR-DESIGN.md §2.2 pkt 2, §2.4, R-MF-4): config-consistency
// check for the mask-floor mechanism's single knob.
describe('MASK_FLOOR (MF-1)', () => {
  it('starts disabled (null) — this commit ships the mechanism, not a value; GATE-MF\'s measurement sets the real number', () => {
    expect(MASK_FLOOR).toBeNull();
  });

  it('domain: null (disabled) or a number in (0, 1]', () => {
    if (MASK_FLOOR === null) return;
    expect(typeof MASK_FLOOR).toBe('number');
    expect(MASK_FLOOR).toBeGreaterThan(0);
    expect(MASK_FLOOR).toBeLessThanOrEqual(1);
  });

  // R-MF-4 (documenting, not blocking — MASK-FLOOR-DESIGN.md §8): a floor at
  // or above every mask-tier type's own base threshold would be a silent
  // no-op. This test never fails on its own account (a genuinely no-op
  // value chosen deliberately by GATE-MF is still a valid, if pointless,
  // config) — it prints a warning so the condition is never silent.
  it('(informational) warns if MASK_FLOOR would be a silent no-op for every mask-tier type', () => {
    const maskTypeThresholds = Object.keys(TYPE_TIERS)
      .filter((type) => TYPE_TIERS[type] === 'mask')
      .map((type) => rulesFor(type).threshold)
      .filter((t) => t > 0);
    const lowestMaskThreshold = Math.min(...maskTypeThresholds);

    if (MASK_FLOOR !== null && MASK_FLOOR >= lowestMaskThreshold) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mask-floor] MASK_FLOOR=${MASK_FLOOR} is >= the lowest mask-tier base ` +
        `threshold (${lowestMaskThreshold}) — every mask-tier type's own ` +
        'threshold already sits at or below the floor, so it is a silent ' +
        'no-op (R-MF-4). Re-check the GATE-MF sweep result before shipping this value.',
      );
    }
    // Sanity that the computed reference itself is meaningful (not NaN/0
    // from an empty filter — a real assertion, not a decoy).
    expect(lowestMaskThreshold).toBeGreaterThan(0);
  });
});
