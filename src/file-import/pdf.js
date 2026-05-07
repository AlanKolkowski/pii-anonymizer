import { ExtractionFailedError, ScannedPdfError } from './errors.js';

export const SCAN_DETECT_AVG_CHARS_PER_PAGE = 50;

async function defaultLoadPdfjs() {
  const mod = await import('pdfjs-dist');
  return mod;
}

async function defaultLoadPdfWorkerUrl() {
  const url = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  return url;
}

let workerConfigured = false;

export async function extractPdf(file, deps = {}) {
  const loadPdfjs = deps.loadPdfjs ?? defaultLoadPdfjs;
  const loadPdfWorkerUrl = deps.loadPdfWorkerUrl ?? defaultLoadPdfWorkerUrl;

  let pdfjs;
  let buf;
  try {
    [pdfjs, buf] = await Promise.all([
      loadPdfjs(),
      file.arrayBuffer(),
    ]);
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
  const pageTexts = [];
  try {
    pdf = await pdfjs.getDocument({ data: buf }).promise;
    pageCount = pdf.numPages;
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str ?? '').join(' ');
      pageTexts.push(pageText);
    }
  } catch (err) {
    throw new ExtractionFailedError('pdf', err);
  }

  const text = pageTexts.join('\n\n');
  const nonWs = text.replace(/\s+/g, '').length;
  if (pageCount > 0 && nonWs / pageCount < SCAN_DETECT_AVG_CHARS_PER_PAGE) {
    throw new ScannedPdfError(pageCount);
  }

  return {
    text,
    meta: {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      pageCount,
    },
  };
}
