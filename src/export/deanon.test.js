import { describe, it, expect } from 'vitest';
import {
  buildDeanonExportEntries,
  exportDeanonOutcomes,
  sanitizeFileStem,
  uniqueDeanonFileName,
} from './deanon.js';

describe('deanon export helpers', () => {
  it('sanitizes Polish labels into safe portable file stems', () => {
    expect(sanitizeFileStem('Zażółć gęślą jaźń.txt')).toBe('zazolc-gesla-jazn');
    expect(sanitizeFileStem('  Wynik / 1?.docx  ')).toBe('wynik-1');
  });

  it('creates ordered per-document file names for each format', () => {
    const used = new Set();
    expect(uniqueDeanonFileName('Opinia Sądu.txt', 0, 'pdf', used)).toBe('01-opinia-sadu-deanon.pdf');
    expect(uniqueDeanonFileName('Odpowiedź.txt', 1, 'pdf', used)).toBe('02-odpowiedz-deanon.pdf');
  });

  it('builds separate deanonymized entries for all outcomes', () => {
    const entries = buildDeanonExportEntries(
      [
        { id: 'o1', label: 'Opinia.txt', text: 'A [PERSON_NAME_1]' },
        { id: 'o2', label: 'Pismo.txt', text: 'B [PERSON_NAME_1] [UNKNOWN_1]' },
      ],
      { '[PERSON_NAME_1]': 'Jan Kowalski' },
      'docx',
    );

    expect(entries).toEqual([
      { name: '01-opinia-deanon.docx', label: 'Opinia.txt', text: 'A Jan Kowalski' },
      { name: '02-pismo-deanon.docx', label: 'Pismo.txt', text: 'B Jan Kowalski [UNKNOWN_1]' },
    ]);
  });

  it('exports a single outcome directly instead of wrapping it in ZIP', async () => {
    const result = await exportDeanonOutcomes({
      outcomes: [{ id: 'o1', label: 'Jedyny wynik.txt', text: 'A [PERSON_NAME_1]' }],
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      format: 'docx',
    });

    expect(result.archive).toBe(false);
    expect(result.fileName).toBe('jedyny-wynik-deanon.docx');
    expect(result.zipName).toBeUndefined();
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
