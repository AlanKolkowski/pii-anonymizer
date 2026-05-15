import { pipeline as hfPipeline, env } from '@huggingface/transformers';
import init, { get_sentence_boundaries } from 'sentencex-wasm';
import sentencexWasm from 'sentencex-wasm/sentencex_wasm_bg.wasm?url';
import { classifyWithCache, sha256Hex } from './pipeline/cache-orchestrator.js';
import { SOURCES, ENTITY_SOURCES, requiredSources } from './pipeline/configs/entity-sources.js';
import { ensureModelSourcesCached } from './pipeline/model-download.js';

// ORT-Web's default caps threads aggressively (~min(hw/2, 4)). On 8c+ machines
// that leaves ~30% perf on the table for BERT matmul. Cap at 8 because gains
// flatten past that on memory bandwidth, and on lower-core hardware fall back
// to whatever the machine actually has so we don't oversubscribe.
env.backends.onnx.wasm.numThreads = Math.min(self.navigator.hardwareConcurrency || 4, 8);

// Memory budget for resident HF models in the WASM heap.
// SOURCES[*].sizeMB tracks real ONNX artifact size; this lower-than-raw-heap
// budget reserves headroom for ORT scratch/tokenizer buffers and contiguous
// fp32 allocations. In forced-WASM mode it intentionally prevents fp16+fp32
// co-residency, which has proven too tight despite totaling only ~1.67 GB.
const MEMORY_BUDGET_MB = 1680;

// WebNN compiles a fixed-shape graph at session creation. Pin sequence_length
// so the tokenizer pads/truncates every input to this length; without it, only
// ~25% of nodes run on WebNN and the rest fall back to CPU with memcpy fences.
// 512 covers chunked segments (pipeline chunks at 900 chars ≈ 200-400 tokens)
// and matches XLM-RoBERTa's max_position_embeddings of 514.
const WEBNN_SEQ_LEN = 512;

let wasmReady = false;
let currentConfig = null;
let backendOverride = null; // 'wasm' to force-disable WebNN; null = auto/GPU allowed
let webnnAvailable = false;
const loadedModels = new Map();
const nerCache = new Map();

function postTiming(mark, extra = {}) {
  self.postMessage({ type: 'timing', mark, ...extra, t: performance.now() });
}

function isBackendAvailable(backend) {
  // Whether a backend can run at all in this environment.
  // 'wasm' is universally available; 'webnn-gpu' depends on browser support.
  if (backend === 'wasm') return true;
  if (backend === 'webnn-gpu') return webnnAvailable;
  return false;
}

function isBackendDisabledByUser(backend) {
  // No override → nothing disabled. With an override, only the matching
  // backend is allowed (the UI sends 'wasm' when GPU usage is unchecked).
  return backendOverride != null && backendOverride !== backend;
}

function deviceFor(def) {
  // Try each backend in the source's preference order. Skip ones that aren't
  // available in this environment or have been disabled by the user override.
  const supported = def.backends ?? ['wasm'];
  for (const backend of supported) {
    if (isBackendAvailable(backend) && !isBackendDisabledByUser(backend)) {
      return backend;
    }
  }
  throw new Error(`No usable backend for ${def.id}@${def.dtype}; supported=[${supported.join(', ')}]`);
}

async function ensureWasm() {
  if (!wasmReady) {
    await init(sentencexWasm);
    wasmReady = true;
  }
}

async function applyBackendPreference(requestedBackend = 'wasm') {
  await ensureWasm();
  // 'auto' = no override/GPU allowed; any other value forces that backend.
  const newOverride = requestedBackend === 'auto' ? null : requestedBackend;
  // webnnAvailable reflects raw browser capability; the override is applied
  // separately in deviceFor(), so the two stay decoupled.
  const newWebnnAvailable = 'ml' in self.navigator;
  // Backend selection changed mid-session: drop sessions so they reload
  // on the new device.
  if (newOverride !== backendOverride || newWebnnAvailable !== webnnAvailable) {
    if (loadedModels.size > 0) {
      for (const alias of [...loadedModels.keys()]) await disposeModel(alias);
    }
    // Backend semantics may differ; drop entity cache too.
    nerCache.clear();
  }
  backendOverride = newOverride;
  webnnAvailable = newWebnnAvailable;
  return { requested: requestedBackend, webnnAvailable };
}

