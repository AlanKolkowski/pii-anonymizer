import { createAnnotationEditor } from '../annotation-editor/index.js';

const CLOSE_ICON_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
const PASTE_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h4l1 2H5l1-2Z"/><path d="M5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V5A1.5 1.5 0 0 0 12 3.5h-1"/><path d="M5.5 7h5M5.5 10h4"/></svg>';
const FILE_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h5l3 3V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"/><path d="M9 2.5v3h3"/></svg>';
const PLUS_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

function normalizeSourceType(type) {
  return type === 'file' || type === 'upload' ? 'file' : 'paste';
}

function normalizeStatus(status) {
  return ['idle', 'pending', 'ready', 'error'].includes(status) ? status : 'idle';
}

function statusGlyph(status) {
  switch (status) {
    case 'ready': return '✓';
    case 'pending': return '·';
    case 'error': return '✕';
    case 'idle':
    default:
      return '…';
  }
}

export function createSourcesList(rootEl, opts) {
  rootEl.classList.add('srclist');

  const tabsHost = opts.tabsHost ?? makeFallbackHost(rootEl, 'srclist-tabs-host');
  const toolbarHost = opts.toolbarHost ?? makeFallbackHost(rootEl, 'srclist-toolbar-host');

  tabsHost.classList.add('workspace-tabs');
  toolbarHost.classList.add('editor-toolbar');

  const cardsHost = document.createElement('div');
  cardsHost.className = 'srclist-cards';
  rootEl.appendChild(cardsHost);

  const fileInput = createFileInput((files) => opts.onAddFiles(files));
  rootEl.appendChild(fileInput);

  const cards = new Map();
  const order = [];
  let activeId = null;
  const docListHosts = new Set();

  // Empty state element (rendered in cardsHost when no sources)
  let emptyEl = null;

  // Initialize empty state — sources can be added afterward.
  // We defer rendering to the bottom of this factory after `renderEmptyState`
  // is defined.

  function makeFallbackHost(parent, marker) {
    const div = document.createElement('div');
    div.dataset.fallbackHost = marker;
    parent.appendChild(div);
    return div;
  }

  function createFileInput(onFiles) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.heic,.heif';
    input.style.display = 'none';
    input.dataset.testid = 'sources-add-file-input';
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length > 0) onFiles(files);
    });
    return input;
  }

  function renderEmptyState() {
    if (emptyEl) return;
    emptyEl = document.createElement('div');
    emptyEl.className = 'editor-empty';
    emptyEl.dataset.testid = 'editor-empty';
    emptyEl.innerHTML = `
      <span class="glyph">+</span>
      <h3>Dodaj dokument do analizy</h3>
      <p>Wybierz źródło — Twoje dane nie opuszczają tego urządzenia.</p>
      <div class="ways"></div>
    `;
    const ways = emptyEl.querySelector('.ways');

    const pasteWay = document.createElement('button');
    pasteWay.type = 'button';
    pasteWay.className = 'way';
    pasteWay.dataset.testid = 'sources-add-paste';
    pasteWay.innerHTML = '<span class="ico">📋</span><div class="lbl">Wklej tekst</div><div class="hint">⌘V</div>';
    pasteWay.addEventListener('click', () => opts.onAddPaste());
    ways.appendChild(pasteWay);

    const fileWay = document.createElement('button');
    fileWay.type = 'button';
    fileWay.className = 'way';
    fileWay.dataset.testid = 'sources-add-file';
    fileWay.innerHTML = '<span class="ico">⬆</span><div class="lbl">Prześlij plik</div><div class="hint">.txt .pdf .docx · .jpg .png (OCR)</div>';
    fileWay.addEventListener('click', () => fileInput.click());
    ways.appendChild(fileWay);

    const typeWay = document.createElement('button');
    typeWay.type = 'button';
    typeWay.className = 'way';
    typeWay.dataset.testid = 'sources-add-type';
    typeWay.innerHTML = '<span class="ico">✎</span><div class="lbl">Pisz w edytorze</div><div class="hint">nowy dokument</div>';
    typeWay.addEventListener('click', () => opts.onAddPaste());
    ways.appendChild(typeWay);

    cardsHost.appendChild(emptyEl);
    tabsHost.hidden = true;
    toolbarHost.hidden = true;
  }

  function clearEmptyState() {
    if (emptyEl) {
      emptyEl.remove();
      emptyEl = null;
    }
    tabsHost.hidden = false;
    toolbarHost.hidden = false;
  }

  function ensureAddButton() {
    let addBtn = tabsHost.querySelector('[data-testid="ws-tab-add"]');
    if (!addBtn) {
      addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ws-tab-add';
      addBtn.dataset.testid = 'ws-tab-add';
      addBtn.title = 'Dodaj dokument';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', () => opts.onAddPaste());
      tabsHost.appendChild(addBtn);
    } else {
      tabsHost.appendChild(addBtn); // keep at end
    }
  }

  function makeTab(id, label, initialStatus = 'idle') {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ws-tab';
    tab.dataset.testid = `ws-tab-${id}`;

    const status = document.createElement('span');
    status.className = 'dot';
    status.dataset.testid = `source-status-${id}`;
    status.dataset.status = initialStatus;
    tab.appendChild(status);

    const labelEl = document.createElement('span');
    labelEl.className = 'ws-tab-label';
    labelEl.dataset.testid = `ws-tab-label-${id}`;
    labelEl.textContent = label;
    tab.appendChild(labelEl);

    const close = document.createElement('span');
    close.className = 'close';
    close.dataset.testid = `source-remove-${id}`;
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', `Usuń ${label}`);
    close.innerHTML = CLOSE_ICON_SVG;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRemove(id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => setActive(id));
    tab.classList.toggle('has-anon', initialStatus === 'ready');
    return { tab, labelEl, statusEl: status };
  }

  function makeCard(id, init) {
    const wrapper = document.createElement('div');
    wrapper.className = 'srclist-card';
    wrapper.dataset.testid = `source-card-${id}`;
    wrapper.dataset.active = 'false';

    const editorRoot = document.createElement('div');
    wrapper.appendChild(editorRoot);
    const editor = createAnnotationEditor(editorRoot, {
      text: init.text ?? '',
      entities: init.entities ?? [],
      entityCategories: opts.entityCategories ?? [],
      entityLabels: opts.entityLabels ?? {},
      postEdit: opts.postEdit,
      onChange: (entities) => {
        opts.onAnnotationChange(id, entities);
        if (id === activeId) refreshToolbar();
      },
      onTextChange: (text) => {
        opts.onTextChange?.(id, text);
        if (id === activeId) refreshToolbar();
      },
      onModeChange: (mode) => opts.onModeChange(id, mode),
    });

    cardsHost.appendChild(wrapper);
    return { wrapper, editor };
  }

  function refreshToolbar() {
    toolbarHost.innerHTML = '';
    if (!activeId) return;
    const card = cards.get(activeId);
    if (!card) return;

    const left = document.createElement('div');
    left.className = 'left';

    const labelEl = document.createElement('span');
    labelEl.className = 'meta';
    labelEl.dataset.testid = 'editor-toolbar-label';
    labelEl.textContent = card.label;
    left.appendChild(labelEl);

    const text = card.editor.getText();
    const sizeEl = document.createElement('span');
    sizeEl.className = 'meta';
    sizeEl.dataset.testid = 'editor-toolbar-size';
    sizeEl.textContent = formatSize(text.length);
    left.appendChild(sep());
    left.appendChild(sizeEl);

    const entities = card.editor.getEntities();
    if (entities.length > 0) {
      left.appendChild(sep());
      const countEl = document.createElement('span');
      countEl.className = 'meta';
      countEl.dataset.testid = 'editor-toolbar-entity-count';
      countEl.style.color = 'var(--accent-ink)';
      countEl.textContent = `${entities.length} encji wykrytych`;
      left.appendChild(countEl);
    }

    const right = document.createElement('div');
    right.className = 'right';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn btn-sm btn-ghost';
    renameBtn.dataset.testid = `source-rename-${activeId}`;
    renameBtn.textContent = 'Zmień nazwę';
    renameBtn.addEventListener('click', () => beginRename(activeId));
    right.appendChild(renameBtn);

    toolbarHost.appendChild(left);
    toolbarHost.appendChild(right);
  }

  function sep() {
    const s = document.createElement('span');
    s.className = 'meta';
    s.textContent = '·';
    return s;
  }

  function formatSize(chars) {
    if (chars < 1000) return `${chars} znaków`;
    const k = (chars / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}k znaków`;
  }

  function beginRename(id) {
    const card = cards.get(id);
    if (!card || id !== activeId) return;
    const labelEl = toolbarHost.querySelector('[data-testid="editor-toolbar-label"]');
    if (!labelEl) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'srclist-label-input';
    input.dataset.testid = `source-label-input-${id}`;
    input.value = card.label;
    let next = input.value;
    input.addEventListener('change', () => { next = input.value; });
    input.addEventListener('blur', () => {
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        input.replaceWith(labelEl);
        return;
      }
      card.label = trimmed;
      labelEl.textContent = trimmed;
      input.replaceWith(labelEl);
      const tab = cards.get(id)?.tabRefs.labelEl;
      if (tab) tab.textContent = trimmed;
      refreshDocLists();
      opts.onRename(id, trimmed);
    });
    labelEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function setActive(id) {
    if (!cards.has(id)) return;
    activeId = id;
    for (const [cid, card] of cards) {
      card.wrapper.dataset.active = cid === id ? 'true' : 'false';
      card.tabRefs.tab.classList.toggle('active', cid === id);
    }
    refreshToolbar();
    refreshDocLists();
  }

  function renderDocLists() {
    for (const host of docListHosts) {
      renderDocListHost(host);
    }
  }

  function refreshDocLists() {
    renderDocLists();
  }

  function renderDocListHost(host) {
    host.classList.add('sidebar-section');
    host.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'sidebar-title';

    const heading = document.createElement('h4');
    heading.textContent = 'Dokumenty';
    title.appendChild(heading);

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(order.length);
    title.appendChild(count);
    host.appendChild(title);

    const list = document.createElement('div');
    list.className = 'doc-list';
    for (const id of order) {
      const card = cards.get(id);
      if (!card) continue;
      const item = document.createElement('div');
      item.className = 'doc-item';
      item.dataset.testid = `doc-item-${id}`;
      item.dataset.status = card.status;
      item.dataset.type = card.type;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.classList.toggle('active', id === activeId);
      item.addEventListener('click', () => setActive(id));
      item.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        setActive(id);
      });

      const icon = document.createElement('span');
      icon.className = 'doc-icon';
      icon.innerHTML = card.type === 'file' ? FILE_ICON_SVG : PASTE_ICON_SVG;
      item.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = card.label;
      item.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.dataset.testid = `doc-status-${id}`;
      meta.textContent = statusGlyph(card.status);
      item.appendChild(meta);

      list.appendChild(item);
    }
    host.appendChild(list);

    const add = document.createElement('div');
    add.className = 'doc-add';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm';
    addBtn.dataset.testid = 'doc-add';
    addBtn.innerHTML = `${PLUS_ICON_SVG} Dodaj`;
    addBtn.addEventListener('click', () => opts.onAddPaste());
    add.appendChild(addBtn);
    host.appendChild(add);
  }

  renderEmptyState();

  return {
    addSource(id, label, init = {}) {
      if (cards.has(id)) throw new Error(`source ${id} already exists`);
      clearEmptyState();
      const status = normalizeStatus(init.status);
      const type = normalizeSourceType(init.type);
      const tabRefs = makeTab(id, label, status);
      tabsHost.appendChild(tabRefs.tab);
      ensureAddButton();
      const card = makeCard(id, init);
      cards.set(id, { ...card, tabRefs, label, status, type });
      order.push(id);
      if (activeId === null) {
        setActive(id);
      } else {
        // ensure new card is hidden
        card.wrapper.dataset.active = 'false';
        refreshDocLists();
      }
    },
    removeSource(id) {
      const card = cards.get(id);
      if (!card) return;
      try { card.editor.dispose?.(); } catch {}
      card.wrapper.remove();
      card.tabRefs.tab.remove();
      cards.delete(id);
      const idx = order.indexOf(id);
      if (idx !== -1) order.splice(idx, 1);
      if (cards.size === 0) {
        activeId = null;
        toolbarHost.innerHTML = '';
        tabsHost.innerHTML = '';
        renderEmptyState();
        refreshDocLists();
        return;
      }
      if (activeId === id) {
        activeId = null;
        const next = order[idx] ?? order[idx - 1] ?? order[0];
        if (next) setActive(next);
      } else {
        refreshDocLists();
      }
    },
    setSourceText(id, text) {
      cards.get(id)?.editor.setText(text);
      if (id === activeId) refreshToolbar();
    },
    setSourceEntities(id, entities) {
      cards.get(id)?.editor.setEntities(entities);
      if (id === activeId) refreshToolbar();
    },
    setSourceLabel(id, label) {
      const card = cards.get(id);
      if (!card) return;
      card.label = label;
      card.tabRefs.labelEl.textContent = label;
      if (id === activeId) {
        const labelEl = toolbarHost.querySelector('[data-testid="editor-toolbar-label"]');
        if (labelEl) labelEl.textContent = label;
      }
      refreshDocLists();
    },
    setSourceStatus(id, status, error) {
      const card = cards.get(id);
      if (!card) return;
      const nextStatus = normalizeStatus(status);
      card.status = nextStatus;
      card.tabRefs.statusEl.dataset.status = nextStatus;
      card.tabRefs.statusEl.title = nextStatus === 'error' ? (error ?? 'błąd') : '';
      card.tabRefs.tab.classList.toggle('has-anon', nextStatus === 'ready');
      refreshDocLists();
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
    getActiveId() { return activeId; },
    setActive,
    renderDocList(root) {
      docListHosts.add(root);
      renderDocListHost(root);
    },
    dispose() {
      for (const id of [...cards.keys()]) this.removeSource(id);
      for (const host of docListHosts) host.innerHTML = '';
      docListHosts.clear();
      tabsHost.innerHTML = '';
      toolbarHost.innerHTML = '';
      rootEl.classList.remove('srclist');
      rootEl.innerHTML = '';
    },
  };
}
