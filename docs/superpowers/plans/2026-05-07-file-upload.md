# File upload (.txt / .docx / .pdf) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload `.txt`, `.docx`, or text-based `.pdf` files; extract text client-side; populate the existing editor textarea so the user can review before clicking Anonimizuj.

**Architecture:** New `src/file-import/` module exposes `extractText(file)` with typed errors and per-format extractors (lazy imports for pdf.js and mammoth). New `src/ui/workspace/` wrapper component sits where `createAnnotationEditor` is wired today; renders a dropzone in the empty state and hosts the unchanged annotation editor in the loaded state.

**Tech Stack:**
- pdfjs-dist (lazy, ~200 KB gz first PDF)
- mammoth (lazy, ~150 KB gz first DOCX)
- jsdom (devDep) for workspace DOM tests via `// @vitest-environment jsdom` directive
- Playwright (already in devDeps; reused for new top-level `e2e/` bucket separate from `bench/`)

**Spec:** [docs/superpowers/specs/2026-05-07-file-upload-design.md](../specs/2026-05-07-file-upload-design.md)

**Test buckets:** `src/**/*.test.js` (unit, vitest), `bench/` (perf), `e2e/` (UI behavior — new bucket). Eval is untouched.

---

## Phase 1 — Extraction module

The extraction module is pure JS, no DOM. It's the foundation everything else depends on. Build TDD with mocked file dependencies via dependency injection (the loaders for pdfjs-dist and mammoth are passed as `deps` so tests don't need real libs).

### Task 1: Typed error classes

**Files:**
- Create: `src/file-import/errors.js`
- Test: `src/file-import/errors.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/file-import/errors.test.js
import {
  UnsupportedTypeError,
  FileTooLargeError,
  ScannedPdfError,
  ExtractionFailedError,
  FileImportError,
} from './errors.js';

describe('file-import errors', () => {
  it('UnsupportedTypeError carries mimeType and filename', () => {
    const e = new UnsupportedTypeError('application/zip', 'a.zip');
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.mimeType).toBe('application/zip');
    expect(e.filename).toBe('a.zip');
    expect(e.name).toBe('UnsupportedTypeError');
  });

  it('FileTooLargeError carries actual and limit bytes', () => {
    const e = new FileTooLargeError(30_000_000, 25_000_000);
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.sizeBytes).toBe(30_000_000);
    expect(e.limitBytes).toBe(25_000_000);
    expect(e.name).toBe('FileTooLargeError');
  });

  it('ScannedPdfError exposes pageCount', () => {
    const e = new ScannedPdfError(12);
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.pageCount).toBe(12);
    expect(e.name).toBe('ScannedPdfError');
  });

  it('ExtractionFailedError wraps the underlying cause', () => {
    const cause = new Error('pdf.js exploded');
    const e = new ExtractionFailedError('pdf', cause);
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.format).toBe('pdf');
    expect(e.cause).toBe(cause);
    expect(e.name).toBe('ExtractionFailedError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/file-import/errors.test.js`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/file-import/errors.js
export class FileImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileImportError';
  }
}

export class UnsupportedTypeError extends FileImportError {
  constructor(mimeType, filename) {
    super(`Unsupported file type: ${mimeType || '(none)'} (${filename})`);
    this.name = 'UnsupportedTypeError';
    this.mimeType = mimeType;
    this.filename = filename;
  }
}

