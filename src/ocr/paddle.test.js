import { createPaddleEngine } from './paddle.js';
import { OcrFailedError, OcrCancelledError } from './errors.js';

function fakeSdkFactory(predictImpl, opts = {}) {
  const calls = { create: 0, dispose: 0, lastOptions: null };
  const sdk = {
    PaddleOCR: {
      async create(options) {
        calls.create++;
        calls.lastOptions = options;
        if (opts.throwOnCreate) throw opts.throwOnCreate;
        return {
          predict: predictImpl,
          dispose: async () => { calls.dispose++; },
        };
      },
    },
  };
  return { sdk, calls };
}

function okResult(items, runtime = {}) {
  return [{
    image: { width: 100, height: 100 },
    items,
    metrics: { detMs: 1, recMs: 1, totalMs: 2, detectedBoxes: items.length, recognizedCount: items.length },
    runtime: { requestedBackend: 'wasm', detProvider: 'wasm', recProvider: 'wasm', webgpuAvailable: false, ...runtime },
  }];
}

describe('createPaddleEngine', () => {
  it('lazy-initializes on first run and caches the instance', async () => {
    const { sdk, calls } = fakeSdkFactory(async () => okResult([]));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    await engine.run({ kind: 'fake' });
    await engine.run({ kind: 'fake' });
    expect(calls.create).toBe(1);
  });

  it('passes worker:true and the provided ortOptions to PaddleOCR.create', async () => {
    const { sdk, calls } = fakeSdkFactory(async () => okResult([]));
    const engine = createPaddleEngine({
      loadSdk: async () => sdk,
      ortOptions: { backend: 'wasm', wasmPaths: '/local/' },
    });
    await engine.run({ kind: 'fake' });
    expect(calls.lastOptions.worker).toBe(true);
    expect(calls.lastOptions.ortOptions).toEqual({ backend: 'wasm', wasmPaths: '/local/' });
  });

  it('passes a custom createWorker when provided', async () => {
    const { sdk, calls } = fakeSdkFactory(async () => okResult([]));
    const fakeCreateWorker = () => ({ postMessage: () => {}, terminate: () => {} });
    const engine = createPaddleEngine({
      loadSdk: async () => sdk,
      createWorker: fakeCreateWorker,
    });
    await engine.run({ kind: 'fake' });
    expect(calls.lastOptions.worker).toEqual({ createWorker: fakeCreateWorker });
  });

  it('joins items[].text with newlines and averages score for confidence', async () => {
    const { sdk } = fakeSdkFactory(async () => okResult([
      { poly: [], text: 'Jan Kowalski', score: 0.9 },
      { poly: [], text: 'PESEL 80010112345', score: 0.8 },
    ]));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    const out = await engine.run({ kind: 'fake' });
    expect(out.text).toBe('Jan Kowalski\nPESEL 80010112345');
    expect(out.confidence).toBeCloseTo(0.85, 5);
    expect(out.backend).toBe('wasm');
  });

  it('returns null confidence and empty text when no items detected', async () => {
    const { sdk } = fakeSdkFactory(async () => okResult([]));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    const out = await engine.run({ kind: 'fake' });
    expect(out.text).toBe('');
    expect(out.confidence).toBeNull();
  });

  it('reports the backend from runtime.requestedBackend', async () => {
    const { sdk } = fakeSdkFactory(async () => okResult([{ poly: [], text: 'x', score: 0.7 }], { requestedBackend: 'webgpu' }));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    const out = await engine.run({ kind: 'fake' });
    expect(out.backend).toBe('webgpu');
  });

  it('emits model:load:start and model:load:end exactly once per init', async () => {
    const events = [];
    const { sdk } = fakeSdkFactory(async () => okResult([]));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    engine.onModelLoad((e) => events.push(e.type));
    await engine.run({ kind: 'fake' });
    await engine.run({ kind: 'fake' });
    expect(events).toEqual(['model:load:start', 'model:load:end']);
  });

  it('wraps predict failures in OcrFailedError', async () => {
    const { sdk } = fakeSdkFactory(async () => { throw new Error('boom'); });
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    await expect(engine.run({ kind: 'fake' })).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('wraps create failures in OcrFailedError', async () => {
    const { sdk } = fakeSdkFactory(async () => okResult([]), { throwOnCreate: new Error('cdn down') });
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    await expect(engine.run({ kind: 'fake' })).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('cancel() before run rejects with OcrCancelledError', async () => {
    const { sdk } = fakeSdkFactory(async () => okResult([]));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    engine.cancel();
    await expect(engine.run({ kind: 'fake' })).rejects.toBeInstanceOf(OcrCancelledError);
  });

  it('cancel() during init rejects with OcrCancelledError and disposes the just-made instance', async () => {
    const { sdk, calls } = fakeSdkFactory(async () => okResult([]));
    const engine = createPaddleEngine({ loadSdk: async () => sdk });
    const p = engine.run({ kind: 'fake' });
    engine.cancel();
    await expect(p).rejects.toBeInstanceOf(OcrCancelledError);
    expect(calls.dispose).toBe(1);
  });
});
