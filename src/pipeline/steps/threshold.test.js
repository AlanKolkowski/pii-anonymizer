import { describe, it, expect, vi } from 'vitest';
import { thresholdStep } from './threshold.js';

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { threshold: 0.5, thresholdBySource: {} },
      PERSON_ROLE_OR_TITLE: { threshold: 0.6, thresholdBySource: { 'polish-q8': 0.75 } },
    };
    return map[type] || { threshold: 0, thresholdBySource: {} };
  },
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
