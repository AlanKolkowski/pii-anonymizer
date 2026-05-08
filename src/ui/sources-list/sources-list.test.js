// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSourcesList } from './index.js';

describe('createSourcesList', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
  });

  function defaultOpts(overrides = {}) {
    return {
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

  it('renders an empty container with an "add" affordance', () => {
    createSourcesList(root, defaultOpts());
    expect(root.querySelector('[data-testid="sources-add-paste"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="sources-add-file"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid^="source-card-"]').length).toBe(0);
  });

  it('addSource creates a card with the given label', () => {
    const list = createSourcesList(root, defaultOpts());
    list.addSource('s1', 'umowa.docx', { text: '', entities: [] });
    const card = root.querySelector('[data-testid="source-card-s1"]');
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-testid="source-label-s1"]').textContent).toBe('umowa.docx');
  });

  it('removeSource detaches the card', () => {
    const list = createSourcesList(root, defaultOpts());
    list.addSource('s1', 'a', { text: '', entities: [] });
    list.removeSource('s1');
    expect(root.querySelector('[data-testid="source-card-s1"]')).toBeNull();
  });

  it('clicking the paste affordance fires onAddPaste', () => {
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

  it('clicking remove fires onRemove with id', () => {
    const opts = defaultOpts();
    const list = createSourcesList(root, opts);
    list.addSource('s1', 'a', { text: '', entities: [] });
    root.querySelector('[data-testid="source-remove-s1"]').click();
    expect(opts.onRemove).toHaveBeenCalledWith('s1');
  });

  it('renaming via the label input fires onRename and updates display', () => {
    const opts = defaultOpts();
    const list = createSourcesList(root, opts);
    list.addSource('s1', 'old', { text: '', entities: [] });
    const editBtn = root.querySelector('[data-testid="source-rename-s1"]');
    editBtn.click();
    const input = root.querySelector('[data-testid="source-label-input-s1"]');
    input.value = 'new';
    input.dispatchEvent(new Event('change'));
    input.dispatchEvent(new Event('blur'));
    expect(opts.onRename).toHaveBeenCalledWith('s1', 'new');
    list.setSourceLabel('s1', 'new');
    expect(root.querySelector('[data-testid="source-label-s1"]').textContent).toBe('new');
  });

  it('setSourceStatus updates a status indicator inside the card', () => {
    const list = createSourcesList(root, defaultOpts());
    list.addSource('s1', 'a', { text: '', entities: [] });
    list.setSourceStatus('s1', 'pending');
    expect(
      root.querySelector('[data-testid="source-status-s1"]').dataset.status,
    ).toBe('pending');
    list.setSourceStatus('s1', 'ready');
    expect(
      root.querySelector('[data-testid="source-status-s1"]').dataset.status,
    ).toBe('ready');
  });
});
