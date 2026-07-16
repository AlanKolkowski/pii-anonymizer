import { runPipeline } from './runner.js';
import {
  createPreSegmentSteps,
  createModelLoadSteps,
  createNerSteps,
  createPostprocessSteps,
} from './configs/default.js';
import { createCaseFoldedNerStep } from './steps/case-folded-ner.js';
import { createDespacedNerStep } from './steps/despaced-ner.js';

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeSeededCtx({ text, segments, entities, modelHandles = null, meta = null }) {
  return {
    text,
    segments,
    entities,
    anonymized: '',
    legend: {},
    debug: [],
    ...(modelHandles && { modelHandles }),
    ...(meta && { meta }),
  };
}

async function disposeModelHandles(modelHandles) {
  if (!(modelHandles instanceof Map)) return;
  for (const [key, model] of [...modelHandles.entries()]) {
    try { await model.dispose?.(); } finally { modelHandles.delete(key); }
  }
}

function requiredSourcesFor(enabledEntities, entitySources) {
  const set = new Set();
  for (const type of enabledEntities) {
    const aliases = entitySources[type];
    if (!aliases) continue;
    for (const alias of aliases) set.add(alias);
  }
  return [...set];
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
 * @param {Function} params.loadModel - async ({alias, id, dtype}) => { infer, dispose }
 * @param {Function} params.getSentenceBoundaries - (lang, text) => boundaries[]
 * @param {Function} [params.sortSources] - optional ordering of HF sources
 * @param {object} [params.tierOverrides] - ST-2: per-type tier overrides, forwarded to createPostprocessSteps
 * @param {boolean} [params.allMask] - ST-2: forces the single-tier (legacy) profile when true/omitted
 * @param {object} [params.meta] - OS-1: document metadata; meta.ocrProvenance gates the despaced pass (OCR-SPACING-DESIGN.md §2.2 pkt 6)
 * @param {Function} [params.onTimingMark] - optional progress hook receiving mark names
 * @param {Function} [params.onProgress] - optional fine-grained progress hook receiving progress events
 * @param {Function} [params.prepareModel] - async hook for downloading/caching one model source before inference
 * @param {Function} [params.prepareModels] - async hook for downloading/caching all missing model sources before inference
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
  tierOverrides,
  allMask,
  meta,
  onTimingMark = () => {},
  onProgress = () => {},
  prepareModel = null,
  prepareModels = null,
}) {
  const emit = (mark) => onTimingMark(mark);
  const emitProgress = (event) => onProgress(event);
  const hash = await sha256Hex(text);
  const hit = cache?.textHash === hash;

  const needed = requiredSourcesFor(enabledEntities, entitySources);
  const requiredHf = needed
    .filter((alias) => sources[alias]?.kind === 'hf')
    .map((alias) => ({ alias, id: sources[alias].id, dtype: sources[alias].dtype }));
  const bySource = hit ? new Map(cache.bySource) : new Map();
  const missingHf = requiredHf.filter((s) => !bySource.has(s.alias));
  const orderedMissingHf = sortSources ? sortSources(missingHf) : missingHf;
  const regexNeeded = needed.includes('regex');
  const lexiconNeeded = needed.includes('lexicon');
  // B2 (RECALL-90-DESIGN.md §2.2): like regex/lexicon, computed once per
  // text and cached on its own field rather than under bySource — unlike
  // regex/lexicon it DOES need HF models (both of them, together; see the
  // dedicated block below and createCaseFoldedNerStep's own doc comment for
  // why it can't be driven from the per-source loop the way the main pass is).
  const caseFoldedNeeded = needed.includes('case-folded');
  // OS-1 (OCR-SPACING-DESIGN.md §2.2): same construction as case-folded,
  // additionally gated on the document's OCR provenance. The gate is applied
  // both here (skip the inference entirely) and at merge time below — the
  // NER cache is keyed by text hash alone, so the same text classified once
  // with and once without provenance must not leak candidates across.
  const despacedNeeded = needed.includes('despaced') && Boolean(meta?.ocrProvenance);

  emit('pipeline:load:start');
  if (prepareModels) {
    await prepareModels(orderedMissingHf);
  } else if (prepareModel) {
    for (const source of orderedMissingHf) {
      await prepareModel(source);
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

  // --- Stage 2: load model sessions, then run pure inference NER for missing sources ---
  let regex = hit ? cache.regex : null;
  let lexicon = hit ? cache.lexicon : null;
  let caseFolded = hit ? cache.caseFolded : null;
  let despaced = hit ? (cache.despaced ?? null) : null;
  let modelHandles = new Map();

  emit('pipeline:model-load:start');
  try {
    const [modelLoadPhase] = createModelLoadSteps(orderedMissingHf, loadModel, {
      onPlan: ({ total, sources: planSources }) => emitProgress({
        type: 'model-load-plan',
        models: total,
        total,
        completed: 0,
        sources: planSources.map((source) => source.alias),
      }),
      onProgress: ({ status, source, model, completed, total, cached }) => emitProgress({
        type: 'model-load-progress',
        status,
        source: source?.alias ?? null,
        device: model?.device ?? null,
        models: total,
        total,
        completed,
        cached: Boolean(cached),
      }),
    });
    const modelCtx = await runPipeline(
      makeSeededCtx({ text: normalizedText, segments, entities: [] }),
      [modelLoadPhase],
    );
    modelHandles = modelCtx.modelHandles instanceof Map ? modelCtx.modelHandles : new Map();
  } catch (err) {
    await disposeModelHandles(modelHandles);
    throw err;
  }
  emit('pipeline:model-load:end');

  emit('pipeline:ner:start');
  const totalInferences = segments.length * orderedMissingHf.length;
  let completedInferences = 0;
  emitProgress({
    type: 'ner-plan',
    segments: segments.length,
    models: orderedMissingHf.length,
    total: totalInferences,
    completed: 0,
  });
  try {
    if (missingHf.length > 0) {
      for (const source of orderedMissingHf) {
        const ctx = await runPipeline(
          makeSeededCtx({ text: normalizedText, segments, entities: [], modelHandles }),
          createNerSteps([source], false, false, loadModel, {
            caseFoldedActive: false, // one model at a time here — see caseFoldedNeeded block below
            despacedActive: false, // same constraint — see despacedNeeded block below
            onInference: () => {
              completedInferences += 1;
              emitProgress({
                type: 'ner-progress',
                segments: segments.length,
                models: orderedMissingHf.length,
                total: totalInferences,
                completed: completedInferences,
                source: source.alias,
              });
            },
          }),
        );
        modelHandles = ctx.modelHandles instanceof Map ? ctx.modelHandles : modelHandles;
        bySource.set(source.alias, ctx.entities);
      }
    }

    if (regexNeeded && regex === null) {
      const ctx = await runPipeline(
        makeSeededCtx({ text: normalizedText, segments, entities: [] }),
        createNerSteps([], true, false, loadModel, { caseFoldedActive: false, despacedActive: false }),
      );
      regex = ctx.entities;
    }

    if (lexiconNeeded && lexicon === null) {
      const ctx = await runPipeline(
        makeSeededCtx({ text: normalizedText, segments, entities: [] }),
        createNerSteps([], false, true, loadModel, { caseFoldedActive: false, despacedActive: false }),
      );
      lexicon = ctx.entities;
    }

    // B2: run once with every currently-required HF source together (not
    // via createNerSteps — that would also re-run the main NER pass on
    // requiredHf, duplicating bySource's own work). requiredHf, not
    // orderedMissingHf: the folded pass is independent of which sources
    // were already cached this round, and in the browser re-requesting an
    // already-warm model is free (worker.js keeps sessions loaded across
    // calls) — see createCaseFoldedNerStep's doc comment.
    if (caseFoldedNeeded && caseFolded === null) {
      const ctx = await runPipeline(
        makeSeededCtx({ text: normalizedText, segments, entities: [] }),
        [{ phase: 'ner', steps: [createCaseFoldedNerStep(requiredHf, loadModel)] }],
      );
      caseFolded = ctx.entities;
    }

    // OS-1: like case-folded — once per text, full source set, own cache
    // bucket. Seeded ctx carries meta so the step's own provenance gate
    // stays the single source of truth for activation.
    if (despacedNeeded && despaced === null) {
      const ctx = await runPipeline(
        makeSeededCtx({ text: normalizedText, segments, entities: [], meta }),
        [{ phase: 'ner', steps: [createDespacedNerStep(requiredHf, loadModel)] }],
      );
      despaced = ctx.entities;
    }
  } finally {
    await disposeModelHandles(modelHandles);
  }
  emit('pipeline:ner:end');

  // --- Stage 3: postprocess on the merged entity union ---
  const merged = [
    ...[...bySource.values()].flat(),
    ...(regex ?? []),
    ...(lexicon ?? []),
    ...(caseFolded ?? []),
    // Gated on THIS call's provenance, not just on the cached value —
    // see the despacedNeeded comment above.
    ...(despacedNeeded ? (despaced ?? []) : []),
  ];
  const [postprocessPhase] = createPostprocessSteps({ enabledEntities, entitySources, tierOverrides, allMask });
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
    cache: { textHash: hash, normalizedText, segments, bySource, regex, lexicon, caseFolded, despaced },
  };
}
