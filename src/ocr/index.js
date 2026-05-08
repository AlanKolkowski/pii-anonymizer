import { createPaddleEngine } from './paddle.js';
import {
  OcrCancelledError,
  OcrFailedError,
  WebNNUnavailableError,
} from './errors.js';

// Worker → main thread `postMessage` strips prototype chains. Reconstruct the
// proper subclass instance here so `instanceof` checks downstream (workspace
// `messageFor`, file-import error wrapping) work.
function reconstructOcrError(name, message) {
  let err;
  switch (name) {
    case 'OcrCancelledError':
      err = new OcrCancelledError();
      break;
    case 'WebNNUnavailableError':
      err = new WebNNUnavailableError(message);
      break;
    case 'OcrFailedError':
      err = new OcrFailedError(message);
      break;
    default:
      err = new Error(message);
      err.name = name ?? 'OcrError';
      return err;
  }
  err.message = message;
  return err;
}

async function defaultDecodeBitmap(blob) {
  return await createImageBitmap(blob);
}

export function createOcr(deps = {}) {
  const engine = deps.engine ?? createPaddleEngine();
  const decodeBitmap = deps.decodeBitmap ?? defaultDecodeBitmap;

  async function ocrBitmap(bitmap) {
    return await engine.run(bitmap);
  }

  async function ocrImage(blob) {
    const bitmap = await decodeBitmap(blob);
    try {
      return await engine.run(bitmap);
    } finally {
      bitmap.close?.();
    }
  }

  async function init() {
    if (deps.eagerInit) {
      await engine.run({ width: 1, height: 1, _warmup: true }).catch(() => undefined);
    }
  }

  return {
    ocrBitmap,
    ocrImage,
    init,
    cancel: () => engine.cancel(),
    getBackend: () => engine.getBackend(),
  };
}

let singleton = null;
export function getOcr() {
  if (!singleton) singleton = createOcr();
  return singleton;
}

let nextId = 1;

export function createOcrWorkerProxy(worker) {
  const inflight = new Map();

  worker.onmessage = (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    const pending = msg.id != null ? inflight.get(msg.id) : null;

    switch (msg.type) {
      case 'ocr:done':
        inflight.delete(msg.id);
        pending?.resolve({ text: msg.text, confidence: msg.confidence, backend: msg.backend });
        break;
      case 'ocr:error': {
        inflight.delete(msg.id);
        pending?.reject(reconstructOcrError(msg.name, msg.message));
        break;
      }
      case 'ocr:progress':
        pending?.onProgress?.(msg);
        break;
      case 'model:load:start':
      case 'model:load:end':
        proxy._modelLoadListener?.(msg);
        break;
    }
  };

  function postBitmap(bitmap, onProgress) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      inflight.set(id, { resolve, reject, onProgress });
      worker.postMessage({ type: 'ocr:run', id, imageBitmap: bitmap }, [bitmap]);
    });
  }

  const proxy = {
    ocrBitmap: (bitmap, onProgress) => postBitmap(bitmap, onProgress),
    async ocrImage(blob, onProgress) {
      const bitmap = await createImageBitmap(blob);
      return await postBitmap(bitmap, onProgress);
    },
    cancel() {
      worker.postMessage({ type: 'cancel' });
    },
    onModelLoad(listener) {
      proxy._modelLoadListener = listener;
    },
    getBackend: () => proxy._backend ?? null,
  };
  return proxy;
}

function makeWorker() {
  return new Worker(new URL('../workers/ocr.js', import.meta.url), { type: 'module' });
}

export function setOcrSingleton(instance) { singleton = instance; }
export function resetOcrSingleton() { singleton = null; }

export function getWorkerBackedOcr() {
  if (singleton) return singleton;
  if (typeof Worker === 'undefined') {
    singleton = getOcr();
    return singleton;
  }
  singleton = createOcrWorkerProxy(makeWorker());
  return singleton;
}
