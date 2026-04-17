import { sourcesToArray } from '../sources.js';

export function createSourceFilterStep({ enabledEntities, entitySources }) {
  const enabled = new Set(enabledEntities);

  return function sourceFilterStep(ctx) {
    const filtered = ctx.entities.filter((entity) => {
      if (!enabled.has(entity.entity_group)) return false;
      const authoritative = entitySources[entity.entity_group];
      if (!authoritative || authoritative.length === 0) return false;
      const auth = new Set(authoritative);
      const entitySourceList = sourcesToArray(entity.source);
      if (entitySourceList.length === 0) return false;
      return entitySourceList.some((s) => auth.has(s));
    });
    return { ...ctx, entities: filtered };
  };
}
