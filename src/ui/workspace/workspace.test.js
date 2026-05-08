// @vitest-environment jsdom
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
    expect(dropzone.textContent).toContain('kliknij, aby wybrać plik');
  });

  it('renders a "Wolę wkleić tekst" button as the alternate path', () => {
    const { root } = mount();
    const btn = root.querySelector('[data-testid="workspace-paste-text"]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('wkleić tekst');
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
    expect(input.getAttribute('accept')).toBe('.pdf,.docx,.txt,.png,.jpg,.jpeg,.heic,.heif');
  });

  it('dropzone is keyboard focusable (role=button, tabindex=0)', () => {
    const { root } = mount();
    const dropzone = root.querySelector('[data-testid="workspace-dropzone"]');
    expect(dropzone.getAttribute('role')).toBe('button');
    expect(dropzone.getAttribute('tabindex')).toBe('0');
  });
});

describe('createWorkspace — empty dropzone interactions', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('clicking the dropzone triggers the hidden file input', () => {
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    const fileInput = root.querySelector('input[type="file"]');
    let clicked = 0;
    fileInput.click = () => { clicked++; };
    dz.click();
    expect(clicked).toBe(1);
    expect(root.querySelector('.ann-editor')).toBeNull();
  });

  it('keyboard Enter on the dropzone also triggers the file input', () => {
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    const fileInput = root.querySelector('input[type="file"]');
    let clicked = 0;
    fileInput.click = () => { clicked++; };
    dz.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicked).toBe(1);
  });

  it('"Wolę wkleić tekst" button mounts the editor with empty text and no file pill', () => {
    const { root, ws } = mount();
    const pasteBtn = root.querySelector('[data-testid="workspace-paste-text"]');
    pasteBtn.click();
    expect(root.querySelector('.ann-editor')).not.toBeNull();
    expect(ws.getText()).toBe('');
    expect(root.querySelector('[data-testid="workspace-file-pill"]')).toBeNull();
    expect(root.querySelector('[data-testid="workspace-dropzone"]')).toBeNull();
  });

  it('clicking the paste button does not also fire the dropzone file picker', () => {
    const { root } = mount();
    const fileInput = root.querySelector('input[type="file"]');
    let clicked = 0;
    fileInput.click = () => { clicked++; };
    const pasteBtn = root.querySelector('[data-testid="workspace-paste-text"]');
    pasteBtn.click();
    expect(clicked).toBe(0);
  });
});

function dragEvent(type, files) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { files, items: files.map((f) => ({ kind: 'file', getAsFile: () => f })), dropEffect: '' },
  });
  return ev;
}

function dropOn(el, files) {
  el.dispatchEvent(dragEvent('dragover', []));
  el.dispatchEvent(dragEvent('drop', files));
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('createWorkspace — drop file in empty', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('successful drop transitions to loaded with extracted text', async () => {
    const { root, ws } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    const file = new File(['Hello upload'], 'doc.txt', { type: 'text/plain' });
    dropOn(dz, [file]);
    await flush();
    expect(ws.getText()).toBe('Hello upload');
    expect(root.querySelector('.ann-editor')).not.toBeNull();
  });

  it('shows a file pill with the filename after successful drop', async () => {
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dropOn(dz, [new File(['x'], 'contract.txt', { type: 'text/plain' })]);
    await flush();
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
    await flush();
    expect(ws.getText()).toBe('first');
  });

  it('after extraction, commitTextMode reports changed=true so the pipeline fires on first Anonimizuj', async () => {
    // Regression: the editor used to set textSnapshot to its initial text. When the workspace
    // mounted the editor with extracted text, snapshot===text and Anonimizuj returned changed=false,
    // flipping into annotation mode without ever running the pipeline. Snapshot must represent
    // "last classified text" — empty when no entities were passed in.
    const { root, ws } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dropOn(dz, [new File(['Jan Kowalski mieszka w Warszawie'], 'doc.txt', { type: 'text/plain' })]);
    await flush();
    const result = ws.commitTextMode(ws.getText());
    expect(result.changed).toBe(true);
  });
});

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

