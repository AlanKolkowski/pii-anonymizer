// @vitest-environment jsdom
//
// FL-5-LIVE-WIRING-DESIGN.md K5: main.js is the flexion resolver's owner —
// this drives the REAL app (boot pattern mirrors src/main.docx-export.test.js)
// end to end through every live sink (U1 screen, U2 clipboard, U3 flat
// export, U4 DOCX reconstruction) to prove the wiring, not the linguistics
// (those are already proven in flexion-resolver.test.js/morph tests).
//
// Gate decision baked in throughout this file: FLEXION_LIVE_DEFAULT = false.
// Tests that want the mechanism active must flip localStorage themselves —
// the very first tests below prove OFF is the untouched, byte-for-byte
// default (G-FL5-1).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildZip } from './docx-rebuild/test-helpers/zip-fixture.js';
import { openZip } from './docx-rebuild/zip-reader.js';

const FLAG_KEY = 'pii.deanon-flexion';

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
  globalThis.WebMCP = class FakeWebMCP {
    constructor() {
      this.isConnected = false;
    }

    registerTool() {}
  };
}

async function bootApp() {
  vi.resetModules();
  FakeWorker.instances = [];
  installToolDom();
  installWebMcpFake();
  globalThis.Worker = FakeWorker;
  let nextUuid = 1;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `id${nextUuid++}`);
  await import('./main.js');
  const worker = FakeWorker.instances[0];
  worker.emit({ type: 'configured' });
  return worker;
}

function activeSourceId() {
  const card = document.querySelector('[data-testid^="source-card-"][data-active="true"]');
  return card ? card.dataset.testid.replace('source-card-', '') : null;
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
  return activeSourceId();
}

function clickAnonymize() {
  document.querySelector('[data-action="anonymize"]').click();
}

async function waitFor(predicate, { timeout = 4000, interval = 10 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor: timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Adds a text outcome via the REAL "Wklej" (paste) affordance — with zero
// outcomes yet, pasteIntoActive has no active outcome to update, so it calls
// onAdd directly (src/ui/deanon-workspace/index.js): a single click creates
// the outcome carrying exactly `text`.
async function addOutcomeViaPaste(text) {
  navigator.clipboard.readText.mockResolvedValue(text);
  document.querySelector('[data-testid="deanon-paste"]').click();
  await flush();
  await waitFor(() => document.querySelector('[data-testid="deanon-output-body"]') !== null);
}

function outputBodyText() {
  return document.querySelector('[data-testid="deanon-output-body"]').textContent;
}

async function clickCopyAndFlush() {
  document.querySelector('[data-testid="deanon-copy"]').click();
  await flush();
}

async function exportAndWaitForStats(format = 'docx') {
  document.querySelector(`[data-testid="deanon-export-${format}"]`).click();
  await waitFor(() => {
    const stats = document.querySelector('[data-testid="deanon-run-bar-stats"]')?.textContent ?? '';
    return stats !== '' && !stats.startsWith('Generuję') && !stats.startsWith('Tworzę');
  });
}

async function docxTextFromBlob(blob) {
  const zip = openZip(new Uint8Array(await blob.arrayBuffer()));
  return new TextDecoder().decode(await zip.extract('word/document.xml'));
}

// Two mentions of the SAME person in different grammatical cases — the
// FD-3/G12 recipe already proven end to end (flexion-resolver.test.js,
// main.docx-export.test.js): nominative first (becomes the legend's base
// value), genitive second (retained in `seen` as an attested form). No
// morphology artifact needed for this recipe (attested forms alone resolve
// the D case via S-P "od").
const SOURCE_TEXT = 'Jan Kowalski zawarł umowę. Wcześniej informowano Jana Kowalskiego o warunkach.';
function sourceEntities(text) {
  const nomStart = text.indexOf('Jan Kowalski');
  const genStart = text.indexOf('Jana Kowalskiego');
  return [
    { entity_group: 'PERSON_NAME', start: nomStart, end: nomStart + 'Jan Kowalski'.length, score: 0.99, source: 'ner' },
    { entity_group: 'PERSON_NAME', start: genStart, end: genStart + 'Jana Kowalskiego'.length, score: 0.99, source: 'ner' },
  ];
}
const OUTCOME_TEXT = 'Zasądza się od [PERSON_NAME_1] kwotę zadośćuczynienia.';
const BASE_TEXT = 'Zasądza się od Jan Kowalski kwotę zadośćuczynienia.';
const INFLECTED_TEXT = 'Zasądza się od Jana Kowalskiego kwotę zadośćuczynienia.';

describe('FL-5 K5 — default ON activates deanon inflection; explicit "0" is the off-switch (G-FL5-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
    Object.assign(navigator, { clipboard: { readText: vi.fn(), writeText: vi.fn() } });
  });

  // FLEXION_LIVE_DEFAULT = true (activated on Alan's approval, 2026-07-19): with
  // no localStorage key the deanon sinks inflect, matching the DOCX export path
  // that already inflects by default. The attested genitive from SOURCE_TEXT
  // supplies the form; the 'od' preposition confirms the case.
  it('default (no localStorage key at all): screen and clipboard inflect (default ON)', async () => {
    const worker = await bootApp();
    const sourceId = addPasteSourceWithText(SOURCE_TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: sourceId, data: sourceEntities(SOURCE_TEXT) });

    await addOutcomeViaPaste(OUTCOME_TEXT);
    expect(outputBodyText()).toBe(INFLECTED_TEXT);

    await clickCopyAndFlush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(INFLECTED_TEXT);
  });

  it("explicit pii.deanon-flexion='0' (off-switch): base value everywhere, overriding the ON default", async () => {
    localStorage.setItem(FLAG_KEY, '0');
    const worker = await bootApp();
    const sourceId = addPasteSourceWithText(SOURCE_TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: sourceId, data: sourceEntities(SOURCE_TEXT) });

    await addOutcomeViaPaste(OUTCOME_TEXT);
    expect(outputBodyText()).toBe(BASE_TEXT);

    await clickCopyAndFlush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BASE_TEXT);
  });
});

