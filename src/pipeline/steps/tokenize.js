import { anonymizeText } from '../../anonymizer.js';

export function tokenizeStep(ctx) {
  const { anonymized, legend } = anonymizeText(ctx.text, ctx.entities);
  return { ...ctx, anonymized, legend };
}
