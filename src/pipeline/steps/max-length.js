import { rulesFor } from '../configs/entity-rules.js';
import { weightFor } from '../configs/type-weights.js';

// Oversized candidates are ambiguous signal (the model may have over-extended
// into surrounding context), so weight ≥ 3 types over-mask rather than risk a
// bare leak (EVAL-RECALL-AUDIT §8 A5: a PERSON_NAME at score 1.00 was dropped
// in full because it exceeded maxLength by 18 characters). Lower-weight types
// keep the original drop behavior, where a garbage over-long span is more
// likely than a genuine secrecy risk.
// Exported so the tier-safety lint (configs/tier-safety.js, consumed by
// tier-safety.test.js) tracks the real threshold instead of a stale copy —
// export only, the value and every use below are unchanged.
export const OVERSIZE_WEIGHT_THRESHOLD = 3;

export function maxLengthStep(ctx) {
  const entities = ctx.entities.flatMap((e) => {
    const max = rulesFor(e.entity_group).maxLength;
    if (max == null || (e.end - e.start) <= max) return [e];
    if (weightFor(e.entity_group) >= OVERSIZE_WEIGHT_THRESHOLD) {
      return [{ ...e, oversized: true }];
    }
    return [];
  });
  return { ...ctx, entities };
}
