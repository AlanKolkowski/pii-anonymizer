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
    root.querySelector('[data-testid="workspace-dropzone"]').click();
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
