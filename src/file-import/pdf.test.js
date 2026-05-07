import { extractPdf, SCAN_DETECT_AVG_CHARS_PER_PAGE } from './pdf.js';
import { ExtractionFailedError, ScannedPdfError } from './errors.js';

function fakeFile(name = 'a.pdf', size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: 'application/pdf' });
}

function fakePdfjs(pages) {
  return {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: (n) => Promise.resolve({
          getTextContent: () => Promise.resolve({
            items: pages[n - 1].map((str) => ({ str, hasEOL: true })),
          }),
        }),
      }),
    }),
  };
}

const deps = (pages, workerUrl = 'fake.mjs') => ({
  loadPdfjs: async () => fakePdfjs(pages),
  loadPdfWorkerUrl: async () => workerUrl,
});

describe('extractPdf', () => {
  it('concatenates page text with newlines between pages', async () => {
    // Each page must clear the scan-detect threshold (50 non-ws chars/page).
    const pageOne = ['Hello'.repeat(15), 'world.'.repeat(15)];
    const pageTwo = ['Page two.'.repeat(15)];
    const out = await extractPdf(fakeFile(), deps([pageOne, pageTwo]));
    expect(out.text).toContain('Hello');
    expect(out.text).toContain('Page two.');
    expect(out.text.indexOf('\n')).toBeGreaterThan(-1);
  });

  it('returns meta with pageCount', async () => {
    const file = fakeFile('doc.pdf');
    const out = await extractPdf(file, deps([['hello'.repeat(20)]]));
    expect(out.meta).toEqual({
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      pageCount: 1,
    });
  });

  it('throws ScannedPdfError when avg chars/page is below threshold', async () => {
    const skimpy = Array.from({ length: 5 }, () => ['']);
    await expect(extractPdf(fakeFile(), deps(skimpy))).rejects.toBeInstanceOf(ScannedPdfError);
  });

  it('does not throw ScannedPdfError when threshold is met', async () => {
    const dense = [['x'.repeat(SCAN_DETECT_AVG_CHARS_PER_PAGE + 1)]];
    const out = await extractPdf(fakeFile(), deps(dense));
    expect(out.text.length).toBeGreaterThan(SCAN_DETECT_AVG_CHARS_PER_PAGE);
  });

  it('wraps pdfjs errors in ExtractionFailedError', async () => {
    const exploding = {
      loadPdfjs: async () => ({
        GlobalWorkerOptions: {},
        getDocument: () => ({ promise: Promise.reject(new Error('boom')) }),
      }),
      loadPdfWorkerUrl: async () => 'fake.mjs',
    };
    await expect(extractPdf(fakeFile(), exploding)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('wraps loader failures in ExtractionFailedError', async () => {
    const broken = {
      loadPdfjs: async () => { throw new Error('module not found'); },
      loadPdfWorkerUrl: async () => 'fake.mjs',
    };
    await expect(extractPdf(fakeFile(), broken)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
