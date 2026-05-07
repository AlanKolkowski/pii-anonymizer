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
    rootEl.appendChild(dz);
  }

  renderEmpty();
  onModeChange('text');

  const api = {
    getText: () => (editor ? editor.getText() : ''),
    getEntities: () => (editor ? editor.getEntities() : []),
    getMode: () => (editor ? editor.getMode() : 'text'),
    setEntities: () => {},
    setText: () => {},
    enterTextMode: () => {},
    commitTextMode: () => ({ changed: false }),
    dispose: () => {
      if (editor) editor.dispose();
      rootEl.classList.remove('ws');
      rootEl.innerHTML = '';
    },
  };
  return api;
}
