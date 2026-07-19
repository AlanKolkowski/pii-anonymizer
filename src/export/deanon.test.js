import { describe, it, expect } from 'vitest';
import {
  buildDeanonExportEntries,
  exportDeanonOutcomes,
  sanitizeFileStem,
  uniqueDeanonFileName,
} from './deanon.js';
import { deanonymizeText } from '../anonymizer.js';
import { createFlexionResolver } from '../verifier/flexion-resolver.js';

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

  it('deanonymizes export entries with the outcome legend snapshot instead of the live legend', () => {
    const entries = buildDeanonExportEntries(
      [
        {
          id: 'o1',
          label: 'Odpowiedź.txt',
          text: 'Zobowiązuje się [PERSON_NAME_1] wobec [PERSON_NAME_2].',
          legendSnapshot: {
            '[PERSON_NAME_1]': 'Adam Nowicki',
            '[PERSON_NAME_2]': 'Barbara Lis',
          },
        },
      ],
      { '[PERSON_NAME_1]': 'Barbara Lis' },
      'docx',
    );

    expect(entries).toEqual([
      {
        name: '01-odpowiedz-deanon.docx',
        label: 'Odpowiedź.txt',
        text: 'Zobowiązuje się Adam Nowicki wobec Barbara Lis.',
      },
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

// FL-5-LIVE-WIRING-DESIGN.md K3 (§3.4/U3): the flat export path (PDF always,
// DOCX for outcomes with no attached .docx bytes) gains a per-outcome
// resolveReplacementFor(outcome) — the same flexion seam U1/U2 use, built by
// the SAME construction point (buildOutcomeResolver, flexion-live.js) at the
// caller. A missing/undefined resolver must reproduce today's
// deanonymizeText output byte for byte (G-FL5-1).
describe('buildDeanonExportEntries — flexion seam (resolveReplacementFor, FL-5 K3)', () => {
  it('inflects an unannotated token using an attested case form from `seen`, with no morphology artifact (morph: null)', () => {
    // FD-3 recipe (proven end to end in main.docx-export.test.js/
    // deanon-docx.test.js): an unambiguous preposition ("od") immediately
    // before the token reaches 'wysoka' confidence on context alone, no
    // annotation needed — an annotation ALONE (no corroborating signal)
    // would only ever reach 'niska', which minConfidence: 'wysoka' declines
    // regardless of whether the eventual form is attested or rule-based, so
    // this recipe (not an annotated-alone one) is what actually exercises
    // the attested-form path under the O-FL5-1 threshold every sink applies.
    const seen = { 'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]' };
    const resolveReplacement = createFlexionResolver({ morph: null, seen, minConfidence: 'wysoka' });

    const entries = buildDeanonExportEntries(
      [{ id: 'o1', label: 'Pismo.txt', text: 'Zasądza się od [PERSON_NAME_1] kwotę zadośćuczynienia.' }],
      { '[PERSON_NAME_1]': 'Jan Kowalski' },
      'docx',
      { resolveReplacementFor: () => resolveReplacement },
    );

    expect(entries[0].text).toBe('Zasądza się od Jana Kowalskiego kwotę zadośćuczynienia.');
  });

  it('resolveReplacementFor is called per outcome — different outcomes may get different resolvers (or none)', () => {
    const seen = { 'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]' };
    const resolveReplacement = createFlexionResolver({ morph: null, seen, minConfidence: 'wysoka' });
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const outcomes = [
      { id: 'o1', label: 'Inflected.txt', text: 'Zasądza się od [PERSON_NAME_1] kwotę.' },
      { id: 'o2', label: 'Plain.txt', text: 'Zasądza się od [PERSON_NAME_1] kwotę.' },
    ];

    const entries = buildDeanonExportEntries(outcomes, legend, 'docx', {
      resolveReplacementFor: (outcome) => (outcome.id === 'o1' ? resolveReplacement : undefined),
    });

    expect(entries[0].text).toBe('Zasądza się od Jana Kowalskiego kwotę.');
    expect(entries[1].text).toBe('Zasądza się od Jan Kowalski kwotę.'); // no resolver for o2 -> base legend value
  });

  it('without resolveReplacementFor, output is byte-identical to the deanonymizeText facade (golden, unchanged behavior)', () => {
    const outcomes = [{ id: 'o1', label: 'Pismo.txt', text: 'A [PERSON_NAME_1|D] B [PERSON_NAME_2].' }];
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski', '[PERSON_NAME_2]': 'Anna Nowak' };

    const entries = buildDeanonExportEntries(outcomes, legend, 'docx');

    expect(entries[0].text).toBe(deanonymizeText(outcomes[0].text, legend));
    expect(entries[0].text).toBe('A Jan Kowalski B Anna Nowak.'); // annotation consumed, never leaks (unchanged S2 behavior)
  });
});
