import { anonymizeText } from '../../anonymizer.js';

export function tokenizeStep(ctx) {
  const { anonymized, legend } = anonymizeText(ctx.text, ctx.entities);
  return {
    ...ctx,
    anonymized,
    legend,
    debug: [...ctx.debug, {
      step: 'tokenize',
      phase: 'postprocess',
      out: { tokenCount: Object.keys(legend).length },
    }],
  };
}
