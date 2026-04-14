import { snapToWordBoundaries } from '../../anonymizer.js';

export function snapStep(ctx) {
  const snapped = snapToWordBoundaries(ctx.entities, ctx.text);
  return {
    ...ctx,
    entities: snapped,
    debug: [...ctx.debug, {
      step: 'snap',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: snapped.length },
    }],
  };
}
