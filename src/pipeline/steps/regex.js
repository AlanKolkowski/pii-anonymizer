import { findRegexEntities } from '../../anonymizer.js';

export function regexStep(ctx) {
  const regexEntities = findRegexEntities(ctx.text);
  const combined = [...ctx.entities, ...regexEntities];
  return {
    ...ctx,
    entities: combined,
    debug: [...ctx.debug, {
      step: 'regex',
      phase: 'ner',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: combined.length, regexFound: regexEntities.length },
    }],
  };
}
