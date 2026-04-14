import { filterOversizedEntities } from '../../anonymizer.js';

export function filterStep(ctx) {
  const filtered = filterOversizedEntities(ctx.entities);
  return { ...ctx, entities: filtered };
}
