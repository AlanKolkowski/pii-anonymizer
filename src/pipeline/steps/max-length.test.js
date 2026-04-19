import { describe, it, expect, vi } from 'vitest';
import { maxLengthStep } from './max-length.js';

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { maxLength: 50 },
      LOCATION: { maxLength: 100 },
    };
    return map[type] || { maxLength: null };
  },
}));

describe('maxLengthStep', () => {
  it('drops entities exceeding maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 60, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('keeps entities at or below maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 50, score: 0.9, source: 'polish-q8' },
      { entity_group: 'PERSON_NAME', start: 60, end: 70, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('keeps all entities when type has no maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'EMAIL_ADDRESS', start: 0, end: 5000, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
  });
});
