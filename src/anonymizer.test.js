import { describe, it, expect } from 'vitest';
import { buildTokenMap, anonymizeText, deanonymizeText } from './anonymizer.js';

describe('buildTokenMap', () => {
  it('assigns indexed tokens per entity type', () => {
    const text = 'Jan Kowalski and Anna Nowak';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 17, end: 27, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[PERSON_NAME_2]': 'Anna Nowak',
    });
  });

  it('reuses token when same value repeats', () => {
    const text = 'Jan Kowalski called Jan Kowalski';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 20, end: 32, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
    });
  });

  it('handles multiple entity types independently', () => {
    const text = 'Jan Kowalski, email jan@test.com';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'EMAIL_ADDRESS', start: 20, end: 32, score: 0.99 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[EMAIL_ADDRESS_1]': 'jan@test.com',
    });
  });

  it('returns empty legend for no entities', () => {
    const { legend } = buildTokenMap([], 'no PII');
    expect(legend).toEqual({});
  });
});

describe('anonymizeText', () => {
  it('replaces entities with indexed tokens', () => {
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'ORGANIZATION_NAME', start: 22, end: 34, score: 0.95 },
    ];
    const { anonymized, legend } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]');
    expect(legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
    expect(legend['[ORGANIZATION_NAME_1]']).toBe('Example Corp');
  });

  it('uses same token for duplicate entity values', () => {
    const text = 'Jan Kowalski called Jan Kowalski';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 20, end: 32, score: 0.97 },
    ];
    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] called [PERSON_NAME_1]');
  });

  it('handles entities not sorted by position', () => {
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'ORGANIZATION_NAME', start: 22, end: 34, score: 0.95 },
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
    ];
    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]');
  });

  it('returns unchanged text when no entities', () => {
    const { anonymized, legend } = anonymizeText('No PII here', []);
    expect(anonymized).toBe('No PII here');
    expect(legend).toEqual({});
  });
});

describe('deanonymizeText', () => {
  it('replaces tokens with original values', () => {
    const text = '[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]';
    const legend = {
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[ORGANIZATION_NAME_1]': 'Example Corp',
    };
    expect(deanonymizeText(text, legend)).toBe('Jan Kowalski works at Example Corp');
  });

  it('replaces multiple occurrences of same token', () => {
    const text = '[PERSON_NAME_1] called [PERSON_NAME_1]';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    expect(deanonymizeText(text, legend)).toBe('Jan Kowalski called Jan Kowalski');
  });

  it('leaves text unchanged when no tokens match', () => {
    expect(deanonymizeText('no tokens', { '[X_1]': 'val' })).toBe('no tokens');
  });

  it('handles empty legend', () => {
    expect(deanonymizeText('some text', {})).toBe('some text');
  });
});
