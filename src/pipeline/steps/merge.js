import { mergeAdjacentEntities } from '../../anonymizer.js';

export function mergeStep(ctx) {
  const merged = mergeAdjacentEntities(ctx.entities, ctx.text);
  return {
    ...ctx,
    entities: merged,
    debug: [...ctx.debug, {
      step: 'merge',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: merged.length },
    }],
  };
}
