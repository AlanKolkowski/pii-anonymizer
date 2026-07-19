// @vitest-environment jsdom
//
// DOCX-REBUILD §3.4 export integration: a DOCX outcome exports through the
// surgical reconstruction (bytes in → replaced bytes out), text outcomes
// keep the flat path, export gates surface as user-facing errors, and the
// docx payload never leaks into any MCP listing.
import { buildZip } from '../docx-rebuild/test-helpers/zip-fixture.js';
import { openZip } from '../docx-rebuild/zip-reader.js';
import { exportDeanonOutcomes } from './deanon.js';
import { buildOutcomeListing, buildReadOutcomeContent } from '../mcp/listings.js';
import { createFlexionResolver } from '../verifier/flexion-resolver.js';
import { loadMorphData } from '../verifier/morph/load.js';
import { MINI_LEXICON } from '../verifier/morph/fixtures/mini-lexicon.js';

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

async function docxBytes(parts) {
  return buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, method: 0 })));
}

const LEGEND = { '[PERSON_NAME_1]': 'Jan Kowalski' };

function docxOutcome(bytes, overrides = {}) {
  return {
    id: 'o1',
    label: 'pismo-od-AI.docx',
    mcpLabel: 'Wynik 1',
    text: 'Pozwany [PERSON_NAME_1] wnosi o oddalenie.',
    legendSnapshot: { ...LEGEND },
    docx: { bytes, inspection: { external: { hyperlinks: 0, blocked: [] } } },
    ...overrides,
  };
}

