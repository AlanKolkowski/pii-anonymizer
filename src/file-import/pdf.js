import { ExtractionFailedError } from './errors.js';

export const PAGE_TEXT_THRESHOLD = 20;
export const RENDER_SCALE = 2.0;

async function defaultLoadPdfjs() {
  return await import('pdfjs-dist');
}

async function defaultLoadPdfWorkerUrl() {
  return (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
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
  return items.map((it) => it?.str ?? '').join(' ');
}

export async function extractPdf(file, deps = {}) {
  const loadPdfjs = deps.loadPdfjs ?? defaultLoadPdfjs;
  const loadPdfWorkerUrl = deps.loadPdfWorkerUrl ?? defaultLoadPdfWorkerUrl;
  const loadOcr = deps.loadOcr ?? defaultLoadOcr;
  const makeCanvas = deps.makeCanvas ?? defaultMakeCanvas;

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
  try {
    pdf = await pdfjs.getDocument({ data: buf }).promise;
    pageCount = pdf.numPages;
  } catch (err) {
    throw new ExtractionFailedError('pdf', err);
  }

  const pageEntries = [];
  let ocrBackend = null;
  let ocr = null;

  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      if (nonWhitespaceLength(content.items) >= PAGE_TEXT_THRESHOLD) {
        pageEntries.push({ index: i, source: 'text', text: joinPageItems(content.items) });
        continue;
      }
      if (!ocr) ocr = await loadOcr();
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = makeCanvas({ width: viewport.width, height: viewport.height });
      const ctx = canvas.getContext('2d');
      let bitmap;
      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
        bitmap = canvas.transferToImageBitmap();
        const out = await ocr.ocrBitmap(bitmap);
        ocrBackend = ocrBackend ?? out.backend;
        pageEntries.push({ index: i, source: 'ocr', text: out.text, confidence: out.confidence });
      } catch (err) {
        if (err.name === 'OcrCancelledError' || err.name === 'WebNNUnavailableError') throw err;
        pageEntries.push({
          index: i,
          source: 'ocr',
          text: `[OCR strony ${i} nie powiódł się]`,
          confidence: null,
        });
      } finally {
        bitmap?.close?.();
      }
    }
  } catch (err) {
    if (err.name === 'OcrCancelledError' || err.name === 'WebNNUnavailableError') throw err;
    throw new ExtractionFailedError('pdf', err);
  }

  const text = pageEntries.map((p) => p.text).join('\n\n');
  const meta = {
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    pageCount,
    pages: pageEntries.map((p) =>
      p.source === 'ocr'
        ? { index: p.index, source: 'ocr', confidence: p.confidence }
        : { index: p.index, source: 'text' }
    ),
  };
  if (pageEntries.some((p) => p.source === 'ocr' && p.confidence != null)) {
    meta.ocr = { engine: 'paddleocr-v4', backend: ocrBackend ?? 'wasm' };
  }
  return { text, meta };
}
