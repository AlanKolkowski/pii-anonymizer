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

  let state = 'empty';
  let editor = null;
  let lastMeta = null;

  rootEl.classList.add('ws');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,.docx,.txt';
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
    dz.innerHTML = `
      <div class="ws-dropzone-icon">📄</div>
      <div class="ws-dropzone-primary">Upuść plik (.docx, .pdf, .txt)</div>
      <div class="ws-dropzone-secondary">lub kliknij aby wkleić tekst</div>
    `;
    dz.addEventListener('click', () => {
      transitionToLoaded({ text: '', entities: [] });
    });
    dz.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        transitionToLoaded({ text: '', entities: [] });
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

  async function runExtractionFromEmpty(file) {
    try {
      const { text, meta } = await extractText(file);
      transitionToLoaded({ text, entities: [], meta });
    } catch (err) {
      console.error('[workspace] extraction failed', err);
    }
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
      pill.textContent = `📄 ${lastMeta.filename}`;
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
    dispose: () => {
      if (editor) editor.dispose();
      rootEl.classList.remove('ws');
      rootEl.innerHTML = '';
    },
  };
  return api;
}
