import { createAnnotationEditor } from '../annotation-editor/index.js';

export function createSourcesList(rootEl, opts) {
  rootEl.classList.add('srclist');

  const cards = new Map();

  const cardsHost = document.createElement('div');
  rootEl.appendChild(cardsHost);

  const addRow = document.createElement('div');
  addRow.className = 'srclist-add';

  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'btn btn-secondary';
  pasteBtn.dataset.testid = 'sources-add-paste';
  pasteBtn.textContent = 'Wklej tekst';
  pasteBtn.addEventListener('click', () => opts.onAddPaste());
  addRow.appendChild(pasteBtn);

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.className = 'btn btn-secondary';
  fileBtn.dataset.testid = 'sources-add-file';
  fileBtn.textContent = 'Wgraj plik';
  addRow.appendChild(fileBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.heic,.heif';
  fileInput.style.display = 'none';
  fileInput.dataset.testid = 'sources-add-file-input';
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length > 0) opts.onAddFiles(files);
  });
  fileBtn.addEventListener('click', () => fileInput.click());
  addRow.appendChild(fileInput);

  rootEl.appendChild(addRow);

  function makeCard(id, label, init) {
    const wrapper = document.createElement('div');
    wrapper.className = 'srclist-card';
    wrapper.dataset.testid = `source-card-${id}`;

    const head = document.createElement('div');
    head.className = 'srclist-card-head';

    const labelEl = document.createElement('span');
    labelEl.className = 'srclist-label';
    labelEl.dataset.testid = `source-label-${id}`;
    labelEl.textContent = label;
    head.appendChild(labelEl);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn btn-secondary';
    renameBtn.dataset.testid = `source-rename-${id}`;
    renameBtn.textContent = 'Zmień nazwę';
    renameBtn.addEventListener('click', () => beginRename(id));
    head.appendChild(renameBtn);

    const statusEl = document.createElement('span');
    statusEl.className = 'srclist-status';
    statusEl.dataset.testid = `source-status-${id}`;
    statusEl.dataset.status = init.status ?? 'idle';
    head.appendChild(statusEl);

    const spacer = document.createElement('div');
    spacer.className = 'srclist-spacer';
    head.appendChild(spacer);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-secondary';
    removeBtn.dataset.testid = `source-remove-${id}`;
    removeBtn.textContent = 'Usuń';
    removeBtn.addEventListener('click', () => opts.onRemove(id));
    head.appendChild(removeBtn);

    wrapper.appendChild(head);

    const editorRoot = document.createElement('div');
    wrapper.appendChild(editorRoot);
    const editor = createAnnotationEditor(editorRoot, {
      text: init.text ?? '',
      entities: init.entities ?? [],
      entityCategories: opts.entityCategories ?? [],
      entityLabels: opts.entityLabels ?? {},
      postEdit: opts.postEdit,
      onChange: (entities) => opts.onAnnotationChange(id, entities),
      onModeChange: (mode) => opts.onModeChange(id, mode),
    });

    cardsHost.appendChild(wrapper);
    return { wrapper, editor, labelEl, statusEl };
  }

  function beginRename(id) {
    const card = cards.get(id);
    if (!card) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'srclist-label-input';
    input.dataset.testid = `source-label-input-${id}`;
    input.value = card.labelEl.textContent;
    let next = input.value;
    input.addEventListener('change', () => { next = input.value; });
    input.addEventListener('blur', () => {
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        finalize(card.labelEl.textContent);
        return;
      }
      finalize(trimmed);
      opts.onRename(id, trimmed);
    });
    function finalize(label) {
      card.labelEl.textContent = label;
      input.replaceWith(card.labelEl);
    }
    card.labelEl.replaceWith(input);
    input.focus();
    input.select();
  }

  return {
    addSource(id, label, init = {}) {
      if (cards.has(id)) throw new Error(`source ${id} already exists`);
      cards.set(id, makeCard(id, label, init));
    },
    removeSource(id) {
      const card = cards.get(id);
      if (!card) return;
      try { card.editor.dispose?.(); } catch {}
      card.wrapper.remove();
      cards.delete(id);
    },
    setSourceText(id, text) {
      cards.get(id)?.editor.setText(text);
    },
    setSourceEntities(id, entities) {
      cards.get(id)?.editor.setEntities(entities);
    },
    setSourceLabel(id, label) {
      const card = cards.get(id);
      if (card) card.labelEl.textContent = label;
    },
    setSourceStatus(id, status, error) {
      const card = cards.get(id);
      if (!card) return;
      card.statusEl.dataset.status = status;
      card.statusEl.textContent = status === 'error' ? (error ?? 'błąd') : '';
    },
    getText(id) { return cards.get(id)?.editor.getText() ?? ''; },
    getEntities(id) { return cards.get(id)?.editor.getEntities() ?? []; },
    getMode(id) { return cards.get(id)?.editor.getMode() ?? 'text'; },
    enterTextMode(id) { cards.get(id)?.editor.enterTextMode(); },
    commitTextMode(id, text) {
      const card = cards.get(id);
      return card ? card.editor.commitTextMode(text) : { changed: false };
    },
    listIds() { return [...cards.keys()]; },
    dispose() {
      for (const id of [...cards.keys()]) this.removeSource(id);
      rootEl.classList.remove('srclist');
      rootEl.innerHTML = '';
    },
  };
}
