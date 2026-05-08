import { createOcr } from './index.js';
import { OcrCancelledError } from './errors.js';

function makeFakeEngine(impl) {
  let cancelled = false;
  return {
    run: async (input) => {
      if (cancelled) {
        cancelled = false;
        throw new OcrCancelledError();
      }
      return impl(input);
    },
    cancel: () => { cancelled = true; },
    getBackend: () => 'wasm',
  };
}

describe('createOcr', () => {
  it('ocrBitmap returns text + meta', async () => {
    const engine = makeFakeEngine(async () => ({ text: 'hello', confidence: 0.9, backend: 'wasm' }));
    const ocr = createOcr({ engine });
    const out = await ocr.ocrBitmap({ width: 100, height: 100 });
    expect(out.text).toBe('hello');
    expect(out.confidence).toBe(0.9);
    expect(out.backend).toBe('wasm');
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
});
