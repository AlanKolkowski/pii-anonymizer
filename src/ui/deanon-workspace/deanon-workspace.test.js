// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeanonWorkspace } from './index.js';

function mount({ outcomes = [], legend = {}, ...extraOpts } = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  const onAdd = vi.fn();
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onExport = vi.fn().mockResolvedValue({ count: outcomes.length, archive: outcomes.length > 1 });
  const workspace = createDeanonWorkspace(root, {
    getOutcomes: () => outcomes,
    getLegend: () => legend,
    entityLabels: {
      PERSON_NAME: 'Imię i nazwisko',
      FINANCIAL_AMOUNT: 'Kwota',
    },
    onAdd,
    onUpdate,
    onRemove,
    onExport,
    ...extraOpts,
  });
  workspace.render();
  return { root, workspace, onAdd, onUpdate, onRemove, onExport };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createDeanonWorkspace', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn(),
        writeText: vi.fn(),
      },
    });
  });

  it('renders token-form input as colored token pills', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });

    const pill = root.querySelector('[data-testid="deanon-input-token-PERSON_NAME_1"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe('[PERSON_NAME_1]');
    expect(pill.style.getPropertyValue('--ec-bg')).not.toBe('');
  });

  // S1 migration (SHARED-FOUNDATION-DESIGN.md §3.3): two intentional edge-case
  // changes, celowa zmiana — ujednolicenie do gramatyki kanonicznej — traded
  // against the old, UI-only TOKEN_RE so that this pane agrees with token
  // reservation (anonymizer.js) and MCP listings on what counts as a token.
  it('recognizes a digit-after-first-letter type as an unresolved token pill (celowa zmiana)', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'a.txt', text: 'Tekst [X2_FOO_1] dalej.' }],
      legend: {},
    });

    const pill = root.querySelector('[data-testid="deanon-input-token-X2_FOO_1"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe('[X2_FOO_1]');
  });

  it('no longer recognizes an underscore-led type as a token (celowa zmiana)', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'a.txt', text: 'Tekst [_FOO_1] dalej.' }],
      legend: {},
    });

    expect(root.querySelector('[data-testid="deanon-input-token-_FOO_1"]')).toBeNull();
    expect(root.querySelector('[data-testid="deanon-input-body"]').textContent).toContain('[_FOO_1]');
  });

  it('renders deanonymized output pills using legend lookup and data-orig', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });

    const pill = root.querySelector('[data-testid="deanon-output-token-PERSON_NAME_1"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe('Jan Kowalski');
    expect(pill.dataset.orig).toBe('Jan Kowalski');
  });

  it('shows an empty legend state in the output pane while keeping input usable', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: {},
    });

    expect(root.querySelector('[data-testid="deanon-input-token-PERSON_NAME_1"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="deanon-empty-legend"]').textContent).toContain(
      'wymaga przynajmniej jednego zanonimizowanego dokumentu',
    );
    expect(root.querySelector('[data-testid="deanon-output-token-PERSON_NAME_1"]')).toBeNull();
  });

  it('switching outcome tabs updates both panes', () => {
    const { root } = mount({
      outcomes: [
        { id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' },
        { id: 'o2', label: 'b.txt', text: 'B [FINANCIAL_AMOUNT_1]' },
      ],
      legend: {
        '[PERSON_NAME_1]': 'Jan Kowalski',
        '[FINANCIAL_AMOUNT_1]': '123 zł',
      },
    });

    root.querySelector('[data-testid="deanon-tab-o2"]').click();

    expect(root.querySelector('[data-testid="deanon-input-body"]').textContent).toContain(
      '[FINANCIAL_AMOUNT_1]',
    );
    expect(root.querySelector('[data-testid="deanon-output-body"]').textContent).toContain('123 zł');
    expect(root.querySelector('[data-testid="deanon-output-tab"]').textContent).toContain(
      'b-deanon.txt',
    );
  });

  it('paste updates the active outcome with clipboard text', async () => {
    navigator.clipboard.readText.mockResolvedValue('Nowy [PERSON_NAME_1]');
    const { root, onUpdate } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Stary tekst' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });

    root.querySelector('[data-testid="deanon-paste"]').click();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledWith('o1', 'odpowiedz.txt', 'Nowy [PERSON_NAME_1]');
  });

  it('copy writes fully deanonymized plain text to clipboard', async () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });

    root.querySelector('[data-testid="deanon-copy"]').click();
    await Promise.resolve();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Witaj Jan Kowalski.');
  });

  it('shows deanon export stats and calls export callback for all PDF files', async () => {
    const { root, onExport } = mount({
      outcomes: [
        { id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' },
        { id: 'o2', label: 'b.txt', text: 'B [FINANCIAL_AMOUNT_1]' },
      ],
      legend: {
        '[PERSON_NAME_1]': 'Jan Kowalski',
        '[FINANCIAL_AMOUNT_1]': '123 zł',
      },
    });

    expect(root.querySelector('[data-testid="deanon-run-bar-stats"]').textContent).toContain(
      '2 dokumenty wynikowe · 2 tokeny odtworzone',
    );

    root.querySelector('[data-testid="deanon-export-pdf"]').click();
    await flushPromises();

    expect(onExport).toHaveBeenCalledWith('pdf');
  });

  it('exports snapshot-backed outcomes even after the live legend is empty', async () => {
    const { root, onExport } = mount({
      outcomes: [
        {
          id: 'o1',
          label: 'a.txt',
          text: 'A [PERSON_NAME_1]',
          legendSnapshot: { '[PERSON_NAME_1]': 'Jan Kowalski' },
        },
      ],
      legend: {},
    });

    const pdfBtn = root.querySelector('[data-testid="deanon-export-pdf"]');
    expect(pdfBtn.disabled).toBe(false);

    pdfBtn.click();
    await flushPromises();

    expect(onExport).toHaveBeenCalledWith('pdf');
  });

  it('uses direct-file labels and success message for a single exported outcome', async () => {
    const { root, onExport } = mount({
      outcomes: [{ id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });
    onExport.mockResolvedValueOnce({ count: 1, archive: false });

    const pdfBtn = root.querySelector('[data-testid="deanon-export-pdf"]');
    expect(pdfBtn.textContent).toContain('Eksportuj PDF');
    expect(pdfBtn.textContent).not.toContain('PDF-y');

    pdfBtn.click();
    await flushPromises();

    expect(root.querySelector('[data-testid="deanon-run-bar-stats"]').textContent).toBe('Pobrano plik PDF');
  });

  it('disables deanon export buttons without a legend', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: {},
    });

    expect(root.querySelector('[data-testid="deanon-export-pdf"]').disabled).toBe(true);
    expect(root.querySelector('[data-testid="deanon-export-docx"]').disabled).toBe(true);
    expect(root.querySelector('[data-testid="deanon-run-bar-stats"]').textContent).toContain(
      'brak legendy tokenów',
    );
  });
  it('refreshLegend skips no-op re-renders, preserving the existing DOM nodes (#38)', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const outcomes = [{ id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' }];
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const workspace = createDeanonWorkspace(root, {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      entityLabels: {},
      onExport: vi.fn(),
    });
    workspace.render();

    const beforeNode = root.querySelector('[data-testid="deanon-output-body"]');
    workspace.refreshLegend();
    workspace.refreshLegend();
    const afterNode = root.querySelector('[data-testid="deanon-output-body"]');
    expect(afterNode).toBe(beforeNode);
  });

  it('refreshLegend preserves scroll position across a real re-render (#38)', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const outcomes = [{ id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' }];
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const workspace = createDeanonWorkspace(root, {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      entityLabels: {},
      onExport: vi.fn(),
    });
    workspace.render();

    const body = root.querySelector('[data-testid="deanon-output-body"]');
    body.scrollTop = 120;
    body.scrollLeft = 30;

    // mutate legend to force a signature change on the next refreshLegend
    legend['[FINANCIAL_AMOUNT_1]'] = '123 zł';

    workspace.refreshLegend();

    const newBody = root.querySelector('[data-testid="deanon-output-body"]');
    expect(newBody).not.toBe(body);
    expect(newBody.scrollTop).toBe(120);
    expect(newBody.scrollLeft).toBe(30);
  });

  it('clears the export status message after a timeout, restoring token stats (#33)', async () => {
    vi.useFakeTimers();
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const outcomes = [{ id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1] [PERSON_NAME_99]' }];
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const onExport = vi.fn().mockResolvedValue({ count: 1, archive: false });
    const workspace = createDeanonWorkspace(root, {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      entityLabels: {},
      onExport,
    });
    workspace.render();

    root.querySelector('[data-testid="deanon-export-pdf"]').click();
    await flushPromises();

    expect(root.querySelector('[data-testid="deanon-run-bar-stats"]').textContent).toBe('Pobrano plik PDF');

    vi.advanceTimersByTime(6000);

    const stats = root.querySelector('[data-testid="deanon-run-bar-stats"]').textContent;
    expect(stats).toContain('1 token pozostanie niezmieniony');
    expect(stats).not.toContain('Pobrano plik PDF');

    vi.useRealTimers();
  });
});

// FL-5-LIVE-WIRING-DESIGN.md K4 (§3.2/§3.3): the output pane renders from
// resolveOccurrences (via opts.getResolveReplacement) instead of a plain
// legend lookup, so a resolver-inflected occurrence shows its generated form
// — a fake resolver stands in for the real engine here (already proven
// end-to-end in flexion-resolver.test.js/main.docx-export.test.js); this
// suite is about the WIRING (does the workspace call it and render/copy its
// result correctly), not the linguistics.
describe('deanon workspace — live flexion wiring (FL-5 K4)', () => {
  it('(a) renders an inflected form in the output pill when opts.getResolveReplacement supplies a resolver', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'pismo.txt', text: 'Zobowiązuje [PERSON_NAME_1|D] do zapłaty.' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      getResolveReplacement: () => (ctx) => (ctx.tokenId === 'PERSON_NAME_1' ? { text: 'Jana Kowalskiego' } : undefined),
    });

    const pill = root.querySelector('[data-testid="deanon-output-token-PERSON_NAME_1"]');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe('Jana Kowalskiego');
    expect(pill.dataset.orig).toBe('Jana Kowalskiego');
  });

  it('(a) a declining resolver (returns undefined) leaves the base legend value untouched, exactly like no resolver at all', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'pismo.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      getResolveReplacement: () => () => undefined,
    });

    const pill = root.querySelector('[data-testid="deanon-output-token-PERSON_NAME_1"]');
    expect(pill.textContent).toBe('Jan Kowalski');
    expect(pill.dataset.orig).toBe('Jan Kowalski');
  });

  it('(b) copy places into the clipboard exactly the output pane\'s rendered textContent (hash equality, G-FL5-2)', async () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'pismo.txt', text: 'Zobowiązuje [PERSON_NAME_1|D] do zapłaty.' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      getResolveReplacement: () => (ctx) => (ctx.tokenId === 'PERSON_NAME_1' ? { text: 'Jana Kowalskiego' } : undefined),
    });

    const outputBody = root.querySelector('[data-testid="deanon-output-body"]');
    expect(outputBody.textContent).toBe('Zobowiązuje Jana Kowalskiego do zapłaty.');

    root.querySelector('[data-testid="deanon-copy"]').click();
    await Promise.resolve();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(outputBody.textContent);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Zobowiązuje Jana Kowalskiego do zapłaty.');
  });

  it('(c) without opts.getResolveReplacement, output rendering/copy stay byte-for-byte identical to today', async () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'odpowiedz.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });
    expect(root.querySelector('[data-testid="deanon-output-token-PERSON_NAME_1"]').textContent).toBe('Jan Kowalski');
    root.querySelector('[data-testid="deanon-copy"]').click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Witaj Jan Kowalski.');
  });

  it('(d) shows "odmieniono N formę" only when at least one occurrence used the resolver', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'pismo.txt', text: 'Zobowiązuje [PERSON_NAME_1|D] wobec [PERSON_NAME_2].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski', '[PERSON_NAME_2]': 'Anna Nowak' },
      getResolveReplacement: () => (ctx) => (ctx.tokenId === 'PERSON_NAME_1' ? { text: 'Jana Kowalskiego' } : undefined),
    });

    const el = root.querySelector('[data-testid="deanon-inflected-count"]');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('odmieniono 1 formę');
  });

  it('(d) hides the inflected-count element entirely when nothing was resolved via the engine', () => {
    const { root } = mount({
      outcomes: [{ id: 'o1', label: 'a.txt', text: 'Witaj [PERSON_NAME_1].' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });
    expect(root.querySelector('[data-testid="deanon-inflected-count"]')).toBeNull();
  });

  it('(e) refreshLegend re-renders when opts.getSeenVersion() changes, even though legend/outcomes stay the same', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const outcomes = [{ id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' }];
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    let seenVersion = 1;
    const workspace = createDeanonWorkspace(root, {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      entityLabels: {},
      onExport: vi.fn(),
      getSeenVersion: () => seenVersion,
    });
    workspace.render();

    const before = root.querySelector('[data-testid="deanon-output-body"]');
    seenVersion += 1; // e.g. a new attested surface-form variant just got ingested elsewhere
    workspace.refreshLegend();
    const after = root.querySelector('[data-testid="deanon-output-body"]');

    expect(after).not.toBe(before); // re-rendered, not skipped as a no-op
  });

  it('(e) refreshLegend still skips a true no-op re-render when getSeenVersion() is stable (no regression on #38)', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const outcomes = [{ id: 'o1', label: 'a.txt', text: 'A [PERSON_NAME_1]' }];
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const workspace = createDeanonWorkspace(root, {
      getOutcomes: () => outcomes,
      getLegend: () => legend,
      entityLabels: {},
      onExport: vi.fn(),
      getSeenVersion: () => 7,
      getFlexionEnabled: () => true,
      getMorphReady: () => false,
    });
    workspace.render();

    const before = root.querySelector('[data-testid="deanon-output-body"]');
    workspace.refreshLegend();
    workspace.refreshLegend();
    const after = root.querySelector('[data-testid="deanon-output-body"]');

    expect(after).toBe(before);
  });
});
