import { unionSources } from '../sources.js';
import { rulesFor } from '../configs/entity-rules.js';

const MAX_GAP = 3;
const GAP_RE = /^[\s,\n]*$/;

function hasRule(rule, key, type) {
  return (rule[key] ?? []).includes(type);
}

function canMergePair(prev, curr) {
  if (prev.entity_group === curr.entity_group) return { host: prev.entity_group };
  const prevRule = rulesFor(prev.entity_group);
  const currRule = rulesFor(curr.entity_group);

  // Directional: the listed type must be after the rule owner in the text.
  if (hasRule(prevRule, 'mergeWithFollowing', curr.entity_group)) return { host: prev.entity_group };

  // Legacy symmetric adjacency rule.
  if (hasRule(prevRule, 'mergeWithAdjacent', curr.entity_group)) return { host: prev.entity_group };
  if (hasRule(currRule, 'mergeWithAdjacent', prev.entity_group)) return { host: curr.entity_group };
  return null;
}

// ST-2 H-1 (SCOPE-TIERS-DESIGN.md §3.2 pkt 3) applies to merging exactly as
// it does to dedup — merging is same-family arbitration of adjacent spans.
// The optional `tierOf` resolver ((entity) => 'mask'|'review'|'pass')
// restricts merging to pairs of the SAME effective tier: without the guard a
// pass-tier signature could swallow an adjacent forceTier-'mask' one (the
// masked span would come out visible), or a mask-tier address could silently
// consume a review-tier location that belongs in the W2 bucket. Omitted
// (single-tier callers) or under allMask every pair shares one tier and the
// behavior is byte-for-byte today's. Discovered during ST-5 (the design
// names dedup/backfill as H-1/H-2 carriers; merge is the same hazard).
export function mergeStep(ctx, tierOf) {
  const { text, entities } = ctx;
  if (entities.length <= 1) return ctx;

  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const result = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];

    const gap = text.slice(prev.end, curr.start);
    if (gap.length > MAX_GAP || !GAP_RE.test(gap)) {
      result.push(curr);
      continue;
    }

    if (tierOf && tierOf(prev) !== tierOf(curr)) {
      result.push(curr);
      continue;
    }

    const pair = canMergePair(prev, curr);
    if (!pair) {
      result.push(curr);
      continue;
    }

    const mergedSources = unionSources(prev.source, curr.source);
    // Both sides share one effective tier (guard above); carrying either
    // forceTier over keeps an allowlisted signature masked after it merges
    // with its own duplicate from another source.
    const forceTier = prev.forceTier ?? curr.forceTier;
    result[result.length - 1] = {
      entity_group: pair.host,
      start: prev.start,
      end: curr.end,
      score: Math.max(prev.score, curr.score),
      ...(mergedSources.length > 0 && {
        source: mergedSources.length === 1 ? mergedSources[0] : mergedSources,
      }),
      ...(forceTier && { forceTier }),
    };
  }

  return { ...ctx, entities: result };
}
