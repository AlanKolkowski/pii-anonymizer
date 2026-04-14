import { aggregateEntities } from '../../anonymizer.js';

/**
 * Factory that creates a NER pipeline step.
 *
 * @param {Array<{id: string, dtype: string}>} models - Model configs to run
 * @param {Function} loadModel - async (modelConfig) => { infer(text), dispose() }
 */
export function createNerStep(models, loadModel) {
  return async function nerStep(ctx) {
    const allEntities = [];

    for (const model of models) {
      const ner = await loadModel(model);

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
          });
        }
      }

      await ner.dispose();
    }

    return {
      ...ctx,
      entities: [...ctx.entities, ...allEntities],
      debug: [...ctx.debug, {
        step: 'ner',
        phase: 'ner',
        out: {
          entityCount: allEntities.length,
          modelsUsed: models.map(m => m.id),
        },
      }],
    };
  };
}
