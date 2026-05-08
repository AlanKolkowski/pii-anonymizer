import { createPaddleEngine } from './paddle.js';

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
