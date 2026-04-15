import { describe, it, expect } from 'vitest';
import { overlapRatio, matchEntities } from './matching.js';

describe('overlapRatio', () => {
  it('returns 0 for non-overlapping spans', () => {
    expect(overlapRatio({ start: 0, end: 5 }, { start: 10, end: 15 })).toBe(0);
  });

  it('returns 1 for identical spans', () => {
    expect(overlapRatio({ start: 0, end: 10 }, { start: 0, end: 10 })).toBe(1);
  });

  it('returns correct ratio for partial overlap', () => {
    // overlap = 5-3 = 2, union = 10-0 = 10
    const ratio = overlapRatio({ start: 0, end: 5 }, { start: 3, end: 10 });
    expect(ratio).toBeCloseTo(0.2);
  });
});

describe('matchEntities', () => {
  it('matches entities with sufficient overlap and same type', () => {
    const expected = [{ entity_group: 'PERSON_NAME', start: 0, end: 10 }];
    const predicted = [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9 }];
    const { matched, missed, spurious } = matchEntities(expected, predicted);
    expect(matched).toHaveLength(1);
    expect(missed).toHaveLength(0);
    expect(spurious).toHaveLength(0);
  });

  it('classifies unmatched expected as missed', () => {
    const expected = [{ entity_group: 'PERSON_NAME', start: 0, end: 10 }];
    const predicted = [];
    const { matched, missed, spurious } = matchEntities(expected, predicted);
    expect(matched).toHaveLength(0);
    expect(missed).toHaveLength(1);
  });

  it('classifies unmatched predicted as spurious', () => {
    const expected = [];
    const predicted = [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9 }];
    const { matched, missed, spurious } = matchEntities(expected, predicted);
    expect(matched).toHaveLength(0);
    expect(spurious).toHaveLength(1);
  });

  it('detects type mismatch for overlapping entities with different types', () => {
    const expected = [{ entity_group: 'PERSON_NAME', start: 0, end: 10 }];
    const predicted = [{ entity_group: 'LOCATION', start: 0, end: 10, score: 0.9 }];
    const { matched, missed, spurious, typeMismatched } = matchEntities(expected, predicted);
    expect(matched).toHaveLength(0);
    expect(missed).toHaveLength(0);
    expect(spurious).toHaveLength(0);
    expect(typeMismatched).toHaveLength(1);
    expect(typeMismatched[0].expected.entity_group).toBe('PERSON_NAME');
    expect(typeMismatched[0].predicted.entity_group).toBe('LOCATION');
  });

  it('does not detect type mismatch for non-overlapping entities with different types', () => {
    const expected = [{ entity_group: 'PERSON_NAME', start: 0, end: 10 }];
    const predicted = [{ entity_group: 'LOCATION', start: 50, end: 60, score: 0.9 }];
    const { matched, missed, spurious, typeMismatched } = matchEntities(expected, predicted);
    expect(matched).toHaveLength(0);
    expect(missed).toHaveLength(1);
    expect(spurious).toHaveLength(1);
    expect(typeMismatched).toHaveLength(0);
  });
});
