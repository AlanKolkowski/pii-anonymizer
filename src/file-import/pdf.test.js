import { extractPdf, PAGE_TEXT_THRESHOLD } from './pdf.js';
import { ExtractionFailedError } from './errors.js';

function fakeFile(name = 'a.pdf', size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: 'application/pdf' });
}

function fakePdfjs(pages, opts = {}) {
  const renderCalls = [];
  return {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: (n) => Promise.resolve({
          getTextContent: () => Promise.resolve({
            items: pages[n - 1].map((str) => ({ str, hasEOL: true })),
          }),
          getViewport: ({ scale }) => ({ width: 800 * scale, height: 1000 * scale }),
          render: ({ canvasContext, viewport }) => {
            renderCalls.push({ page: n, scale: viewport.width / 800 });
            return { promise: Promise.resolve() };
          },
        }),
      }),
    }),
    _renderCalls: renderCalls,
  };
}

const pdfjs = (pages, opts = {}) => {
  const mod = fakePdfjs(pages, opts);
  return {
    loadPdfjs: async () => mod,
    loadPdfWorkerUrl: async () => 'fake.mjs',
    pdfjsRef: mod,
  };
};

function ocrSpy(perPageText, opts = {}) {
  const calls = [];
  return {
    spy: calls,
    deps: {
      loadOcr: async () => ({
        ocrBitmap: async () => {
          calls.push({});
          if (opts.throwOnIndex === calls.length - 1) {
            throw new Error('boom');
          }
          return { text: perPageText[calls.length - 1] ?? '', confidence: 0.9, backend: 'wasm' };
        },
        cancel: () => {},
      }),
    },
  };
}

function makeOffscreenCanvasFakes() {
  // jsdom does not implement OffscreenCanvas. Inject a minimal fake.
  const made = [];
  return {
    deps: {
      makeCanvas: ({ width, height }) => {
        const canvas = {
          width,
          height,
          getContext: () => ({ /* render() doesn't actually need to draw */ }),
          transferToImageBitmap: () => ({ width, height, close: () => {} }),
        };
        made.push(canvas);
        return canvas;
      },
    },
    canvases: made,
  };
}

describe('extractPdf — text-only PDFs', () => {
  it('uses text-path for all pages when each has text above the threshold', async () => {
    const dense = ['x'.repeat(PAGE_TEXT_THRESHOLD + 1)];
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([dense]),
      ...makeOffscreenCanvasFakes().deps,
    });
    expect(out.text.length).toBeGreaterThan(PAGE_TEXT_THRESHOLD);
    expect(out.meta.pages).toEqual([{ index: 1, source: 'text' }]);
    expect(out.meta.ocr).toBeUndefined();
  });

  it('joins multi-page text with double newlines', async () => {
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([
        ['Hello'.repeat(15)],
        ['World'.repeat(15)],
      ]),
      ...makeOffscreenCanvasFakes().deps,
    });
    expect(out.text).toContain('Hello');
    expect(out.text).toContain('World');
    expect(out.text).toMatch(/Hello.*\n\n.*World/s);
  });
});

describe('extractPdf — mixed / OCR PDFs', () => {
  it('runs OCR for pages below the text threshold and stitches them in', async () => {
    const ocr = ocrSpy(['OCR FROM PAGE 2']);
    const canvasFakes = makeOffscreenCanvasFakes();
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([
        ['x'.repeat(PAGE_TEXT_THRESHOLD + 1)],
        [''], // empty page → OCR-path
      ]),
      ...canvasFakes.deps,
      ...ocr.deps,
    });
    expect(out.text).toContain('x');
    expect(out.text).toContain('OCR FROM PAGE 2');
    expect(out.meta.pages).toEqual([
      { index: 1, source: 'text' },
      { index: 2, source: 'ocr', confidence: 0.9 },
    ]);
    expect(out.meta.ocr).toEqual({ engine: 'paddleocr-v4', backend: 'wasm' });
    expect(ocr.spy).toHaveLength(1);
  });

  it('OCRs every page when none have extractable text', async () => {
    const ocr = ocrSpy(['p1', 'p2']);
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([[''], ['']]),
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
    });
    expect(out.text).toContain('p1');
    expect(out.text).toContain('p2');
    expect(out.meta.pages).toEqual([
      { index: 1, source: 'ocr', confidence: 0.9 },
      { index: 2, source: 'ocr', confidence: 0.9 },
    ]);
    expect(ocr.spy).toHaveLength(2);
  });

  it('inlines [OCR strony N nie powiódł się] when one page OCR fails', async () => {
    const ocr = ocrSpy(['', 'p2'], { throwOnIndex: 0 });
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([[''], ['']]),
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
    });
    expect(out.text).toContain('[OCR strony 1 nie powiódł się]');
    expect(out.text).toContain('p2');
    expect(out.meta.pages[0].source).toBe('ocr');
  });

  it('threshold edge: page with PAGE_TEXT_THRESHOLD non-ws chars uses text-path', async () => {
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([['x'.repeat(PAGE_TEXT_THRESHOLD)]]),
      ...makeOffscreenCanvasFakes().deps,
    });
    expect(out.meta.pages).toEqual([{ index: 1, source: 'text' }]);
  });
});

describe('extractPdf — error wrapping', () => {
  it('wraps pdfjs failures in ExtractionFailedError', async () => {
    const exploding = {
      loadPdfjs: async () => ({
        GlobalWorkerOptions: {},
        getDocument: () => ({ promise: Promise.reject(new Error('boom')) }),
      }),
      loadPdfWorkerUrl: async () => 'fake.mjs',
      ...makeOffscreenCanvasFakes().deps,
    };
    await expect(extractPdf(fakeFile(), exploding)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