function totalLoadedMB() {
  // Budget tracks WASM heap occupancy only. WebNN-GPU sessions live in GPU
  // memory and don't pressure the WASM heap, so they don't count here and
  // aren't candidates for eviction below.
  let total = 0;
  for (const entry of loadedModels.values()) {
    if (entry.device === 'wasm') total += entry.sizeMB;
  }
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
  // Only evict WASM-resident models — disposing a GPU session frees GPU
  // memory but does nothing for WASM heap pressure.
  const candidates = [...loadedModels.entries()]
    .filter(([alias, entry]) => alias !== protectAlias && entry.device === 'wasm')
    .sort((a, b) => a[1].sizeMB - b[1].sizeMB);
  for (const [alias] of candidates) {
    if (totalLoadedMB() + needSizeMB <= MEMORY_BUDGET_MB) return;
    await disposeModel(alias);
  }
}

async function loadPipelineWithDevice(def, device) {
  const opts = {
    dtype: def.dtype,
    // Downloads are preflighted and aggregated in the pipeline load phase.
    // Keep Transformers.js per-file callbacks out of the UI so model session
    // creation during NER cannot reset the download progress indicator.
    progress_callback: () => {},
  };
  if (device === 'webnn-gpu') {
    opts.device = device;
    opts.session_options = {
      freeDimensionOverrides: { batch_size: 1, sequence_length: WEBNN_SEQ_LEN },
    };
  }
  const ner = await hfPipeline('token-classification', def.id, opts);
  if (device === 'webnn-gpu') {
    // The token-classification pipeline calls tokenizer with `padding: true`
    // (= pad to longest in batch), which leaves single-input batches unpadded.
    // WebNN's fixed-shape graph then rejects them. Override `_call` so every
    // tokenization pads/truncates to WEBNN_SEQ_LEN.
    const origCall = ner.tokenizer._call.bind(ner.tokenizer);
    ner.tokenizer._call = (texts, options = {}) => origCall(texts, {
      ...options,
      padding: 'max_length',
      max_length: WEBNN_SEQ_LEN,
      truncation: true,
    });
  }
  return ner;
}

// Concurrent classify messages can race past the loadedModels.has() check
// for the same alias and each kick off a load. The second loadedModels.set
// clobbers the first, leaking the first session in the WASM heap with no
// path to dispose it. Dedupe via in-flight load promises keyed by alias.
const inFlightLoads = new Map();

async function ensureModelLoaded(alias, { emitTiming = true } = {}) {
  if (loadedModels.has(alias)) return;
  const existing = inFlightLoads.get(alias);
  if (existing) {
    await existing;
    return;
  }
  const def = SOURCES[alias];
  if (!def || def.kind !== 'hf') return;

  const promise = (async () => {
    const sizeMB = def.sizeMB ?? 0;
    const targetDevice = deviceFor(def);
    // Only evict for WASM loads; GPU sessions don't pressure the WASM heap.
    if (targetDevice === 'wasm') await evictForBudget(sizeMB, alias);
    if (emitTiming) postTiming('model:load:start', { alias });
    let ner;
    let device = targetDevice;
    try {
      ner = await loadPipelineWithDevice(def, targetDevice);
    } catch (err) {
      if (targetDevice === 'webnn-gpu') {
        console.warn(`[worker] WebNN session failed for ${alias}, falling back to WASM:`, err);
        // Fallback lands on WASM heap, so evict now.
        await evictForBudget(sizeMB, alias);
        ner = await loadPipelineWithDevice(def, 'wasm');
        device = 'wasm';
      } else {
        throw err;
      }
    }
    if (emitTiming) postTiming('model:load:end', { alias });
    loadedModels.set(alias, { ner, sizeMB, device, dispose: async () => await ner.dispose() });
    console.log(`[worker] loaded ${alias} on ${device} (${def.id}, ${def.dtype}, ${sizeMB}MB; wasm-resident=${totalLoadedMB()}MB)`);
  })();

  inFlightLoads.set(alias, promise);
  try {
    await promise;
  } finally {
    inFlightLoads.delete(alias);
  }
}

