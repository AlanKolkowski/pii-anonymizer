// @vitest-environment jsdom
//
// ST-3 wiring (SCOPE-TIERS-DESIGN.md §4.1): worker 'result' messages carry W2
// review candidates; main.js reconciles them with the document's decision
// memory and the persistent dictionary (localStorage pii.review-dictionary)
// before entities reach the legend. The engine itself is unit-tested in
// review-engine.test.js — these tests drive the app shell end to end with a
// fake worker, the same harness as main.stale-classify.test.js.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEXT = 'Anna Nowak, wdowiec, mieszka sama.';
const TEXT_RERUN = 'Anna Nowak, wdowiec, mieszka sama. Dopisek.';
const PERSON_ENTITY = {
  entity_group: 'PERSON_NAME',
  start: 0,
  end: 'Anna Nowak'.length,
  score: 0.99,
  source: 'ner',
};
const WIDOWER_CANDIDATE = {
  entity_group: 'PERSON_ATTRIBUTE',
  start: TEXT.indexOf('wdowiec'),
  end: TEXT.indexOf('wdowiec') + 'wdowiec'.length,
  score: 0.9,
  source: 'ner',
  tier: 'review',
  valueKey: 'PERSON_ATTRIBUTE::wdowiec',
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
  let nextUuid = 2;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `s${nextUuid++}`);

  await import('./main.js');

  const worker = FakeWorker.instances[0];
  worker.emit({ type: 'configured' });

  return { worker, tools };
}

function addPasteSourceWithText(text) {
  let pasteButton = document.querySelector('[data-testid="sources-add-paste"]');
  if (!pasteButton) {
    document.querySelector('[data-testid="ws-tab-add"]')?.click();
    pasteButton = document.querySelector('[data-testid="sources-add-paste"]');
  }
  expect(pasteButton).not.toBeNull();
  pasteButton.click();
  const activeCard = document.querySelector('[data-testid^="source-card-"][data-active="true"]');
  const textarea = activeCard?.querySelector('.ann-editor-textarea')
    ?? document.querySelector('.ann-editor-textarea');
  expect(textarea).not.toBeNull();
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function editReadySourceText(id, text) {
  document.querySelector(`[data-testid="source-edit-${id}"]`).click();
  const textarea = document.querySelector(`[data-testid="source-card-${id}"] .ann-editor-textarea`);
  expect(textarea).not.toBeNull();
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickAnonymize() {
  document.querySelector('[data-action="anonymize"]').click();
}

describe('review candidates wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
  });

  it('a dictionary alwaysMask entry resolves a fresh candidate and masks it end to end', async () => {
    localStorage.setItem(
      'pii.review-dictionary',
      JSON.stringify({ alwaysMask: { PERSON_ATTRIBUTE: ['wdowiec'] } }),
    );
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();

    worker.emit({
      type: 'result',
      id: 's2',
      data: [PERSON_ENTITY],
      candidates: [WIDOWER_CANDIDATE],
    });

    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('ready');
    expect(document.querySelector('[data-testid="run-bar-tokens"]').textContent).toBe('2');
    expect(mcpText(tools, 'read_source', { id: 's2' }))
      .toBe('[PERSON_NAME_1], [PERSON_ATTRIBUTE_1], mieszka sama.');
  });

  it('without a dictionary entry the candidate stays pending and visible', async () => {
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();

    worker.emit({
      type: 'result',
      id: 's2',
      data: [PERSON_ENTITY],
      candidates: [WIDOWER_CANDIDATE],
    });

    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('ready');
    expect(document.querySelector('[data-testid="run-bar-tokens"]').textContent).toBe('1');
    expect(mcpText(tools, 'read_source', { id: 's2' }))
      .toBe('[PERSON_NAME_1], wdowiec, mieszka sama.');
  });

  it('a rerun re-resolves candidates without stacking duplicate entities', async () => {
    localStorage.setItem(
      'pii.review-dictionary',
      JSON.stringify({ alwaysMask: { PERSON_ATTRIBUTE: ['wdowiec'] } }),
    );
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();
    worker.emit({
      type: 'result', id: 's2', data: [PERSON_ENTITY], candidates: [WIDOWER_CANDIDATE],
    });

    editReadySourceText('s2', TEXT_RERUN);
    clickAnonymize();
    expect(worker.messages.filter((m) => m.type === 'classify')).toHaveLength(2);
    worker.emit({
      type: 'result',
      id: 's2',
      data: [PERSON_ENTITY],
      candidates: [{ ...WIDOWER_CANDIDATE }],
    });

    expect(document.querySelector('[data-testid="run-bar-tokens"]').textContent).toBe('2');
    expect(mcpText(tools, 'read_source', { id: 's2' }))
      .toBe('[PERSON_NAME_1], [PERSON_ATTRIBUTE_1], mieszka sama. Dopisek.');
  });

  it('a legacy result without a candidates field behaves exactly like today', async () => {
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();

    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY] });

    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('ready');
    expect(document.querySelector('[data-testid="run-bar-tokens"]').textContent).toBe('1');
    expect(mcpText(tools, 'read_source', { id: 's2' }))
      .toBe('[PERSON_NAME_1], wdowiec, mieszka sama.');
  });

  it('a corrupt persisted dictionary degrades to empty instead of breaking boot', async () => {
    localStorage.setItem('pii.review-dictionary', '{broken json');
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();

    worker.emit({
      type: 'result',
      id: 's2',
      data: [PERSON_ENTITY],
      candidates: [WIDOWER_CANDIDATE],
    });

    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('ready');
    expect(mcpText(tools, 'read_source', { id: 's2' }))
      .toBe('[PERSON_NAME_1], wdowiec, mieszka sama.');
  });
});
