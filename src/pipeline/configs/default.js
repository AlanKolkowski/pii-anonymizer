import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../steps/merge-abbreviations.js';
import { tightenSegmentsStep } from '../steps/tighten-segments.js';
import { createLoadModelsStep } from '../steps/load-models.js';
import { createNerStep } from '../steps/ner.js';
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
import { tokenizeStep } from '../steps/tokenize.js';
import { ENTITY_SOURCES, SOURCES, requiredSources } from './entity-sources.js';

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
  return [
    { phase: 'ner', steps: [
      createNerStep(hfSubset, loadModel, options),
      createRegexStep(regexActive),
      createLexiconStep(lexiconActive),
      createSpecialCategoryLexiconStep(lexiconActive),
    ] },
  ];
}

export function createPostprocessSteps(options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const enabledEntities = options.enabledEntities;
  return [
    { phase: 'postprocess', steps: [
      createSourceFilterStep({ enabledEntities, entitySources }),
      createThresholdStep(options.thresholdOverrides),
      refineFinancialAmountStep,
      snapStep,
      trimTrailingPunctuationStep,
      blocklistStep,
      maxLengthStep,
      dedupStep,
      backfillOccurrencesStep,
      mergeStep,
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
    ...createNerSteps(orderedHf, regexActive, lexiconActive, loadModel),
    ...createPostprocessSteps({ enabledEntities, entitySources }),
  ];
}
