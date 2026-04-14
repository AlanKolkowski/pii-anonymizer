import { deduplicateEntities } from '../../anonymizer.js';

export function dedupStep(ctx) {
  const deduped = deduplicateEntities(ctx.entities);
  return { ...ctx, entities: deduped };
}
