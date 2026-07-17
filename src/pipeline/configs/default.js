import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../steps/merge-abbreviations.js';
import { tightenSegmentsStep } from '../steps/tighten-segments.js';
import { createLoadModelsStep } from '../steps/load-models.js';
import { createNerStep } from '../steps/ner.js';
import { createCaseFoldedNerStep } from '../steps/case-folded-ner.js';
import { createCaseAllowlistStep } from '../steps/case-allowlist.js';
import { createJdgReviewFallbackStep } from '../steps/jdg-review-fallback.js';
import { createRegexStep } from '../steps/regex.js';
import { createLexiconStep } from '../steps/lexicon.js';
import { createSpecialCategoryLexiconStep } from '../steps/special-category-lexicon.js';
import { createSourceFilterStep } from '../steps/source-filter.js';
import { createThresholdStep } from '../steps/threshold.js';
import { refineFinancialAmountStep } from '../steps/refine-financial-amount.js';
import { snapStep } from '../steps/snap.js';
import { trimTrailingPunctuationStep } from '../steps/trim-trailing-punctuation.js';
import { blocklistStep } from '../steps/blocklist.js';
import { maxLengthStep } from '../steps/max-length.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { backfillOccurrencesStep } from '../steps/backfill.js';
import { createTierPartitionStep } from '../steps/tier-partition.js';
import { tokenizeStep } from '../steps/tokenize.js';
import { ENTITY_SOURCES, SOURCES, requiredSources } from './entity-sources.js';
import { effectiveTier } from './type-tiers.js';

// A factory-produced step must keep the name of the function it wraps —
// cache-orchestrator.js locates backfillOccurrencesStep by `step.name` to
// split the postprocess phase into a cacheable prefix and a cheap
// no-inference "rescan" suffix (dedup/backfill/merge/tierPartition/tokenize).
// Renaming would silently break that split (see cache-orchestrator.js).
function bindTierOf(fn, tierOf) {
  const bound = (ctx) => fn(ctx, tierOf);
  Object.defineProperty(bound, 'name', { value: fn.name, configurable: true });
  return bound;
}

function resolveActiveSources({ enabledEntities, entitySources, sources }) {
  const needed = requiredSources(enabledEntities);
  const hf = [];
  let regexActive = false;
  let lexiconActive = false;
  for (const alias of needed) {
    const def = sources[alias];
    if (!def) continue;
    if (def.kind === 'hf') hf.push({ alias, id: def.id, dtype: def.dtype });
    else if (def.kind === 'regex') regexActive = true;
    else if (def.kind === 'lexicon') lexiconActive = true;
  }
  return { hf, regexActive, lexiconActive };
}

export function createPreSegmentSteps(getSentenceBoundaries) {
  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [
      createSentencexSegmentStep(getSentenceBoundaries),
      mergeAbbreviationsStep,
      tightenSegmentsStep,
    ] },
  ];
}

export function createModelLoadSteps(hfSubset, loadModel, options = {}) {
  return [
    { phase: 'model-load', steps: [createLoadModelsStep(hfSubset, loadModel, options)] },
  ];
}

export function createNerSteps(hfSubset, regexActive, lexiconActive, loadModel, options = {}) {
  // B2 (RECALL-90-DESIGN.md §2.2): options.caseFoldedActive defaults to
  // active — the common case (createDefaultPipeline, below) always wants it
  // given the full hfSubset. The one caller that must suppress it explicitly
  // is cache-orchestrator.js's per-source NER loop: it calls this factory
  // once per HF source for incremental caching, and createCaseFoldedNerStep
  // cannot be meaningfully driven with only one of the two models (folding
  // is a joint pass over both) — see that file's dedicated, once-per-text
  // cache.caseFolded block and createCaseFoldedNerStep's own doc comment.
  const caseFoldedActive = options.caseFoldedActive ?? true;
  return [
    { phase: 'ner', steps: [
      createNerStep(hfSubset, loadModel, options),
      createCaseFoldedNerStep(hfSubset, loadModel, { active: caseFoldedActive }),
      createRegexStep(regexActive),
      createLexiconStep(lexiconActive),
      createSpecialCategoryLexiconStep(lexiconActive),
      // ST-5 (SCOPE-TIERS-DESIGN.md §5.2 pkt 3): deterministic, model-free;
      // self-inactive when the allowlist is empty, so the zero-entry world
      // stays byte-identical (§5.3 pkt 4).
      createCaseAllowlistStep(options.caseAllowlist ?? []),
    ] },
  ];
}

export function createPostprocessSteps(options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const enabledEntities = options.enabledEntities;
  // ST-2 (SCOPE-TIERS-DESIGN.md §3.4 pkt 2/§9): allMask defaults true, so
  // every caller that doesn't know about tiers yet (today's worker/eval/
  // tests) keeps today's single-tier behavior byte-for-byte — tiering only
  // activates for a caller that explicitly opts in with allMask: false.
  const allMask = options.allMask ?? true;
  const tierOverrides = options.tierOverrides;
  const tierOpts = { allMask, tierOverrides };
  const tierOf = (entity) => effectiveTier(entity, tierOpts);

  return [
    { phase: 'postprocess', steps: [
      createSourceFilterStep({ enabledEntities, entitySources }),
      createThresholdStep(options.thresholdOverrides),
      refineFinancialAmountStep,
      snapStep,
      trimTrailingPunctuationStep,
      blocklistStep,
      maxLengthStep,
      bindTierOf(dedupStep, tierOf),
      bindTierOf(backfillOccurrencesStep, tierOf),
      bindTierOf(mergeStep, tierOf),
      // ST-5 (SCOPE-TIERS-DESIGN.md §5.2 pkt 5): marks pass-tier org names
      // that may contain a person's name as review candidates; hard no-op
      // under allMask, so today's single-tier world is untouched.
      createJdgReviewFallbackStep(tierOpts),
      createTierPartitionStep(tierOpts),
      tokenizeStep,
    ] },
  ];
}

/**
 * Creates the default PII anonymization pipeline.
 *
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), countTokens(text), dispose() }
 * @param {Function} getSentenceBoundaries - (lang, text) => [{start_index, end_index, text}, ...]
 * @param {object} options - { enabledEntities, entitySources?, sources?, sortSources? }
 */
export function createDefaultPipeline(loadModel, getSentenceBoundaries, options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const sources = options.sources ?? SOURCES;
  const enabledEntities = options.enabledEntities;
  const { hf, regexActive, lexiconActive } = resolveActiveSources({ enabledEntities, entitySources, sources });
  const orderedHf = options.sortSources ? options.sortSources(hf) : hf;

  return [
    ...createPreSegmentSteps(getSentenceBoundaries),
    ...createModelLoadSteps(orderedHf, loadModel),
    ...createNerSteps(orderedHf, regexActive, lexiconActive, loadModel, {
      caseAllowlist: options.caseAllowlist,
    }),
    ...createPostprocessSteps({
      enabledEntities,
      entitySources,
      tierOverrides: options.tierOverrides,
      allMask: options.allMask,
    }),
  ];
}
