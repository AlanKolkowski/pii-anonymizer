import { rulesFor } from '../configs/entity-rules.js';
import { weightFor } from '../configs/type-weights.js';

// Oversized candidates are ambiguous signal (the model may have over-extended
// into surrounding context), so weight ≥ 3 types over-mask rather than risk a
// bare leak (EVAL-RECALL-AUDIT §8 A5: a PERSON_NAME at score 1.00 was dropped
// in full because it exceeded maxLength by 18 characters). Lower-weight types
// keep the original drop behavior, where a garbage over-long span is more
// likely than a genuine secrecy risk.
const OVERSIZE_WEIGHT_THRESHOLD = 3;

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