describe('createWorkspace — drop in loaded text mode', () => {
  let originalConfirm;
  beforeEach(() => { originalConfirm = window.confirm; });
  afterEach(() => {
    document.body.innerHTML = '';
    window.confirm = originalConfirm;
  });

  it('drop on empty textarea replaces text without asking', async () => {
    const { root, ws } = mount();
    root.querySelector('[data-testid="workspace-paste-text"]').click();
    const ta = root.querySelector('.ann-editor-textarea');
    expect(ta).not.toBeNull();
    dropOn(ta, [new File(['fresh'], 'a.txt', { type: 'text/plain' })]);
    await flush();
    expect(ws.getText()).toBe('fresh');
  });

  it('drop on non-empty textarea asks for confirmation; cancel keeps text', async () => {
    const { root, ws } = mount();
    ws.setText('original');
    const ta = root.querySelector('.ann-editor-textarea');
    window.confirm = vi.fn(() => false);
    dropOn(ta, [new File(['replacement'], 'a.txt', { type: 'text/plain' })]);
    await flush();
    expect(ws.getText()).toBe('original');
    expect(window.confirm).toHaveBeenCalled();
  });

  it('drop on non-empty textarea replaces on confirm and shows new pill', async () => {
    const { root, ws } = mount();
    ws.setText('original');
    const ta = root.querySelector('.ann-editor-textarea');
    window.confirm = vi.fn(() => true);
    dropOn(ta, [new File(['replacement'], 'b.txt', { type: 'text/plain' })]);
    await flush();
    expect(ws.getText()).toBe('replacement');
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('b.txt');
  });
});

async function ws_handleFile_for_test(root, file, opts = {}) {
  const ws = root.__workspace_for_tests__;
  if (!ws) throw new Error('workspace test seam missing');
  return ws._handleFileForTest(file, opts);
}

describe('createWorkspace — error rendering', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('UnsupportedTypeError shows inline error and keeps dropzone', async () => {
    const { root } = mount();
    const dz = root.querySelector('[data-testid="workspace-dropzone"]');
    dropOn(dz, [new File(['x'], 'a.zip', { type: 'application/zip' })]);
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err).not.toBeNull();
    expect(err.textContent).toContain('Nieobsługiwany typ pliku');
    expect(root.querySelector('[data-testid="workspace-dropzone"]')).not.toBeNull();
  });

  it('FileTooLargeError shows size and limit', async () => {
    const { FileTooLargeError } = await import('../../file-import/errors.js');
    const { root } = mount();
    const f = { name: 'big.txt', type: 'text/plain', size: 26 * 1024 * 1024 };
    await ws_handleFile_for_test(root, f, {
      mockExtract: () => { throw new FileTooLargeError(f.size, 25 * 1024 * 1024); },
    });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/za duży/);
  });

  it('WebNNUnavailableError shows OCR-specific message and recovery button', async () => {
    const { WebNNUnavailableError } = await import('../../file-import/errors.js');
    const { root } = mount();
    const f = { name: 'photo.png', type: 'image/png', size: 100 };
    await ws_handleFile_for_test(root, f, {
      mockExtract: () => { throw new WebNNUnavailableError('no ep'); },
    });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err.textContent).toContain('przeglądarka nie obsługuje OCR');
    const recover = root.querySelector('[data-testid="workspace-recover-paste"]');
    expect(recover).not.toBeNull();
    recover.click();
    expect(root.querySelector('.ann-editor')).not.toBeNull();
  });

  it('OcrFailedError shows generic-OCR message and recovery button', async () => {
    const { OcrFailedError } = await import('../../file-import/errors.js');
    const { root } = mount();
    const f = { name: 'photo.png', type: 'image/png', size: 100 };
    await ws_handleFile_for_test(root, f, {
      mockExtract: () => { throw new OcrFailedError(new Error('boom')); },
    });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err.textContent).toContain('Nie udało się przeprowadzić OCR');
    expect(root.querySelector('[data-testid="workspace-recover-paste"]')).not.toBeNull();
  });

  it('ExtractionFailedError shows generic message and recovery button', async () => {
    const { ExtractionFailedError } = await import('../../file-import/errors.js');
    const { root } = mount();
    const f = { name: 'broken.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 100 };
    await ws_handleFile_for_test(root, f, {
      mockExtract: () => { throw new ExtractionFailedError('docx', new Error('x')); },
    });
    await flush();
    const err = root.querySelector('[data-testid="workspace-error"]');
    expect(err.textContent).toMatch(/Nie udało się odczytać/);
    expect(root.querySelector('[data-testid="workspace-recover-paste"]')).not.toBeNull();
  });
});

describe('createWorkspace — drop in annotation mode', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('drop in annotation mode is silently ignored', async () => {
    const { root, ws } = mount();
    ws.setText('Jan Kowalski');
    ws.setEntities([{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 1, source: 'manual' }]);
    expect(ws.getMode()).toBe('annotation');

    const editorEl = root.querySelector('.ann-editor');
    const before = ws.getText();
    const beforeEnts = ws.getEntities();

    dropOn(editorEl, [new File(['NEW'], 'x.txt', { type: 'text/plain' })]);
    await flush();

    expect(ws.getText()).toBe(before);
    expect(ws.getEntities()).toEqual(beforeEnts);
  });
});

