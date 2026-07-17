// @vitest-environment jsdom
//
// ST-4 (SCOPE-TIERS-DESIGN.md §4.2/§4.3): the review-bucket UI drives the
// ST-3 engine end to end through the real app shell — decision buttons mask
// and unmask through the same entity/legend paths as annotation edits, the
// explicit "zapamiętaj" checkbox writes the persistent dictionary, and
// "Zakończ przegląd" resolves the rest as bulk skips.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEXT = 'Anna Nowak, wdowiec, winna 500 zł.';
const PERSON_ENTITY = {
  entity_group: 'PERSON_NAME',
  start: 0,
  end: 'Anna Nowak'.length,
  score: 0.99,
  source: 'ner',
};

function candidateFor(value, entity_group) {
  const start = TEXT.indexOf(value);
  return {
    entity_group, start, end: start + value.length, score: 0.9, source: 'ner',
    tier: 'review', valueKey: `${entity_group}::${value.toLocaleLowerCase('pl')}`,
  };
}

const WIDOWER = candidateFor('wdowiec', 'PERSON_ATTRIBUTE');
const AMOUNT = candidateFor('500 zł', 'FINANCIAL_AMOUNT');

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

function byId(testid) {
  return document.querySelector(`[data-testid="${testid}"]`);
}

async function bootWithCandidates() {
  const boot = await bootApp();
  addPasteSourceWithText(TEXT);
  clickAnonymize();
  boot.worker.emit({
    type: 'result',
    id: 's2',
    data: [PERSON_ENTITY],
    candidates: [WIDOWER, AMOUNT],
  });
  return boot;
}

describe('review-bucket UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
  });

  it('renders the badge with pending VALUES, groups collapsed by default', async () => {
    await bootWithCandidates();
    expect(byId('review-badge-s2').textContent).toBe('Do przeglądu (2)');
    const group = byId('review-group-s2-PERSON_ATTRIBUTE');
    expect(group).not.toBeNull();
    expect(group.open).toBe(false);
    expect(group.querySelector('summary').textContent).toContain('(1 wartości, 1 wystąpień)');
    // Air-gap surface: no copy/export controls anywhere in the bucket (O-ST-8).
    const bucketText = document.querySelector('.review-bucket').textContent;
    expect(bucketText).not.toMatch(/[Kk]opiuj|[Ee]ksport/);
  });

  it('Maskuj masks all occurrences through the legend; Cofnij restores', async () => {
    await bootWithCandidates();
    expect(byId('run-bar-tokens').textContent).toBe('1');

    byId('review-mask-s2-PERSON_ATTRIBUTE::wdowiec').click();
    expect(byId('run-bar-tokens').textContent).toBe('2');
    expect(byId('review-decision-s2-PERSON_ATTRIBUTE::wdowiec').textContent).toBe('zamaskowane');
    expect(byId('review-badge-s2').textContent).toBe('Do przeglądu (1)');

    byId('review-undo-s2-PERSON_ATTRIBUTE::wdowiec').click();
    expect(byId('run-bar-tokens').textContent).toBe('1');
    expect(byId('review-badge-s2').textContent).toBe('Do przeglądu (2)');
    expect(byId('review-mask-s2-PERSON_ATTRIBUTE::wdowiec')).not.toBeNull();
  });

  it('Pomiń records the decision without masking; both buttons carry equal styling', async () => {
    await bootWithCandidates();
    const mask = byId('review-mask-s2-PERSON_ATTRIBUTE::wdowiec');
    const skip = byId('review-skip-s2-PERSON_ATTRIBUTE::wdowiec');
    expect(mask.className).toBe(skip.className); // R-ST-2: no blessed default
    skip.click();
    expect(byId('run-bar-tokens').textContent).toBe('1');
    expect(byId('review-decision-s2-PERSON_ATTRIBUTE::wdowiec').textContent).toBe('pominięte');
  });

  it('zapamiętaj na stałe writes the persistent dictionary on decision', async () => {
    await bootWithCandidates();
    byId('review-remember-s2-PERSON_ATTRIBUTE::wdowiec').checked = true;
    byId('review-mask-s2-PERSON_ATTRIBUTE::wdowiec').click();
    const stored = JSON.parse(localStorage.getItem('pii.review-dictionary'));
    expect(stored.alwaysMask.PERSON_ATTRIBUTE).toEqual(['wdowiec']);
    expect(stored.alwaysSkip).toEqual({});
  });

  it('a decision without the checkbox does NOT touch the dictionary', async () => {
    await bootWithCandidates();
    byId('review-mask-s2-PERSON_ATTRIBUTE::wdowiec').click();
    expect(localStorage.getItem('pii.review-dictionary')).toBeNull();
  });

  it('bulk skip per type and Zakończ przegląd resolve the rest as bulk', async () => {
    await bootWithCandidates();
    byId('review-bulk-skip-s2-FINANCIAL_AMOUNT').click();
    expect(byId('review-decision-s2-FINANCIAL_AMOUNT::500 zł').textContent).toBe('pominięte (zbiorczo)');
    expect(byId('review-badge-s2').textContent).toBe('Do przeglądu (1)');

    byId('review-finish-s2').click();
    expect(byId('review-badge-s2').textContent).toBe('Do przeglądu (0)');
    expect(byId('review-complete-s2').textContent).toBe('Przegląd zakończony');
    expect(byId('review-decision-s2-PERSON_ATTRIBUTE::wdowiec').textContent).toBe('pominięte (zbiorczo)');
  });

  it('dictionary-resolved values render with the słownik badge and stay reversible', async () => {
    localStorage.setItem(
      'pii.review-dictionary',
      JSON.stringify({ alwaysSkip: { FINANCIAL_AMOUNT: ['500 zł'] } }),
    );
    await bootWithCandidates();
    expect(byId('review-decision-s2-FINANCIAL_AMOUNT::500 zł').textContent).toBe('pominięte (słownik)');
    byId('review-undo-s2-FINANCIAL_AMOUNT::500 zł').click();
    expect(byId('review-mask-s2-FINANCIAL_AMOUNT::500 zł')).not.toBeNull();
  });

  it('no candidates → the bucket section stays hidden', async () => {
    const { worker } = await bootApp();
    addPasteSourceWithText(TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: 's2', data: [PERSON_ENTITY], candidates: [] });
    const bucket = document.querySelector('.review-bucket');
    expect(bucket === null || bucket.hidden).toBe(true);
  });
});
