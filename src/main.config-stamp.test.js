// @vitest-environment jsdom
//
// ST-8 (SCOPE-TIERS-DESIGN.md §8.1 pkt 2, R-ST-4): a ready document
// anonymized under an older configuration carries a visible stamp until the
// user re-runs anonymization — two documents in one session must never
// silently live in two scopes. Same fake-worker harness as
// main.stale-classify.test.js.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEXT = 'Jan Kowalski podpisał umowę.';
const PERSON_ENTITY = {
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

async function bootApp() {
  vi.resetModules();
  FakeWorker.instances = [];
  installToolDom();
  installWebMcpFake();
  globalThis.Worker = FakeWorker;
  let nextUuid = 2;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `s${nextUuid++}`);

  await import('./main.js');

  const worker = FakeWorker.instances[0];
  worker.emit({ type: 'configured' });

  return { worker };
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

function clickAnonymize() {
  document.querySelector('[data-action="anonymize"]').click();
}

function toggleEntity(worker, entity) {
  const input = document.querySelector(`#entity-selector-root input[data-entity="${entity}"]`);
  expect(input).not.toBeNull();
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // A selection change re-configures the worker and disables Anonimizuj
  // until the ack arrives — deliver it like the real worker would.
  worker.emit({ type: 'configured' });
}

function staleBadge() {
  return document.querySelector('[data-testid^="editor-toolbar-config-stale-"]');
}

describe('configuration stamp on ready sources (ST-8)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
  });

  it('appears when the selection drifts after the result and clears after a re-run', async () => {
    const { worker } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY] });

    expect(staleBadge()).toBeNull();

    toggleEntity(worker, 'ORGANIZATION_NAME');
    expect(staleBadge()).not.toBeNull();
    expect(staleBadge().textContent).toBe('zanonimizowano starszą konfiguracją');

    // Re-run under the new configuration (selectionChanged forces the
    // re-classify) — the fresh result carries the new stamp.
    clickAnonymize();
    expect(worker.messages.filter((m) => m.type === 'classify')).toHaveLength(2);
    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY] });
    expect(staleBadge()).toBeNull();
  });

  it('toggling the selection back to the anonymized configuration clears the stamp without a re-run', async () => {
    const { worker } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY] });

    toggleEntity(worker, 'ORGANIZATION_NAME');
    expect(staleBadge()).not.toBeNull();
    toggleEntity(worker, 'ORGANIZATION_NAME');
    expect(staleBadge()).toBeNull();
  });
});
