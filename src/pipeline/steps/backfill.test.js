import { describe, it, expect, vi } from 'vitest';
import { backfillOccurrencesStep } from './backfill.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { backfill: true },
      ORGANIZATION_NAME: { backfill: false },
    };
    return map[type] || { backfill: true };
  },
}));

describe('backfillOccurrencesStep', () => {
  it('backfills additional occurrences of a type that opts in', () => {
    const text = 'Kowalski spotkał Kowalski w parku.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 8, score: 0.9, source: 'polish-q8' },
    ]));
    const names = result.entities.filter((e) => e.entity_group === 'PERSON_NAME');
    expect(names.length).toBe(2);
    expect(names[1].start).toBe(17);
    expect(names[1].end).toBe(25);
  });

  it('does not backfill occurrences for types where backfill=false', () => {
    const text = 'Acme Corp paid Acme Corp again.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'ORGANIZATION_NAME', start: 0, end: 9, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
  });
});
