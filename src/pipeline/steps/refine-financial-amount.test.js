import { describe, it, expect } from 'vitest';
import { refineFinancialAmountStep } from './refine-financial-amount.js';

function makeCtx(text, entities) {
  return { text, entities, segments: [], anonymized: '', legend: {} };
}

describe('refineFinancialAmountStep', () => {
  it('shrinks model FINANCIAL_AMOUNT spans to the clean money amount inside', () => {
    const text = 'nr WYL/2024/00912),\nwynosi 2 847,38 zł brutto.';
    const result = refineFinancialAmountStep(makeCtx(text, [
      { entity_group: 'FINANCIAL_AMOUNT', start: 18, end: 42, score: 0.99, source: 'multilang-q8', word: '),\nwynosi 2 847,38 zł' },
    ]));

    expect(result.entities[0]).toMatchObject({
      entity_group: 'FINANCIAL_AMOUNT',
      start: 27,
      end: 38,
      source: 'multilang-q8',
      word: '2 847,38 zł',
    });
  });

  it('leaves regex FINANCIAL_AMOUNT spans unchanged', () => {
    const text = 'wynosi 2 847,38 zł brutto';
    const result = refineFinancialAmountStep(makeCtx(text, [
      { entity_group: 'FINANCIAL_AMOUNT', start: 7, end: 18, score: 1, source: 'regex' },
    ]));

    expect(result.entities[0]).toMatchObject({ start: 7, end: 18, source: 'regex' });
  });

  it('leaves non-financial entities unchanged', () => {
    const text = 'nr WYL/2024/00912';
    const entity = { entity_group: 'DOCUMENT_REFERENCE', start: 3, end: 17, score: 0.9, source: 'polish-q8' };
    const result = refineFinancialAmountStep(makeCtx(text, [entity]));

    expect(result.entities[0]).toBe(entity);
  });
});