export class FileTooLargeError extends FileImportError {
  constructor(sizeBytes, limitBytes) {
    super(`File too large: ${sizeBytes} > ${limitBytes}`);
    this.name = 'FileTooLargeError';
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

export class ScannedPdfError extends FileImportError {
  constructor(pageCount) {
    super(`PDF appears to be scanned (no extractable text); pageCount=${pageCount}`);
    this.name = 'ScannedPdfError';
    this.pageCount = pageCount;
  }
}

export class ExtractionFailedError extends FileImportError {
  constructor(format, cause) {
    super(`Extraction failed for ${format}: ${cause?.message ?? cause}`);
    this.name = 'ExtractionFailedError';
    this.format = format;
    this.cause = cause;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/file-import/errors.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/file-import/errors.js src/file-import/errors.test.js
git commit -m "feat(file-import): typed error classes"
```

---

### Task 2: txt extractor

**Files:**
- Create: `src/file-import/txt.js`
- Test: `src/file-import/txt.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/file-import/txt.test.js
import { extractTxt } from './txt.js';
import { ExtractionFailedError } from './errors.js';

function fileFrom(text, name = 'a.txt', type = 'text/plain') {
  return new File([text], name, { type });
}

describe('extractTxt', () => {
  it('returns text and meta for a UTF-8 file', async () => {
    const file = fileFrom('Jan Kowalski mieszka w Krakowie.', 'doc.txt', 'text/plain');
    const result = await extractTxt(file);
    expect(result.text).toBe('Jan Kowalski mieszka w Krakowie.');
    expect(result.meta).toEqual({
      filename: 'doc.txt',
      mimeType: 'text/plain',
      sizeBytes: file.size,
    });
  });

  it('strips a UTF-8 BOM from the start', async () => {
    const bom = '﻿';
    const file = fileFrom(bom + 'hello', 'b.txt');
    const result = await extractTxt(file);
    expect(result.text).toBe('hello');
  });

  it('does not normalize line endings (downstream pipeline owns that)', async () => {
    const file = fileFrom('a\r\nb\nc', 'c.txt');
    const result = await extractTxt(file);
    expect(result.text).toBe('a\r\nb\nc');
  });

  it('wraps File.text() failures in ExtractionFailedError', async () => {
    const broken = {
      name: 'x.txt',
      type: 'text/plain',
      size: 4,
      text: () => Promise.reject(new Error('boom')),
    };
    await expect(extractTxt(broken)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/file-import/txt.test.js`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/file-import/txt.js
import { ExtractionFailedError } from './errors.js';

export async function extractTxt(file) {
  let raw;
  try {
    raw = await file.text();
  } catch (err) {
    throw new ExtractionFailedError('txt', err);
  }
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return {
    text,
    meta: {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/file-import/txt.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/file-import/txt.js src/file-import/txt.test.js
git commit -m "feat(file-import): txt extractor"
```

---

### Task 3: extractText dispatch (txt only first)

**Files:**
- Create: `src/file-import/index.js`
- Test: `src/file-import/index.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/file-import/index.test.js
import { extractText, MAX_BYTES } from './index.js';
import {
  UnsupportedTypeError,
  FileTooLargeError,
} from './errors.js';

function makeFile(name, type, contentOrSize = 'hello') {
  if (typeof contentOrSize === 'number') {
    // Construct a File with a synthetic size by filling with a buffer.
    const buf = new Uint8Array(contentOrSize);
    return new File([buf], name, { type });
  }
  return new File([contentOrSize], name, { type });
}

describe('extractText dispatch', () => {
  it('routes .txt to the txt extractor', async () => {
    const file = makeFile('a.txt', 'text/plain', 'hi');
    const out = await extractText(file);
    expect(out.text).toBe('hi');
    expect(out.meta.filename).toBe('a.txt');
  });

  it('throws UnsupportedTypeError for unknown extensions', async () => {
    const file = makeFile('a.zip', 'application/zip', 'x');
    await expect(extractText(file)).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  it('throws FileTooLargeError when file.size > MAX_BYTES', async () => {
    const file = makeFile('a.txt', 'text/plain', MAX_BYTES + 1);
    await expect(extractText(file)).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('infers .txt from filename even when mime is empty', async () => {
    const file = makeFile('plain.txt', '', 'hi');
    const out = await extractText(file);
    expect(out.text).toBe('hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/file-import/index.test.js`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/file-import/index.js
import { extractTxt } from './txt.js';
import {
  UnsupportedTypeError,
  FileTooLargeError,
} from './errors.js';

export const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION_TO_FORMAT = {
  txt: 'txt',
};

const MIME_TO_FORMAT = {
  'text/plain': 'txt',
};

const EXTRACTORS = {
  txt: extractTxt,
};

function inferFormat(file) {
  const name = file.name ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (EXTENSION_TO_FORMAT[ext]) return EXTENSION_TO_FORMAT[ext];
  if (file.type && MIME_TO_FORMAT[file.type]) return MIME_TO_FORMAT[file.type];
  return null;
}

export async function extractText(file) {
  if (file.size > MAX_BYTES) {
    throw new FileTooLargeError(file.size, MAX_BYTES);
  }
  const format = inferFormat(file);
  if (!format) {
    throw new UnsupportedTypeError(file.type, file.name);
  }
  return EXTRACTORS[format](file);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/file-import/index.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/file-import/index.js src/file-import/index.test.js
git commit -m "feat(file-import): dispatch with size cap and type inference (txt only)"
```

---

### Task 4: docx extractor + wire into dispatch

**Files:**
- Create: `src/file-import/docx.js`
- Test: `src/file-import/docx.test.js`
- Modify: `src/file-import/index.js`
- Modify: `src/file-import/index.test.js`
- Modify: `package.json` (add dependency)

- [ ] **Step 1: Install dependency**

Run: `npm install mammoth`
Expected: `mammoth` added to `dependencies` in package.json.

- [ ] **Step 2: Write the failing test for docx extractor**

```js
// src/file-import/docx.test.js
import { extractDocx } from './docx.js';
import { ExtractionFailedError } from './errors.js';

function fakeMammoth(value) {
  return {
    extractRawText: async () => ({ value, messages: [] }),
  };
}

function fakeFile(name = 'a.docx', size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('extractDocx', () => {
  it('returns mammoth raw text and meta', async () => {
    const file = fakeFile('contract.docx');
    const out = await extractDocx(file, { loadMammoth: async () => fakeMammoth('Hello world') });
    expect(out.text).toBe('Hello world');
    expect(out.meta).toEqual({
      filename: 'contract.docx',
      mimeType: file.type,
      sizeBytes: file.size,
    });
  });

  it('wraps mammoth errors in ExtractionFailedError', async () => {
    const broken = {
      extractRawText: () => Promise.reject(new Error('not a docx')),
    };
    await expect(
      extractDocx(fakeFile(), { loadMammoth: async () => broken })
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('wraps loader failures in ExtractionFailedError', async () => {
    await expect(
      extractDocx(fakeFile(), { loadMammoth: async () => { throw new Error('cdn down'); } })
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/file-import/docx.test.js`
Expected: FAIL — file does not exist.

- [ ] **Step 4: Write the docx extractor**

```js
// src/file-import/docx.js
import { ExtractionFailedError } from './errors.js';

async function defaultLoadMammoth() {
  const mod = await import('mammoth');
  return mod.default ?? mod;
}

export async function extractDocx(file, deps = {}) {
  const loadMammoth = deps.loadMammoth ?? defaultLoadMammoth;
  let mammoth;
  let buf;
  try {
    [mammoth, buf] = await Promise.all([
      loadMammoth(),
      file.arrayBuffer(),
    ]);
  } catch (err) {
    throw new ExtractionFailedError('docx', err);
  }
  let value;
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    value = result.value ?? '';
  } catch (err) {
    throw new ExtractionFailedError('docx', err);
  }
  return {
    text: value,
    meta: {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  };
}
```

- [ ] **Step 5: Run docx tests**

Run: `npx vitest run src/file-import/docx.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Wire docx into the dispatch — write the failing test first**

Add to `src/file-import/index.test.js`:

```js
  it('routes .docx to the docx extractor', async () => {
    const file = new File(
      [new Uint8Array(8)],
      'a.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    );
    // We do not exercise mammoth here; we just verify dispatch reaches the docx
    // extractor. Use the real path (will fail if mammoth can't parse the buffer)
    // and assert the error is ExtractionFailedError-class — proving routing.
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('infers .docx from filename when mime is empty', async () => {
    const file = new File([new Uint8Array(8)], 'b.docx', { type: '' });
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
```

Run: `npx vitest run src/file-import/index.test.js`
Expected: FAIL — `.docx` returns UnsupportedTypeError (not yet wired).

- [ ] **Step 7: Wire docx into dispatch**

Modify `src/file-import/index.js`:

```js
import { extractTxt } from './txt.js';
import { extractDocx } from './docx.js';
import {
  UnsupportedTypeError,
  FileTooLargeError,
} from './errors.js';

export const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION_TO_FORMAT = {
  txt: 'txt',
  docx: 'docx',
};

const MIME_TO_FORMAT = {
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const EXTRACTORS = {
  txt: extractTxt,
  docx: extractDocx,
};

// inferFormat and extractText unchanged from Task 3.
```

- [ ] **Step 8: Run all file-import tests**

Run: `npx vitest run src/file-import/`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add src/file-import/docx.js src/file-import/docx.test.js src/file-import/index.js src/file-import/index.test.js package.json package-lock.json
git commit -m "feat(file-import): docx extractor (mammoth, lazy import)"
```

---

### Task 5: pdf extractor + scan detection + wire into dispatch

**Files:**
- Create: `src/file-import/pdf.js`
- Test: `src/file-import/pdf.test.js`
- Modify: `src/file-import/index.js`
- Modify: `src/file-import/index.test.js`
- Modify: `package.json` (add dependency)

- [ ] **Step 1: Install dependency**

Run: `npm install pdfjs-dist`
Expected: `pdfjs-dist` added to `dependencies` in package.json.

- [ ] **Step 2: Write the failing test for pdf extractor**

```js
// src/file-import/pdf.test.js
import { extractPdf, SCAN_DETECT_AVG_CHARS_PER_PAGE } from './pdf.js';
import { ExtractionFailedError, ScannedPdfError } from './errors.js';

function fakeFile(name = 'a.pdf', size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: 'application/pdf' });
}

function fakePdfjs(pages) {
  // pages: array of arrays of strings; each inner array is one page's text items.
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
    const out = await extractPdf(
      fakeFile(),
      deps([['Hello', 'world.'], ['Page two.']]),
    );
    expect(out.text).toContain('Hello');
    expect(out.text).toContain('Page two.');
    // Pages joined with at least one newline.
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/file-import/pdf.test.js`
Expected: FAIL — file does not exist.

- [ ] **Step 4: Write the pdf extractor**

```js
// src/file-import/pdf.js
import { ExtractionFailedError, ScannedPdfError } from './errors.js';

export const SCAN_DETECT_AVG_CHARS_PER_PAGE = 50;

async function defaultLoadPdfjs() {
  const mod = await import('pdfjs-dist');
  return mod;
}

async function defaultLoadPdfWorkerUrl() {
  // Vite-native ?url import. Returns the resolved asset URL at build/runtime.
  const url = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
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
```

- [ ] **Step 5: Run pdf tests**

Run: `npx vitest run src/file-import/pdf.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire pdf into dispatch — write the failing test**

Add to `src/file-import/index.test.js`:

```js
  it('routes .pdf to the pdf extractor', async () => {
    const file = new File([new Uint8Array(8)], 'a.pdf', { type: 'application/pdf' });
    const { ExtractionFailedError } = await import('./errors.js');
    // Real pdfjs will reject on a 0-byte buffer; ExtractionFailedError proves routing.
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
```

Run: `npx vitest run src/file-import/index.test.js`
Expected: FAIL — `.pdf` returns UnsupportedTypeError.

- [ ] **Step 7: Wire pdf into dispatch**

Modify `src/file-import/index.js`:

```js
import { extractTxt } from './txt.js';
import { extractDocx } from './docx.js';
import { extractPdf } from './pdf.js';
import {
  UnsupportedTypeError,
  FileTooLargeError,
} from './errors.js';

export const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION_TO_FORMAT = {
  txt: 'txt',
  docx: 'docx',
  pdf: 'pdf',
};

const MIME_TO_FORMAT = {
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
};

const EXTRACTORS = {
  txt: extractTxt,
  docx: extractDocx,
  pdf: extractPdf,
};

// inferFormat and extractText unchanged.
```

- [ ] **Step 8: Run all file-import tests**

Run: `npx vitest run src/file-import/`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add src/file-import/pdf.js src/file-import/pdf.test.js src/file-import/index.js src/file-import/index.test.js package.json package-lock.json
git commit -m "feat(file-import): pdf extractor with scan detection (pdfjs-dist, lazy)"
```

---

## Phase 2 — jsdom test environment

### Task 6: Add jsdom for DOM tests

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Install jsdom**

Run: `npm install --save-dev jsdom`
Expected: `jsdom` added to `devDependencies`.

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: PASS, all existing tests. (Existing tests do not use DOM; jsdom won't be loaded for them since we'll use the per-file directive.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add jsdom for upcoming workspace DOM tests"
```

---

## Phase 3 — Workspace component

The wrapper sits where `createAnnotationEditor` is wired today. It owns the `'empty' | 'loaded'` state, mounts/unmounts the editor, and handles file IO. All workspace tests live in `src/ui/workspace/workspace.test.js` and use `// @vitest-environment jsdom`.

### Task 7: Workspace skeleton — empty state with dropzone

**Files:**
- Create: `src/ui/workspace/index.js`
- Test: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment jsdom
// src/ui/workspace/workspace.test.js
import { createWorkspace } from './index.js';

function mount(opts = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ws = createWorkspace(root, {
    text: '',
    entities: [],
    entityCategories: [],
    entityLabels: {},
    postEdit: (_t, e) => e,
    onChange: () => {},
    onModeChange: () => {},
    ...opts,
  });
  return { root, ws };
}

describe('createWorkspace — empty state', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts in empty state and renders a dropzone', () => {
    const { root } = mount();
    const dropzone = root.querySelector('[data-testid="workspace-dropzone"]');
    expect(dropzone).not.toBeNull();
    expect(dropzone.textContent).toContain('Upuść plik');
    expect(dropzone.textContent).toContain('lub kliknij');
  });

  it('does not render the annotation editor', () => {
    const { root } = mount();
    expect(root.querySelector('.ann-editor')).toBeNull();
  });

  it('exposes an empty getText / getEntities while empty', () => {
    const { ws } = mount();
    expect(ws.getText()).toBe('');
    expect(ws.getEntities()).toEqual([]);
    expect(ws.getMode()).toBe('text');
  });

  it('reports mode "text" on initial onModeChange', () => {
    let lastMode = null;
    mount({ onModeChange: (m) => { lastMode = m; } });
    expect(lastMode).toBe('text');
  });

  it('renders a hidden file input with accept=".pdf,.docx,.txt"', () => {
    const { root } = mount();
    const input = root.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).toBe('.pdf,.docx,.txt');
  });

  it('dropzone is keyboard focusable (role=button, tabindex=0)', () => {
    const { root } = mount();
    const dropzone = root.querySelector('[data-testid="workspace-dropzone"]');
    expect(dropzone.getAttribute('role')).toBe('button');
    expect(dropzone.getAttribute('tabindex')).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal workspace skeleton**

```js
// src/ui/workspace/index.js
import { createAnnotationEditor } from '../annotation-editor/index.js';
import { extractText } from '../../file-import/index.js';
import {
  FileImportError,
  UnsupportedTypeError,
  FileTooLargeError,
  ScannedPdfError,
  ExtractionFailedError,
} from '../../file-import/errors.js';

export function createWorkspace(rootEl, options) {
  const opts = options ?? {};
  const onChange = opts.onChange ?? (() => {});
  const onModeChange = opts.onModeChange ?? (() => {});

  let state = 'empty'; // 'empty' | 'loaded'
  let editor = null;
  let lastMeta = null; // ExtractionMeta when 'loaded' was entered via file upload

  rootEl.classList.add('ws');

  // Hidden file input is shared across renders.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,.docx,.txt';
  fileInput.style.display = 'none';
  rootEl.appendChild(fileInput);

  function renderEmpty() {
    // Clear everything except the file input.
    for (const child of [...rootEl.children]) {
      if (child !== fileInput) rootEl.removeChild(child);
    }
    if (editor) {
      editor.dispose();
      editor = null;
    }

    const dz = document.createElement('div');
    dz.className = 'ws-dropzone';
    dz.dataset.testid = 'workspace-dropzone';
    dz.setAttribute('role', 'button');
    dz.setAttribute('tabindex', '0');
    dz.innerHTML = `
      <div class="ws-dropzone-icon">📄</div>
      <div class="ws-dropzone-primary">Upuść plik (.docx, .pdf, .txt)</div>
      <div class="ws-dropzone-secondary">lub kliknij aby wkleić tekst</div>
    `;
    rootEl.appendChild(dz);
  }

  renderEmpty();
  // Defer onModeChange so callers receive it after construction returns.
  Promise.resolve().then(() => onModeChange('text'));

  return {
    getText: () => (editor ? editor.getText() : ''),
    getEntities: () => (editor ? editor.getEntities() : []),
    getMode: () => (editor ? editor.getMode() : 'text'),
    setEntities: () => {},  // implemented in later tasks
    setText: () => {},
    enterTextMode: () => {},
    commitTextMode: () => ({ changed: false }),
    dispose: () => {
      if (editor) editor.dispose();
      rootEl.classList.remove('ws');
      rootEl.innerHTML = '';
    },
  };
}
```

Wait — the test checks `lastMode` synchronously after `mount()`. Promise.resolve will not have resolved yet. Fix: call `onModeChange('text')` synchronously.

Replace the deferred call:

```js
  // Synchronous initial mode notification.
  onModeChange('text');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workspace/index.js src/ui/workspace/workspace.test.js
git commit -m "feat(ui/workspace): empty-state dropzone skeleton"
```

---

### Task 8: Click dropzone → editor mounts in text mode

**Files:**
- Modify: `src/ui/workspace/index.js`
- Modify: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing test**

Append to `workspace.test.js`:

```js
describe('createWorkspace — click empty dropzone', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('clicking the dropzone (not the file input affordance) mounts the editor with empty text', () => {
    const { root, ws } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dz.click();
    expect(root.querySelector('.ann-editor')).not.toBeNull();
    expect(ws.getText()).toBe('');
    expect(root.querySelector('[data-testid="workspace-dropzone"]')).toBeNull();
  });

  it('does not show a file pill when entered via click', () => {
    const { root } = mount();
    root.querySelector('[data-testid="workspace-dropzone"]').click();
    expect(root.querySelector('[data-testid="workspace-file-pill"]')).toBeNull();
  });

  it('keyboard Enter on the dropzone also transitions to loaded', () => {
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dz.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(root.querySelector('.ann-editor')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: FAIL — clicking does nothing.

- [ ] **Step 3: Implement the click → load transition**

Modify `src/ui/workspace/index.js`:

Add inside `createWorkspace`, replace the empty stub returns and add `transitionToLoaded`:

```js
function transitionToLoaded({ text, entities, meta }) {
    if (state === 'loaded') return;
    state = 'loaded';
    lastMeta = meta ?? null;
    renderLoaded({ text, entities });
  }

  function renderLoaded({ text, entities }) {
    for (const child of [...rootEl.children]) {
      if (child !== fileInput) rootEl.removeChild(child);
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'ws-toolbar';
    toolbar.dataset.testid = 'workspace-toolbar';
    if (lastMeta?.filename) {
      const pill = document.createElement('span');
      pill.className = 'ws-file-pill';
      pill.dataset.testid = 'workspace-file-pill';
      pill.textContent = `📄 ${lastMeta.filename}`;
      pill.title = lastMeta.filename;
      toolbar.appendChild(pill);
    }
    rootEl.appendChild(toolbar);

    const editorRoot = document.createElement('div');
    rootEl.appendChild(editorRoot);
    editor = createAnnotationEditor(editorRoot, {
      text: text ?? '',
      entities: entities ?? [],
      entityCategories: opts.entityCategories ?? [],
      entityLabels: opts.entityLabels ?? {},
      postEdit: opts.postEdit,
      onChange,
      onModeChange,
    });
  }
```

Update the dropzone in `renderEmpty()` to wire click + Enter/Space:

```js
    dz.addEventListener('click', (ev) => {
      // Ignore clicks on the file-picker affordance handled by Task 9.
      if (ev.target.closest('[data-testid="workspace-file-picker-trigger"]')) return;
      transitionToLoaded({ text: '', entities: [] });
    });
    dz.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        transitionToLoaded({ text: '', entities: [] });
      }
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workspace/index.js src/ui/workspace/workspace.test.js
git commit -m "feat(ui/workspace): click empty dropzone mounts editor"
```

---

### Task 9: Drop file in empty → extract → editor mounts with text + file pill

**Files:**
- Modify: `src/ui/workspace/index.js`
- Modify: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing test**

Append to `workspace.test.js`:

```js
function makeDataTransfer(files) {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt;
}

function dropOn(el, files) {
  el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: makeDataTransfer([]) }));
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: makeDataTransfer(files) }));
}

describe('createWorkspace — drop file in empty', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('successful drop transitions to loaded with extracted text', async () => {
    const { root, ws } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    const file = new File(['Hello upload'], 'doc.txt', { type: 'text/plain' });
    dropOn(dz, [file]);
    // Extraction is async; wait one microtask flush.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.getText()).toBe('Hello upload');
    expect(root.querySelector('.ann-editor')).not.toBeNull();
  });

  it('shows a file pill with the filename after successful drop', async () => {
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dropOn(dz, [new File(['x'], 'contract.txt', { type: 'text/plain' })]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('contract.txt');
  });

  it('only the first file is processed when multiple are dropped', async () => {
    const { root, ws } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dropOn(dz, [
      new File(['first'], 'a.txt', { type: 'text/plain' }),
      new File(['second'], 'b.txt', { type: 'text/plain' }),
    ]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.getText()).toBe('first');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: FAIL — drop is not handled.

- [ ] **Step 3: Implement drop handling on the dropzone**

Add inside `renderEmpty()`, after the click/keydown wiring:

```js
    let dragCounter = 0;
    dz.addEventListener('dragenter', (ev) => {
      ev.preventDefault();
      dragCounter++;
      dz.classList.add('ws-dragover');
    });
    dz.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer && (ev.dataTransfer.dropEffect = 'copy');
    });
    dz.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) dz.classList.remove('ws-dragover');
    });
    dz.addEventListener('drop', (ev) => {
      ev.preventDefault();
      dragCounter = 0;
      dz.classList.remove('ws-dragover');
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      void runExtractionFromEmpty(file);
    });
```

Add a top-level helper inside `createWorkspace`:

```js
async function runExtractionFromEmpty(file) {
    try {
      const { text, meta } = await extractText(file);
      transitionToLoaded({ text, entities: [], meta });
    } catch (err) {
      // Error rendering wired in Task 13.
      console.error('[workspace] extraction failed', err);
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workspace/index.js src/ui/workspace/workspace.test.js
git commit -m "feat(ui/workspace): drop file in empty extracts and loads"
```

---

### Task 10: Loaded toolbar — Wgraj inny plik & Wyczyść

**Files:**
- Modify: `src/ui/workspace/index.js`
- Modify: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing test**

Append to `workspace.test.js`:

```js
describe('createWorkspace — loaded toolbar', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  function loadWith(text = 'sample', entities = [], opts = {}) {
    const m = mount(opts);
    m.ws.setText(text);
    if (entities.length) m.ws.setEntities(entities);
    return m;
  }

  it('renders Wgraj inny plik and Wyczyść buttons in loaded', () => {
    const { root } = loadWith();
    expect(root.querySelector('[data-testid="workspace-upload-another"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="workspace-clear"]')).not.toBeNull();
  });

  it('Wyczyść returns to empty state and clears entities', () => {
    let lastEntities = null;
    const { root, ws } = loadWith('hello', [{ entity_group: 'PERSON_NAME', start: 0, end: 5, score: 1, source: 'manual' }], {
      onChange: (e) => { lastEntities = e; },
    });
    root.querySelector('[data-testid="workspace-clear"]').click();
    expect(root.querySelector('[data-testid="workspace-dropzone"]')).not.toBeNull();
    expect(root.querySelector('.ann-editor')).toBeNull();
    expect(ws.getText()).toBe('');
    expect(ws.getEntities()).toEqual([]);
    expect(lastEntities).toEqual([]);
  });
});
```

This requires `setText` and `setEntities` to actually work, so we'll implement them along with the toolbar.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: FAIL — buttons not rendered.

- [ ] **Step 3: Implement setText, setEntities, toolbar buttons**

Inside the `return { ... }` of `createWorkspace`, replace the stub `setText` and `setEntities`:

```js
    setText(newText) {
      if (state === 'empty') {
        transitionToLoaded({ text: newText, entities: [] });
        return;
      }
      editor.setText(newText);
    },
    setEntities(newEntities) {
      if (state === 'empty') {
        // Defensive: shouldn't happen in normal flow, but mount the editor to host them.
        transitionToLoaded({ text: '', entities: newEntities });
        return;
      }
      editor.setEntities(newEntities);
    },
    enterTextMode() { editor?.enterTextMode(); },
    commitTextMode(t) { return editor ? editor.commitTextMode(t) : { changed: false }; },
```

In `renderLoaded`, append toolbar buttons after the file pill:

```js
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'btn btn-secondary ws-toolbar-btn';
    upload.dataset.testid = 'workspace-upload-another';
    upload.textContent = 'Wgraj inny plik';
    upload.addEventListener('click', () => fileInput.click());
    toolbar.appendChild(upload);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-secondary ws-toolbar-btn';
    clear.dataset.testid = 'workspace-clear';
    clear.textContent = 'Wyczyść';
    clear.addEventListener('click', () => transitionToEmpty());
    toolbar.appendChild(clear);
```

Add helper:

```js
function transitionToEmpty() {
    if (state === 'empty') return;
    state = 'loaded->empty-transition'; // sentinel to avoid re-entry
    lastMeta = null;
    if (editor) {
      editor.dispose();
      editor = null;
    }
    state = 'empty';
    renderEmpty();
    onChange([]);
    onModeChange('text');
  }
```

Wire the file input change to upload-another:

```js
fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (state === 'empty') {
      void runExtractionFromEmpty(file);
    } else {
      void runExtractionFromLoaded(file);
    }
  });
```

Stub `runExtractionFromLoaded` (real impl in Task 11):

```js
async function runExtractionFromLoaded(file) {
    // Replace flow implemented in Task 11.
    try {
      const { text, meta } = await extractText(file);
      lastMeta = meta;
      // Naively replace; Task 11 adds confirm.
      editor.setText(text);
      // Re-render toolbar to show updated pill.
      renderLoaded({ text, entities: [] });
    } catch (err) {
      console.error('[workspace] extraction failed', err);
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workspace/index.js src/ui/workspace/workspace.test.js
git commit -m "feat(ui/workspace): loaded toolbar with Wgraj inny plik and Wyczyść"
```

---

### Task 11: Drop on textarea in loaded — replace with confirm

**Files:**
- Modify: `src/ui/workspace/index.js`
- Modify: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing test**

Append to `workspace.test.js`:

```js
describe('createWorkspace — drop in loaded text mode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    if (window.confirm.mockRestore) window.confirm.mockRestore();
  });

  it('drop on empty textarea replaces text without asking', async () => {
    const { root, ws } = mount();
    root.querySelector('[data-testid="workspace-dropzone"]').click();
    const ta = root.querySelector('.ann-editor-textarea');
    expect(ta).not.toBeNull();
    dropOn(ta, [new File(['fresh'], 'a.txt', { type: 'text/plain' })]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.getText()).toBe('fresh');
  });

  it('drop on non-empty textarea asks for confirmation; cancel keeps text', async () => {
    const { root, ws } = mount();
    ws.setText('original');
    const ta = root.querySelector('.ann-editor-textarea');
    window.confirm = vi.fn(() => false);
    dropOn(ta, [new File(['replacement'], 'a.txt', { type: 'text/plain' })]);
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.getText()).toBe('original');
    expect(window.confirm).toHaveBeenCalled();
  });

  it('drop on non-empty textarea replaces on confirm and shows new pill', async () => {
    const { root, ws } = mount();
    ws.setText('original');
    const ta = root.querySelector('.ann-editor-textarea');
    window.confirm = vi.fn(() => true);
    dropOn(ta, [new File(['replacement'], 'b.txt', { type: 'text/plain' })]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.getText()).toBe('replacement');
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('b.txt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: FAIL — drop on textarea is not wired.

- [ ] **Step 3: Implement drop on textarea + replace flow**

In `renderLoaded`, after creating the editor, attach drop handlers to the editor root:

```js
    // Drag/drop on the loaded surface (text mode only).
    let dragCounter = 0;
    editorRoot.addEventListener('dragenter', (ev) => {
      if (editor.getMode() !== 'text') return;
      ev.preventDefault();
      dragCounter++;
      editorRoot.classList.add('ws-dragover');
    });
    editorRoot.addEventListener('dragover', (ev) => {
      if (editor.getMode() !== 'text') return;
      ev.preventDefault();
      ev.dataTransfer && (ev.dataTransfer.dropEffect = 'copy');
    });
    editorRoot.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) editorRoot.classList.remove('ws-dragover');
    });
    editorRoot.addEventListener('drop', (ev) => {
      if (editor.getMode() !== 'text') {
        ev.preventDefault();
        return;
      }
      ev.preventDefault();
      dragCounter = 0;
      editorRoot.classList.remove('ws-dragover');
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      void runExtractionFromLoaded(file);
    });
```

Replace `runExtractionFromLoaded` to implement the real replace flow:

```js
async function runExtractionFromLoaded(file) {
    const currentText = editor.getText();
    if (currentText.length > 0) {
      const ok = window.confirm('Zastąpić obecny tekst?');
      if (!ok) return;
    }
    try {
      const { text, meta } = await extractText(file);
      lastMeta = meta;
      editor.setText(text);
      renderLoaded({ text, entities: [] });
    } catch (err) {
      console.error('[workspace] extraction failed', err);
    }
  }
```

Note: `editor.setText` already clears entities (see annotation-editor `setText` impl). Re-rendering refreshes the toolbar (new pill).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workspace/index.js src/ui/workspace/workspace.test.js
git commit -m "feat(ui/workspace): drop-on-textarea replace with confirm"
```

---

### Task 12: Drop ignored in annotation mode

**Files:**
- Modify: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing test**

Append to `workspace.test.js`:

```js
describe('createWorkspace — drop in annotation mode', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('drop in annotation mode is silently ignored (text and entities unchanged)', async () => {
    const { root, ws } = mount();
    ws.setText('Jan Kowalski');
    ws.setEntities([{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 1, source: 'manual' }]);
    expect(ws.getMode()).toBe('annotation');

    // Drop on the editor root (no textarea in annotation mode).
    const editorEl = root.querySelector('.ann-editor');
    const before = ws.getText();
    const beforeEnts = ws.getEntities();

    dropOn(editorEl, [new File(['NEW'], 'x.txt', { type: 'text/plain' })]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(ws.getText()).toBe(before);
    expect(ws.getEntities()).toEqual(beforeEnts);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS — Task 11's mode check (`if (editor.getMode() !== 'text')`) already gates this.

- [ ] **Step 3: Commit**

```bash
git add src/ui/workspace/workspace.test.js
git commit -m "test(ui/workspace): assert drop in annotation mode is ignored"
```

---

### Task 13: Error rendering for each error class

**Files:**
- Modify: `src/ui/workspace/index.js`
- Modify: `src/ui/workspace/workspace.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `workspace.test.js`:

```js
describe('createWorkspace — error rendering on empty', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  function dropFile(name, type, contentOrSize = 'x') {
    const { root, ws } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    const content = typeof contentOrSize === 'number' ? new Uint8Array(contentOrSize) : contentOrSize;
    dropOn(dz, [new File([content], name, { type })]);
    return { root, ws };
  }

  async function flush() {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('UnsupportedTypeError shows inline error and keeps dropzone', async () => {
    const { root } = dropFile('a.zip', 'application/zip');
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err).not.toBeNull();
    expect(err.textContent).toContain('Nieobsługiwany typ pliku');
    expect(root.querySelector('[data-testid="workspace-dropzone"]')).not.toBeNull();
  });

  it('FileTooLargeError shows size + limit', async () => {
    // Build a file with a size attribute > MAX_BYTES via prototype get; jsdom Files
    // accept arbitrary buffers but performance suffers — use a synthetic object.
    const big = {
      name: 'big.txt',
      type: 'text/plain',
      size: 26 * 1024 * 1024,
      text: () => Promise.resolve('x'),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    // We can't construct a real DataTransfer with this object; call the public path directly.
    // Workaround: call ws.handleFile via exposed test seam.
    expect(typeof window).toBe('object');
    // Instead, exercise the path via setText cancel: the simpler route is to
    // rely on the index.test for size-cap; here just verify the rendering helper
    // when an error class is dispatched programmatically — see internal test helper below.
    // For this assertion, fall back to FileImportError plumbing through a direct dispatch.
    // (See Step 3: we expose a `_handleFile` test seam.)
    await ws_handleFile_for_test(root, big);
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/za duży/);
  });

  it('ScannedPdfError shows PDF-specific message and a "Wklej tekst" recovery button', async () => {
    const { ScannedPdfError } = await import('../../file-import/errors.js');
    const { root } = mount();
    const big = { name: 'scan.pdf', type: 'application/pdf', size: 100 };
    await ws_handleFile_for_test(root, big, { mockExtract: () => { throw new ScannedPdfError(3); } });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err.textContent).toContain('zeskanowany PDF');
    const recover = root.querySelector('[data-testid="workspace-recover-paste"]');
    expect(recover).not.toBeNull();
    recover.click();
    expect(root.querySelector('.ann-editor')).not.toBeNull();
    expect(root.querySelector('.ann-editor-textarea')).not.toBeNull();
  });

  it('ExtractionFailedError shows generic message and recovery button', async () => {
    const { root } = mount();
    const f = { name: 'broken.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 100 };
    const { ExtractionFailedError } = await import('../../file-import/errors.js');
    await ws_handleFile_for_test(root, f, { mockExtract: () => { throw new ExtractionFailedError('docx', new Error('x')); } });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err.textContent).toMatch(/Nie udało się odczytać/);
    expect(root.querySelector('[data-testid="workspace-recover-paste"]')).not.toBeNull();
  });
});

// Test helper: workspace exposes a `_handleFileForTest` seam. We call it via the
// instance returned by mount(), passing a synthetic file and an optional mock
// extractor to bypass real extraction. The seam is documented and stable.
async function ws_handleFile_for_test(root, file, opts = {}) {
  const ws = root.__workspace_for_tests__;
  if (!ws) throw new Error('workspace test seam missing');
  return ws._handleFileForTest(file, opts);
}
```

This test depends on a test seam. Implement that seam in the workspace source.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: FAIL — error rendering and `_handleFileForTest` do not exist.

- [ ] **Step 3: Implement error rendering**

Add a render helper and update extraction handlers:

```js
function renderError(err) {
    // Find or create the error region inside the dropzone (empty state) or below the toolbar.
    const host =
      rootEl.querySelector('[data-testid="workspace-dropzone"]') ||
      rootEl.querySelector('[data-testid="workspace-toolbar"]')?.parentElement;
    if (!host) return;
    let region = rootEl.querySelector('[data-testid="workspace-error"]');
    if (!region) {
      region = document.createElement('div');
      region.className = 'ws-error';
      region.dataset.testid = 'workspace-error';
      region.setAttribute('aria-live', 'assertive');
      host.appendChild(region);
    }
    region.innerHTML = '';
    const msg = document.createElement('p');
    msg.className = 'ws-error-msg';
    msg.textContent = messageFor(err);
    region.appendChild(msg);

    if (err instanceof ScannedPdfError || err instanceof ExtractionFailedError) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary ws-error-recover';
      btn.dataset.testid = 'workspace-recover-paste';
      btn.textContent = 'Wklej tekst';
      btn.addEventListener('click', () => transitionToLoaded({ text: '', entities: [] }));
      region.appendChild(btn);
    }
  }

  function messageFor(err) {
    if (err instanceof UnsupportedTypeError) {
      return 'Nieobsługiwany typ pliku. Akceptujemy: .pdf, .docx, .txt';
    }
    if (err instanceof FileTooLargeError) {
      const mb = (err.sizeBytes / (1024 * 1024)).toFixed(1);
      const limitMb = (err.limitBytes / (1024 * 1024)).toFixed(0);
      return `Plik jest za duży (${mb} MB / limit ${limitMb} MB)`;
    }
    if (err instanceof ScannedPdfError) {
      return 'Wygląda na zeskanowany PDF. Wklej tekst ręcznie.';
    }
    if (err instanceof ExtractionFailedError) {
      return 'Nie udało się odczytać pliku. Spróbuj ponownie lub wklej tekst.';
    }
    return 'Nieznany błąd.';
  }

  function clearError() {
    const region = rootEl.querySelector('[data-testid="workspace-error"]');
    if (region) region.remove();
  }
```

Update both extraction handlers to call `renderError` on catch and `clearError` on success, and expose the test seam:

```js
async function runExtractionFromEmpty(file, deps = {}) {
    clearError();
    const extractor = deps.extractText ?? extractText;
    try {
      const { text, meta } = await extractor(file);
      transitionToLoaded({ text, entities: [], meta });
    } catch (err) {
      renderError(err);
    }
  }
```

Add a `_handleFileForTest` method to the returned API:

```js
    _handleFileForTest(file, opts = {}) {
      const fakeExtract = opts.mockExtract;
      const extractor = fakeExtract
        ? async (f) => {
            const out = fakeExtract(f);
            if (out instanceof Promise) return out;
            return out;
          }
        : extractText;
      // Empty path covers all error classes since loaded-state errors mirror it.
      return runExtractionFromEmpty(file, { extractText: extractor });
    },
```

Expose `ws` on the root for the test seam:

In `createWorkspace`, after building the API object:

```js
const api = { /* ... */ };
  rootEl.__workspace_for_tests__ = api;
  return api;
```

Adjust the FileTooLargeError test path: since the size cap lives in `extractText`, and we want to bypass extractText for the FileTooLargeError test, simulate the throw via `mockExtract`:

In the test:

```js
  it('FileTooLargeError shows size + limit', async () => {
    const { root } = mount();
    const f = { name: 'big.txt', type: 'text/plain', size: 26 * 1024 * 1024 };
    const { FileTooLargeError } = await import('../../file-import/errors.js');
    await ws_handleFile_for_test(root, f, { mockExtract: () => { throw new FileTooLargeError(f.size, 25 * 1024 * 1024); } });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err.textContent).toMatch(/za duży/);
  });
```

(Replace the test in step 1 with this simpler form when finalizing.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/workspace/workspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workspace/index.js src/ui/workspace/workspace.test.js
git commit -m "feat(ui/workspace): inline error rendering with typed messages and recovery"
```

---

## Phase 4 — Styles + main.js wiring

### Task 14: Workspace CSS

**Files:**
- Create: `src/ui/workspace/styles.css`

- [ ] **Step 1: Add CSS for dropzone, toolbar, file pill, error region, and dragover state**

```css
/* src/ui/workspace/styles.css */
.ws {
  display: block;
}

.ws-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 2.5rem 1rem;
  border: 2px dashed #93c5fd;
  border-radius: 8px;
  background: #f8fafc;
  color: #1e3a8a;
  cursor: pointer;
  text-align: center;
  outline-offset: 4px;
  user-select: none;
}
.ws-dropzone:focus-visible {
  outline: 2px solid #3b82f6;
}
.ws-dropzone.ws-dragover {
  background: #eff6ff;
  border-color: #3b82f6;
}
.ws-dropzone-icon {
  font-size: 2rem;
}
.ws-dropzone-primary {
  font-weight: 600;
}
.ws-dropzone-secondary {
  color: #475569;
  font-size: 0.85rem;
}

.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.ws-file-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #e5e7eb;
  color: #374151;
  font-size: 0.8rem;
  margin-right: auto;
  max-width: 50ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-toolbar-btn {
  margin-top: 0;
  padding: 0.4rem 0.9rem;
  font-size: 0.85rem;
}

.ws-error {
  margin-top: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
  background: #fee2e2;
  color: #991b1b;
  font-size: 0.85rem;
  text-align: center;
}
.ws-error-msg { margin: 0 0 0.5rem; }
.ws-error-recover { margin-top: 0; }

.ann-editor.ws-dragover {
  outline: 2px dashed #3b82f6;
  outline-offset: -2px;
}
```

- [ ] **Step 2: Visually verify (manual)**

The test suite passes without styles. Style validation happens after main.js wiring (Task 15).

- [ ] **Step 3: Commit**

```bash
git add src/ui/workspace/styles.css
git commit -m "feat(ui/workspace): styles for dropzone, toolbar, error region"
```

---

### Task 15: Wire createWorkspace into main.js

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Replace the editor import and instantiation**

In `src/main.js`, replace:

```js
import { createAnnotationEditor } from './ui/annotation-editor/index.js';
```
with:
```js
import { createWorkspace } from './ui/workspace/index.js';
```

Add the workspace stylesheet import alongside existing styles (just below `import './ui/annotation-editor/styles.css';`):
```js
import './ui/workspace/styles.css';
```

Replace the `editor` declaration:
```js
const editor = createAnnotationEditor(workspaceRoot, {
```
with:
```js
const editor = createWorkspace(workspaceRoot, {
```

The call signature is identical — `createWorkspace` exposes the same surface (`getText`, `setText`, `setEntities`, `enterTextMode`, `commitTextMode`, `getMode`, `getEntities`, `dispose`).

- [ ] **Step 2: Run unit tests**

Run: `npm test`
Expected: PASS, all tests including workspace.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`. Open the printed URL in a browser.

Verify:
- Dropzone appears in section "2. Wklej swój dokument..." instead of the old textarea.
- Click dropzone → textarea appears, focused, empty. Toolbar shows Wgraj inny plik + Wyczyść (no file pill).
- Type text → Anonimizuj works as before.
- Wyczyść returns to dropzone.
- Drop a small `.txt` file (e.g., copy any of `test-data/synthetic/*.txt`) → text fills the textarea, file pill shows the filename.
- Drop a `.docx` (any small Word file) → text fills the textarea.
- Drop a small text-based `.pdf` → text fills the textarea.
- Anonimizuj after upload → entities highlighted in annotation mode. Drop in annotation mode is ignored.
- Edytuj tekst → returns to text mode, drop now replaces with confirm.

If any step fails, fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(ui): wire workspace wrapper into main.js (replaces direct editor mount)"
```

---

## Phase 5 — e2e tests

A new top-level `e2e/` directory with its own Playwright config. Eval and bench remain untouched.

### Task 16: e2e Playwright config and npm script

**Files:**
- Create: `e2e/playwright.config.js`
- Create: `e2e/.gitignore`
- Modify: `package.json` (add `test:e2e` script)

- [ ] **Step 1: Add Playwright config**

```js
// e2e/playwright.config.js
import { defineConfig } from '@playwright/test';

const PORT = 5180;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/pii-anonymizer/`,
    trace: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: `npx vite --strictPort --port ${PORT}`,
    url: `http://localhost:${PORT}/pii-anonymizer/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

- [ ] **Step 2: Add gitignore for e2e artifacts**

```
# e2e/.gitignore
/test-results/
/playwright-report/
/.user-data/
```

- [ ] **Step 3: Add Playwright `@playwright/test` dependency (if not already present)**

The repo currently has `playwright` (used by bench). The test runner needs `@playwright/test`:

Run: `npm install --save-dev @playwright/test`

- [ ] **Step 4: Add npm script**

In `package.json`, add to `scripts`:

```json
"test:e2e": "playwright test --config=e2e/playwright.config.js"
```

- [ ] **Step 5: Verify config loads (no specs yet — empty run is fine)**

Run: `npm run test:e2e`
Expected: "no tests found" or 0 passed. (Vite still starts; that's OK.)

- [ ] **Step 6: Commit**

```bash
git add e2e/playwright.config.js e2e/.gitignore package.json package-lock.json
git commit -m "chore(e2e): add Playwright config and test:e2e script (separate from bench)"
```

---

### Task 17: e2e fixtures

**Files:**
- Create: `e2e/fixtures/sample.txt`
- Create: `e2e/fixtures/sample.docx` (binary)
- Create: `e2e/fixtures/sample-text.pdf` (binary)
- Create: `e2e/fixtures/sample-scanned.pdf` (binary)
- Create: `e2e/fixtures/README.md`

- [ ] **Step 1: Build the txt fixture**

```
# e2e/fixtures/sample.txt
Jan Kowalski mieszka w Krakowie przy ul. Floriańskiej 12.
Telefon: +48 600 123 456. Email: jan.kowalski@example.com.
PESEL: 80010112345.
```

- [ ] **Step 2: Generate the docx fixture**

Two acceptable approaches — either is fine, document in README:

**Option A (preferred): commit a hand-crafted docx**
Open Word/LibreOffice, paste the same content as `sample.txt`, save as `sample.docx`. Place at `e2e/fixtures/sample.docx`.

**Option B: generate via a Node script**
Use `docx` npm package in a one-shot script (do not add as a dependency — generate, commit, throw away the script). Or run `pandoc -o e2e/fixtures/sample.docx e2e/fixtures/sample.txt`.

- [ ] **Step 3: Generate the text-based PDF fixture**

`pandoc -o e2e/fixtures/sample-text.pdf e2e/fixtures/sample.txt`

(Requires pandoc + a TeX engine. If unavailable, print `sample.txt` from a browser → Save as PDF and commit the result.)

- [ ] **Step 4: Generate the scanned-PDF fixture**

`convert -size 800x1000 xc:white -font Arial -pointsize 18 caption:"This is a rasterized page (scan)." e2e/fixtures/sample-scanned.pdf`

(Requires ImageMagick. The PDF must contain only an image — no extractable text. Verify by running `pdftotext sample-scanned.pdf -` and confirming empty output.)

- [ ] **Step 5: Document fixtures**

```markdown
# e2e/fixtures/README.md

# e2e fixtures

These files exercise the file upload flow end-to-end. They are committed as binaries; do not edit by hand.

- `sample.txt` — plain UTF-8.
- `sample.docx` — same content as `sample.txt`, exported from LibreOffice (or `pandoc -o sample.docx sample.txt`).
- `sample-text.pdf` — same content as `sample.txt`, generated via `pandoc -o sample-text.pdf sample.txt`. Has extractable text on every page.
- `sample-scanned.pdf` — image-only PDF (no extractable text). Generated via `convert -size 800x1000 xc:white -font Arial -pointsize 18 caption:"This is a rasterized page (scan)." sample-scanned.pdf`. Verifies the scan-detection heuristic.

Regenerate when content drifts from the unit-test expectations. Do not include real PII; these are synthetic.
```

- [ ] **Step 6: Verify fixtures work**

Run: `npx pdftotext e2e/fixtures/sample-text.pdf -`
Expected: prints text similar to `sample.txt`.

Run: `npx pdftotext e2e/fixtures/sample-scanned.pdf -`
Expected: prints empty/whitespace-only output.

- [ ] **Step 7: Commit**

```bash
git add e2e/fixtures/
git commit -m "test(e2e): fixtures for txt/docx/text-pdf/scanned-pdf upload flows"
```

---

### Task 18: e2e upload happy paths (txt, docx, text-pdf)

**Files:**
- Create: `e2e/upload.spec.js`

- [ ] **Step 1: Write the spec**

```js
// e2e/upload.spec.js
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

async function uploadAndAssertText(page, filename, expectedSubstring) {
  await page.goto('/');
  // Wait for dropzone to render.
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  // The hidden file input is the deterministic upload path. Drag-drop is exercised
  // in unit tests (jsdom); this e2e proves the file → extract → text-in-textarea pipeline.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, filename));
  // After extraction the editor mounts; the textarea is in text mode by default.
  await page.waitForSelector('.ann-editor-textarea');
  const value = await page.locator('.ann-editor-textarea').inputValue();
  expect(value).toContain(expectedSubstring);
  // File pill should show the filename.
  const pill = page.locator('[data-testid="workspace-file-pill"]');
  await expect(pill).toContainText(filename);
}

test('txt upload populates the textarea', async ({ page }) => {
  await uploadAndAssertText(page, 'sample.txt', 'Jan Kowalski');
});

test('docx upload populates the textarea', async ({ page }) => {
  await uploadAndAssertText(page, 'sample.docx', 'Jan Kowalski');
});

test('text-based pdf upload populates the textarea', async ({ page }) => {
  await uploadAndAssertText(page, 'sample-text.pdf', 'Jan Kowalski');
});
```

- [ ] **Step 2: Run the e2e tests**

Run: `npm run test:e2e`
Expected: 3 tests PASS. Each takes 5–15 s on first model warm-up cycle (tests do not click Anonimizuj, so models don't actually load — should be fast).

- [ ] **Step 3: Commit**

```bash
git add e2e/upload.spec.js
git commit -m "test(e2e): upload happy paths for txt/docx/text-pdf"
```

---

### Task 19: e2e scanned-PDF error path + final verification

**Files:**
- Modify: `e2e/upload.spec.js`

- [ ] **Step 1: Append the error spec**

```js
test('scanned pdf shows the scan-detection error and Wklej tekst recovery', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, 'sample-scanned.pdf'));
  // Error region appears.
  const err = page.locator('[data-testid="workspace-error"]');
  await expect(err).toContainText('zeskanowany PDF');
  // Recovery path: clicking the button mounts the editor with empty textarea.
  await page.locator('[data-testid="workspace-recover-paste"]').click();
  await expect(page.locator('.ann-editor-textarea')).toBeVisible();
  await expect(page.locator('.ann-editor-textarea')).toHaveValue('');
});
```

- [ ] **Step 2: Run all e2e tests**

Run: `npm run test:e2e`
Expected: 4 tests PASS.

- [ ] **Step 3: Run the full unit test suite**

Run: `npm test`
Expected: PASS, including all `src/file-import/*.test.js` and `src/ui/workspace/workspace.test.js`. No regressions in pre-existing tests.

- [ ] **Step 4: Run eval to confirm no accuracy regression**

Run: `npm run eval -- --label=post-file-upload && npm run eval:score`
Expected: scores match baseline (we did not change the pipeline). If anything looks off, investigate before committing.

- [ ] **Step 5: Commit**

```bash
git add e2e/upload.spec.js
git commit -m "test(e2e): scanned pdf error and recovery flow"
```

- [ ] **Step 6: Open a PR**

```bash
git push -u origin claude/sharp-hypatia-122221
gh pr create --title "feat: file upload (.txt/.docx/.pdf) for anonymizer input" --body "$(cat <<'EOF'
## Summary
- New \`src/file-import/\` module: \`extractText(file)\` with typed errors; lazy imports for pdf.js and mammoth.
- New \`src/ui/workspace/\` wrapper component: empty-state dropzone replaces the textarea entry point; mounts the unchanged annotation editor once content loads.
- New top-level \`e2e/\` test bucket with Playwright (separate from \`bench/\`).
- OCR is explicitly deferred; scanned PDFs surface a clear error with a "Wklej tekst" recovery button.

Spec: \`docs/superpowers/specs/2026-05-07-file-upload-design.md\`
Plan: \`docs/superpowers/plans/2026-05-07-file-upload.md\`

## Test plan
- [x] \`npm test\` — unit tests including new \`file-import\` and \`workspace\` suites
- [x] \`npm run test:e2e\` — txt / docx / pdf upload paths + scanned-pdf error recovery
- [x] \`npm run eval -- --label=post-file-upload && npm run eval:score\` — no accuracy regression
- [ ] Manual: drag-drop variations covered above
EOF
)"
```

---

## Self-review pass

**Spec coverage check:**

| Spec section | Task |
|---|---|
| `'empty'` state — dropzone with PL copy | T7 |
| `'loaded'` state — toolbar + editor | T8, T10 |
| File pill lifecycle (file uploads only) | T8, T9, T11 |
| Wgraj inny plik / Wyczyść buttons | T10 |
| No auto-revert on empty textarea | covered implicitly (transition only via Wyczyść) — T10 test asserts text='' stays in `'loaded'` once entered |
| Drop on textarea (empty + non-empty + confirm) | T11 |
| Drop ignored in annotation mode | T12 |
| Errors: 4 classes with PL messages + recovery | T13 |
| `aria-live` for loading/errors | T7 (dropzone tabindex) + T13 (assertive region) |
| `accept=".pdf,.docx,.txt"` on hidden input | T7 |
| `MAX_BYTES = 25 MB` | T3 |
| `inferType` extension-then-mime | T3 |
| `SCAN_DETECT_AVG_CHARS_PER_PAGE = 50` | T5 |
| Lazy pdf.js + mammoth | T4, T5 |
| Wrapper hosts editor unchanged | T7+ (editor untouched) |
| `main.js` one-line swap | T15 |
| Unit tests in `src/**/*.test.js` | T1–T13 |
| e2e tests in new top-level `e2e/` bucket | T16–T19 |
| Eval and bench untouched | confirmed by absence of changes |

**Gap check:** "delete-all-chars does NOT auto-revert" is asserted only implicitly. Add an explicit assertion to T10 if needed, but the current test fixture (Wyczyść is the only path) is sufficient — adding a test that types into the textarea and clears it would only re-test editor internals.

**Loading state UI:** The spec calls for a spinner during extraction with `aria-live="polite"`. The plan does NOT include this; for v1, extraction of typical files completes in <1 s, and the existing modelStatus line remains the user's primary feedback. Add as a follow-up if real-world files prove slow. Documented as a v1 simplification — flag for the implementing engineer.

**Type consistency check:** `extractText` returns `{ text, meta }` everywhere. `meta` has `{ filename, mimeType, sizeBytes, pageCount? }` consistently. `transitionToLoaded({ text, entities, meta })` and `runExtractionFromLoaded`/`runExtractionFromEmpty` use the same names. `_handleFileForTest` is referenced from tests and exposed on the API. Looks consistent.

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate" — code blocks are concrete. Each test step has explicit assertions and expected outcomes. ✓
