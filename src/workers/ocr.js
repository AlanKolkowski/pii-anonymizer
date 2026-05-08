import { createPaddleEngine } from '../ocr/paddle.js';
import { OcrCancelledError } from '../ocr/errors.js';

const engine = createPaddleEngine({
  loadWrapper: async () => {
    self.postMessage({ type: 'model:load:start', engine: 'paddleocr-v4' });
    try {
      const mod = await import('@gutenye/ocr-browser');
      return mod;
    } finally {
      self.postMessage({ type: 'model:load:end', engine: 'paddleocr-v4' });
    }
  },
});

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'cancel':
      engine.cancel();
      break;

    case 'ocr:run': {
      const { id, imageBitmap } = msg;
      try {
        const out = await engine.run(imageBitmap);
        self.postMessage({
          type: 'ocr:done',
          id,
          text: out.text,
          confidence: out.confidence,
          backend: out.backend,
        });
      } catch (err) {
        self.postMessage({
          type: 'ocr:error',
          id,
          name: err.name ?? 'OcrFailedError',
          message: err.message ?? String(err),
        });
      } finally {
        imageBitmap?.close?.();
      }
      break;
    }
  }
};
