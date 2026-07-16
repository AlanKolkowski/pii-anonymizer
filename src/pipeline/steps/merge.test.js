import { describe, it, expect, vi } from 'vitest';
import { mergeStep } from './merge.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      POSTAL_ADDRESS: { mergeWithFollowing: ['LOCATION'] },
      LOCATION: { mergeWithAdjacent: [] },
      PERSON_NAME: { mergeWithAdjacent: [] },
      ORGANIZATION_NAME: { mergeWithAdjacent: ['LOCATION'] },
    };
    return map[type] || { mergeWithAdjacent: [] };
  },
}));

describe('mergeStep', () => {
  it('merges same-type adjacent entities with short gap', () => {
    const text = 'ul. Warszawska 5, Kraków';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 16, score: 0.9, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 18, end: 24, score: 0.8, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(24);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
  });

  it('merges LOCATION after POSTAL_ADDRESS via mergeWithFollowing', () => {
    const text = 'ul. Warszawska 5, Kraków';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 16, score: 0.9, source: 'polish-q8' },
      { entity_group: 'LOCATION', start: 18, end: 24, score: 0.8, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].end).toBe(24);
  });

  it('does not merge LOCATION before POSTAL_ADDRESS via mergeWithFollowing', () => {
    const text = 'Kraków, ul. Warszawska';
    const result = mergeStep(ctx(text, [
      { entity_group: 'LOCATION', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 8, end: 22, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
    expect(result.entities.map(e => e.entity_group)).toEqual(['LOCATION', 'POSTAL_ADDRESS']);
  });

  it('keeps mergeWithAdjacent symmetric for legacy adjacency rules', () => {
    const text = 'Kraków, ACME';
    const result = mergeStep(ctx(text, [
      { entity_group: 'LOCATION', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'ORGANIZATION_NAME', start: 8, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('ORGANIZATION_NAME');
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(12);
  });

  it('does not merge cross-type pairs where neither lists the other', () => {
    const text = 'Kraków Kowalski';
    const result = mergeStep(ctx(text, [
      { entity_group: 'LOCATION', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'PERSON_NAME', start: 7, end: 15, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('does not merge when gap exceeds 3 chars', () => {
    const text = 'Kraków  ---  Warszawa';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 13, end: 21, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('does not merge when gap contains non-whitespace/comma characters', () => {
    const text = 'Kraków a Warszawa';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 9, end: 17, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('unions sources as an array when the two entities have different origins', () => {
    const text = 'ul. Marszałkowska 47/12, 00-648 Warszawa';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 23, score: 0.85, source: 'multilang-q8' },
      { entity_group: 'LOCATION', start: 25, end: 40, score: 0.90, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].source).toEqual(['multilang-q8', 'polish-q8']);
  });

  it('keeps a single source (not an array) when both entities share it', () => {
    const text = 'ul. Marszałkowska 47/12, 00-648 Warszawa';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 23, score: 0.85, source: 'polish-q8' },
      { entity_group: 'LOCATION', start: 25, end: 40, score: 0.90, source: 'polish-q8' },
    ]));
    expect(result.entities[0].source).toBe('polish-q8');
  });
});

// ST-2 H-1 extended to merging (ST-5): with a tierOf resolver, only pairs of
// the same effective tier merge; forceTier survives a same-tier merge.
describe('mergeStep tier awareness', () => {
  const ctx = (text, entities) => ({ text, segments: [], entities, anonymized: '', legend: {}, debug: [] });
  const tierOf = (e) => e.forceTier ?? (e.entity_group === 'DOCUMENT_REFERENCE' ? 'pass' : 'mask');

  it('does not merge same-type neighbors of different effective tiers', () => {
    const text = 'I C 1552/23, III CZP 6/21';
    const result = mergeStep(ctx(text, [
      { entity_group: 'DOCUMENT_REFERENCE', start: 0, end: 11, score: 1.0, source: 'case-allowlist', forceTier: 'mask' },
      { entity_group: 'DOCUMENT_REFERENCE', start: 13, end: 25, score: 1.0, source: 'regex' },
    ]), tierOf);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].forceTier).toBe('mask');
    expect(result.entities[1].forceTier).toBeUndefined();
  });

  it('preserves forceTier when same-tier duplicates of one span merge', () => {
    const text = 'I C 1552/23 w aktach';
    const result = mergeStep(ctx(text, [
      { entity_group: 'DOCUMENT_REFERENCE', start: 0, end: 11, score: 1.0, source: 'case-allowlist', forceTier: 'mask' },
      { entity_group: 'DOCUMENT_REFERENCE', start: 0, end: 11, score: 1.0, source: 'case-allowlist', forceTier: 'mask' },
    ]), tierOf);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].forceTier).toBe('mask');
  });

  it('without tierOf behaves exactly as before (single-tier callers)', () => {
    const text = 'I C 1552/23, III CZP 6/21';
    const result = mergeStep(ctx(text, [
      { entity_group: 'DOCUMENT_REFERENCE', start: 0, end: 11, score: 1.0, source: 'regex' },
      { entity_group: 'DOCUMENT_REFERENCE', start: 13, end: 25, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
  });
});
