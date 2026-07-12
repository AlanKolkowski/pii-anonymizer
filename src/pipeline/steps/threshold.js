import { rulesFor } from '../configs/entity-rules.js';

// `overrides` (entity_group -> threshold) replaces the configured per-type
// threshold while leaving thresholdBySource untouched; used by
// scripts/measure-thresholds.mjs (A7) to sweep candidate thresholds without
// forking entity-rules.js.
export function createThresholdStep(overrides = {}) {
  return function thresholdStep(ctx) {
    const filtered = ctx.entities.filter((e) => {
      const rules = rulesFor(e.entity_group);
      const sourceThreshold =
        typeof e.source === 'string' ? rules.thresholdBySource[e.source] : undefined;
      const baseThreshold = overrides[e.entity_group] ?? rules.threshold;
      const threshold = sourceThreshold ?? baseThreshold;
      return e.score >= threshold;
    });
    return { ...ctx, entities: filtered };
  };
}
