import { rulesFor, MASK_FLOOR } from '../configs/entity-rules.js';
import { effectiveTier } from '../configs/type-tiers.js';

// `overrides` (entity_group -> threshold) replaces the configured per-type
// threshold while leaving thresholdBySource untouched; used by
// scripts/measure-thresholds.mjs (A7) to sweep candidate thresholds without
// forking entity-rules.js.
//
// `tierOpts` (MF-1, MASK-FLOOR-DESIGN.md §2.2): {allMask, tierOverrides},
// threaded from createPostprocessSteps the same way bindTierOf feeds
// dedup/backfill (default.js): no second configuration channel. Missing
// tierOpts.allMask defaults to true (same convention as
// createPostprocessSteps), so a caller unaware of tiers, the bare
// createThresholdStep() used by threshold.test.js and
// scripts/measure-thresholds.mjs's existing per-type sweep, stays
// byte-for-byte legacy.
//
// `maskFloorOverride` defaults to entity-rules.js's real MASK_FLOOR (null
// until GATE-MF sets it). It exists only so scripts/measure-thresholds.mjs
// can sweep the floor value offline without editing entity-rules.js
// (§2.2 pkt 4: "skrypt pomiarowy może sweepować oba wymiary niezależnie"):
// createPostprocessSteps (default.js) never passes a third argument, so the
// shipped pipeline always defers to the real constant.
export function createThresholdStep(overrides = {}, tierOpts = {}, maskFloorOverride = MASK_FLOOR) {
  // §2.2 pkt 2: floorActive needs BOTH independent switches, tiering on
  // (allMask:false) AND a configured floor (not null). Either one off means
  // the floor never touches an entity, regardless of tier.
  const allMask = tierOpts.allMask ?? true;
  const floorActive = !allMask && maskFloorOverride !== null;
  return function thresholdStep(ctx) {
    const filtered = ctx.entities.filter((e) => {
      const rules = rulesFor(e.entity_group);
      const sourceThreshold =
        typeof e.source === 'string' ? rules.thresholdBySource[e.source] : undefined;
      const baseThreshold = overrides[e.entity_group] ?? rules.threshold;
      let threshold = sourceThreshold ?? baseThreshold;
      // §2.2 pkt 3: a source-specific threshold (case-folded/despaced/
      // multilang-fp32) is a measured source-reliability bar, not tier
      // policy: the floor only ever touches the baseThreshold path, so
      // this fires only when sourceThreshold is undefined.
      if (floorActive && sourceThreshold === undefined && effectiveTier(e, tierOpts) === 'mask') {
        threshold = Math.min(threshold, maskFloorOverride);
      }
      return e.score >= threshold;
    });
    return { ...ctx, entities: filtered };
  };
}
