// @vitest-environment jsdom
//
// MD6 "pomiar czasu na realnym piśmie" — order-of-magnitude only. jsdom's
// DOMParser is NOT Chromium (typically slower), so a pass here understates
// nothing: if even jsdom stays under §3.1's ~200 ms bar on a realistic
// document, the browser will too. Log-only for the sizes; the assertions
// pin correctness (status/replacement counts), not wall-clock, so slow CI
// machines never flake. Numbers land in the test output for the gate.
import { rebuildDocx } from './rebuild-docx.js';
import { buildZip } from './test-helpers/zip-fixture.js';
import { openZip } from './zip-reader.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const LEGEND = {
  '[PERSON_NAME_1]': 'Jan Kowalski',
  '[PERSON_NAME_2]': 'Barbara Lis',
  '[ADDRESS_1]': 'ul. Piekary 33, 87-100 Toruń',
  '[CASE_NUMBER_1]': 'I C 1234/23',
};
const TOKENS = Object.keys(LEGEND);

// A realistic legal-brief paragraph: ~300 chars, run-split mid-sentence the
// way Word splits on formatting/spellcheck boundaries; every 4th paragraph
// carries a token, sometimes split across runs by the engine's own repair.
function paragraph(i) {
  const token = i % 4 === 0 ? ` ${TOKENS[(i / 4) % TOKENS.length]}` : '';
  return '<w:p><w:pPr><w:jc w:val="both"/></w:pPr>'
    + `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr><w:t xml:space="preserve">W odpowiedzi na zobowiązanie Sądu z dnia 12 marca pełnomocnik powoda${token} podtrzymuje </w:t></w:r>`
    + '<w:r><w:t xml:space="preserve">dotychczasowe stanowisko w sprawie i wskazuje, że okoliczności podnoszone przez stronę pozwaną </w:t></w:r>'
    + '<w:r><w:t>nie znajdują oparcia w zgromadzonym materiale dowodowym, w szczególności w treści dokumentów.</w:t></w:r>'
    + '</w:p>';
}

function bigDocParts(paragraphCount) {
  let body = '';
  for (let i = 0; i < paragraphCount; i++) body += paragraph(i);
  return {
    '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
    'word/document.xml': `${XML_DECL}<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
  };
}

async function measure(paragraphCount) {
  const parts = bigDocParts(paragraphCount);
  const xmlBytes = parts['word/document.xml'].length;
  const input = await buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, method: 8 })));
  const t0 = performance.now();
  const { status, bytes, report } = await rebuildDocx(input, LEGEND);
  const elapsed = performance.now() - t0;
  return { status, bytes, report, elapsed, xmlBytes, zipBytes: input.length };
}

describe('rebuildDocx — order-of-magnitude timing (MD6, log-only)', () => {
  it('realistic brief (~15 pages, ~200 paragraphs) rebuilds correctly', async () => {
    const r = await measure(200);
    expect(r.status).toBe('ok');
    expect(r.report.totals.replaced).toBe(50);
    expect(r.report.totals.left).toBe(0);
    const doc = new TextDecoder().decode(await openZip(r.bytes).extract('word/document.xml'));
    expect(doc).toContain('Jan Kowalski');
    expect(doc).not.toContain('[PERSON_NAME_1]');
    console.log(`[docx-perf] realistic: ${r.elapsed.toFixed(0)} ms, document.xml ${(r.xmlBytes / 1024).toFixed(0)} KB, zip ${(r.zipBytes / 1024).toFixed(0)} KB, replaced ${r.report.totals.replaced}`);
  }, 30_000);

  it('stress document (~150 pages, ~2000 paragraphs) stays linear', async () => {
    const r = await measure(2000);
    expect(r.status).toBe('ok');
    expect(r.report.totals.replaced).toBe(500);
    console.log(`[docx-perf] stress: ${r.elapsed.toFixed(0)} ms, document.xml ${(r.xmlBytes / 1024).toFixed(0)} KB, zip ${(r.zipBytes / 1024).toFixed(0)} KB, replaced ${r.report.totals.replaced}`);
  }, 60_000);
});
