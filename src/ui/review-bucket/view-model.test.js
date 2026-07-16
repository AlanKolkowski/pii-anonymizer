import { buildReviewViewModel, contextAround } from './view-model.js';

const TEXT = 'Powód jest wdowiec. Zapłacił 500 zł tytułem zaliczki. Znów wdowiec.';

function candidate(value, entity_group, from = 0) {
  const start = TEXT.indexOf(value, from);
  return {
    entity_group, start, end: start + value.length, score: 0.9, source: 'ner',
    tier: 'review', valueKey: `${entity_group}::${value.toLocaleLowerCase('pl')}`,
  };
}

const CANDIDATES = [
  candidate('wdowiec', 'PERSON_ATTRIBUTE'),
  candidate('wdowiec', 'PERSON_ATTRIBUTE', 30),
  candidate('500 zł', 'FINANCIAL_AMOUNT'),
];

describe('buildReviewViewModel (ST-4 §4.2)', () => {
  it('groups by type, counts values vs occurrences, orders by weight descending', () => {
    const vm = buildReviewViewModel({
      text: TEXT,
      candidates: CANDIDATES,
      decisions: new Map(),
      entityLabels: { PERSON_ATTRIBUTE: 'Cechy osobowe', FINANCIAL_AMOUNT: 'Kwota' },
    });
    expect(vm.pendingCount).toBe(2); // values, not occurrences
    expect(vm.complete).toBe(false);
    // PERSON_ATTRIBUTE weight 3 == FINANCIAL_AMOUNT weight 3 → alphabetical;
    // the point pinned here: descending weight is the primary key.
    expect(vm.groups.map((g) => g.type)).toEqual(['PERSON_ATTRIBUTE', 'FINANCIAL_AMOUNT']);
    const attr = vm.groups[0];
    expect(attr.label).toBe('Cechy osobowe');
    expect(attr.valueCount).toBe(1);
    expect(attr.occurrenceCount).toBe(2);
    expect(attr.values[0].value).toBe('wdowiec');
    expect(attr.values[0].occurrenceCount).toBe(2);
    expect(attr.values[0].decision).toBeNull();
  });

  it('weights actually order sensitive types first', () => {
    const health = candidate('zaliczki', 'HEALTH_DATA'); // weight 5 beats 3
    const vm = buildReviewViewModel({
      text: TEXT, candidates: [...CANDIDATES, health], decisions: new Map(),
    });
    expect(vm.groups[0].type).toBe('HEALTH_DATA');
  });

  it('carries decisions and origins into rows and the pending count', () => {
    const decisions = new Map([
      ['PERSON_ATTRIBUTE::wdowiec', { decision: 'mask', origin: 'dictionary' }],
    ]);
    const vm = buildReviewViewModel({ text: TEXT, candidates: CANDIDATES, decisions });
    expect(vm.pendingCount).toBe(1);
    const attrRow = vm.groups.find((g) => g.type === 'PERSON_ATTRIBUTE').values[0];
    expect(attrRow.decision).toBe('mask');
    expect(attrRow.origin).toBe('dictionary');
  });

  it('complete when every value is decided', () => {
    const decisions = new Map([
      ['PERSON_ATTRIBUTE::wdowiec', { decision: 'mask', origin: 'user' }],
      ['FINANCIAL_AMOUNT::500 zł', { decision: 'skip', origin: 'bulk' }],
    ]);
    const vm = buildReviewViewModel({ text: TEXT, candidates: CANDIDATES, decisions });
    expect(vm.complete).toBe(true);
    expect(vm.pendingCount).toBe(0);
  });
});

describe('contextAround', () => {
  it('cuts a sentence-ish window with the value in the middle', () => {
    const start = TEXT.indexOf('500 zł');
    const ctx = contextAround(TEXT, start, start + '500 zł'.length);
    expect(ctx.value).toBe('500 zł');
    expect(ctx.before).toContain('Zapłacił');
    expect(ctx.after).toContain('tytułem zaliczki.');
    expect(ctx.before).not.toContain('wdowiec');
  });

  it('caps runaway windows and marks the cut with an ellipsis', () => {
    const long = `${'a'.repeat(400)} WARTOŚĆ ${'b'.repeat(400)}`;
    const start = long.indexOf('WARTOŚĆ');
    const ctx = contextAround(long, start, start + 'WARTOŚĆ'.length);
    expect(ctx.before.length).toBeLessThan(200);
    expect(ctx.after.length).toBeLessThan(200);
    expect(ctx.before.startsWith('…')).toBe(true);
    expect(ctx.after.endsWith('…')).toBe(true);
  });
});
