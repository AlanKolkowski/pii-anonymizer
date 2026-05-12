const MONEY_AMOUNT_RE = /\b\d{1,3}(?:[\s\u00a0]\d{3})*,\d{2}\s?zł/g;

function bestMoneyMatch(value) {
  const matches = [...value.matchAll(MONEY_AMOUNT_RE)];
  if (matches.length === 0) return null;
  return matches.reduce((best, match) => (
    match[0].length > best[0].length ? match : best
  ));
}

export function refineFinancialAmountStep(ctx) {
  const { text, entities } = ctx;
  if (!entities || entities.length === 0) return ctx;

  const refined = entities.map((entity) => {
    if (entity.entity_group !== 'FINANCIAL_AMOUNT') return entity;
    if (entity.source === 'regex') return entity;

    const value = text.slice(entity.start, entity.end);
    const match = bestMoneyMatch(value);
    if (!match) return entity;

    const start = entity.start + match.index;
    const end = start + match[0].length;
    if (start === entity.start && end === entity.end) return entity;

    return {
      ...entity,
      start,
      end,
      word: typeof entity.word === 'string' ? match[0] : entity.word,
    };
  });

  return { ...ctx, entities: refined };
}
