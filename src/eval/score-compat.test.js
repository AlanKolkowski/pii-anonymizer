import { scoreComparability } from './score-compat.js';

// ST-8 (SCOPE-TIERS-DESIGN.md §8.1 pkt 4 / §8.2): eval:compare must refuse
// to diff score files that are not the same measurement.

describe('scoreComparability', () => {
  const tiered = { scoringVersion: 'tiers/1', tiersConfig: { PERSON_NAME: 'mask' } };

  it('same version and tiersConfig → comparable', () => {
    const twin = { scoringVersion: 'tiers/1', tiersConfig: { PERSON_NAME: 'mask' } };
    expect(scoreComparability(tiered, twin)).toEqual({ comparable: true, reasons: [] });
  });

  it('a pre-pivot file (no scoringVersion) against a tiered one → refuse with the old-format message', () => {
    const legacy = { overall: { f1: 0.9 } };
    const result = scoreComparability(legacy, tiered);
    expect(result.comparable).toBe(false);
    expect(result.reasons.join('\n')).toContain('brak (format sprzed piwotu)');
  });

  it('different scoringVersion → refuse', () => {
    const other = { ...tiered, scoringVersion: 'tiers/2' };
    expect(scoreComparability(tiered, other).comparable).toBe(false);
  });

  it('different tiersConfig → refuse even on the same version', () => {
    const other = { scoringVersion: 'tiers/1', tiersConfig: { PERSON_NAME: 'review' } };
    const result = scoreComparability(tiered, other);
    expect(result.comparable).toBe(false);
    expect(result.reasons.join('\n')).toContain('tiersConfig');
  });

  it('tiersConfig comparison is key-order independent', () => {
    const a = { scoringVersion: 'tiers/1', tiersConfig: { A: 'mask', B: 'pass' } };
    const b = { scoringVersion: 'tiers/1', tiersConfig: { B: 'pass', A: 'mask' } };
    expect(scoreComparability(a, b).comparable).toBe(true);
  });

  it('two legacy files compare as before (both without a version)', () => {
    expect(scoreComparability({ overall: {} }, { overall: {} }).comparable).toBe(true);
  });

  it('missing score files never block the run-level comparison', () => {
    expect(scoreComparability(null, tiered).comparable).toBe(true);
  });
});
