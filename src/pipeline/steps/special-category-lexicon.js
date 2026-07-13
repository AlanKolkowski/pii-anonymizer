import { findSpecialCategoryEntities } from '../special-category-lexicon.js';

export function createSpecialCategoryLexiconStep(active) {
  return function specialCategoryLexiconStep(ctx) {
    if (!active) return ctx;
    const entities = findSpecialCategoryEntities(ctx.text);
    return { ...ctx, entities: [...ctx.entities, ...entities] };
  };
}
