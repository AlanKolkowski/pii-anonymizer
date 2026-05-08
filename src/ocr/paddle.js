import { OcrFailedError, OcrCancelledError } from './errors.js';
import { TEXT_RECOGNITION_MODEL_NAME, TEXT_RECOGNITION_MODEL_URL } from './models.js';

// The official @paddleocr/paddleocr-js SDK owns its own worker (via
// `worker: true`) and ONNX Runtime Web setup, so we don't manage either.
// Pinning ORT WASM to jsDelivr keeps versions in sync between main thread and
// worker — the SDK's architecture doc explicitly recommends this.
const DEFAULT_WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

async function defaultLoadSdk() {
  return await import('@paddleocr/paddleocr-js');
}

export function createPaddleEngine(deps = {}) {
  const loadSdk = deps.loadSdk ?? defaultLoadSdk;
  const ortOptions = deps.ortOptions ?? {
    backend: 'wasm',
    wasmPaths: DEFAULT_WASM_PATHS,
  };
  const createWorker = deps.createWorker;
  const sdkOptions = deps.sdkOptions;

  let instance = null;
  let initPromise = null;
  let cancelRequested = false;
  let onModelLoadListener = null;
  let modelLoadAnnounced = false;
  let backend = ortOptions.backend ?? 'wasm';

  function emitLoadStart() {
    if (modelLoadAnnounced) return;
    modelLoadAnnounced = true;
    onModelLoadListener?.({ type: 'model:load:start', engine: 'paddleocr-v5' });
  }

  function emitLoadEnd() {
    if (!modelLoadAnnounced) return;
    onModelLoadListener?.({ type: 'model:load:end', engine: 'paddleocr-v5' });
  }

  async function ensureInit() {
    if (instance) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const sdk = await loadSdk();
      const PaddleOCR = sdk.PaddleOCR ?? sdk.default?.PaddleOCR;
      if (!PaddleOCR || typeof PaddleOCR.create !== 'function') {
        throw new OcrFailedError(new Error('PaddleOCR.create not exported by @paddleocr/paddleocr-js'));
      }
      try {
        emitLoadStart();
        const made = await PaddleOCR.create({
          worker: createWorker ? { createWorker } : true,
          ortOptions,
          textRecognitionModelName: TEXT_RECOGNITION_MODEL_NAME,
          textRecognitionModelAsset: { url: TEXT_RECOGNITION_MODEL_URL },
          ...sdkOptions,
        });
        // Cancel arrived during init: discard the freshly-made instance.
        if (cancelRequested) {
          try { await made.dispose?.(); } catch { /* swallow */ }
          return;
        }
        instance = made;
        emitLoadEnd();
      } catch (err) {
        initPromise = null;
        throw new OcrFailedError(err);
      }
    })();
    return initPromise;
  }

  async function run(input) {
    if (cancelRequested) {
      cancelRequested = false;
      throw new OcrCancelledError();
    }
    try {
      await ensureInit();
      if (cancelRequested || !instance) {
        cancelRequested = false;
        throw new OcrCancelledError();
      }
      const results = await instance.predict(input);
      const result = Array.isArray(results) ? results[0] : results;
      const items = result?.items ?? [];
      const text = items.map((it) => it?.text ?? '').filter(Boolean).join('\n');
      const confidence = items.length === 0
        ? null
        : items.reduce((s, it) => s + (it?.score ?? 0), 0) / items.length;
      backend = result?.runtime?.requestedBackend ?? backend;
      return { text, confidence, backend };
    } catch (err) {
      if (cancelRequested) {
        cancelRequested = false;
        throw new OcrCancelledError();
      }
      if (err instanceof OcrCancelledError) throw err;
      if (err instanceof OcrFailedError) throw err;
      throw new OcrFailedError(err);
    }
  }

  function cancel() {
    cancelRequested = true;
    if (instance) {
      const i = instance;
      instance = null;
      initPromise = null;
      try { i.dispose?.(); } catch { /* swallow */ }
    }
  }

  function onModelLoad(listener) {
    onModelLoadListener = listener;
  }

  return {
    run,
    cancel,
    onModelLoad,
    getBackend: () => backend,
  };
}
