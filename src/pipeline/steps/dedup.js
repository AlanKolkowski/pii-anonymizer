import { deduplicateEntities } from '../../anonymizer.js';

export function dedupStep(ctx) {
  const deduped = deduplicateEntities(ctx.entities);
  return {
    ...ctx,
    entities: deduped,
    debug: [...ctx.debug, {
      step: 'dedup',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: deduped.length },
    }],
  };
}
