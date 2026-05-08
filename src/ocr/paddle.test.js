import { createPaddleEngine } from './paddle.js';
import { OcrFailedError, OcrCancelledError } from './errors.js';

function fakeWrapperFactory(impl) {
  return {
    async create() { return impl; },
  };
}

describe('createPaddleEngine', () => {
  it('lazy-initializes on first run and caches the session', async () => {
    let creates = 0;
    const wrapper = {
      async create() {
        creates++;
        return { detect: async () => [] };
      },
    };
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    await engine.run({ kind: 'fake' });
    await engine.run({ kind: 'fake' });
    expect(creates).toBe(1);
  });

  it('returns text and mean confidence', async () => {
    const wrapper = fakeWrapperFactory({
      detect: async () => [
        { text: 'Jan',     confidence: 0.9, box: { x: 0,   y: 0, w: 50, h: 20 } },
        { text: 'Kowalski',confidence: 0.8, box: { x: 60,  y: 0, w: 90, h: 20 } },
      ],
    });
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    const out = await engine.run({ kind: 'fake' });
    expect(out.text).toBe('Jan Kowalski');
    expect(out.confidence).toBeCloseTo(0.85, 5);
    expect(out.backend).toMatch(/^(webnn|wasm)$/);
  });

  it('records the active backend after init', async () => {
    const wrapper = fakeWrapperFactory({ detect: async () => [], _backend: 'wasm' });
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    await engine.run({ kind: 'fake' });
    expect(engine.getBackend()).toMatch(/^(webnn|wasm)$/);
  });

  it('wraps wrapper failures in OcrFailedError', async () => {
    const wrapper = fakeWrapperFactory({
      detect: async () => { throw new Error('boom'); },
    });
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    await expect(engine.run({ kind: 'fake' })).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('cancel() before run rejects with OcrCancelledError', async () => {
    const wrapper = fakeWrapperFactory({ detect: async () => [] });
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    engine.cancel();
    await expect(engine.run({ kind: 'fake' })).rejects.toBeInstanceOf(OcrCancelledError);
  });

  it('cancel() during run aborts the next run but lets the current one finish', async () => {
    let inFlight;
    const wrapper = fakeWrapperFactory({
      detect: () => new Promise((resolve) => { inFlight = () => resolve([]); }),
    });
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    const p1 = engine.run({ kind: 'fake' });
    // Wait for init + detect() to be entered so inFlight is bound.
    while (!inFlight) await Promise.resolve();
    engine.cancel();
    inFlight();
    await p1;
    await expect(engine.run({ kind: 'fake' })).rejects.toBeInstanceOf(OcrCancelledError);
  });

  it('falls back to wasm when webnn EP creation throws', async () => {
    let attempts = 0;
    const wrapper = {
      async create({ executionProviders } = {}) {
        attempts++;
        if (attempts === 1 && executionProviders?.[0] === 'webnn') {
          throw new Error('webnn unavailable');
        }
        return { detect: async () => [], _backend: 'wasm' };
      },
    };
    const engine = createPaddleEngine({ loadWrapper: async () => wrapper });
    await engine.run({ kind: 'fake' });
    expect(engine.getBackend()).toBe('wasm');
    expect(attempts).toBe(2);
  });
});
