import { ExtractionFailedError } from './errors.js';
import { ENGINE } from '../ocr/models.js';

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
  const onProgress = deps.onProgress ?? (() => {});
  const signal = deps.signal;

  if (signal?.aborted) {
    const { OcrCancelledError } = await import('../ocr/errors.js');
    throw new OcrCancelledError();
  }

  let blob = file;
  let ocr = null;
  let onAbort = null;
  try {
    if (isHeic(file)) {
      const mod = await loadHeicTo();
      blob = await mod.heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
    }
    ocr = await loadOcr();
    if (signal) {
      onAbort = () => ocr.cancel?.();
      signal.addEventListener('abort', onAbort);
    }
    onProgress({ stage: 'ocr-plan', kind: 'image', current: 0, completed: 0, total: 1, pageCount: 1 });
    if (typeof ocr.onProgress === 'function') {
      ocr.onProgress(onProgress);
    }
    if (typeof ocr.onModelLoad === 'function' && deps.onModelLoad) {
      ocr.onModelLoad(deps.onModelLoad);
    }
    const result = await ocr.ocrImage(blob, {
      onRunStart: () => onProgress({
        stage: 'ocr',
        kind: 'image',
        status: 'page-start',
        current: 1,
        completed: 0,
        total: 1,
        page: 1,
      }),
    });
    onProgress({ stage: 'ocr', kind: 'image', status: 'page-done', current: 1, completed: 1, total: 1, page: 1 });
    return {
      text: result.text,
      meta: {
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        ocr: { engine: ENGINE, backend: result.backend },
      },
    };
  } catch (err) {
    if (err.name === 'OcrCancelledError' || err.name === 'WebNNUnavailableError') {
      throw err;
    }
    throw new ExtractionFailedError('image', err);
  } finally {
    if (onAbort && signal) {
      try { signal.removeEventListener('abort', onAbort); } catch { /* swallow */ }
    }
  }
}
