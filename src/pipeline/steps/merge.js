import { unionSources } from '../sources.js';
import { rulesFor } from '../configs/entity-rules.js';

const MAX_GAP = 3;
const GAP_RE = /^[\s,\n]*$/;

function canMergePair(prev, curr) {
  if (prev.entity_group === curr.entity_group) return { host: prev.entity_group };
  const prevRule = rulesFor(prev.entity_group);
  const currRule = rulesFor(curr.entity_group);
  if (prevRule.mergeWithAdjacent.includes(curr.entity_group)) return { host: prev.entity_group };
  if (currRule.mergeWithAdjacent.includes(prev.entity_group)) return { host: curr.entity_group };
  return null;
}

export function mergeStep(ctx) {
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

    const pair = canMergePair(prev, curr);
    if (!pair) {
      result.push(curr);
      continue;
    }

    const mergedSources = unionSources(prev.source, curr.source);
    result[result.length - 1] = {
      entity_group: pair.host,
      start: prev.start,
      end: curr.end,
      score: Math.max(prev.score, curr.score),
      ...(mergedSources.length > 0 && {
        source: mergedSources.length === 1 ? mergedSources[0] : mergedSources,
      }),
    };
  }

  return { ...ctx, entities: result };
}
