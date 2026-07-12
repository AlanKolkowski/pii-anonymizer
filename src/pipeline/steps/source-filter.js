import { sourcesToArray } from '../sources.js';
import { weightFor } from '../configs/type-weights.js';

// A8 (EVAL-RECALL-AUDIT §8): dropping on a source technicality is too costly
// for a high-weight type — a candidate from a non-authoritative source that
// still scored this high is not noise. It passes through flagged instead of
// being rejected outright; dedup arbitrates any resulting overlap with an
// authoritative candidate the normal way (score/span tie-break).
const SAFETY_NET_WEIGHT_THRESHOLD = 4;
const SAFETY_NET_SCORE_THRESHOLD = 0.9;

export function createSourceFilterStep({ enabledEntities, entitySources }) {
  const enabled = new Set(enabledEntities);

  return function sourceFilterStep(ctx) {
    const filtered = [];
    for (const entity of ctx.entities) {
      if (!enabled.has(entity.entity_group)) continue;
      const authoritative = entitySources[entity.entity_group];
      if (!authoritative || authoritative.length === 0) continue;
      const auth = new Set(authoritative);
      const entitySourceList = sourcesToArray(entity.source);
      if (entitySourceList.length === 0) continue;

      if (entitySourceList.some((s) => auth.has(s))) {
        filtered.push(entity);
        continue;
      }

      if (weightFor(entity.entity_group) >= SAFETY_NET_WEIGHT_THRESHOLD && entity.score >= SAFETY_NET_SCORE_THRESHOLD) {
        filtered.push({ ...entity, unauthoritativeSource: true });
      }
    }
    return { ...ctx, entities: filtered };
  };
}
