import { ExtractionFailedError } from './errors.js';
import { ENGINE } from '../ocr/models.js';

export const PAGE_TEXT_THRESHOLD = 20;
export const PAGE_TEXT_DENSE_THRESHOLD = 300;
export const RENDER_SCALE = 2.0;

async function defaultLoadPdfjs() {
  return await import('pdfjs-dist');
}

async function defaultLoadPdfWorkerUrl() {
  return (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
}

// PDF.js v5 needs a directory URL (trailing slash) to fetch wasm/JS fallbacks
// for JBig2/OpenJPEG/QCMS. The directory is served by the pdfjs-wasm-assets
// Vite plugin (see vite.config.js). Resolve against `document.baseURI` so the
// URL is correct under both `/` and `/pii-anonymizer/` deployments.
function defaultGetPdfWasmUrl() {
  if (typeof document === 'undefined') return null;
  return new URL('./vendor/pdfjs/wasm/', document.baseURI).href;
}

async function defaultLoadOcr() {
  const { getWorkerBackedOcr } = await import('../ocr/index.js');
  return getWorkerBackedOcr();
}

function defaultMakeCanvas({ width, height }) {
  return new OffscreenCanvas(width, height);
}

let workerConfigured = false;

function nonWhitespaceLength(items) {
  let n = 0;
  for (const it of items) {
    const s = it?.str ?? '';
    for (let i = 0; i < s.length; i++) {
      if (!/\s/.test(s[i])) n++;
    }
  }
  return n;
}

function joinPageItems(items) {
  let out = '';
  for (const it of items) {
    out += it?.str ?? '';
    if (it?.hasEOL) out += '\n';
  }
  return out.trimEnd();
}

// Sparse-text pages (PAGE_TEXT_THRESHOLD ≤ chars < PAGE_TEXT_DENSE_THRESHOLD) are
// only OCRed when they actually carry a painted raster (scan, stamp, Bates label).
// Operator-list failure ⇒ keep legacy text classification (returns false).
async function pageHasPaintedImages(page, pdfjs) {
  try {
    const ops = await page.getOperatorList();
    return ops.fnArray.some(
      (fn) =>
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject ||
        fn === pdfjs.OPS.paintImageXObjectRepeat,
    );
  } catch {
    return false;
  }
}

export async function extractPdf(file, deps = {}) {
  const loadPdfjs = deps.loadPdfjs ?? defaultLoadPdfjs;
  const loadPdfWorkerUrl = deps.loadPdfWorkerUrl ?? defaultLoadPdfWorkerUrl;
  const getPdfWasmUrl = deps.getPdfWasmUrl ?? defaultGetPdfWasmUrl;
  const loadOcr = deps.loadOcr ?? defaultLoadOcr;
  const makeCanvas = deps.makeCanvas ?? defaultMakeCanvas;
  const onProgress = deps.onProgress ?? (() => {});
  const signal = deps.signal;

  let pdfjs;
  let buf;
  try {
    [pdfjs, buf] = await Promise.all([loadPdfjs(), file.arrayBuffer()]);
    if (!workerConfigured && pdfjs?.GlobalWorkerOptions) {
      const url = await loadPdfWorkerUrl();
      pdfjs.GlobalWorkerOptions.workerSrc = url;
      workerConfigured = true;
    }
  } catch (err) {
    throw new ExtractionFailedError('pdf', err);
  }

  let pdf;
  let pageCount = 0;
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({ data: buf, wasmUrl: getPdfWasmUrl() });
    pdf = await loadingTask.promise;
    pageCount = pdf.numPages;
  } catch (err) {
    throw new ExtractionFailedError('pdf', err);
  }

  let ocr = null;
  let ocrBackend = null;
  let ocrDone = 0;
  let onAbort = null;
  try {
    const classifications = [];
    try {
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const chars = nonWhitespaceLength(content.items);
        if (chars < PAGE_TEXT_THRESHOLD) {
          classifications.push({ index: i, source: 'ocr', page });
        } else if (chars >= PAGE_TEXT_DENSE_THRESHOLD) {
          classifications.push({ index: i, source: 'text', text: joinPageItems(content.items) });
        } else if (await pageHasPaintedImages(page, pdfjs)) {
          classifications.push({ index: i, source: 'ocr', page });
        } else {
          classifications.push({ index: i, source: 'text', text: joinPageItems(content.items) });
        }
      }
    } catch (err) {
      throw new ExtractionFailedError('pdf', err);
    }

    const ocrTotal = classifications.filter((c) => c.source === 'ocr').length;
    if (ocrTotal > 0) {
      onProgress({ stage: 'ocr-plan', kind: 'pdf', current: 0, completed: 0, total: ocrTotal, pageCount });
    }

    for (const c of classifications) {
      if (c.source === 'text') continue;
      if (signal?.aborted) {
        const { OcrCancelledError } = await import('../ocr/errors.js');
        ocr?.cancel?.();
        throw new OcrCancelledError();
      }
      if (!ocr) {
        ocr = await loadOcr();
        if (typeof ocr.onProgress === 'function') {
          ocr.onProgress(onProgress);
        }
        if (typeof ocr.onModelLoad === 'function' && deps.onModelLoad) {
          ocr.onModelLoad(deps.onModelLoad);
        }
        if (signal) {
          onAbort = () => ocr.cancel?.();
          signal.addEventListener('abort', onAbort);
        }
      }

      // Abort may have fired while loadOcr() was pending — the listener above is
      // registered too late to catch an already-dispatched abort, so re-check.
      if (signal?.aborted) {
        const { OcrCancelledError } = await import('../ocr/errors.js');
        ocr.cancel?.();
        throw new OcrCancelledError();
      }

      const viewport = c.page.getViewport({ scale: RENDER_SCALE });
      const canvas = makeCanvas({ width: viewport.width, height: viewport.height });
      const ctx = canvas.getContext('2d');
      let bitmap;
      let counted = false;
      const markPageStart = () => onProgress({
        stage: 'ocr',
        kind: 'pdf',
        status: 'page-start',
        current: ocrDone + 1,
        completed: ocrDone,
        total: ocrTotal,
        page: c.index,
        pageCount,
      });
      const markPageDone = () => {
        if (counted) return;
        counted = true;
        ocrDone++;
        onProgress({
          stage: 'ocr',
          kind: 'pdf',
          status: 'page-done',
          current: ocrDone,
          completed: ocrDone,
          total: ocrTotal,
          page: c.index,
          pageCount,
        });
      };
      try {
        await c.page.render({ canvasContext: ctx, viewport }).promise;
        bitmap = canvas.transferToImageBitmap();
        if (signal?.aborted) {
          ocr.cancel?.();
          const { OcrCancelledError } = await import('../ocr/errors.js');
          throw new OcrCancelledError();
        }
        const out = await ocr.ocrBitmap(bitmap, { onRunStart: markPageStart });
        ocrBackend = ocrBackend ?? out.backend;
        c.text = out.text;
        c.confidence = out.confidence;
        markPageDone();
      } catch (err) {
        if (err.name === 'OcrCancelledError' || err.name === 'WebNNUnavailableError') throw err;
        c.text = `[OCR strony ${c.index} nie powiódł się]`;
        c.confidence = null;
        markPageDone();
      } finally {
        bitmap?.close?.();
      }
    }

    const text = classifications.map((c) => c.text).join('\n\n');
    const meta = {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      pageCount,
      pages: classifications.map((c) =>
        c.source === 'ocr'
          ? { index: c.index, source: 'ocr', confidence: c.confidence }
          : { index: c.index, source: 'text' }
      ),
    };
    if (classifications.some((c) => c.source === 'ocr' && c.confidence != null)) {
      meta.ocr = { engine: ENGINE, backend: ocrBackend ?? 'wasm' };
    }
    return { text, meta };
  } finally {
    if (onAbort && signal) {
      try { signal.removeEventListener('abort', onAbort); } catch { /* swallow */ }
    }
    try { await loadingTask.destroy(); } catch { /* swallow — release worker best-effort */ }
  }
}
