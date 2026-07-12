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
  // PERSON_NAME is weight 4 (see type-weights.js) — over-masking is
  // preferred over a bare leak (EVAL-RECALL-AUDIT §8 A5: "Sebastian
  // Grabowski", score 1.00, dropped in full for exceeding maxLength by 18
  // chars).
  it('flags oversized entities of weight>=3 types instead of dropping them', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 60, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ start: 0, end: 60, oversized: true });
  });

  // LOCATION is weight 2 — an over-long span here is more likely a garbage
  // over-extension than a secrecy risk, so the original drop behavior holds.
  it('drops oversized entities of weight<3 types', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'LOCATION', start: 0, end: 150, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('keeps entities at or below maxLength, without flagging them', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 50, score: 0.9, source: 'polish-q8' },
      { entity_group: 'PERSON_NAME', start: 60, end: 70, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].oversized).toBeUndefined();
    expect(result.entities[1].oversized).toBeUndefined();
  });

  it('keeps all entities when type has no maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'EMAIL_ADDRESS', start: 0, end: 5000, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
  });
});
