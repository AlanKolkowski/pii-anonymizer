import { snapToWordBoundaries } from '../../anonymizer.js';

export function snapStep(ctx) {
  const snapped = snapToWordBoundaries(ctx.entities, ctx.text);
  return { ...ctx, entities: snapped };
}
