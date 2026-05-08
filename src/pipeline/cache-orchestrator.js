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
}) {
  const hash = await sha256Hex(text);
  const hit = cache?.textHash === hash;

  // --- Stage 1: preprocess + segment ---
  let normalizedText, segments;
  if (hit) {
    normalizedText = cache.normalizedText;
    segments = cache.segments;
  } else {
    const preCtx = await runPipeline(text, createPreSegmentSteps(getSentenceBoundaries));
    normalizedText = preCtx.text;
    segments = preCtx.segments;
  }

  // --- Stage 2: NER, running only what's missing ---
  const bySource = hit ? new Map(cache.bySource) : new Map();
  let regex = hit ? cache.regex : null;

  const needed = requiredSources(enabledEntities);
  const requiredHf = needed
    .filter((alias) => sources[alias]?.kind === 'hf')
    .map((alias) => ({ alias, id: sources[alias].id, dtype: sources[alias].dtype }));
  const missingHf = requiredHf.filter((s) => !bySource.has(s.alias));
  const regexNeeded = needed.includes('regex');

  if (missingHf.length > 0) {
    const ordered = sortSources ? sortSources(missingHf) : missingHf;
    for (const source of ordered) {
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

  // --- Stage 3: postprocess on the merged entity union ---
  const merged = [...[...bySource.values()].flat(), ...(regex ?? [])];
  const finalCtx = await runPipeline(
    makeSeededCtx({ text: normalizedText, segments, entities: merged }),
    createPostprocessSteps({ enabledEntities, entitySources }),
  );

  return {
    ctx: finalCtx,
    cache: { textHash: hash, normalizedText, segments, bySource, regex },
  };
}
