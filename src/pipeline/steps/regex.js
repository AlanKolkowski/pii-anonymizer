import { findRegexEntities } from '../../anonymizer.js';

export function regexStep(ctx) {
  const regexEntities = findRegexEntities(ctx.text);
  const combined = [...ctx.entities, ...regexEntities];
  return { ...ctx, entities: combined };
}
