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

describe('createWorkspace — click empty dropzone', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('clicking the dropzone mounts the editor with empty text', () => {
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
