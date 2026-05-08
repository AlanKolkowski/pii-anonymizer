import { createPaddleEngine } from './paddle.js';

async function defaultDecodeBitmap(blob) {
  return await createImageBitmap(blob);
}

// The PaddleOCR SDK spawns its own worker via `worker: true`; we don't manage
// one ourselves. `ocrBitmap` and `ocrImage` run on the main thread, the engine
// marshals to its internal worker.
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
    onModelLoad: (listener) => engine.onModelLoad?.(listener),
    getBackend: () => engine.getBackend(),
  };
}

let singleton = null;

export function getOcr() {
  if (!singleton) singleton = createOcr();
  return singleton;
}

export function setOcrSingleton(instance) { singleton = instance; }
export function resetOcrSingleton() { singleton = null; }

// Kept as an alias for file-import callers; with the official SDK, the engine
// owns its own worker, so this is just `getOcr`.
export const getWorkerBackedOcr = getOcr;