async function loadModelForPipeline({ alias: requestedAlias, id, dtype }) {
  const alias = requestedAlias ?? Object.keys(SOURCES).find((k) => {
    const s = SOURCES[k];
    return s.kind === 'hf' && s.id === id && s.dtype === dtype;
  });
  if (!alias || SOURCES[alias]?.kind !== 'hf') throw new Error(`[worker] unknown model ${id}@${dtype}`);
  await ensureModelLoaded(alias);
  const entry = loadedModels.get(alias);
  return {
    alias,
    device: entry.device,
    infer: async (text) => await entry.ner(text),
    dispose: async () => {},
  };
}

function allHfSourceAliases() {
  return Object.keys(SOURCES).filter((alias) => SOURCES[alias]?.kind === 'hf');
}

function hfAliasesForEntities(enabledEntities) {
  if (Array.isArray(enabledEntities) && enabledEntities.length > 0) {
    return requiredSources(enabledEntities).filter((alias) => SOURCES[alias]?.kind === 'hf');
  }
  return currentConfig?.requiredAliases?.length ? [...currentConfig.requiredAliases] : allHfSourceAliases();
}

function hfDefsForAliases(aliases) {
  return aliases.map((alias) => SOURCES[alias]).filter((def) => def?.kind === 'hf');
}

function sortHfAliasesForLoad(aliases) {
  return [...aliases].sort((a, b) => {
    const aLoaded = loadedModels.has(a) ? 0 : 1;
    const bLoaded = loadedModels.has(b) ? 0 : 1;
    if (aLoaded !== bLoaded) return aLoaded - bLoaded;
    return (SOURCES[b]?.sizeMB ?? 0) - (SOURCES[a]?.sizeMB ?? 0);
  });
}

async function downloadModelFilesForPipeline(sources) {
  const defs = sources
    .map(({ alias }) => SOURCES[alias])
    .filter((def) => def?.kind === 'hf');
  if (defs.length === 0) {
    self.postMessage({
      type: 'download-progress',
      status: 'plan',
      progress: 100,
      loadedBytes: 0,
      totalBytes: 0,
      cachedFiles: 0,
      remainingFiles: 0,
      totalFiles: 0,
    });
    return;
  }

  await ensureModelSourcesCached(defs, {
    progressCallback: (data) => {
      self.postMessage({ type: 'download-progress', ...data });
    },
  });
}

