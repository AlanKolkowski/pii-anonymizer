import { findRegexEntities } from '../../anonymizer.js';

export function createRegexStep(active) {
  return function regexStep(ctx) {
    if (!active) return ctx;
    const regexEntities = findRegexEntities(ctx.text);
    return { ...ctx, entities: [...ctx.entities, ...regexEntities] };
  };
}
