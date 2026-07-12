import { deduplicateEntities } from '../../anonymizer.js';

export function dedupStep(ctx) {
  const deduped = deduplicateEntities(ctx.entities, ctx.text);
  return { ...ctx, entities: deduped };
}
