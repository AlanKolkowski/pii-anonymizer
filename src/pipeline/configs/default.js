import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../steps/merge-abbreviations.js';
import { tightenSegmentsStep } from '../steps/tighten-segments.js';
import { createNerStep } from '../steps/ner.js';
import { createRegexStep } from '../steps/regex.js';
import { createSourceFilterStep } from '../steps/source-filter.js';
import { snapStep } from '../steps/snap.js';
import { trimTrailingDotStep } from '../steps/trim-trailing-dot.js';
import { filterStep } from '../steps/filter.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { backfillOccurrencesStep } from '../steps/backfill.js';
import { tokenizeStep } from '../steps/tokenize.js';
import { ENTITY_SOURCES, SOURCES, requiredSources } from './entity-sources.js';

function resolveActiveSources({ enabledEntities, entitySources, sources }) {
  const needed = requiredSources(enabledEntities);
  const hf = [];
  let regexActive = false;
  for (const alias of needed) {
    const def = sources[alias];
    if (!def) continue;
    if (def.kind === 'hf') hf.push({ alias, id: def.id, dtype: def.dtype });
    else if (def.kind === 'regex') regexActive = true;
  }
  return { hf, regexActive };
}

/**
 * Creates the default PII anonymization pipeline.
 *
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), dispose() }
 * @param {Function} getSentenceBoundaries - (lang, text) => [{start_index, end_index, text}, ...]
 * @param {object} options - { enabledEntities, entitySources?, sources? }
 */
export function createDefaultPipeline(loadModel, getSentenceBoundaries, options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const sources = options.sources ?? SOURCES;
  const enabledEntities = options.enabledEntities;
  const { hf, regexActive } = resolveActiveSources({ enabledEntities, entitySources, sources });

  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [
      createSentencexSegmentStep(getSentenceBoundaries),
      mergeAbbreviationsStep,
      tightenSegmentsStep,
    ] },
    { phase: 'ner', steps: [createNerStep(hf, loadModel), createRegexStep(regexActive)] },
    { phase: 'postprocess', steps: [
      createSourceFilterStep({ enabledEntities, entitySources }),
      snapStep,
      trimTrailingDotStep,
      filterStep,
      dedupStep,
      backfillOccurrencesStep,
      mergeStep,
      tokenizeStep,
    ] },
  ];
}
