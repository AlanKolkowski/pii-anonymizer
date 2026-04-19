import { describe, it, expect, vi } from 'vitest';
import { snapStep } from './snap.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { snap: true },
      FINANCIAL_AMOUNT: { snap: false },
    };
    return map[type] || { snap: true };
  },
}));

describe('snapStep', () => {
  it('snaps entities of types with snap=true to word boundaries', () => {
    const text = 'Kowalski mieszka tu.';
    const result = snapStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 2, end: 6, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(8);
  });

  it('leaves entities with snap=false untouched', () => {
    const text = '1000 zł';
    const result = snapStep(ctx(text, [
      { entity_group: 'FINANCIAL_AMOUNT', start: 1, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities[0].start).toBe(1);
    expect(result.entities[0].end).toBe(3);
  });
});
