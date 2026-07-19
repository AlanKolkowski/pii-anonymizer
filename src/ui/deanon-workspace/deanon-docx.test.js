// @vitest-environment jsdom
//
// DOCX-REBUILD §3.4 workspace surface: DOCX outcomes render a badge, the
// preview is read-only (paste disabled, updates refused by the coordinator),
// the import button feeds onImportDocx, and export success surfaces the
// ENGINE's report numbers (O-5).
import { describe, it, expect, vi } from 'vitest';
import { createDeanonWorkspace } from './index.js';
import { createOutcomesCoordinator } from '../outcomes-coordinator.js';

function mount({ outcomes = [], legend = {}, onExport, onImportDocx } = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const workspace = createDeanonWorkspace(document.getElementById('root'), {
    getOutcomes: () => outcomes,
    getLegend: () => legend,
    entityLabels: { PERSON_NAME: 'Imię i nazwisko' },
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onExport: onExport ?? vi.fn().mockResolvedValue({ count: 1, archive: false }),
    ...(onImportDocx && { onImportDocx }),
  });
  workspace.render();
  return workspace;
}

const byId = (testid) => document.querySelector(`[data-testid="${testid}"]`);

function docxOutcome(overrides = {}) {
  return {
    id: 'o1',
    label: 'pismo.docx',
    mcpLabel: 'Wynik 1',
    text: 'Pozwany [PERSON_NAME_1].',
    legendSnapshot: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    docx: {
      bytes: new Uint8Array([1, 2, 3]),
      inspection: { external: { hyperlinks: 2, blocked: [] } },
    },
    ...overrides,
  };
}

describe('deanon workspace — DOCX outcomes (§3.4)', () => {
  it('renders the DOCX badge, hyperlink count and disables paste', () => {
    mount({ outcomes: [docxOutcome()], legend: { '[PERSON_NAME_1]': 'Jan Kowalski' } });
    expect(byId('deanon-docx-badge').textContent).toContain('DOCX');
    expect(byId('deanon-docx-hyperlinks').textContent).toBe('2 hiperłączy zewnętrznych');
    expect(byId('deanon-paste').disabled).toBe(true);
  });

  it('text outcomes keep paste enabled and show no badge', () => {
    mount({
      outcomes: [{ id: 't1', label: 'Wynik 1', mcpLabel: 'Wynik 1', text: '[PERSON_NAME_1]' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    });
    expect(byId('deanon-docx-badge')).toBeNull();
    expect(byId('deanon-paste').disabled).toBe(false);
  });

  it('the import button hands the picked file to onImportDocx', () => {
    const onImportDocx = vi.fn();
    mount({ onImportDocx });
    const input = byId('deanon-import-docx-input');
    expect(byId('deanon-import-docx').textContent).toBe('Importuj pismo od AI (DOCX)');
    const file = new File(['x'], 'pismo.docx');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(onImportDocx).toHaveBeenCalledWith(file);
  });

  it('export success message carries the engine report totals and the residue warning', async () => {
    const outcomes = [docxOutcome()];
    const onExport = vi.fn().mockResolvedValue({
      count: 1,
      archive: false,
      reports: [{ name: 'x.docx', report: { totals: { replaced: 7, left: 2 } } }],
    });
    mount({ outcomes, legend: { '[PERSON_NAME_1]': 'Jan Kowalski' }, onExport });
    byId('deanon-export-docx').click();
    await Promise.resolve();
    await Promise.resolve();
    const stats = byId('deanon-run-bar-stats').textContent;
    expect(stats).toContain('7 tokenów podmienionych');
    expect(stats).toContain('2 tokenów pozostało w dokumencie');
  });

  // DOCX-IMPL-PLAN.md FD-5: the "odmieniono" summary + the expandable
  // declined-forms detail panel, driven entirely by the engine's report
  // (never invented by the UI) — case codes mapped to Polish words here,
  // the one place CASE_LABELS lives.
  it('export success message appends the declined-forms count and renders the detail panel', async () => {
    const outcomes = [docxOutcome()];
    const onExport = vi.fn().mockResolvedValue({
      count: 1,
      archive: false,
      reports: [{
        name: 'x.docx',
        report: {
          totals: { replaced: 3, left: 0, declined: 1 },
          flexionDeclined: { count: 2 },
          parts: [{
            part: 'word/document.xml',
            replaced: [], left: [],
            declined: [{
              token: '[PERSON_NAME_1]', z: 'Jan Kowalski', na: 'Jana Kowalskiego',
              przypadek: 'D', zrodlo: 'reguła', pewnosc: 'wysoka', part: 'word/document.xml',
            }],
          }],
        },
      }],
    });
    mount({ outcomes, legend: { '[PERSON_NAME_1]': 'Jan Kowalski' }, onExport });
    byId('deanon-export-docx').click();
    await Promise.resolve();
    await Promise.resolve();

    const stats = byId('deanon-run-bar-stats').textContent;
    expect(stats).toContain('odmieniono 1 formę');

    const details = byId('deanon-flexion-report');
    expect(details).not.toBeNull();
    expect(details.querySelector('summary').textContent).toContain('odmieniono 1 formę');
    const rows = byId('deanon-flexion-rows').textContent;
    expect(rows).toContain('Jan Kowalski');
    expect(rows).toContain('Jana Kowalskiego');
    expect(rows).toContain('dopełniacz'); // CASE_LABELS['D'], never the bare code
    expect(byId('deanon-flexion-refused').textContent).toContain('2');
  });

  it('no declined forms — no detail panel, no "odmieniono" suffix', async () => {
    const outcomes = [docxOutcome()];
    const onExport = vi.fn().mockResolvedValue({
      count: 1,
      archive: false,
      reports: [{ name: 'x.docx', report: { totals: { replaced: 3, left: 0, declined: 0 }, flexionDeclined: { count: 0 }, parts: [] } }],
    });
    mount({ outcomes, legend: { '[PERSON_NAME_1]': 'Jan Kowalski' }, onExport });
    byId('deanon-export-docx').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(byId('deanon-run-bar-stats').textContent).not.toContain('odmieniono');
    expect(byId('deanon-flexion-report')).toBeNull();
  });

  it('showMessage surfaces import failures in the run bar', () => {
    const workspace = mount({});
    workspace.showMessage('Import DOCX nieudany: makra');
    expect(byId('deanon-run-bar-stats').textContent).toBe('Import DOCX nieudany: makra');
  });
});

describe('outcomes coordinator — DOCX outcomes are read-only (§3.4)', () => {
  it('refuses text updates for a DOCX outcome, accepts them for text outcomes', () => {
    const outcomes = [];
    const coordinator = createOutcomesCoordinator({
      outcomes,
      deanonWorkspace: { activateOutcome: vi.fn(), render: vi.fn(), refreshLegend: vi.fn() },
      getLegend: () => ({}),
    });
    const docxId = coordinator.createOutcome('pismo.docx', 'podgląd', 'Wynik 1', {
      docx: { bytes: new Uint8Array([1]), inspection: { external: { hyperlinks: 0, blocked: [] } } },
    });
    const textId = coordinator.createOutcome('notatka', 'tekst', 'Wynik 2');

    expect(coordinator.updateOutcomeFields(docxId, 'pismo.docx', 'ZMIANA')).toBe(false);
    expect(outcomes.find((o) => o.id === docxId).text).toBe('podgląd');
    expect(coordinator.updateOutcomeFields(textId, 'notatka', 'nowy tekst')).toBe(true);
    expect(outcomes.find((o) => o.id === textId).text).toBe('nowy tekst');
  });
});
