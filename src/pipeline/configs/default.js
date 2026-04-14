import { normalizeWhitespace } from '../steps/preprocess.js';
import { segmentStep } from '../steps/segment.js';
import { createNerStep } from '../steps/ner.js';
import { regexStep } from '../steps/regex.js';
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
 */
export function createDefaultPipeline(loadModel) {
  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [segmentStep] },
    { phase: 'ner', steps: [createNerStep(MODELS, loadModel), regexStep] },
    { phase: 'postprocess', steps: [snapStep, filterStep, dedupStep, mergeStep, tokenizeStep, rescanStep] },
  ];
}