async function predownloadAndLoadNerModels(requestId, { enabledEntities, backend } = {}) {
  if (backend) await applyBackendPreference(backend);

  const aliases = sortHfAliasesForLoad(hfAliasesForEntities(enabledEntities));
  const defs = hfDefsForAliases(aliases);
  if (defs.length === 0) {
    self.postMessage({
      type: 'predownload-progress',
      phase: 'ner',
      requestId,
      status: 'plan',
      progress: 100,
      loadedBytes: 0,
      totalBytes: 0,
      cachedFiles: 0,
      remainingFiles: 0,
      totalFiles: 0,
    });
    self.postMessage({
      type: 'predownload-progress',
      phase: 'ner-load',
      requestId,
      status: 'complete',
      progress: 100,
      completed: 0,
      total: 0,
    });
    return;
  }

  await ensureModelSourcesCached(defs, {
    progressCallback: (data) => {
      self.postMessage({ type: 'predownload-progress', phase: 'ner', requestId, ...data });
    },
  });

  const total = aliases.length;
  let completed = 0;
  self.postMessage({
    type: 'predownload-progress',
    phase: 'ner-load',
    requestId,
    status: 'plan',
    progress: 0,
    completed,
    total,
    aliases,
  });

  for (const alias of aliases) {
    const wasLoaded = loadedModels.has(alias);
    self.postMessage({
      type: 'predownload-progress',
      phase: 'ner-load',
      requestId,
      status: wasLoaded ? 'ready' : 'loading',
      alias,
      source: alias,
      progress: total > 0 ? (completed / total) * 100 : 100,
      completed,
      total,
      cached: wasLoaded,
      device: loadedModels.get(alias)?.device ?? null,
    });
    await ensureModelLoaded(alias, { emitTiming: false });
    completed += 1;
    self.postMessage({
      type: 'predownload-progress',
      phase: 'ner-load',
      requestId,
      status: 'ready',
      alias,
      source: alias,
      progress: total > 0 ? (completed / total) * 100 : 100,
      completed,
      total,
      cached: wasLoaded,
      device: loadedModels.get(alias)?.device ?? null,
    });
  }

  self.postMessage({
    type: 'predownload-progress',
    phase: 'ner-load',
    requestId,
    status: 'complete',
    progress: 100,
    completed,
    total,
  });
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'predownload-models') {
    const requestId = e.data.requestId;
    try {
      await predownloadAndLoadNerModels(requestId, {
        enabledEntities: e.data.enabledEntities,
        backend: e.data.backend,
      });
      self.postMessage({ type: 'predownload-result', phase: 'ner', requestId });
    } catch (err) {
      console.error('[worker] model pre-download/load failed:', err);
      self.postMessage({ type: 'predownload-error', phase: 'ner', requestId, message: err.message });
    }
    return;
  }

  if (type === 'configure') {
    const configRequestId = e.data.configRequestId;
    try {
      const requestedBackend = e.data.backend ?? 'wasm';
      const backendInfo = await applyBackendPreference(requestedBackend);
      self.postMessage({
        type: 'backend-resolved',
        webnnAvailable: backendInfo.webnnAvailable,
        requested: backendInfo.requested,
        configRequestId,
      });
      const enabledEntities = e.data.enabledEntities ?? [];
      const requiredAliases = requiredSources(enabledEntities).filter((a) => SOURCES[a]?.kind === 'hf');
      currentConfig = { enabledEntities, requiredAliases };
      await disposeUnusedModels(requiredAliases);
      self.postMessage({ type: 'configured', requiredAliases, configRequestId });
    } catch (err) {
      console.error('[worker] configure failed:', err);
      self.postMessage({ type: 'error', message: err.message, configRequestId });
    }
    return;
  }

  if (type === 'classify') {
    const { id } = e.data;
    if (!currentConfig) {
      self.postMessage({ type: 'error', id, message: 'Worker not configured' });
      return;
    }
    if (currentConfig.enabledEntities.length === 0) {
      self.postMessage({ type: 'error', id, message: 'No entities enabled' });
      return;
    }
    postTiming('classify:start');
    try {
      const sortSources = (hf) => [...hf].sort((a, b) => {
        const aLoaded = loadedModels.has(a.alias) ? 0 : 1;
        const bLoaded = loadedModels.has(b.alias) ? 0 : 1;
        if (aLoaded !== bLoaded) return aLoaded - bLoaded;
        // Big-first: WASM linear memory grows in place when the largest model
        // is allocated first, avoiding the heap copy/relocation that happens
        // when a smaller heap has to grow to fit a larger model on top.
        return (SOURCES[b.alias]?.sizeMB ?? 0) - (SOURCES[a.alias]?.sizeMB ?? 0);
      });

      const hash = await sha256Hex(e.data.text);
      const prev = nerCache.get(hash) ?? null;
      const { ctx, cache: newEntry } = await classifyWithCache({
        text: e.data.text,
        enabledEntities: currentConfig.enabledEntities,
        cache: prev,
        sources: SOURCES,
        entitySources: ENTITY_SOURCES,
        loadModel: loadModelForPipeline,
        getSentenceBoundaries: get_sentence_boundaries,
        sortSources,
        prepareModels: downloadModelFilesForPipeline,
        onTimingMark: postTiming,
        onProgress: (event) => self.postMessage(event),
      });
      nerCache.set(hash, newEntry);

      self.postMessage({
        type: 'result',
        id,
        data: ctx.entities,
        anonymized: ctx.anonymized,
        legend: ctx.legend,
        debug: ctx.debug,
      });
    } catch (err) {
      console.error('[worker] classify failed:', err);
      self.postMessage({ type: 'error', id, message: err.message });
    }
    return;
  }
};
