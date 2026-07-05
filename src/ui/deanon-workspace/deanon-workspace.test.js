// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeanonWorkspace } from './index.js';

function mount({ outcomes = [], legend = {} } = {}) {
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
