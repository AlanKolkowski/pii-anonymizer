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
      ocr: { engine: 'paddleocr-v4', backend: 'wasm' },
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
