import { mergeAdjacentEntities } from '../../anonymizer.js';

export function mergeStep(ctx) {
  const merged = mergeAdjacentEntities(ctx.entities, ctx.text);
  return { ...ctx, entities: merged };
}
