import { deduplicateEntities } from '../../anonymizer.js';

export function dedupStep(ctx, tierOf) {
  const deduped = deduplicateEntities(ctx.entities, ctx.text, tierOf);
  return { ...ctx, entities: deduped };
}
