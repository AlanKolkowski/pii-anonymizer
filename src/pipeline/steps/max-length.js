import { rulesFor } from '../configs/entity-rules.js';

export function maxLengthStep(ctx) {
  const filtered = ctx.entities.filter((e) => {
    const max = rulesFor(e.entity_group).maxLength;
    if (max == null) return true;
    return (e.end - e.start) <= max;
  });
  return { ...ctx, entities: filtered };
}
