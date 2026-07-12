// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSourcesList } from './index.js';

describe('createSourcesList', () => {
  let root;
  let tabsHost;
  let toolbarHost;
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tabs"></div>
      <div id="toolbar"></div>
      <div id="root"></div>
    `;
    tabsHost = document.getElementById('tabs');
    toolbarHost = document.getElementById('toolbar');
    root = document.getElementById('root');
  });

  function defaultOpts(overrides = {}) {
    return {
      tabsHost,
      toolbarHost,
      entityCategories: [],
      entityLabels: {},
      postEdit: (ctx) => ctx,
      onAddPaste: vi.fn(),
      onAddFiles: vi.fn(),
      onRemove: vi.fn(),
      onRename: vi.fn(),
      onAnnotationChange: vi.fn(),
      onTextChange: vi.fn(),
      onTextDirtyChange: vi.fn(),
      onModeChange: vi.fn(),
      ...overrides,
    };
  }

  describe('empty state', () => {
    it('renders paste and file affordances when no sources', () => {
      createSourcesList(root, defaultOpts());
      expect(root.querySelector('[data-testid="editor-empty"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-paste"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-file"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-type"]')).toBeNull();
      expect(root.querySelectorAll('[data-testid^="source-card-"]').length).toBe(0);
    });

    it('clicking the paste way fires onAddPaste', () => {
      const opts = defaultOpts();
      createSourcesList(root, opts);
      root.querySelector('[data-testid="sources-add-paste"]').click();
      expect(opts.onAddPaste).toHaveBeenCalledTimes(1);
    });

    it('selecting files via the file input fires onAddFiles', () => {
      const opts = defaultOpts();
      createSourcesList(root, opts);
      const input = root.querySelector('[data-testid="sources-add-file-input"]');
      const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change'));
      expect(opts.onAddFiles).toHaveBeenCalledTimes(1);
      expect(opts.onAddFiles.mock.calls[0][0][0].name).toBe('a.txt');
    });

    it('dropping a file on the editor area fires onAddFiles', () => {
      const opts = defaultOpts();
      createSourcesList(root, opts);
      const file = new File(['hello'], 'drop.txt', { type: 'text/plain' });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [file], types: ['Files'], dropEffect: 'copy' },
      });

      root.querySelector('.srclist-cards').dispatchEvent(event);

      expect(opts.onAddFiles).toHaveBeenCalledTimes(1);
      expect(opts.onAddFiles.mock.calls[0][0][0].name).toBe('drop.txt');
    });

    it('removing the last source returns to empty state', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      list.removeSource('s1');
      expect(root.querySelector('[data-testid="editor-empty"]')).not.toBeNull();
      expect(tabsHost.querySelectorAll('[data-testid^="ws-tab-"]').length).toBe(0);
    });
  });

  describe('tabs', () => {
    it('addSource renders a tab in tabsHost with the label', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'umowa.docx', { text: '', entities: [] });
      const tab = tabsHost.querySelector('[data-testid="ws-tab-s1"]');
      expect(tab).not.toBeNull();
      expect(tab.textContent).toContain('umowa.docx');
    });

    it('first added source becomes the active tab', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      const tab = tabsHost.querySelector('[data-testid="ws-tab-s1"]');
      expect(tab.classList.contains('active')).toBe(true);
    });

    it('only the active card is visually visible (data-active toggle)', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      list.addSource('s2', 'b', { text: '', entities: [] });
      expect(root.querySelector('[data-testid="source-card-s1"]').dataset.active).toBe('true');
      expect(root.querySelector('[data-testid="source-card-s2"]').dataset.active).toBe('false');
    });

    it('clicking a tab switches active state without disposing cards', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: 'hello', entities: [] });
      list.addSource('s2', 'b', { text: 'world', entities: [] });
      const card1 = root.querySelector('[data-testid="source-card-s1"]');
      const card2 = root.querySelector('[data-testid="source-card-s2"]');
      // both card nodes still in DOM
      expect(card1).not.toBeNull();
      expect(card2).not.toBeNull();
      // initially s1 active (first added)
      expect(card1.dataset.active).toBe('true');
      expect(card2.dataset.active).toBe('false');
      // click s2's tab
      tabsHost.querySelector('[data-testid="ws-tab-s2"]').click();
      expect(card1.dataset.active).toBe('false');
      expect(card2.dataset.active).toBe('true');
      // text preserved (no recreation)
      expect(list.getText('s1')).toBe('hello');
      expect(list.getText('s2')).toBe('world');
    });

    it('shows a "+" add affordance after the tabs', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      expect(tabsHost.querySelector('[data-testid="ws-tab-add"]')).not.toBeNull();
    });

    it('clicking the add affordance opens a new-document tab with the initial choices', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'a', { text: '', entities: [] });
      tabsHost.querySelector('[data-testid="ws-tab-add"]').click();
      expect(tabsHost.querySelector('[data-testid="ws-tab-new-source"]')).not.toBeNull();
      expect(tabsHost.querySelector('[data-testid="ws-tab-new-source"]').classList.contains('active')).toBe(true);
      expect(root.querySelector('[data-testid="editor-empty"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-paste"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-file"]')).not.toBeNull();
      expect(opts.onAddPaste).not.toHaveBeenCalled();
    });

    it('choosing paste from the new-document tab fires onAddPaste', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'a', { text: '', entities: [] });
      tabsHost.querySelector('[data-testid="ws-tab-add"]').click();
      root.querySelector('[data-testid="sources-add-paste"]').click();
      expect(opts.onAddPaste).toHaveBeenCalledTimes(1);
    });

    it('choosing upload from the new-document tab opens the file input', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'a', { text: '', entities: [] });
      const input = root.querySelector('[data-testid="sources-add-file-input"]');
      const click = vi.spyOn(input, 'click').mockImplementation(() => {});

      tabsHost.querySelector('[data-testid="ws-tab-add"]').click();
      root.querySelector('[data-testid="sources-add-file"]').click();

      expect(click).toHaveBeenCalledTimes(1);
    });

    it('adding a source while the new-document tab is open replaces the chooser with the new source', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      tabsHost.querySelector('[data-testid="ws-tab-add"]').click();

      list.addSource('s2', 'b', { text: 'new', entities: [] });

      expect(tabsHost.querySelector('[data-testid="ws-tab-new-source"]')).toBeNull();
      expect(root.querySelector('[data-testid="source-card-s2"]').dataset.active).toBe('true');
      expect(root.querySelector('[data-testid="editor-empty"]')).toBeNull();
    });

    it('close button on a tab fires onRemove with the id', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'a', { text: '', entities: [] });
      tabsHost.querySelector('[data-testid="source-remove-s1"]').click();
      expect(opts.onRemove).toHaveBeenCalledWith('s1');
    });

    it('removing the active source activates a sibling', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      list.addSource('s2', 'b', { text: '', entities: [] });
      list.addSource('s3', 'c', { text: '', entities: [] });
      // s1 is active. Remove s1 — sibling becomes active.
      list.removeSource('s1');
      const remainingActive = tabsHost.querySelectorAll('.ws-tab.active');
      expect(remainingActive.length).toBe(1);
      expect(remainingActive[0].dataset.testid).toMatch(/^ws-tab-(s2|s3)$/);
    });
  });

  describe('editor toolbar', () => {
    it('shows the active source label', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'umowa.docx', { text: 'abc', entities: [] });
      const meta = toolbarHost.querySelector('[data-testid="editor-toolbar-label"]');
      expect(meta).not.toBeNull();
      expect(meta.textContent).toBe('umowa.docx');
    });

    it('updates label when source is renamed', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'old', { text: '', entities: [] });
      list.setSourceLabel('s1', 'new');
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-label"]').textContent).toBe('new');
    });

    it('shows entity count when active source has entities', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', {
        text: 'Anna mieszka w Warszawie',
        entities: [
          { entity_group: 'PERSON_NAME', start: 0, end: 4, score: 0.99, word: 'Anna' },
          { entity_group: 'POSTAL_ADDRESS', start: 15, end: 24, score: 0.98, word: 'Warszawie' },
        ],
      });
      const count = toolbarHost.querySelector('[data-testid="editor-toolbar-entity-count"]');
      expect(count).not.toBeNull();
      expect(count.textContent).toContain('2');
    });

    it('updates entity count when entities change via setSourceEntities', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: 'Anna', entities: [] });
      const count = () => toolbarHost.querySelector('[data-testid="editor-toolbar-entity-count"]');
      // No entities yet — count node may exist with 0 or not exist
      list.setSourceEntities('s1', [
        { entity_group: 'PERSON_NAME', start: 0, end: 4, score: 0.99, word: 'Anna' },
      ]);
      expect(count()).not.toBeNull();
      expect(count().textContent).toContain('1');
    });

    it('shows the OCR review badge for an image source read via OCR', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', {
        text: 'Jan Kowalski',
        meta: { mimeType: 'image/png', ocr: { engine: 'paddleocr', backend: 'wasm' } },
      });
      const badge = toolbarHost.querySelector('[data-testid="editor-toolbar-ocr-badge-s1"]');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('czytane OCR — zweryfikuj nazwiska i liczby');
    });

    it('shows the OCR badge with a page range for a partially-OCRed PDF', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', {
        text: 'Jan Kowalski',
        meta: {
          mimeType: 'application/pdf',
          ocr: { engine: 'paddleocr', backend: 'wasm' },
          pageCount: 3,
          pages: [{ index: 1, source: 'text' }, { index: 2, source: 'ocr' }, { index: 3, source: 'text' }],
        },
      });
      const badge = toolbarHost.querySelector('[data-testid="editor-toolbar-ocr-badge-s1"]');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('czytane OCR — zweryfikuj nazwiska i liczby (strona 2)');
    });

    it('does not show an OCR badge for a source with no OCR meta', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: 'Jan Kowalski', meta: { mimeType: 'text/plain' } });
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-ocr-badge-s1"]')).toBeNull();
    });

    it('does not show an OCR badge for a pasted source (no meta)', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: 'Jan Kowalski' });
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-ocr-badge-s1"]')).toBeNull();
    });

    it('shows the OCR badge once setSourceMeta reports OCR after async import', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', status: 'pending' });
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-ocr-badge-s1"]')).toBeNull();
      list.setSourceMeta('s1', { mimeType: 'image/png', ocr: { engine: 'paddleocr', backend: 'wasm' } });
      const badge = toolbarHost.querySelector('[data-testid="editor-toolbar-ocr-badge-s1"]');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('czytane OCR — zweryfikuj nazwiska i liczby');
    });

    it('switches toolbar content when active tab changes', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'first', { text: '', entities: [] });
      list.addSource('s2', 'second', { text: '', entities: [] });
      tabsHost.querySelector('[data-testid="ws-tab-s2"]').click();
      const label = toolbarHost.querySelector('[data-testid="editor-toolbar-label"]');
      expect(label.textContent).toBe('second');
    });

    it('clears toolbar contents when no sources remain', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      list.removeSource('s1');
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-label"]')).toBeNull();
    });

    it('reports live text edits from the source editor', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'a', { text: '', entities: [] });

      const textarea = root.querySelector('.ann-editor-textarea');
      textarea.value = 'Anna Kowalska';
      textarea.dispatchEvent(new Event('input'));

      expect(opts.onTextChange).toHaveBeenCalledWith('s1', 'Anna Kowalska');
    });
  });

  describe('status', () => {
    it('setSourceStatus updates the tab status indicator', () => {
      const list = createSourcesList(root, defaultOpts());
      list.addSource('s1', 'a', { text: '', entities: [] });
      list.setSourceStatus('s1', 'pending');
      expect(
        tabsHost.querySelector('[data-testid="source-status-s1"]').dataset.status,
      ).toBe('pending');
      list.setSourceStatus('s1', 'ready');
      expect(
        tabsHost.querySelector('[data-testid="source-status-s1"]').dataset.status,
      ).toBe('ready');
    });
  });

  describe('sidebar doc list', () => {
    let docHost;

    beforeEach(() => {
      docHost = document.createElement('div');
      document.body.appendChild(docHost);
    });

    it('renders one row per source with a count and add button', () => {
      const list = createSourcesList(root, defaultOpts());
      list.renderDocList(docHost);

      expect(docHost.querySelector('.sidebar-title h4').textContent).toBe('Dokumenty');
      expect(docHost.querySelector('.sidebar-title .count').textContent).toBe('0');
      expect(docHost.querySelectorAll('.doc-item').length).toBe(0);
      expect(docHost.querySelector('[data-testid="doc-add"]')).not.toBeNull();

      list.addSource('s1', 'Wklejony tekst 1', { text: '', entities: [], type: 'paste' });
      list.addSource('s2', 'umowa.docx', { text: '', entities: [], type: 'file' });

      const rows = [...docHost.querySelectorAll('.doc-item')];
      expect(rows.length).toBe(2);
      expect(docHost.querySelector('.sidebar-title .count').textContent).toBe('2');
      expect(rows.map((row) => row.querySelector('.name').textContent)).toEqual([
        'Wklejony tekst 1',
        'umowa.docx',
      ]);
      expect(rows[0].dataset.type).toBe('paste');
      expect(rows[1].dataset.type).toBe('file');
    });

    it('moves active state between doc list and workspace tabs', () => {
      const list = createSourcesList(root, defaultOpts());
      list.renderDocList(docHost);
      list.addSource('s1', 'first', { text: '', entities: [] });
      list.addSource('s2', 'second', { text: '', entities: [] });

      docHost.querySelector('[data-testid="doc-item-s2"]').click();
      expect(docHost.querySelector('[data-testid="doc-item-s2"]').classList.contains('active')).toBe(true);
      expect(tabsHost.querySelector('[data-testid="ws-tab-s2"]').classList.contains('active')).toBe(true);
      expect(root.querySelector('[data-testid="source-card-s2"]').dataset.active).toBe('true');

      tabsHost.querySelector('[data-testid="ws-tab-s1"]').click();
      expect(docHost.querySelector('[data-testid="doc-item-s1"]').classList.contains('active')).toBe(true);
      expect(docHost.querySelector('[data-testid="doc-item-s2"]').classList.contains('active')).toBe(false);
    });

    it('updates count and active row when sources are removed', () => {
      const list = createSourcesList(root, defaultOpts());
      list.renderDocList(docHost);
      list.addSource('s1', 'first', { text: '', entities: [] });
      list.addSource('s2', 'second', { text: '', entities: [] });
      list.addSource('s3', 'third', { text: '', entities: [] });

      list.removeSource('s1');

      expect(docHost.querySelector('.sidebar-title .count').textContent).toBe('2');
      expect(docHost.querySelector('[data-testid="doc-item-s1"]')).toBeNull();
      expect(docHost.querySelectorAll('.doc-item.active').length).toBe(1);
      expect(tabsHost.querySelectorAll('.ws-tab.active').length).toBe(1);
    });

    it('keeps status glyphs in sync with source status', () => {
      const list = createSourcesList(root, defaultOpts());
      list.renderDocList(docHost);
      list.addSource('s1', 'first', { text: '', entities: [], status: 'idle' });
      list.addSource('s2', 'second', { text: '', entities: [], status: 'pending' });

      expect(docHost.querySelector('[data-testid="doc-status-s1"]').textContent).toBe('…');
      expect(docHost.querySelector('[data-testid="doc-status-s2"]').textContent).toBe('·');

      list.setSourceStatus('s1', 'ready');
      list.setSourceStatus('s2', 'error', 'failed');

      expect(docHost.querySelector('[data-testid="doc-status-s1"]').textContent).toBe('✓');
      expect(docHost.querySelector('[data-testid="doc-status-s2"]').textContent).toBe('✕');
      expect(tabsHost.querySelector('[data-testid="source-status-s1"]').dataset.status).toBe('ready');
      expect(tabsHost.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('error');
    });

    it('clicking doc list add opens the new-document tab', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.renderDocList(docHost);
      list.addSource('s1', 'first', { text: '', entities: [] });

      docHost.querySelector('[data-testid="doc-add"]').click();

      expect(tabsHost.querySelector('[data-testid="ws-tab-new-source"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="editor-empty"]')).not.toBeNull();
      expect(opts.onAddPaste).not.toHaveBeenCalled();
    });
  });

  describe('edit mode controls', () => {
    it('shows Edytuj in annotation mode and returns with Zakończ edycję when unchanged', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'doc', {
        text: 'Anna mieszka w Warszawie',
        entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 4, score: 1 }],
      });

      const editBtn = toolbarHost.querySelector('[data-testid="source-edit-s1"]');
      expect(editBtn).not.toBeNull();
      editBtn.click();
      expect(list.getMode('s1')).toBe('text');
      expect(root.querySelector('.ann-editor-textarea')).not.toBeNull();

      const finishBtn = toolbarHost.querySelector('[data-testid="source-finish-edit-s1"]');
      expect(finishBtn).not.toBeNull();
      finishBtn.click();
      expect(list.getMode('s1')).toBe('annotation');
      expect(root.querySelector('.ann-editor-surface')).not.toBeNull();
    });

    it('marks edited text as dirty and replaces finish control with a re-anonymize hint', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'doc', {
        text: 'Anna mieszka w Warszawie',
        entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 4, score: 1 }],
      });

      toolbarHost.querySelector('[data-testid="source-edit-s1"]').click();
      const textarea = root.querySelector('.ann-editor-textarea');
      textarea.value = 'Anna mieszka w Krakowie';
      textarea.dispatchEvent(new Event('input'));

      expect(list.isTextDirty('s1')).toBe(true);
      expect(opts.onTextDirtyChange).toHaveBeenLastCalledWith('s1', true);
      expect(toolbarHost.querySelector('[data-testid="source-finish-edit-s1"]')).toBeNull();
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-dirty-hint"]')).not.toBeNull();
    });
  });

  describe('without explicit hosts', () => {
    it('renders tabs and toolbar inside rootEl when hosts not provided', () => {
      const list = createSourcesList(root, defaultOpts({ tabsHost: undefined, toolbarHost: undefined }));
      list.addSource('s1', 'a', { text: '', entities: [] });
      expect(root.querySelector('[data-testid="ws-tab-s1"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="editor-toolbar-label"]')).not.toBeNull();
    });
  });

  describe('assistant-visible label', () => {
    it('shows the mcpLabel in the toolbar and edits it through onMcpLabelChange', () => {
      const opts = defaultOpts({ onMcpLabelChange: vi.fn() });
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'Jan_Kowalski_pozew.pdf', {
        text: 'tekst', entities: [], status: 'idle', type: 'file', mcpLabel: 'Źródło 1',
      });

      const tag = toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]');
      expect(tag).not.toBeNull();
      expect(tag.textContent).toContain('Źródło 1');

      tag.click();
      const input = toolbarHost.querySelector('[data-testid="source-mcp-label-input-s1"]');
      expect(input).not.toBeNull();
      input.value = 'Sprawa rozwodowa';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));

      expect(opts.onMcpLabelChange).toHaveBeenCalledWith('s1', 'Sprawa rozwodowa');
      expect(
        toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]').textContent,
      ).toContain('Sprawa rozwodowa');
    });

    it('an empty edit keeps the current mcpLabel and does not fire the callback', () => {
      const opts = defaultOpts({ onMcpLabelChange: vi.fn() });
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'plik.pdf', {
        text: 't', entities: [], status: 'idle', type: 'file', mcpLabel: 'Źródło 1',
      });

      toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]').click();
      const input = toolbarHost.querySelector('[data-testid="source-mcp-label-input-s1"]');
      input.value = '   ';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));

      expect(opts.onMcpLabelChange).not.toHaveBeenCalled();
      expect(
        toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]').textContent,
      ).toContain('Źródło 1');
    });
  });
  describe('rename trigger', () => {
    it('clicking the toolbar label opens the rename input and commits via onRename', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'Jan_Kowalski_pozew.pdf', {
        text: 'tekst', entities: [], status: 'idle', type: 'file',
      });

      const label = toolbarHost.querySelector('[data-testid="editor-toolbar-label"]');
      expect(label).not.toBeNull();
      label.click();

      const input = toolbarHost.querySelector('[data-testid="source-label-input-s1"]');
      expect(input).not.toBeNull();
      expect(input.value).toBe('Jan_Kowalski_pozew.pdf');

      input.value = 'Umowa';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));

      expect(opts.onRename).toHaveBeenCalledWith('s1', 'Umowa');
      expect(
        toolbarHost.querySelector('[data-testid="editor-toolbar-label"]').textContent,
      ).toBe('Umowa');
      expect(
        tabsHost.querySelector('[data-testid="ws-tab-label-s1"]').textContent,
      ).toBe('Umowa');
    });

    it('Enter on the focused toolbar label opens the rename input', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'notatka.txt', { text: 't', entities: [] });

      const label = toolbarHost.querySelector('[data-testid="editor-toolbar-label"]');
      label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(
        toolbarHost.querySelector('[data-testid="source-label-input-s1"]'),
      ).not.toBeNull();
    });

    it('an empty rename keeps the current label and does not fire onRename', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'plik.pdf', { text: 't', entities: [] });

      toolbarHost.querySelector('[data-testid="editor-toolbar-label"]').click();
      const input = toolbarHost.querySelector('[data-testid="source-label-input-s1"]');
      input.value = '   ';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));

      expect(opts.onRename).not.toHaveBeenCalled();
      expect(
        toolbarHost.querySelector('[data-testid="editor-toolbar-label"]').textContent,
      ).toBe('plik.pdf');
    });
  });
});
