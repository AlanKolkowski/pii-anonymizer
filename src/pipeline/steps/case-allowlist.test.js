import { createCaseAllowlistStep, CASE_ALLOWLIST_SOURCE } from './case-allowlist.js';

function ctxFor(text) {
  return { text, segments: [], entities: [], anonymized: '', legend: {}, debug: [] };
}

describe('createCaseAllowlistStep', () => {
  it('is a hard no-op with an empty or blank allowlist (§5.3 pkt 4)', () => {
    const ctx = ctxFor('sygn. akt I C 1552/23');
    expect(createCaseAllowlistStep([])(ctx)).toBe(ctx);
    expect(createCaseAllowlistStep(undefined)(ctx)).toBe(ctx);
    expect(createCaseAllowlistStep(['', '   '])(ctx)).toBe(ctx);
  });

  it('emits DOCUMENT_REFERENCE with source case-allowlist, score 1.0 and forceTier mask', () => {
    const text = 'sygn. akt I C 1552/23 oraz wyrok III CZP 6/21';
    const out = createCaseAllowlistStep(['I C 1552/23'])(ctxFor(text));
    expect(out.entities).toEqual([{
      entity_group: 'DOCUMENT_REFERENCE',
      start: text.indexOf('I C 1552/23'),
      end: text.indexOf('I C 1552/23') + 'I C 1552/23'.length,
      score: 1.0,
      source: CASE_ALLOWLIST_SOURCE,
      forceTier: 'mask',
    }]);
  });

  it('appends to existing entities without touching them', () => {
    const text = 'Jan Kowalski, sygn. I C 1552/23';
    const existing = { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, source: 'x' };
    const out = createCaseAllowlistStep(['I C 1552/23'])({ ...ctxFor(text), entities: [existing] });
    expect(out.entities[0]).toBe(existing);
    expect(out.entities).toHaveLength(2);
  });

  it('returns ctx unchanged when the allowlist matches nothing', () => {
    const ctx = ctxFor('sygn. akt II C 999/24');
    expect(createCaseAllowlistStep(['I C 1552/23'])(ctx)).toBe(ctx);
  });
});
