import { describe, it, expect } from 'vitest';
import { computeSegmentMetrics, filterByTypes, resolveScoringFilter } from './score.js';
import { allEntityTypes } from '../pipeline/configs/entity-sources.js';

describe('computeSegmentMetrics', () => {
  it('returns P=R=F1=1 for identical segmentations', () => {
    const segs = [
      { start: 0, end: 10, text: 'one' },
      { start: 10, end: 20, text: 'two' },
    ];
    const m = computeSegmentMetrics(segs, segs);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.tp).toBe(2);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
    expect(m.tpPartial).toBe(0);
  });

  it('counts missing expected as FN', () => {
    const expected = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const predicted = [
      { start: 0, end: 10, text: 'a' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(1);
    expect(m.fn).toBe(1);
    expect(m.fp).toBe(0);
  });

  it('counts extra predicted as FP', () => {
    const expected = [
      { start: 0, end: 10, text: 'a' },
    ];
    const predicted = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(1);
    expect(m.fp).toBe(1);
    expect(m.fn).toBe(0);
  });

  it('counts a shifted boundary as partial (FP+FN, tpPartial=1)', () => {
    // Same coverage, different boundaries.
    const expected = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const predicted = [
      { start: 0, end: 12, text: 'a+' },
      { start: 12, end: 20, text: '-b' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(0);
    expect(m.tpPartial).toBe(2);
    expect(m.fp).toBe(2);
    expect(m.fn).toBe(2);
  });

  it('returns zeroes for empty inputs', () => {
    const m = computeSegmentMetrics([], []);
    expect(m.tp).toBe(0);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });
});

describe('filterByTypes', () => {
  const entities = [
    { entity_group: 'PERSON_NAME', start: 0, end: 5 },
    { entity_group: 'EMAIL_ADDRESS', start: 6, end: 20 },
    { entity_group: 'PERSON_NAME', start: 21, end: 30 },
    { entity_group: 'POSTAL_ADDRESS', start: 31, end: 60 },
  ];

  it('keeps only entities whose type is in the set', () => {
    const filtered = filterByTypes(entities, new Set(['PERSON_NAME']));
    expect(filtered).toHaveLength(2);
    expect(filtered.every(e => e.entity_group === 'PERSON_NAME')).toBe(true);
  });

  it('returns empty array when no types match', () => {
    expect(filterByTypes(entities, new Set(['PHONE_NUMBER']))).toEqual([]);
  });

  it('returns empty when set is empty', () => {
    expect(filterByTypes(entities, new Set())).toEqual([]);
  });

  it('preserves entity order', () => {
    const filtered = filterByTypes(entities, new Set(['PERSON_NAME', 'POSTAL_ADDRESS']));
    expect(filtered.map(e => e.start)).toEqual([0, 21, 31]);
  });
});

describe('resolveScoringFilter', () => {
  it('uses run.enabledEntities when no override given', () => {
    const set = resolveScoringFilter({
      runEnabledEntities: ['PERSON_NAME', 'EMAIL_ADDRESS'],
      overrideEntities: null,
    });
    expect(set).toEqual(new Set(['PERSON_NAME', 'EMAIL_ADDRESS']));
  });

  it('falls back to all entity types when run.enabledEntities is missing (older runs)', () => {
    const set = resolveScoringFilter({
      runEnabledEntities: undefined,
      overrideEntities: null,
    });
    expect(set.size).toBe(allEntityTypes().length);
    for (const t of allEntityTypes()) expect(set.has(t)).toBe(true);
  });

  it('falls back to all entity types when run.enabledEntities is empty array', () => {
    const set = resolveScoringFilter({
      runEnabledEntities: [],
      overrideEntities: null,
    });
    expect(set.size).toBe(allEntityTypes().length);
  });

  it('applies override when it is a strict subset of the run', () => {
    const set = resolveScoringFilter({
      runEnabledEntities: ['PERSON_NAME', 'EMAIL_ADDRESS', 'PHONE_NUMBER'],
      overrideEntities: ['PERSON_NAME'],
    });
    expect(set).toEqual(new Set(['PERSON_NAME']));
  });

  it('applies override when it equals the run', () => {
    const set = resolveScoringFilter({
      runEnabledEntities: ['PERSON_NAME', 'EMAIL_ADDRESS'],
      overrideEntities: ['EMAIL_ADDRESS', 'PERSON_NAME'],
    });
    expect(set).toEqual(new Set(['PERSON_NAME', 'EMAIL_ADDRESS']));
  });

  it('throws when override contains a type not in the run', () => {
    expect(() => resolveScoringFilter({
      runEnabledEntities: ['PERSON_NAME'],
      overrideEntities: ['PERSON_NAME', 'POSTAL_ADDRESS'],
    })).toThrow(/POSTAL_ADDRESS/);
  });

  it('treats empty override as no override (uses run.enabledEntities)', () => {
    const set = resolveScoringFilter({
      runEnabledEntities: ['PERSON_NAME'],
      overrideEntities: [],
    });
    expect(set).toEqual(new Set(['PERSON_NAME']));
  });
});