describe('createWorkspace — file pill OCR breadcrumb', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('shows " · OCR" for an image upload', async () => {
    const { root } = mount();
    const ws = root.__workspace_for_tests__;
    const f = { name: 'photo.png', type: 'image/png', size: 100 };
    await ws._handleFileForTest(f, {
      mockExtract: () => ({
        text: 'Jan',
        meta: {
          filename: 'photo.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          ocr: { engine: 'paddleocr-v4', backend: 'wasm' },
        },
      }),
    });
    await flush();
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill.textContent).toContain('photo.png');
    expect(pill.textContent).toContain('· OCR');
  });

  it('shows " · OCR: strony 3–4" when only some PDF pages were OCRd', async () => {
    const { root } = mount();
    const ws = root.__workspace_for_tests__;
    const f = { name: 'doc.pdf', type: 'application/pdf', size: 100 };
    await ws._handleFileForTest(f, {
      mockExtract: () => ({
        text: 'Page text',
        meta: {
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          pageCount: 4,
          pages: [
            { index: 1, source: 'text' },
            { index: 2, source: 'text' },
            { index: 3, source: 'ocr', confidence: 0.9 },
            { index: 4, source: 'ocr', confidence: 0.9 },
          ],
          ocr: { engine: 'paddleocr-v4', backend: 'wasm' },
        },
      }),
    });
    await flush();
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill.textContent).toContain('OCR: strony 3–4');
  });

  it('shows " · OCR: wszystkie strony" when every page was OCRd', async () => {
    const { root } = mount();
    const ws = root.__workspace_for_tests__;
    const f = { name: 'scan.pdf', type: 'application/pdf', size: 100 };
    await ws._handleFileForTest(f, {
      mockExtract: () => ({
        text: 'a',
        meta: {
          filename: 'scan.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          pageCount: 2,
          pages: [
            { index: 1, source: 'ocr', confidence: 0.9 },
            { index: 2, source: 'ocr', confidence: 0.9 },
          ],
          ocr: { engine: 'paddleocr-v4', backend: 'wasm' },
        },
      }),
    });
    await flush();
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill.textContent).toContain('wszystkie strony');
  });

  it('does not show OCR breadcrumb for a normal text PDF', async () => {
    const { root } = mount();
    const ws = root.__workspace_for_tests__;
    const f = { name: 'doc.pdf', type: 'application/pdf', size: 100 };
    await ws._handleFileForTest(f, {
      mockExtract: () => ({
        text: 'a',
        meta: {
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          pageCount: 1,
          pages: [{ index: 1, source: 'text' }],
        },
      }),
    });
    await flush();
    const pill = root.querySelector('[data-testid="workspace-file-pill"]');
    expect(pill.textContent).not.toContain('OCR');
  });
});

describe('createWorkspace — OCR progress and cancel', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('renders an OCR progress message during extraction', async () => {
    const { root } = mount();
    const ws = root.__workspace_for_tests__;
    let resolveExtract;
    const slow = new Promise((res) => { resolveExtract = res; });
    const f = { name: 'scan.pdf', type: 'application/pdf', size: 100 };
    const promise = ws._handleFileForTest(f, {
      mockExtract: (file, opts) => {
        opts?.onProgress?.({ stage: 'ocr', current: 1, total: 3 });
        return slow;
      },
    });
    await flush();
    const status = root.querySelector('[data-testid="workspace-progress"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('strony 1 z 3');
    resolveExtract({ text: 'a', meta: { filename: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 100, pages: [], pageCount: 0 } });
    await promise;
  });

  it('renders a Cancel button while OCR runs and aborts when clicked', async () => {
    const { root, ws } = mount();
    const f = { name: 'scan.pdf', type: 'application/pdf', size: 100 };
    let aborted = false;
    let resolveExtract;
    const promise = ws._handleFileForTest(f, {
      mockExtract: (file, opts) => {
        opts.signal.addEventListener('abort', () => { aborted = true; });
        return new Promise((res, rej) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('cancelled');
            err.name = 'OcrCancelledError';
            rej(err);
          });
          resolveExtract = res;
        });
      },
    });
    await flush();
    const cancel = root.querySelector('[data-testid="workspace-ocr-cancel"]');
    expect(cancel).not.toBeNull();
    cancel.click();
    await promise.catch(() => {});
    expect(aborted).toBe(true);
    expect(root.querySelector('[data-testid="workspace-dropzone"]')).not.toBeNull();
  });
});
