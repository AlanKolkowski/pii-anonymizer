import { aggregateEntities } from '../../anonymizer.js';
import { modelKeyForSource } from './load-models.js';

/**
 * Factory that creates a NER pipeline step.
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources - Active HF sources
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), dispose() }
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
          const raw = await ner.infer(segment.text);
          options.onInference?.({ source: source.alias, segment });
          const chunkEntities = raw[0]?.entity_group
            ? raw
            : aggregateEntities(raw, segment.text);

          for (const entity of chunkEntities) {
            allEntities.push({
              ...entity,
              start: entity.start + segment.offset,
              end: entity.end + segment.offset,
              source: source.alias,
            });
          }
        }
      } finally {
        try { await ner.dispose(); } finally { modelHandles?.delete(key); }
      }
    }

    return { ...ctx, entities: [...ctx.entities, ...allEntities], ...(modelHandles && { modelHandles }) };
  };
}