describe('exportDeanonOutcomes — DOCX outcomes go through the reconstruction', () => {
  it('replaces tokens inside the original bytes and returns the engine report', async () => {
    const bytes = await docxBytes(docxParts('<w:p><w:r><w:t>Pozwany [PERSON_NAME_1] wnosi.</w:t></w:r></w:p>'));
    const result = await exportDeanonOutcomes({ outcomes: [docxOutcome(bytes)], legend: LEGEND, format: 'docx' });

    expect(result.count).toBe(1);
    expect(result.fileName).toMatch(/-deanon\.docx$/);
    const rebuilt = openZip(new Uint8Array(await result.blob.arrayBuffer()));
    const doc = new TextDecoder().decode(await rebuilt.extract('word/document.xml'));
    expect(doc).toContain('Pozwany Jan Kowalski wnosi.');
    expect(result.reports[0].report.totals).toEqual({ replaced: 1, left: 0, declined: 0 });
  });

  // DOCX-IMPL-PLAN.md FD-3, updated for FL-5 K3's resolveReplacementFor(outcome)
  // signature (behavior unchanged): resolveReplacementFor, passed in from the
  // caller (main.js in production via buildOutcomeResolver), reaches
  // rebuildDocx through exportDeanonOutcomes -> rebuildDocxBlob and actually
  // changes the bytes written into the .docx — the seam is not just wired,
  // it does something observable in the file, plus the "odmieniono" report row.
  it('a resolveReplacementFor passed to exportDeanonOutcomes inflects an annotated token in the rebuilt .docx', async () => {
    const bytes = await docxBytes(docxParts(
      '<w:p><w:r><w:t xml:space="preserve">Zasądza się od [PERSON_NAME_1|D] kwotę.</w:t></w:r></w:p>',
    ));
    const morph = loadMorphData(MINI_LEXICON);
    const resolveReplacement = createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' });

    const result = await exportDeanonOutcomes({
      outcomes: [docxOutcome(bytes)], legend: LEGEND, format: 'docx', resolveReplacementFor: () => resolveReplacement,
    });

    const rebuilt = openZip(new Uint8Array(await result.blob.arrayBuffer()));
    const doc = new TextDecoder().decode(await rebuilt.extract('word/document.xml'));
    expect(doc).toContain('Zasądza się od Jana Kowalskiego kwotę.');
    expect(doc).not.toContain('Jan Kowalski kwotę'); // not the untouched nominative
    expect(doc).not.toContain('|D'); // the annotation itself never leaks into the file

    expect(result.reports[0].report.totals).toEqual({ replaced: 1, left: 0, declined: 1 });
    expect(result.reports[0].report.parts[0].declined).toEqual([{
      token: '[PERSON_NAME_1]', z: 'Jan Kowalski', na: 'Jana Kowalskiego',
      przypadek: 'D', zrodlo: 'reguła', pewnosc: 'wysoka', part: 'word/document.xml',
    }]);
  });

  it('an omitted resolveReplacementFor leaves the DOCX export byte-for-byte identical to today (G-D9)', async () => {
    const bytes = await docxBytes(docxParts('<w:p><w:r><w:t>Pozwany [PERSON_NAME_1] wnosi.</w:t></w:r></w:p>'));
    const withResolver = await exportDeanonOutcomes({
      outcomes: [docxOutcome(bytes)], legend: LEGEND, format: 'docx',
      resolveReplacementFor: () => createFlexionResolver({ morph: null, seen: {} }),
    });
    const withoutResolver = await exportDeanonOutcomes({ outcomes: [docxOutcome(bytes)], legend: LEGEND, format: 'docx' });
    expect(new Uint8Array(await withResolver.blob.arrayBuffer()))
      .toEqual(new Uint8Array(await withoutResolver.blob.arrayBuffer()));
  });

  // FL-5 K3/O-FL5-2: exportDeanonOutcomes calls resolveReplacementFor(outcome)
  // per outcome — the SAME callback threading through both the flat (U3) and
  // reconstruction (U4) branches for a mixed export, one construction point.
  it('resolveReplacementFor is invoked once per outcome, letting a mixed docx+flat export give each its own resolver', async () => {
    const bytes = await docxBytes(docxParts(
      '<w:p><w:r><w:t xml:space="preserve">Zasądza się od [PERSON_NAME_1|D] kwotę.</w:t></w:r></w:p>',
    ));
    const morph = loadMorphData(MINI_LEXICON);
    const resolveReplacement = createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' });
    const seenOutcomeIds = [];
    const textOutcome = {
      id: 'o2', label: 'Notatka.txt', mcpLabel: 'Wynik 2',
      text: 'Zobowiązuje [PERSON_NAME_1|D].', legendSnapshot: { ...LEGEND },
    };

    const result = await exportDeanonOutcomes({
      outcomes: [docxOutcome(bytes), textOutcome],
      legend: LEGEND,
      format: 'docx',
      resolveReplacementFor: (outcome) => {
        seenOutcomeIds.push(outcome.id);
        return outcome.id === 'o1' ? resolveReplacement : undefined;
      },
    });

    // Per-outcome, in order — proves the callback is not a single shared
    // resolver applied uniformly. o1 (docx-with-bytes) is called TWICE: once
    // while buildDeanonExportEntries builds the flat rendering for every
    // outcome (discarded for o1, since the reconstruction branch below
    // supersedes it — pre-existing shape, unchanged by FL-5) and once more
    // for the reconstruction itself; both calls are pure (buildOutcomeResolver
    // has no side effects), so the extra call is harmless by construction.
    expect(seenOutcomeIds).toEqual(['o1', 'o2', 'o1']);
    const rebuilt = openZip(new Uint8Array(await result.blob.arrayBuffer()));
    const rebuiltEntry = await rebuilt.extract(result.reports[0].name);
    const inner = openZip(new Uint8Array(rebuiltEntry));
    const doc = new TextDecoder().decode(await inner.extract('word/document.xml'));
    expect(doc).toContain('Zasądza się od Jana Kowalskiego kwotę.'); // o1: inflected via its own resolver
  });

  it('blocks the export when the input carries non-hyperlink external references (§9.3)', async () => {
    const bytes = await docxBytes(docxParts('<w:p><w:r><w:t>[PERSON_NAME_1]</w:t></w:r></w:p>', {
      'word/_rels/settings.xml.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/t.dotm" TargetMode="External"/>'
        + '</Relationships>',
    }));
    await expect(exportDeanonOutcomes({ outcomes: [docxOutcome(bytes)], legend: LEGEND, format: 'docx' }))
      .rejects.toThrow(/odwołania zewnętrzne/);
  });

  it('blocks the export when no legend token is found in the file (§6.3, P-4)', async () => {
    const bytes = await docxBytes(docxParts('<w:p><w:r><w:t>Zero tokenów tutaj.</w:t></w:r></w:p>'));
    await expect(exportDeanonOutcomes({ outcomes: [docxOutcome(bytes)], legend: LEGEND, format: 'docx' }))
      .rejects.toThrow(/nie znaleziono żadnego tokenu/);
  });

  it('mixed export (docx + text outcome) zips both, report only for the rebuilt one', async () => {
    const bytes = await docxBytes(docxParts('<w:p><w:r><w:t>Pozwany [PERSON_NAME_1] wnosi.</w:t></w:r></w:p>'));
    const textOutcome = {
      id: 'o2', label: 'Notatka.txt', mcpLabel: 'Wynik 2',
      text: 'Czysty [PERSON_NAME_1].', legendSnapshot: { ...LEGEND },
    };
    const result = await exportDeanonOutcomes({
      outcomes: [docxOutcome(bytes), textOutcome], legend: LEGEND, format: 'docx',
    });

    expect(result.archive).toBe(true);
    expect(result.count).toBe(2);
    expect(result.fileName).toBe('zdeanonimizowane-docx.zip');
    expect(result.files).toHaveLength(2);

    // Exactly one report — for the reconstructed outcome, matched by name.
    expect(result.reports).toHaveLength(1);
    expect(result.files).toContain(result.reports[0].name);
    expect(result.reports[0].report.totals).toEqual({ replaced: 1, left: 0, declined: 0 });

    // The ZIP holds both files; the rebuilt entry is a real DOCX whose
    // document.xml carries the deanonymized value, not the token.
    const zip = openZip(new Uint8Array(await result.blob.arrayBuffer()));
    const names = zip.entries.map((e) => e.name).sort();
    expect(names).toEqual([...result.files].sort());
    const rebuiltEntry = await zip.extract(result.reports[0].name);
    const inner = openZip(new Uint8Array(rebuiltEntry));
    const doc = new TextDecoder().decode(await inner.extract('word/document.xml'));
    expect(doc).toContain('Pozwany Jan Kowalski wnosi.');
    expect(doc).not.toContain('[PERSON_NAME_1]');
  });

  it('text outcomes still export flat, untouched by the DOCX path', async () => {
    const textOutcome = {
      id: 'o2', label: 'Wynik tekstowy', mcpLabel: 'Wynik 2',
      text: 'Czysty [PERSON_NAME_1].', legendSnapshot: { ...LEGEND },
    };
    const result = await exportDeanonOutcomes({ outcomes: [textOutcome], legend: LEGEND, format: 'docx' });
    expect(result.count).toBe(1);
    expect(result.reports).toBeUndefined();
  });
});

describe('MCP boundary — the docx payload never exists in any listing', () => {
  it('listings and reads expose text only, no bytes and no inspection', async () => {
    const bytes = await docxBytes(docxParts('<w:p><w:r><w:t>[PERSON_NAME_1]</w:t></w:r></w:p>'));
    const outcome = docxOutcome(bytes);
    const listing = JSON.stringify(buildOutcomeListing([outcome]));
    const read = JSON.stringify(buildReadOutcomeContent([outcome], 'o1'));
    for (const payload of [listing, read]) {
      expect(payload).not.toContain('bytes');
      expect(payload).not.toContain('inspection');
      expect(payload).not.toContain('docx"');
    }
    expect(JSON.parse(listing)[0]).toEqual({ id: 'o1', label: 'Wynik 1', char_count: outcome.text.length });
  });
});
