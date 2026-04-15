import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { createNerStep } from '../steps/ner.js';
import { regexStep } from '../steps/regex.js';
import { allowedTypesStep } from '../steps/allowed-types.js';
import { snapStep } from '../steps/snap.js';
import { filterStep } from '../steps/filter.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { rescanStep } from '../steps/rescan.js';
import { tokenizeStep } from '../steps/tokenize.js';

export const MODELS = [
  { id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' },
  { id: 'bardsai/eu-pii-anonimization', dtype: 'q8' },
];

/**
 * Creates the default PII anonymization pipeline.
 *
 * @param {Function} loadModel - async (modelConfig) => { infer(text), dispose() }
 * @param {Function} getSentenceBoundaries - (lang, text) => [{start_index, end_index, text}, ...]
 */
export function createDefaultPipeline(loadModel, getSentenceBoundaries) {
  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [createSentencexSegmentStep(getSentenceBoundaries)] },
    { phase: 'ner', steps: [createNerStep(MODELS, loadModel), regexStep] },
    { phase: 'postprocess', steps: [allowedTypesStep, snapStep, filterStep, dedupStep, mergeStep, tokenizeStep, rescanStep] },
  ];
}
