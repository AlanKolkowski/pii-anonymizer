import { rulesFor } from '../configs/entity-rules.js';

export function thresholdStep(ctx) {
  const filtered = ctx.entities.filter((e) => {
    const rules = rulesFor(e.entity_group);
    const sourceThreshold =
      typeof e.source === 'string' ? rules.thresholdBySource[e.source] : undefined;
    const threshold = sourceThreshold ?? rules.threshold;
    return e.score >= threshold;
  });
  return { ...ctx, entities: filtered };
}
