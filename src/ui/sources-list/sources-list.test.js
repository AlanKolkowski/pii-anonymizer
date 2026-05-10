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
      onModeChange: vi.fn(),
      ...overrides,
    };
  }

  describe('empty state', () => {
    it('renders the three "ways" affordances when no sources', () => {
      createSourcesList(root, defaultOpts());
      expect(root.querySelector('[data-testid="editor-empty"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-paste"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-file"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="sources-add-type"]')).not.toBeNull();
      expect(root.querySelectorAll('[data-testid^="source-card-"]').length).toBe(0);
    });

    it('clicking the paste way fires onAddPaste', () => {
      const opts = defaultOpts();
      createSourcesList(root, opts);
      root.querySelector('[data-testid="sources-add-paste"]').click();
      expect(opts.onAddPaste).toHaveBeenCalledTimes(1);
    });

    it('clicking the type way fires onAddPaste', () => {
      const opts = defaultOpts();
      createSourcesList(root, opts);
      root.querySelector('[data-testid="sources-add-type"]').click();
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

    it('clicking the "+" affordance fires onAddPaste', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'a', { text: '', entities: [] });
      tabsHost.querySelector('[data-testid="ws-tab-add"]').click();
      expect(opts.onAddPaste).toHaveBeenCalledTimes(1);
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

  describe('rename', () => {
    it('renaming via the toolbar rename button fires onRename and updates display', () => {
      const opts = defaultOpts();
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'old', { text: '', entities: [] });
      const editBtn = toolbarHost.querySelector('[data-testid="source-rename-s1"]');
      expect(editBtn).not.toBeNull();
      editBtn.click();
      const input = toolbarHost.querySelector('[data-testid="source-label-input-s1"]');
      input.value = 'new';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));
      expect(opts.onRename).toHaveBeenCalledWith('s1', 'new');
      list.setSourceLabel('s1', 'new');
      expect(toolbarHost.querySelector('[data-testid="editor-toolbar-label"]').textContent).toBe('new');
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
});
