import { extractPdf, PAGE_TEXT_THRESHOLD, PAGE_TEXT_DENSE_THRESHOLD } from './pdf.js';
import { ExtractionFailedError } from './errors.js';

function fakeFile(name = 'a.pdf', size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: 'application/pdf' });
}

function fakePdfjs(pages, opts = {}) {
  const renderCalls = [];
  const destroy = vi.fn();
  const operatorListCalls = [];
  const OPS = {
    paintImageXObject: 85,
    paintInlineImageXObject: 87,
    paintImageXObjectRepeat: 88,
  };
  const pageOps = opts.pageOps || [];
  return {
    GlobalWorkerOptions: {},
    OPS,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: (n) =>
          Promise.resolve({
            getTextContent: () =>
              opts.rejectTextContent
                ? Promise.reject(new Error('boom'))
                : Promise.resolve({
                    items: pages[n - 1].map((s) =>
                      typeof s === 'string' ? { str: s, hasEOL: true } : s,
                    ),
                  }),
            getViewport: ({ scale }) => ({ width: 800 * scale, height: 1000 * scale }),
            render: ({ canvasContext, viewport }) => {
              renderCalls.push({ page: n, scale: viewport.width / 800 });
              return { promise: Promise.resolve() };
            },
            getOperatorList: () => {
              operatorListCalls.push(n);
              const fnArray = pageOps[n - 1] || [];
              return Promise.resolve({ fnArray });
            },
          }),
      }),
      destroy,
    }),
    _renderCalls: renderCalls,
    _destroy: destroy,
    _operatorListCalls: operatorListCalls,
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
        ocrBitmap: async (_bitmap, runOptions = {}) => {
          runOptions.onRunStart?.();
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

  it('does not split identifiers across mid-line font changes (PESEL net)', async () => {
    const out = await extractPdf(fakeFile(), {
      ...pdfjs([[
        { str: 'Dokument tożsamości obywatela', hasEOL: true },
        { str: 'PESEL: 920508', hasEOL: false },
        { str: '12345', hasEOL: true },
      ]]),
      ...makeOffscreenCanvasFakes().deps,
    });
    expect(out.text).toContain('PESEL: 92050812345');
    expect(/\b\d{11}\b/.test(out.text)).toBe(true);
    expect(out.meta.pages).toEqual([{ index: 1, source: 'text' }]);
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
    expect(out.meta.ocr).toEqual({ engine: 'paddleocr-v5', backend: 'wasm' });
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

describe('extractPdf — progress and cancellation', () => {
  it('emits onProgress per OCR page', async () => {
    const events = [];
    const ocr = ocrSpy(['p1', 'p2']);
    await extractPdf(fakeFile(), {
      ...pdfjs([[''], ['']]),
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
      onProgress: (e) => events.push(e),
    });
    expect(events).toEqual([
      { stage: 'ocr-plan', kind: 'pdf', current: 0, completed: 0, total: 2, pageCount: 2 },
      { stage: 'ocr', kind: 'pdf', status: 'page-start', current: 1, completed: 0, total: 2, page: 1, pageCount: 2 },
      { stage: 'ocr', kind: 'pdf', status: 'page-done', current: 1, completed: 1, total: 2, page: 1, pageCount: 2 },
      { stage: 'ocr', kind: 'pdf', status: 'page-start', current: 2, completed: 1, total: 2, page: 2, pageCount: 2 },
      { stage: 'ocr', kind: 'pdf', status: 'page-done', current: 2, completed: 2, total: 2, page: 2, pageCount: 2 },
    ]);
  });

  it('honors abortSignal — aborts before next OCR page', async () => {
    const controller = new AbortController();
    let invocations = 0;
    const ocr = {
      loadOcr: async () => ({
        ocrBitmap: async () => {
          invocations++;
          if (invocations === 1) controller.abort();
          return { text: 'p', confidence: 0.9, backend: 'wasm' };
        },
        cancel: () => {},
      }),
    };
    const promise = extractPdf(fakeFile(), {
      ...pdfjs([[''], [''], ['']]),
      ...makeOffscreenCanvasFakes().deps,
      ...ocr,
      signal: controller.signal,
    });
    await expect(promise).rejects.toMatchObject({ name: 'OcrCancelledError' });
    expect(invocations).toBe(1);
  });
});

describe('extractPdf — loadingTask lifecycle (#37)', () => {
  it('destroys the loadingTask exactly once after a successful text-only extraction', async () => {
    const pdf = pdfjs([['x'.repeat(PAGE_TEXT_DENSE_THRESHOLD + 1)]]);
    const out = await extractPdf(fakeFile(), {
      ...pdf,
      ...makeOffscreenCanvasFakes().deps,
    });
    expect(out.meta.pages).toEqual([{ index: 1, source: 'text' }]);
    expect(pdf.pdfjsRef._destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the loadingTask exactly once after a successful OCR extraction', async () => {
    const ocr = ocrSpy(['OCR']);
    const pdf = pdfjs([['']]);
    await extractPdf(fakeFile(), {
      ...pdf,
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
    });
    expect(pdf.pdfjsRef._destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the loadingTask when getTextContent rejects', async () => {
    const pdf = pdfjs([['x'.repeat(100)]], { rejectTextContent: true });
    await expect(
      extractPdf(fakeFile(), {
        ...pdf,
        ...makeOffscreenCanvasFakes().deps,
      }),
    ).rejects.toBeInstanceOf(ExtractionFailedError);
    expect(pdf.pdfjsRef._destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the loadingTask when the run is cancelled', async () => {
    const controller = new AbortController();
    const ocr = {
      loadOcr: async () => ({
        ocrBitmap: async () => {
          controller.abort();
          return { text: 'p', confidence: 0.9, backend: 'wasm' };
        },
        cancel: () => {},
      }),
    };
    const pdf = pdfjs([[''], ['']]);
    await expect(
      extractPdf(fakeFile(), {
        ...pdf,
        ...makeOffscreenCanvasFakes().deps,
        ...ocr,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'OcrCancelledError' });
    expect(pdf.pdfjsRef._destroy).toHaveBeenCalledTimes(1);
  });
});

describe('extractPdf — image-aware sparse-text classification (#23)', () => {
  it('OCRs a sparse page that carries a painted image (Bates stamp)', async () => {
    const ocr = ocrSpy(['BATES 0001']);
    const pdf = pdfjs([['x'.repeat(22)]], { pageOps: [[85]] });
    const out = await extractPdf(fakeFile(), {
      ...pdf,
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
    });
    expect(out.meta.pages).toEqual([{ index: 1, source: 'ocr', confidence: 0.9 }]);
    expect(ocr.spy).toHaveLength(1);
  });

  it('keeps a sparse image-free page on the text path', async () => {
    const ocr = ocrSpy(['SHOULD NOT RUN']);
    const pdf = pdfjs([['x'.repeat(22)]], { pageOps: [[]] });
    const out = await extractPdf(fakeFile(), {
      ...pdf,
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
    });
    expect(out.meta.pages).toEqual([{ index: 1, source: 'text' }]);
    expect(ocr.spy).toHaveLength(0);
  });

  it('never calls getOperatorList for dense pages', async () => {
    const pdf = pdfjs([['x'.repeat(PAGE_TEXT_DENSE_THRESHOLD + 100)]], { pageOps: [[85]] });
    await extractPdf(fakeFile(), {
      ...pdf,
      ...makeOffscreenCanvasFakes().deps,
    });
    expect(pdf.pdfjsRef._operatorListCalls).toEqual([]);
  });

  it('classifies sub-threshold pages as OCR without consulting the operator list', async () => {
    const ocr = ocrSpy(['p1']);
    const pdf = pdfjs([['']], { pageOps: [[85]] });
    await extractPdf(fakeFile(), {
      ...pdf,
      ...makeOffscreenCanvasFakes().deps,
      ...ocr.deps,
    });
    expect(ocr.spy).toHaveLength(1);
    expect(pdf.pdfjsRef._operatorListCalls).toEqual([]);
  });
});

describe('extractPdf — mid-OCR abort listener (#32)', () => {
  it('cancels in-flight OCR when the signal aborts during ocrBitmap', async () => {
    const controller = new AbortController();
    let cancelCount = 0;
    const ocr = {
      loadOcr: async () => ({
        ocrBitmap: async () => {
          controller.abort();
          const { OcrCancelledError } = await import('../ocr/errors.js');
          throw new OcrCancelledError();
        },
        cancel: () => { cancelCount++; },
      }),
    };
    const pdf = pdfjs([['']]);
    await expect(
      extractPdf(fakeFile(), {
        ...pdf,
        ...makeOffscreenCanvasFakes().deps,
        ...ocr,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'OcrCancelledError' });
    expect(cancelCount).toBe(1);
    expect(pdf.pdfjsRef._destroy).toHaveBeenCalledTimes(1);
  });
});
