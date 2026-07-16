// @vitest-environment jsdom
//
// ST-6 (SCOPE-TIERS-DESIGN.md §7.1 pkt 2): the negative contract — W2 review
// candidates do not exist in ANY MCP payload. This drives the real app shell
// (fake worker, real WebMCP tool handlers registered by main.js), puts a
// source into the in-review state, then calls EVERY bridge tool and greps
// every response for the candidate value. Zero hits allowed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEXT = 'Anna Nowak, wdowiec, mieszka sama.';
const CANDIDATE_VALUE = 'wdowiec';
const PERSON_ENTITY = {
  entity_group: 'PERSON_NAME',
  start: 0,
  end: 'Anna Nowak'.length,
  score: 0.99,
  source: 'ner',
};
const WIDOWER_CANDIDATE = {
  entity_group: 'PERSON_ATTRIBUTE',
  start: TEXT.indexOf(CANDIDATE_VALUE),
  end: TEXT.indexOf(CANDIDATE_VALUE) + CANDIDATE_VALUE.length,
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

function clickAnonymize() {
  document.querySelector('[data-action="anonymize"]').click();
}

function callTool(tools, name, args = {}) {
  return JSON.stringify(tools.get(name)(args));
}

describe('ST-6 — candidates do not exist in any MCP payload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
  });

  it('a source in review is unlistable and unreadable; no tool response carries the candidate value', async () => {
    const { worker, tools } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();
    worker.emit({
      type: 'result',
      id: 's2',
      data: [PERSON_ENTITY],
      candidates: [WIDOWER_CANDIDATE],
    });

    // Ready in the UI, but the bridge must not see it before the review ends.
    expect(document.querySelector('[data-testid="source-status-s2"]').dataset.status).toBe('ready');
    const listSources = callTool(tools, 'list_sources');
    expect(JSON.parse(JSON.parse(listSources).content[0].text)).toEqual([]);

    const readSource = callTool(tools, 'read_source', { id: 's2' });
    expect(readSource).toContain('w przeglądzie');

    const writeOutcome = callTool(tools, 'write_outcome', { label: 'Szkic', text: 'Pismo o [PERSON_NAME_1].' });
    const listOutcomes = callTool(tools, 'list_outcomes');
    const outcomeId = JSON.parse(JSON.parse(writeOutcome).content[0].text).id;
    const readOutcome = callTool(tools, 'read_outcome', { id: outcomeId });

    // §7.1 pkt 2: grep EVERY response — the candidate value, its count and
    // its context exist nowhere in the bridge's world.
    for (const payload of [listSources, readSource, writeOutcome, listOutcomes, readOutcome]) {
      expect(payload).not.toContain(CANDIDATE_VALUE);
      expect(payload).not.toContain('PERSON_ATTRIBUTE');
    }
    // The raw text (with the pending value in context) never crossed either.
    expect(readSource).not.toContain('Anna Nowak');
  });

  it('a dictionary-resolved review opens the bridge without any UI action', async () => {
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

    const listing = JSON.parse(JSON.parse(callTool(tools, 'list_sources')).content[0].text);
    expect(listing).toHaveLength(1);
    const readSource = JSON.parse(callTool(tools, 'read_source', { id: 's2' }));
    expect(readSource.content[0].text).toBe('[PERSON_NAME_1], [PERSON_ATTRIBUTE_1], mieszka sama.');
  });
});
