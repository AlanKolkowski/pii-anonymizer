import { extractImage } from './image.js';
import { ExtractionFailedError } from './errors.js';

function makeFile(name, type, size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type });
}

describe('extractImage', () => {
  it('returns text and OCR meta for a PNG', async () => {
    const file = makeFile('photo.png', 'image/png');
    const out = await extractImage(file, {
      loadOcr: async () => ({
        ocrImage: async () => ({ text: 'Jan Kowalski', confidence: 0.9, backend: 'wasm' }),
      }),
    });
    expect(out.text).toBe('Jan Kowalski');
    expect(out.meta).toEqual({
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: file.size,
      ocr: { engine: 'paddleocr-v5', backend: 'wasm' },
    });
  });

  it('lazy-imports heic-to and converts before OCR for HEIC', async () => {
    const file = makeFile('photo.heic', 'image/heic');
    let heicCalled = false;
    const out = await extractImage(file, {
      loadHeicTo: async () => ({
        heicTo: async () => { heicCalled = true; return new Blob(['x'], { type: 'image/jpeg' }); },
      }),
      loadOcr: async () => ({
        ocrImage: async (blob) => ({ text: blob.type, confidence: 0.5, backend: 'wasm' }),
      }),
    });
    expect(heicCalled).toBe(true);
    expect(out.text).toBe('image/jpeg'); // proves the JPEG conversion was forwarded
  });

  it('wraps OCR failures in ExtractionFailedError', async () => {
    const file = makeFile('photo.png', 'image/png');
    await expect(
      extractImage(file, {
        loadOcr: async () => ({ ocrImage: async () => { throw new Error('boom'); } }),
      })
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('emits OCR plan/page progress and forwards model lifecycle listeners', async () => {
    const file = makeFile('photo.png', 'image/png');
    const progress = [];
    const modelLoad = [];
    await extractImage(file, {
      loadOcr: async () => ({
        onProgress: (listener) => listener({ stage: 'model-download', status: 'progress', progress: 50 }),
        onModelLoad: (listener) => listener({ type: 'model:load:start' }),
        ocrImage: async (_blob, options = {}) => {
          options.onRunStart?.();
          return { text: 'ok', confidence: 0.9, backend: 'wasm' };
        },
      }),
      onProgress: (event) => progress.push(event),
      onModelLoad: (event) => modelLoad.push(event),
    });

    expect(progress).toEqual([
      { stage: 'ocr-plan', kind: 'image', current: 0, completed: 0, total: 1, pageCount: 1 },
      { stage: 'model-download', status: 'progress', progress: 50 },
      { stage: 'ocr', kind: 'image', status: 'page-start', current: 1, completed: 0, total: 1, page: 1 },
      { stage: 'ocr', kind: 'image', status: 'page-done', current: 1, completed: 1, total: 1, page: 1 },
    ]);
    expect(modelLoad).toEqual([{ type: 'model:load:start' }]);
  });

  it('does not call heic-to for non-HEIC inputs', async () => {
    const file = makeFile('photo.png', 'image/png');
    let heicCalled = false;
    await extractImage(file, {
      loadHeicTo: async () => { heicCalled = true; return null; },
      loadOcr: async () => ({ ocrImage: async () => ({ text: '', confidence: 0, backend: 'wasm' }) }),
    });
    expect(heicCalled).toBe(false);
  });
});

describe('extractImage — cancellation signal (#32)', () => {
  it('throws OcrCancelledError when the signal is already aborted at entry', async () => {
    const file = makeFile('photo.png', 'image/png');
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractImage(file, {
        loadOcr: async () => ({ ocrImage: async () => ({ text: 'x', confidence: 0.9, backend: 'wasm' }) }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'OcrCancelledError' });
  });

  it('calls ocr.cancel and rejects when the signal aborts during ocrImage', async () => {
    const file = makeFile('photo.png', 'image/png');
    const controller = new AbortController();
    let cancelCount = 0;
    const { OcrCancelledError } = await import('../ocr/errors.js');
    await expect(
      extractImage(file, {
        loadOcr: async () => ({
          ocrImage: async () => {
            controller.abort();
            throw new OcrCancelledError();
          },
          cancel: () => { cancelCount++; },
        }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'OcrCancelledError' });
    expect(cancelCount).toBe(1);
  });

  it('still returns normally when no signal is provided (no behavior change)', async () => {
    const file = makeFile('photo.png', 'image/png');
    const out = await extractImage(file, {
      loadOcr: async () => ({
        ocrImage: async () => ({ text: 'ok', confidence: 0.9, backend: 'wasm' }),
        cancel: () => { throw new Error('cancel must not be called without a signal'); },
      }),
    });
    expect(out.text).toBe('ok');
  });
});