describe("FL-5 K5 — flag ON ('1'): U1==U2==U3 hash equality (G-FL5-2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
    localStorage.setItem(FLAG_KEY, '1');
    Object.assign(navigator, { clipboard: { readText: vi.fn(), writeText: vi.fn() } });
  });

  it('(a) screen (U1) and clipboard (U2) both carry the SAME inflected form, morph:null (attested form from `seen`)', async () => {
    const worker = await bootApp();
    const sourceId = addPasteSourceWithText(SOURCE_TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: sourceId, data: sourceEntities(SOURCE_TEXT) });

    await addOutcomeViaPaste(OUTCOME_TEXT);
    expect(outputBodyText()).toBe(INFLECTED_TEXT);

    await clickCopyAndFlush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(INFLECTED_TEXT);
  });

  it('(b) flat DOCX export (U3, outcome with no attached bytes) carries the SAME inflected text as U1/U2', async () => {
    vi.doMock('./export/deanon.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, downloadBlob: vi.fn() };
    });
    const worker = await bootApp();
    const sourceId = addPasteSourceWithText(SOURCE_TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: sourceId, data: sourceEntities(SOURCE_TEXT) });
    await addOutcomeViaPaste(OUTCOME_TEXT);
    expect(outputBodyText()).toBe(INFLECTED_TEXT); // U1, cross-checked against U3 below

    await exportAndWaitForStats('docx');

    const { downloadBlob } = await import('./export/deanon.js');
    const [blob] = downloadBlob.mock.calls.at(-1);
    const doc = await docxTextFromBlob(blob);
    expect(doc).toContain(INFLECTED_TEXT);
    expect(doc).not.toContain('Jan Kowalski kwotę'); // not the untouched nominative
  });

  it('(G-FL5-3) U1 preview for a DOCX-imported outcome matches U4 reconstruction, regardless of the flag (U4 is always on)', async () => {
    vi.doMock('./file-import/docx.js', () => ({
      extractDocx: async (file) => ({
        text: OUTCOME_TEXT,
        meta: { filename: file.name, mimeType: file.type, sizeBytes: file.size },
      }),
    }));
    vi.doMock('./export/deanon.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, downloadBlob: vi.fn() };
    });
    const worker = await bootApp();
    const sourceId = addPasteSourceWithText(SOURCE_TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: sourceId, data: sourceEntities(SOURCE_TEXT) });

    const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const parts = {
      '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '</Types>',
      '_rels/.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>',
      'word/document.xml': `${XML_DECL}<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">${OUTCOME_TEXT}</w:t></w:r></w:p></w:body></w:document>`,
    };
    const bytes = await buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, method: 0 })));
    const file = new File([bytes], 'pismo-od-AI.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = document.querySelector('[data-testid="deanon-import-docx-input"]');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await waitFor(() => document.querySelector('[data-testid="deanon-docx-badge"]') !== null);

    // U1: the screen preview for this DOCX outcome.
    expect(outputBodyText()).toBe(INFLECTED_TEXT);

    // U4: the actual reconstructed bytes.
    await exportAndWaitForStats('docx');
    const { downloadBlob } = await import('./export/deanon.js');
    const [blob] = downloadBlob.mock.calls.at(-1);
    const doc = await docxTextFromBlob(blob);
    expect(doc).toContain(INFLECTED_TEXT);
  });
});

