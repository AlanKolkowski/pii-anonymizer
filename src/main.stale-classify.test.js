// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEXT_AT_DISPATCH = 'Jan Kowalski podpisał umowę.';
const TEXT_AFTER_PREFIX_INSERT = `PILNE: ${TEXT_AT_DISPATCH}`;
const PERSON_ENTITY_FOR_DISPATCH_TEXT = {
  entity_group: 'PERSON_NAME',
  start: 0,
  end: 'Jan Kowalski'.length,
  score: 0.99,
  source: 'ner',
};

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.onmessage = null;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }
}

function installToolDom() {
  document.body.innerHTML = `
    <div id="webnn-hint" hidden>
      <button id="webnn-hint-trigger" type="button" aria-expanded="false"></button>
      <div id="webnn-hint-panel" hidden>
        <button id="webnn-hint-close" type="button"></button>
      </div>
    </div>
    <div class="tool">
      <p data-status="model"></p>
      <div data-mode-panel="anonymize">
        <div id="doc-list-root"></div>
        <div id="entity-selector-root"></div>
        <input id="allow-gpu-checkbox" type="checkbox">
        <input id="preload-ocr-checkbox" type="checkbox">
        <input id="preload-ner-checkbox" type="checkbox">
        <div id="workspace-tabs-root"></div>
        <div class="editor-pane">
          <div id="editor-toolbar-root"></div>
          <div id="sources-list-root"></div>
          <section id="debug-section" hidden><div id="debug-panel"></div></section>
        </div>
        <b data-testid="run-bar-docs">0</b>
        <b data-testid="run-bar-tokens">0</b>
        <div data-testid="run-bar-meter" hidden><div data-testid="run-bar-meter-fill"></div></div>
        <p data-testid="run-bar-status" hidden></p>
        <div id="webmcp-control-root"></div>
        <button data-action="copy-all" data-testid="copy-all" type="button" disabled>Kopiuj wszystkie</button>
        <button data-action="anonymize" type="button" disabled>Anonimizuj</button>
      </div>
      <div data-mode-panel="deanonymize" hidden>
        <div id="deanon-workspace-root"></div>
      </div>
    </div>
  `;
}

function installWebMcpFake() {
  const tools = new Map();

  globalThis.WebMCP = class FakeWebMCP {
    constructor() {
      this.isConnected = false;
    }

    registerTool(name, _description, _schema, handler) {
      tools.set(name, handler);
    }
  };

  return tools;
}

function mcpJson(tools, name, args = {}) {
  const response = tools.get(name)(args);
  return JSON.parse(response.content[0].text);
}

function mcpText(tools, name, args = {}) {
  const response = tools.get(name)(args);
  return response.content[0].text;
}

async function bootApp() {
  vi.resetModules();
  FakeWorker.instances = [];
  installToolDom();
  const tools = installWebMcpFake();
  globalThis.Worker = FakeWorker;
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('s2');

  await import('./main.js');

  const worker = FakeWorker.instances[0];
  worker.emit({ type: 'configured' });

  return { worker, tools };
}

function addPasteSourceWithText(text) {
  document.querySelector('[data-testid="sources-add-paste"]').click();
  const textarea = document.querySelector('.ann-editor-textarea');
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickAnonymize() {
  document.querySelector('[data-action="anonymize"]').click();
}

describe('classify result text snapshots', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
  });

  it('rejects stale NER offsets when the source text changed after dispatch', async () => {
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT_AT_DISPATCH);

    clickAnonymize();
    expect(worker.messages).toContainEqual({
      type: 'classify',
      id: 's2',
      text: TEXT_AT_DISPATCH,
    });

    const textarea = document.querySelector('.ann-editor-textarea');
    textarea.value = TEXT_AFTER_PREFIX_INSERT;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY_FOR_DISPATCH_TEXT] });

    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('idle');
    expect(document.querySelector('[data-testid="run-bar-tokens"]').textContent).toBe('0');
    expect(document.querySelector('[data-testid="editor-toolbar-entity-count"]')).toBeNull();
    expect(mcpJson(tools, 'list_sources')).toEqual([]);
  });

  it('accepts matching NER snapshots and exposes the returned entities as ready', async () => {
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT_AT_DISPATCH);

    clickAnonymize();
    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY_FOR_DISPATCH_TEXT] });

    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('ready');
    expect(document.querySelector('[data-testid="run-bar-tokens"]').textContent).toBe('1');
    expect(document.querySelector('[data-testid="editor-toolbar-entity-count"]').textContent).toBe('1 encji wykrytych');
    expect(mcpJson(tools, 'list_sources')).toEqual([
      { id: 's2', label: 'Źródło 1', char_count: '[PERSON_NAME_1] podpisał umowę.'.length },
    ]);
    expect(mcpText(tools, 'read_source', { id: 's2' })).toBe('[PERSON_NAME_1] podpisał umowę.');
  });
});
