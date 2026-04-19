import { describe, it, expect, vi } from 'vitest';
import { mergeStep } from './merge.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      POSTAL_ADDRESS: { mergeWithAdjacent: ['LOCATION'] },
      LOCATION: { mergeWithAdjacent: [] },
      PERSON_NAME: { mergeWithAdjacent: [] },
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

  it('merges LOCATION into adjacent POSTAL_ADDRESS via mergeWithAdjacent', () => {
    const text = 'ul. Warszawska 5, Kraków';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 16, score: 0.9, source: 'polish-q8' },
      { entity_group: 'LOCATION', start: 18, end: 24, score: 0.8, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].end).toBe(24);
  });

  it('merges POSTAL_ADDRESS into adjacent LOCATION (host = POSTAL_ADDRESS)', () => {
    const text = 'Kraków, ul. Warszawska';
    const result = mergeStep(ctx(text, [
      { entity_group: 'LOCATION', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 8, end: 22, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(22);
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
