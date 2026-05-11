import { runPipeline } from './runner.js';
import {
  createPreSegmentSteps,
  createNerSteps,
  createPostprocessSteps,
} from './configs/default.js';
import { requiredSources } from './configs/entity-sources.js';

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeSeededCtx({ text, segments, entities }) {
  return { text, segments, entities, anonymized: '', legend: {}, debug: [] };
}

/**
 * Cache-aware classify orchestration.
 *
 * On cache hit (text matches previous), reuses normalized text + segments
 * and skips already-run NER sources. On miss, runs the full pipeline and
 * populates the cache.
 *
 * @param {object} params
 * @param {string} params.text - Input text
 * @param {string[]} params.enabledEntities - Selected entity types
 * @param {object|null} params.cache - Previous cache, or null
 * @param {object} params.sources - SOURCES map (alias → def)
 * @param {object} params.entitySources - ENTITY_SOURCES map
 * @param {Function} params.loadModel - async ({id, dtype}) => { infer, dispose }
 * @param {Function} params.getSentenceBoundaries - (lang, text) => boundaries[]
 * @param {Function} [params.sortSources] - optional ordering of HF sources
 * @param {Function} [params.onTimingMark] - optional progress hook receiving mark names
 * @param {boolean} [params.preloadModels] - load missing HF sessions before preprocess/segment
 * @returns {Promise<{ ctx: object, cache: object }>}
 */
export async function classifyWithCache({
  text,
  enabledEntities,
  cache,
  sources,
  entitySources,
  loadModel,
  getSentenceBoundaries,
  sortSources,
  onTimingMark = () => {},
  preloadModels = false,
}) {
  const emit = (mark) => onTimingMark(mark);
  const hash = await sha256Hex(text);
  const hit = cache?.textHash === hash;

  const needed = requiredSources(enabledEntities);
  const requiredHf = needed
    .filter((alias) => sources[alias]?.kind === 'hf')
    .map((alias) => ({ alias, id: sources[alias].id, dtype: sources[alias].dtype }));
  const bySource = hit ? new Map(cache.bySource) : new Map();
  const missingHf = requiredHf.filter((s) => !bySource.has(s.alias));
  const orderedMissingHf = sortSources ? sortSources(missingHf) : missingHf;
  const regexNeeded = needed.includes('regex');

  emit('pipeline:load:start');
  if (preloadModels) {
    for (const source of orderedMissingHf) {
      const model = await loadModel({ id: source.id, dtype: source.dtype });
      await model.dispose?.();
    }
  }
  emit('pipeline:load:end');

  // --- Stage 1: preprocess + segment ---
  let normalizedText, segments;
  const [preprocessPhase, segmentPhase] = createPreSegmentSteps(getSentenceBoundaries);
  emit('pipeline:preprocess:start');
  if (hit) {
    normalizedText = cache.normalizedText;
  } else {
    const preCtx = await runPipeline(text, [preprocessPhase]);
    normalizedText = preCtx.text;
  }
  emit('pipeline:preprocess:end');

  emit('pipeline:segment:start');
  if (hit) {
    segments = cache.segments;
  } else {
    const segCtx = await runPipeline(
      makeSeededCtx({ text: normalizedText, segments: [], entities: [] }),
      [segmentPhase],
    );
    normalizedText = segCtx.text;
    segments = segCtx.segments;
  }
  emit('pipeline:segment:end');

  // --- Stage 2: NER, running only what's missing ---
  let regex = hit ? cache.regex : null;

  emit('pipeline:ner:start');
  if (missingHf.length > 0) {
    for (const source of orderedMissingHf) {
      const ctx = await runPipeline(
        makeSeededCtx({ text: normalizedText, segments, entities: [] }),
        createNerSteps([source], false, loadModel),
      );
      bySource.set(source.alias, ctx.entities);
    }
  }

  if (regexNeeded && regex === null) {
    const ctx = await runPipeline(
      makeSeededCtx({ text: normalizedText, segments, entities: [] }),
      createNerSteps([], true, loadModel),
    );
    regex = ctx.entities;
  }
  emit('pipeline:ner:end');

  // --- Stage 3: postprocess on the merged entity union ---
  const merged = [...[...bySource.values()].flat(), ...(regex ?? [])];
  const [postprocessPhase] = createPostprocessSteps({ enabledEntities, entitySources });
  const rescanIndex = postprocessPhase.steps.findIndex((step) => step.name === 'backfillOccurrencesStep');
  const postSteps = rescanIndex === -1
    ? postprocessPhase.steps
    : postprocessPhase.steps.slice(0, rescanIndex);
  const rescanSteps = rescanIndex === -1
    ? []
    : postprocessPhase.steps.slice(rescanIndex);

  emit('pipeline:postprocess:start');
  const postCtx = postSteps.length > 0
    ? await runPipeline(
      makeSeededCtx({ text: normalizedText, segments, entities: merged }),
      [{ phase: 'postprocess', steps: postSteps }],
    )
    : makeSeededCtx({ text: normalizedText, segments, entities: merged });
  const postDebug = postCtx.debug ?? [];
  emit('pipeline:postprocess:end');

  emit('pipeline:rescan:start');
  const rescanCtx = rescanSteps.length > 0
    ? await runPipeline(
      { ...postCtx, debug: [] },
      [{ phase: 'postprocess', steps: rescanSteps }],
    )
    : postCtx;
  const finalCtx = {
    ...rescanCtx,
    debug: [...postDebug, ...(rescanCtx.debug ?? [])],
  };
  emit('pipeline:rescan:end');

  return {
    ctx: finalCtx,
    cache: { textHash: hash, normalizedText, segments, bySource, regex },
  };
}