describe('FL-5 K5 — R-D9 e2e corner: a token collision never surfaces another person\'s form (d)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
    localStorage.clear();
    localStorage.setItem(FLAG_KEY, '1'); // worst case: mechanism ON — the R-D9 filter must hold regardless
    Object.assign(navigator, { clipboard: { readText: vi.fn(), writeText: vi.fn() } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('after swapping sources, an outcome created under the OLD legend never receives the NEW occupant\'s attested form', async () => {
    vi.doMock('./export/deanon.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, downloadBlob: vi.fn() };
    });
    const worker = await bootApp();

    // 1. Source A: Jan Kowalski becomes [PERSON_NAME_1]; genitive attested.
    const sourceAId = addPasteSourceWithText(SOURCE_TEXT);
    clickAnonymize();
    worker.emit({ type: 'result', id: sourceAId, data: sourceEntities(SOURCE_TEXT) });

    // 2. An outcome referencing [PERSON_NAME_1] is created NOW — its
    // legendSnapshot freezes "[PERSON_NAME_1]" -> "Jan Kowalski".
    await addOutcomeViaPaste(OUTCOME_TEXT);
    expect(outputBodyText()).toBe(INFLECTED_TEXT); // sanity: flexion is live before the swap

    // Also import a DOCX outcome under the SAME (pre-swap) legend, to prove
    // U4 stays honest through the collision too.
    vi.doMock('./file-import/docx.js', () => ({
      extractDocx: async (file) => ({ text: OUTCOME_TEXT, meta: { filename: file.name, mimeType: file.type, sizeBytes: file.size } }),
    }));

    // 3. Remove source A entirely (real user action: "Alan zmienia źródła").
    const removeBtn = document.querySelector(`[data-testid="source-remove-${sourceAId}"]`);
    expect(removeBtn).not.toBeNull();
    removeBtn.click();

    // 4. Source B: Anna Nowak (nominative + dative) becomes the NEW
    // [PERSON_NAME_1] — a completely different person occupying the same
    // token index the stale outcome's snapshot still points at.
    const bSourceText = 'Anna Nowak podpisała aneks. Doręczono zawiadomienie Annie Nowak osobiście.';
    const sourceBId = addPasteSourceWithText(bSourceText);
    clickAnonymize();
    const bNomStart = bSourceText.indexOf('Anna Nowak');
    const bDatStart = bSourceText.indexOf('Annie Nowak');
    worker.emit({
      type: 'result',
      id: sourceBId,
      data: [
        { entity_group: 'PERSON_NAME', start: bNomStart, end: bNomStart + 'Anna Nowak'.length, score: 0.99, source: 'ner' },
        { entity_group: 'PERSON_NAME', start: bDatStart, end: bDatStart + 'Annie Nowak'.length, score: 0.99, source: 'ner' },
      ],
    });

    // The token collision is real: [PERSON_NAME_1] now lives on the SCREEN
    // (input pane token pill would still say [PERSON_NAME_1] for source B)
    // meaning "Anna Nowak" for a FRESH outcome, while the earlier outcome's
    // frozen snapshot still says "Jan Kowalski" for the exact same token.

    // 5. The OLD outcome (still showing "[PERSON_NAME_1]" in its stored
    // text) must NEVER surface Anna's attested dative under this collision.
    const tabs = document.querySelectorAll('[data-testid^="deanon-tab-"]');
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    tabs[0].click(); // the first-created outcome (the one with the stale snapshot)

    const screenText = outputBodyText();
    expect(screenText).not.toContain('Nowak');
    expect(screenText).toContain('Kowalski'); // still Jan's own value/form, never dropped silently

    await clickCopyAndFlush();
    const clipboardText = navigator.clipboard.writeText.mock.calls.at(-1)[0];
    expect(clipboardText).not.toContain('Nowak');
    expect(clipboardText).toBe(screenText); // U1==U2 still holds through the collision

    // 6. Same guarantee for U4 (DOCX reconstruction) — import a fresh DOCX
    // outcome under the NOW-current (post-swap) legend/seen, verifying the
    // reconstruction path shares the exact same protection (R-D9 is
    // unconditional, not flag-gated, O-FL5-3).
    await exportAndWaitForStats('docx');
    const { downloadBlob } = await import('./export/deanon.js');
    const allBlobs = downloadBlob.mock.calls.map((c) => c[0]);
    for (const blob of allBlobs) {
      const doc = await docxTextFromBlob(blob).catch(() => '');
      if (doc) expect(doc).not.toContain('Annie Nowak');
    }
  });
});
