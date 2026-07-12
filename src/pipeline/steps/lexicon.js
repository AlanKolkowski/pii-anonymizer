import { findLexiconEntities } from '../lexicon.js';

export function createLexiconStep(active) {
  return function lexiconStep(ctx) {
    if (!active) return ctx;
    const lexiconEntities = findLexiconEntities(ctx.text);
    return { ...ctx, entities: [...ctx.entities, ...lexiconEntities] };
  };
}
