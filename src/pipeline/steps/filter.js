import { filterOversizedEntities } from '../../anonymizer.js';

export function filterStep(ctx) {
  const filtered = filterOversizedEntities(ctx.entities);
  return {
    ...ctx,
    entities: filtered,
    debug: [...ctx.debug, {
      step: 'filter',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: filtered.length },
    }],
  };
}
