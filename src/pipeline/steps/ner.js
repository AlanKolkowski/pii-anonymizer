import { aggregateEntities } from '../../anonymizer.js';

/**
 * Factory that creates a NER pipeline step.
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources - Active HF sources
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), dispose() }
 */
export function createNerStep(sources, loadModel) {
  return async function nerStep(ctx) {
    const allEntities = [];

    for (const source of sources) {
      const ner = await loadModel({ id: source.id, dtype: source.dtype });

      for (const segment of ctx.segments) {
        const raw = await ner.infer(segment.text);
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

      await ner.dispose();
    }

    return { ...ctx, entities: [...ctx.entities, ...allEntities] };
  };
}
