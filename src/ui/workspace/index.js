import { createAnnotationEditor } from '../annotation-editor/index.js';
import { extractText } from '../../file-import/index.js';
import { formatOcrRanges } from '../../ocr/range-format.js';
import {
  FileImportError,
  UnsupportedTypeError,
  FileTooLargeError,
  ExtractionFailedError,
  WebNNUnavailableError,
  OcrFailedError,
} from '../../file-import/errors.js';

function computeOcrLabel(meta) {
  if (!meta) return null;
  const isImage = meta.mimeType?.startsWith('image/');
  if (isImage && meta.ocr) return 'OCR';

  if (!Array.isArray(meta.pages)) return null;
  const ocrPages = meta.pages.filter((p) => p.source === 'ocr').map((p) => p.index);
  if (ocrPages.length === 0) return null;
  const range = formatOcrRanges(ocrPages, meta.pageCount);
  return range ? `OCR: ${range}` : 'OCR';
}

function ensureProgressEl(rootEl) {
  let el = rootEl.querySelector('[data-testid="workspace-progress"]');
  if (!el) {
    const dropzone = rootEl.querySelector('[data-testid="workspace-dropzone"]');
    el = document.createElement('div');
    el.className = 'ws-progress';
    el.dataset.testid = 'workspace-progress';
    el.setAttribute('aria-live', 'polite');
    el.textContent = 'Przetwarzanie pliku…';
    (dropzone ?? rootEl).appendChild(el);
  }
  return el;
}
function updateProgress(rootEl, text) {
  const el = ensureProgressEl(rootEl);
  el.textContent = text;
}
function hideProgress(rootEl) {
  rootEl.querySelector('[data-testid="workspace-progress"]')?.remove();
}
function ensureCancelBtn(rootEl, controller) {
  let btn = rootEl.querySelector('[data-testid="workspace-ocr-cancel"]');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary ws-ocr-cancel';
    btn.dataset.testid = 'workspace-ocr-cancel';
    btn.setAttribute('aria-label', 'Anuluj OCR');
    btn.textContent = 'Anuluj';
    btn.addEventListener('click', () => controller.abort());
    const host = rootEl.querySelector('[data-testid="workspace-dropzone"]') ?? rootEl;
    host.appendChild(btn);
  }
  return btn;
}
function hideCancel(rootEl) {
  rootEl.querySelector('[data-testid="workspace-ocr-cancel"]')?.remove();
}

