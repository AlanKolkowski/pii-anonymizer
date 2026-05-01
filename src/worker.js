import { pipeline as hfPipeline } from '@huggingface/transformers';
import init, { get_sentence_boundaries } from 'sentencex-wasm';
import sentencexWasm from 'sentencex-wasm/sentencex_wasm_bg.wasm?url';
import { runPipeline } from './pipeline/runner.js';
import { createDefaultPipeline } from './pipeline/configs/default.js';
import { SOURCES, ENTITY_SOURCES, requiredSources } from './pipeline/configs/entity-sources.js';

// Memory budget for resident HF models in the WASM heap.
// Sized so 2× q8 (~280 MB) + 1× fp32 (~1100 MB) ≈ 1.66 GB fits with headroom
// for ORT scratch / tokenizer / segment buffers, while two fp32 models do not.
const MEMORY_BUDGET_MB = 1800;

let wasmReady = false;
let currentConfig = null;
const loadedModels = new Map();

async function ensureWasm() {
  if (!wasmReady) {
    await init(sentencexWasm);
    wasmReady = true;
  }
}

function totalLoadedMB() {
  let total = 0;
  for (const entry of loadedModels.values()) total += entry.sizeMB;
  return total;
}

async function disposeModel(alias) {
  const entry = loadedModels.get(alias);
  if (!entry) return;
  try { await entry.dispose(); } catch (err) { console.warn(`[worker] dispose ${alias}:`, err); }
  loadedModels.delete(alias);
  console.log(`[worker] evicted ${alias} (total=${totalLoadedMB()}MB)`);
}

async function disposeUnusedModels(neededAliases) {
  const keep = new Set(neededAliases);
  for (const alias of [...loadedModels.keys()]) {
    if (!keep.has(alias)) await disposeModel(alias);
  }
}

async function evictForBudget(needSizeMB, protectAlias) {
  if (totalLoadedMB() + needSizeMB <= MEMORY_BUDGET_MB) return;
  const candidates = [...loadedModels.entries()]
    .filter(([alias]) => alias !== protectAlias)
    .sort((a, b) => b[1].sizeMB - a[1].sizeMB);
  for (const [alias] of candidates) {
    if (totalLoadedMB() + needSizeMB <= MEMORY_BUDGET_MB) return;
    await disposeModel(alias);
  }
}

async function ensureModelLoaded(alias) {
  if (loadedModels.has(alias)) return;
  const def = SOURCES[alias];
  if (!def || def.kind !== 'hf') return;
  const sizeMB = def.sizeMB ?? 0;
  await evictForBudget(sizeMB, alias);
  self.postMessage({ type: 'timing', mark: 'model:load:start', alias, t: performance.now() });
  const ner = await hfPipeline('token-classification', def.id, {
    dtype: def.dtype,
    progress_callback: (data) => {
      if (data.status === 'progress') {
        self.postMessage({ type: 'progress', file: data.file, progress: data.progress });
      }
    },
  });
  self.postMessage({ type: 'timing', mark: 'model:load:end', alias, t: performance.now() });
  loadedModels.set(alias, { ner, sizeMB, dispose: async () => await ner.dispose() });
  console.log(`[worker] loaded ${alias} (${def.id}, ${def.dtype}, ${sizeMB}MB; total=${totalLoadedMB()}MB)`);
}

async function loadModelForPipeline({ id, dtype }) {
  const alias = Object.keys(SOURCES).find((k) => {
    const s = SOURCES[k];
    return s.kind === 'hf' && s.id === id && s.dtype === dtype;
  });
  if (!alias) throw new Error(`[worker] unknown model ${id}@${dtype}`);
  await ensureModelLoaded(alias);
  const entry = loadedModels.get(alias);
  return {
    infer: async (text) => await entry.ner(text),
    dispose: async () => {},
  };
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'configure') {
    try {
      await ensureWasm();
      const enabledEntities = e.data.enabledEntities ?? [];
      const requiredAliases = requiredSources(enabledEntities).filter((a) => SOURCES[a]?.kind === 'hf');
      currentConfig = { enabledEntities, requiredAliases };
      await disposeUnusedModels(requiredAliases);
      self.postMessage({ type: 'configured', requiredAliases });
    } catch (err) {
      console.error('[worker] configure failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (type === 'classify') {
    if (!currentConfig) {
      self.postMessage({ type: 'error', message: 'Worker not configured' });
      return;
    }
    if (currentConfig.enabledEntities.length === 0) {
      self.postMessage({ type: 'error', message: 'No entities enabled' });
      return;
    }
    self.postMessage({ type: 'timing', mark: 'classify:start', t: performance.now() });
    try {
      const sortSources = (hf) => [...hf].sort((a, b) => {
        const aLoaded = loadedModels.has(a.alias) ? 0 : 1;
        const bLoaded = loadedModels.has(b.alias) ? 0 : 1;
        if (aLoaded !== bLoaded) return aLoaded - bLoaded;
        return (SOURCES[a.alias]?.sizeMB ?? 0) - (SOURCES[b.alias]?.sizeMB ?? 0);
      });
      const pipelineConfig = createDefaultPipeline(
        loadModelForPipeline,
        get_sentence_boundaries,
        { enabledEntities: currentConfig.enabledEntities, entitySources: ENTITY_SOURCES, sources: SOURCES, sortSources },
      );
      const ctx = await runPipeline(e.data.text, pipelineConfig);
      self.postMessage({
        type: 'result',
        data: ctx.entities,
        anonymized: ctx.anonymized,
        legend: ctx.legend,
        debug: ctx.debug,
      });
    } catch (err) {
      console.error('[worker] classify failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }
};
