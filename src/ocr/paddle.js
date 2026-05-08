import { OcrFailedError, OcrCancelledError, WebNNUnavailableError } from './errors.js';
import { boxesToText, meanConfidence } from './postprocess.js';
import { EXECUTION_PROVIDERS } from './models.js';

async function defaultLoadWrapper() {
  return await import('@gutenye/ocr-browser');
}

export function createPaddleEngine(deps = {}) {
  const loadWrapper = deps.loadWrapper ?? defaultLoadWrapper;

  let session = null;
  let backend = null;
  let initPromise = null;
  let cancelRequested = false;
  let pending = 0;

  async function ensureInit() {
    if (session) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const wrapper = await loadWrapper();
      const create = wrapper.create ?? wrapper.default?.create ?? wrapper.default;
      let lastErr;
      for (const ep of EXECUTION_PROVIDERS) {
        try {
          const s = await create({ executionProviders: [ep] });
          session = s;
          backend = s._backend ?? ep;
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw new WebNNUnavailableError(`No execution provider available: ${lastErr?.message ?? 'unknown'}`);
    })();
    return initPromise;
  }

  async function run(input) {
    if (cancelRequested) {
      cancelRequested = false;
      throw new OcrCancelledError();
    }
    pending++;
    try {
      await ensureInit();
      const boxes = await session.detect(input);
      return {
        text: boxesToText(boxes),
        confidence: meanConfidence(boxes),
        backend,
      };
    } catch (err) {
      if (err instanceof OcrCancelledError || err instanceof WebNNUnavailableError) throw err;
      throw new OcrFailedError(err);
    } finally {
      pending--;
    }
  }

  function cancel() {
    cancelRequested = true;
  }

  return {
    run,
    cancel,
    getBackend: () => backend,
  };
}
