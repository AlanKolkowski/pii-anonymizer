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

import { createOcrWorkerProxy } from './index.js';

class FakeWorker {
  constructor() {
    this.postMessage = (data, transfer) => { this._lastPost = { data, transfer }; };
    this.terminate = () => { this.terminated = true; };
    this.onmessage = null;
    this._lastPost = null;
  }
  // helper for tests:
  trigger(data) { this.onmessage?.({ data }); }
}

describe('createOcrWorkerProxy', () => {
  it('forwards ocrBitmap to the worker and resolves with done payload', async () => {
    const worker = new FakeWorker();
    const proxy = createOcrWorkerProxy(worker);
    const promise = proxy.ocrBitmap({ width: 10, height: 10, close: () => {} });
    expect(worker._lastPost.data.type).toBe('ocr:run');
    const id = worker._lastPost.data.id;
    worker.trigger({ type: 'ocr:done', id, text: 'hi', confidence: 0.9, backend: 'wasm' });
    const out = await promise;
    expect(out).toEqual({ text: 'hi', confidence: 0.9, backend: 'wasm' });
  });

  it('rejects when the worker reports an error', async () => {
    const worker = new FakeWorker();
    const proxy = createOcrWorkerProxy(worker);
    const promise = proxy.ocrBitmap({ width: 1, height: 1, close: () => {} });
    const id = worker._lastPost.data.id;
    worker.trigger({ type: 'ocr:error', id, name: 'OcrFailedError', message: 'boom' });
    await expect(promise).rejects.toMatchObject({ name: 'OcrFailedError', message: 'boom' });
  });

  it('cancel() posts a cancel message', () => {
    const worker = new FakeWorker();
    const proxy = createOcrWorkerProxy(worker);
    proxy.cancel();
    expect(worker._lastPost.data).toEqual({ type: 'cancel' });
  });
});