export function createWorkspace(rootEl, options) {
  const opts = options ?? {};
  const onChange = opts.onChange ?? (() => {});
  const onModeChange = opts.onModeChange ?? (() => {});

  let state = 'empty';
  let editor = null;
  let lastMeta = null;

  rootEl.classList.add('ws');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.heic,.heif';
  fileInput.style.display = 'none';
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
  rootEl.appendChild(fileInput);

  function renderEmpty() {
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
    dz.setAttribute('aria-label', 'Upuść plik lub kliknij, aby wybrać plik');
    dz.innerHTML = `
      <div class="ws-dropzone-icon">📄</div>
      <div class="ws-dropzone-primary">Upuść plik (.docx, .pdf, .txt, .png, .jpg, .heic)</div>
      <div class="ws-dropzone-secondary">lub kliknij, aby wybrać plik</div>
    `;

    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'btn btn-secondary ws-dropzone-paste';
    pasteBtn.dataset.testid = 'workspace-paste-text';
    pasteBtn.textContent = 'Wolę wkleić tekst';
    pasteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      transitionToLoaded({ text: '', entities: [] });
    });
    dz.appendChild(pasteBtn);

    dz.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-testid="workspace-paste-text"]')) return;
      fileInput.click();
    });
    dz.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        fileInput.click();
      }
    });
    let dragCounter = 0;
    dz.addEventListener('dragenter', (ev) => {
      ev.preventDefault();
      dragCounter++;
      dz.classList.add('ws-dragover');
    });
    dz.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
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
    rootEl.appendChild(dz);
  }

  async function runExtractionFromEmpty(file, deps = {}) {
    clearError();
    const extractor = deps.extractText ?? extractText;
    const controller = new AbortController();
    ensureProgressEl(rootEl);
    ensureCancelBtn(rootEl, controller);
    try {
      const { text, meta } = await extractor(file, {
        signal: controller.signal,
        onProgress: ({ stage, current, total }) => {
          if (stage === 'ocr') {
            updateProgress(rootEl, `Przetwarzanie strony ${current} z ${total} (OCR)…`);
          }
        },
        onModelLoad: ({ type }) => {
          if (type === 'model:load:start') {
            updateProgress(rootEl, 'Pobieranie modelu OCR (jednorazowo)…');
          }
        },
      });
      hideProgress(rootEl);
      hideCancel(rootEl);
      transitionToLoaded({ text, entities: [], meta });
    } catch (err) {
      hideProgress(rootEl);
      hideCancel(rootEl);
      if (err?.name === 'OcrCancelledError') {
        return;
      }
      renderError(err);
    }
  }

  function renderError(err) {
    const dropzone = rootEl.querySelector('[data-testid="workspace-dropzone"]');
    const toolbar = rootEl.querySelector('[data-testid="workspace-toolbar"]');
    const host = dropzone ?? toolbar?.parentElement ?? rootEl;
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

    if (
      err instanceof WebNNUnavailableError ||
      err instanceof OcrFailedError ||
      err instanceof ExtractionFailedError
    ) {
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
      return 'Nieobsługiwany typ pliku. Akceptujemy: .pdf, .docx, .txt, .png, .jpg, .heic';
    }
    if (err instanceof FileTooLargeError) {
      const mb = (err.sizeBytes / (1024 * 1024)).toFixed(1);
      const limitMb = (err.limitBytes / (1024 * 1024)).toFixed(0);
      return `Plik jest za duży (${mb} MB / limit ${limitMb} MB)`;
    }
    if (err instanceof WebNNUnavailableError) {
      return 'Twoja przeglądarka nie obsługuje OCR. Wklej tekst ręcznie.';
    }
    if (err instanceof OcrFailedError) {
      return 'Nie udało się przeprowadzić OCR. Spróbuj ponownie lub wklej tekst.';
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
      let label = `📄 ${lastMeta.filename}`;
      const ocrLabel = computeOcrLabel(lastMeta);
      if (ocrLabel) label += ` · ${ocrLabel}`;
      pill.textContent = label;
      pill.title = lastMeta.filename;
      toolbar.appendChild(pill);
    }

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
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
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
  }

  function transitionToEmpty() {
    if (state === 'empty') return;
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

  async function runExtractionFromLoaded(file, deps = {}) {
    clearError();
    const currentText = editor.getText();
    if (currentText.length > 0) {
      const ok = window.confirm('Zastąpić obecny tekst?');
      if (!ok) return;
    }
    const extractor = deps.extractText ?? extractText;
    const controller = new AbortController();
    ensureProgressEl(rootEl);
    ensureCancelBtn(rootEl, controller);
    try {
      const { text, meta } = await extractor(file, {
        signal: controller.signal,
        onProgress: ({ stage, current, total }) => {
          if (stage === 'ocr') {
            updateProgress(rootEl, `Przetwarzanie strony ${current} z ${total} (OCR)…`);
          }
        },
        onModelLoad: ({ type }) => {
          if (type === 'model:load:start') {
            updateProgress(rootEl, 'Pobieranie modelu OCR (jednorazowo)…');
          }
        },
      });
      hideProgress(rootEl);
      hideCancel(rootEl);
      lastMeta = meta;
      editor.setText(text);
      renderLoaded({ text, entities: [] });
    } catch (err) {
      hideProgress(rootEl);
      hideCancel(rootEl);
      if (err?.name === 'OcrCancelledError') return;
      renderError(err);
    }
  }

  renderEmpty();
  onModeChange('text');

  const api = {
    getText: () => (editor ? editor.getText() : ''),
    getEntities: () => (editor ? editor.getEntities() : []),
    getMode: () => (editor ? editor.getMode() : 'text'),
    setText(newText) {
      if (state === 'empty') {
        transitionToLoaded({ text: newText, entities: [] });
        return;
      }
      editor.setText(newText);
    },
    setEntities(newEntities) {
      if (state === 'empty') {
        transitionToLoaded({ text: '', entities: newEntities });
        return;
      }
      editor.setEntities(newEntities);
    },
    enterTextMode() { editor?.enterTextMode(); },
    commitTextMode(t) { return editor ? editor.commitTextMode(t) : { changed: false }; },
    _handleFileForTest(file, fnOpts = {}) {
      const fakeExtract = fnOpts.mockExtract;
      const extractor = fakeExtract
        ? async (f, runOpts) => {
            const out = fakeExtract(f, runOpts);
            if (out instanceof Promise) return out;
            return out;
          }
        : extractText;
      return runExtractionFromEmpty(file, { extractText: extractor });
    },
    dispose: () => {
      if (editor) editor.dispose();
      rootEl.classList.remove('ws');
      rootEl.innerHTML = '';
    },
  };
  rootEl.__workspace_for_tests__ = api;
  return api;
}
