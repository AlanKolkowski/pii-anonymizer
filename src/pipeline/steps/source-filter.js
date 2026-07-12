import { sourcesToArray } from '../sources.js';
import { weightFor } from '../configs/type-weights.js';

// A8 (EVAL-RECALL-AUDIT §8): dropping on a source technicality is too costly
// for a high-weight type — a candidate from a non-authoritative source that
// still scored this high is not noise. It passes through flagged instead of
// being rejected outright; dedup arbitrates any resulting overlap with an
// authoritative candidate the normal way (score/span tie-break).
// Measured (synthetic corpus, run 2026-07-12T16-35-53): at 0.9 the net let
// through 15 polish-fp16 PERSON_NAME fragments (the exact name-fragmentation
// failure mode ENTITY_SOURCES already excludes polish-fp16 for), 5 of which
// landed as new false positives with zero change in leak count. Contract's
// own escape valve for this — raise to 0.95 — is only a partial fix (14/15
// of those fragments score >=0.95 too) but is leak-neutral either way and
// costs nothing on the adversarial corpus's "Sad" case (score 0.98). Left
// here rather than raised further: going past the contract's specified 0.95
// would be tightening beyond what was authorized for a residual precision
// cost, not a secrecy one — noted for B1 (full ensemble), which the recall
// plan already earmarks for exactly this case ("wchodzi tylko, jeżeli A8 nie
// wystarczy na inicjały i role").
const SAFETY_NET_WEIGHT_THRESHOLD = 4;
const SAFETY_NET_SCORE_THRESHOLD = 0.95;

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
