import { NAME_CANDIDATE } from './backfill.js';
import { effectiveTier } from '../configs/type-tiers.js';

// ST-5 (SCOPE-TIERS-DESIGN.md §5.2 pkt 5): third line of defense for the
// personal part of JDG/kancelaria names. An ORGANIZATION_NAME that would be
// passed through (tier 'pass') but contains a two-plus-capitalized-words
// sequence NOT covered by any masked entity gets forceTier 'review' — the
// whole name becomes a W2 candidate ("nazwa może zawierać dane osoby") and
// the radca decides. Deliberately broad (it will also catch "Bank
// Spółdzielczy w Wielkiej Nieszawce"); the noise is bounded by the
// not-covered requirement and by the fact that a review candidate masks
// nothing without a decision. The first two lines of defense are ST-2's
// tier-aware dedup/backfill (H-1/H-2): a name the model detected, or knew
// from elsewhere in the document, is already masked inside the span — which
// is exactly what the coverage check below sees.
//
// Placement: postprocess, after mergeStep, before tierPartitionStep — spans
// are final, the partition consumes the flag. Under allMask (today's
// default) the step is a hard no-op so the single-tier world stays
// byte-identical, down to eval's entities.json artifacts (no stray
// forceTier fields).
export function createJdgReviewFallbackStep(tierOpts = {}) {
  return function jdgReviewFallbackStep(ctx) {
    if (tierOpts.allMask ?? true) return ctx;
    const { text, entities } = ctx;

    const maskSpans = entities.filter((e) => effectiveTier(e, tierOpts) === 'mask');
    // A sequence counts as handled when ANY masked entity overlaps it —
    // NAME_CANDIDATE matches are maximal ("Kancelaria Radcy Prawnego Jan
    // Kowalski" is ONE sequence), so requiring full containment would keep
    // offering the org for review even after its personal part is masked,
    // violating ST-2's golden ("kandydatów W2 zero z tego spanu", §3.3
    // pkt 2). The first two lines of defense (model detection, H-2
    // backfill) mask the person; this fallback exists for names known from
    // nowhere else in the document.
    const touched = (start, end) => maskSpans.some((m) => m.start < end && m.end > start);

    let changed = false;
    const next = entities.map((entity) => {
      if (entity.entity_group !== 'ORGANIZATION_NAME') return entity;
      if (entity.forceTier) return entity;
      if (effectiveTier(entity, tierOpts) !== 'pass') return entity;
      const spanText = text.slice(entity.start, entity.end);
      for (const m of spanText.matchAll(NAME_CANDIDATE)) {
        const start = entity.start + m.index;
        const end = start + m[0].length;
        if (!touched(start, end)) {
          changed = true;
          return { ...entity, forceTier: 'review' };
        }
      }
      return entity;
    });

    return changed ? { ...ctx, entities: next } : ctx;
  };
}
