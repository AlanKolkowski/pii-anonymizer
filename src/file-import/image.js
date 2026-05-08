import { ExtractionFailedError } from './errors.js';

const HEIC_TYPES = new Set(['image/heic', 'image/heif']);
const HEIC_EXTS = new Set(['heic', 'heif']);

async function defaultLoadOcr() {
  const { getWorkerBackedOcr } = await import('../ocr/index.js');
  return getWorkerBackedOcr();
}

async function defaultLoadHeicTo() {
  return await import('heic-to');
}

function isHeic(file) {
  if (HEIC_TYPES.has(file.type)) return true;
  const dot = file.name.lastIndexOf('.');
  if (dot >= 0) {
    const ext = file.name.slice(dot + 1).toLowerCase();
    if (HEIC_EXTS.has(ext)) return true;
  }
  return false;
}

export async function extractImage(file, deps = {}) {
  const loadOcr = deps.loadOcr ?? defaultLoadOcr;
  const loadHeicTo = deps.loadHeicTo ?? defaultLoadHeicTo;

  let blob = file;
  try {
    if (isHeic(file)) {
      const mod = await loadHeicTo();
      blob = await mod.heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
    }
    const ocr = await loadOcr();
    const result = await ocr.ocrImage(blob);
    return {
      text: result.text,
      meta: {
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        ocr: { engine: 'paddleocr-v4', backend: result.backend },
      },
    };
  } catch (err) {
    if (err.name === 'OcrCancelledError' || err.name === 'WebNNUnavailableError') {
      throw err;
    }
    throw new ExtractionFailedError('image', err);
  }
}
