import { effectiveTier } from '../configs/type-tiers.js';

function foldValue(value) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
}

function isFullyMasked(entity, maskEntities) {
  return maskEntities.some((m) => m.start <= entity.start && m.end >= entity.end);
}

// ST-2 (SCOPE-TIERS-DESIGN.md §3): the one place the mask/review/pass
// decision is made, after every quality step (thresholds, dedup, backfill,
// merge) has already run. Splits ctx.entities into the three sinks: 'mask'
// stays in ctx.entities (the only thing tokenizeStep ever sees and the only
// thing that reaches the legend), 'review' moves to ctx.reviewCandidates
// (offsets + a value key, not tokenized — nobody consumes this yet, that's
// ST-3/ST-4), 'pass' simply disappears from ctx.entities (still visible in
// ctx.debug via runner.js's automatic added/removed diff, like any filter).
export function createTierPartitionStep(opts = {}) {
  return function tierPartitionStep(ctx) {
    const { text, entities } = ctx;
    const maskEntities = [];
    const reviewEntities = [];
    for (const entity of entities) {
      const tier = effectiveTier(entity, opts);
      if (tier === 'mask') maskEntities.push(entity);
      else if (tier === 'review') reviewEntities.push(entity);
      // 'pass' entities are dropped here — no third bucket to build.
    }

    // A review candidate fully hidden inside a mask span is noise — its
    // characters are already gone from the anonymized text, so showing it
    // to the reviewer teaches nothing. A partially-covered candidate keeps
    // its full original span (§3.2 pkt 3): the uncovered remainder is
    // invisible to the user anyway, and trimming it buys no extra safety.
    const reviewCandidates = reviewEntities
      .filter((entity) => !isFullyMasked(entity, maskEntities))
      .map((entity) => ({
        entity_group: entity.entity_group,
        start: entity.start,
        end: entity.end,
        score: entity.score,
        source: entity.source,
        tier: 'review',
        valueKey: `${entity.entity_group}::${foldValue(text.slice(entity.start, entity.end))}`,
      }));

    return { ...ctx, entities: maskEntities, reviewCandidates };
  };
}
