export function modelKeyForSource(source) {
  return source.alias ?? `${source.id}@${source.dtype}`;
}

function getModelHandles(ctx) {
  return ctx.modelHandles instanceof Map ? ctx.modelHandles : new Map();
}

/**
 * Preloads HF model sessions before the NER phase.
 *
 * The handles are stored on ctx.modelHandles and later consumed by nerStep so
 * NER can do only segment inference. Unknown context fields are intentionally
 * ignored by the debug diffing code.
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources
 * @param {Function} loadModel - async ({alias, id, dtype}) => { infer, dispose }
 * @param {object} options
 * @param {Function} [options.onPlan]
 * @param {Function} [options.onProgress]
 */
export function createLoadModelsStep(sources, loadModel, options = {}) {
  return async function loadModelsStep(ctx) {
    const modelHandles = new Map(getModelHandles(ctx));
    const total = sources.length;
    const loadedKeys = new Set();
    let completed = 0;

    options.onPlan?.({ total, sources });

    try {
      for (const source of sources) {
        const key = modelKeyForSource(source);
        const existing = modelHandles.get(key);

        if (existing) {
          completed += 1;
          options.onProgress?.({
            status: 'ready',
            source,
            model: existing,
            completed,
            total,
            cached: true,
          });
          continue;
        }

        options.onProgress?.({
          status: 'loading',
          source,
          completed,
          total,
          cached: false,
        });

        const model = await loadModel({ alias: source.alias, id: source.id, dtype: source.dtype });
        modelHandles.set(key, model);
        loadedKeys.add(key);
        completed += 1;

        options.onProgress?.({
          status: 'ready',
          source,
          model,
          completed,
          total,
          cached: false,
        });
      }
    } catch (err) {
      for (const key of loadedKeys) {
        const model = modelHandles.get(key);
        try { await model?.dispose?.(); } finally { modelHandles.delete(key); }
      }
      throw err;
    }

    if (total === 0) {
      options.onProgress?.({ status: 'ready', source: null, completed: 0, total: 0 });
    }

    return { ...ctx, modelHandles };
  };
}
