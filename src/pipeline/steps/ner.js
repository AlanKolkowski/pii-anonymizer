import { aggregateEntities } from '../../anonymizer.js';
import { modelKeyForSource } from './load-models.js';

const MODEL_TOKEN_BUDGET = 512;

async function splitToTokenBudget(segment, countTokens) {
  if (segment.text.length <= 1) return [segment];
  if ((await countTokens(segment.text)) <= MODEL_TOKEN_BUDGET) return [segment];
  const mid = Math.floor(segment.text.length / 2);
  let cut = segment.text.lastIndexOf(' ', mid);
  if (cut > 0) cut += 1; // keep the space with the left piece (mirrors segment-sentencex)
  else {
    const fwd = segment.text.indexOf(' ', mid);
    cut = fwd > 0 && fwd < segment.text.length - 1 ? fwd + 1 : mid;
  }
  if (cut <= 0 || cut >= segment.text.length) cut = mid;
  const left = { text: segment.text.slice(0, cut), offset: segment.offset };
  const right = { text: segment.text.slice(cut), offset: segment.offset + cut };
  return [
    ...(await splitToTokenBudget(left, countTokens)),
    ...(await splitToTokenBudget(right, countTokens)),
  ];
}

/**
 * Factory that creates a NER pipeline step.
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources - Active HF sources
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), countTokens(text), dispose() }
 * @param {object} options
 * @param {Function} [options.onInference] - called after each model/segment inference
 */
export function createNerStep(sources, loadModel, options = {}) {
  return async function nerStep(ctx) {
    const allEntities = [];
    const modelHandles = ctx.modelHandles instanceof Map ? ctx.modelHandles : null;

    for (const source of sources) {
      const key = modelKeyForSource(source);
      const preloaded = modelHandles?.get(key) ?? null;
      const ner = preloaded ?? await loadModel({ alias: source.alias, id: source.id, dtype: source.dtype });

      try {
        for (const segment of ctx.segments) {
          const pieces = typeof ner.countTokens === 'function'
            ? await splitToTokenBudget(segment, ner.countTokens)
            : [segment];
          for (const piece of pieces) {
            const raw = await ner.infer(piece.text);
            const chunkEntities = raw[0]?.entity_group
              ? raw
              : aggregateEntities(raw, piece.text);
            for (const entity of chunkEntities) {
              allEntities.push({
                ...entity,
                start: entity.start + piece.offset,
                end: entity.end + piece.offset,
                source: source.alias,
              });
            }
          }
          options.onInference?.({ source: source.alias, segment });
        }
      } finally {
        try { await ner.dispose(); } finally { modelHandles?.delete(key); }
      }
    }

    return { ...ctx, entities: [...ctx.entities, ...allEntities], ...(modelHandles && { modelHandles }) };
  };
}
