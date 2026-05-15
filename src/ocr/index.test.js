import { createOcr } from './index.js';
import { OcrCancelledError } from './errors.js';

function makeFakeEngine(impl) {
  let cancelled = false;
  return {
    run: async (input, options = {}) => {
      if (cancelled) {
        cancelled = false;
        throw new OcrCancelledError();
      }
      return impl(input, options);
    },
    cancel: () => { cancelled = true; },
    getBackend: () => 'wasm',
  };
}

describe('createOcr', () => {
  it('ocrBitmap returns text + meta and forwards run options', async () => {
    let started = false;
    const engine = makeFakeEngine(async (_input, options) => {
      options.onRunStart?.();
      return { text: 'hello', confidence: 0.9, backend: 'wasm' };
    });
    const ocr = createOcr({ engine });
    const out = await ocr.ocrBitmap({ width: 100, height: 100 }, { onRunStart: () => { started = true; } });
    expect(out.text).toBe('hello');
    expect(out.confidence).toBe(0.9);
    expect(out.backend).toBe('wasm');
    expect(started).toBe(true);
  });

  it('ocrImage decodes a blob via createImageBitmap and forwards', async () => {
    let called = null;
    const engine = makeFakeEngine(async (input) => { called = input; return { text: 'x', confidence: 1, backend: 'wasm' }; });
    const fakeBitmap = { width: 50, height: 50, close: () => {} };
    const decoder = async () => fakeBitmap;
    const ocr = createOcr({ engine, decodeBitmap: decoder });
    await ocr.ocrImage(new Blob(['x'], { type: 'image/png' }));
    expect(called).toBe(fakeBitmap);
  });

  it('cancel() propagates to the engine', async () => {
    const engine = makeFakeEngine(async () => ({ text: 'y', confidence: 1, backend: 'wasm' }));
    const ocr = createOcr({ engine });
    ocr.cancel();
    await expect(ocr.ocrBitmap({})).rejects.toBeInstanceOf(OcrCancelledError);
  });

  it('init() runs the engine warmup but does not throw if not implemented', async () => {
    const engine = makeFakeEngine(async () => ({ text: '', confidence: 0, backend: 'wasm' }));
    const ocr = createOcr({ engine });
    await expect(ocr.init()).resolves.toBeUndefined();
  });

  it('onModelLoad forwards to the engine listener', async () => {
    let listenerSet = null;
    const engine = {
      run: async () => ({ text: '', confidence: 0, backend: 'wasm' }),
      cancel: () => {},
      getBackend: () => 'wasm',
      onModelLoad: (l) => { listenerSet = l; },
    };
    const ocr = createOcr({ engine });
    const fn = () => {};
    ocr.onModelLoad(fn);
    expect(listenerSet).toBe(fn);
  });

  it('onProgress forwards to the engine listener', async () => {
    let listenerSet = null;
    const engine = {
      run: async () => ({ text: '', confidence: 0, backend: 'wasm' }),
      cancel: () => {},
      getBackend: () => 'wasm',
      onProgress: (l) => { listenerSet = l; },
    };
    const ocr = createOcr({ engine });
    const fn = () => {};
    ocr.onProgress(fn);
    expect(listenerSet).toBe(fn);
  });
});
