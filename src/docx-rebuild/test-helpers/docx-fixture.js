// Builders for adversarial DOCX fixtures (EVAL-RECALL-AUDIT.md part B).
// A minimal but Word-valid .docx with PII spread across the places a real
// pismo keeps it: body paragraphs, a table, footnotes, the page header and
// the page footer. Used by src/file-import/docx-adversarial.test.js (pins
// what the import path actually extracts) and by
// scripts/generate-adversarial-docx.mjs (writes the same fixtures to
// test-data/adversarial/docx/ for manual drag-and-drop testing).
//
// All data is fictional; identifiers carry valid checksums but belong to
// no one (same identity pool as scripts/generate-adversarial-corpus.mjs).
import { buildZip } from './zip-fixture.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const p = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const tr = (cells) => `<w:tr>${cells.map(tc).join('')}</w:tr>`;

function contentTypes(overrides) {
  return XML_DECL
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + overrides
    + '</Types>';
}

const ROOT_RELS = XML_DECL
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

// ── Fixture 1: table + footnotes ────────────────────────────────────
// PII lives in a table (parties with PESELs and addresses) and in a
// footnote (phone + PESEL of a witness). Tests whether the import path
// flattens table cells and whether footnote content survives extraction.
export const DOCX_TABELA_PRZYPISY = {
  name: 'adw_docx_01_tabela_przypisy',
  attack: 'PII w komórkach tabeli i w przypisie dolnym: import DOCX musi spłaszczyć tabelę i nie zgubić treści przypisu.',
  bodyStrings: [
    'Konrad Żurawski',
    '85030712349',
    'ul. Polna 3/5, 87-100 Toruń',
    'Aniela Wilk',
    '61041876540',
    'ul. Wodna 11, 86-200 Chełmno',
  ],
  footnoteStrings: [
    'Leokadia Szczygieł',
    '+48 566 123 456',
  ],
  headerStrings: [],
  footerStrings: [],
};

// ── Fixture 2: header + footer ──────────────────────────────────────
// PII lives in the page header (law-firm address + NIP) and the page
// footer (IBAN + e-mail). The body itself carries only one name. If the
// import path drops headers/footers, everything there bypasses the sieve.
export const DOCX_NAGLOWEK_STOPKA = {
  name: 'adw_docx_02_naglowek_stopka',
  attack: 'PII w nagłówku i stopce strony: jeżeli import czyta tylko body, adres, NIP, IBAN i e-mail kancelarii omijają sito w całości.',
  bodyStrings: [
    'Michalina Krzemień-Zawadzka',
  ],
  footnoteStrings: [],
  headerStrings: [
    'Kancelaria Radcy Prawnego „Żuraw i Partnerzy”',
    'ul. Szeroka 40/2, 87-100 Toruń',
    '8562349172',
  ],
  footerStrings: [
    'PL41 1140 2004 0000 9876 5432 1098',
    'biuro@zuraw-partnerzy.pl',
  ],
};

export async function buildTabelaPrzypisyDocx() {
  const f = DOCX_TABELA_PRZYPISY;
  const documentXml = XML_DECL
    + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">`
    + '<w:body>'
    + p('Zestawienie stron postępowania zawiera tabela poniżej.')
    + '<w:tbl>'
    + '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>'
    + tr(['Strona', 'PESEL', 'Adres'])
    + tr([f.bodyStrings[0], f.bodyStrings[1], f.bodyStrings[2]])
    + tr([f.bodyStrings[3], f.bodyStrings[4], f.bodyStrings[5]])
    + '</w:tbl>'
    + `<w:p><w:r><w:t xml:space="preserve">Dane świadka w przypisie.</w:t></w:r>`
    + '<w:r><w:footnoteReference w:id="2"/></w:r></w:p>'
    + '<w:sectPr/>'
    + '</w:body></w:document>';

  const footnotesXml = XML_DECL
    + `<w:footnotes xmlns:w="${W_NS}">`
    + '<w:footnote w:id="0" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
    + '<w:footnote w:id="1" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
    + `<w:footnote w:id="2">${p(`Świadek ${f.footnoteStrings[0]}, tel. ${f.footnoteStrings[1]}.`)}</w:footnote>`
    + '</w:footnotes>';

  const documentRels = XML_DECL
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
    + '</Relationships>';

  return buildZip([
    {
      name: '[Content_Types].xml',
      data: contentTypes('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'),
      method: 0,
    },
    { name: '_rels/.rels', data: ROOT_RELS, method: 0 },
    { name: 'word/_rels/document.xml.rels', data: documentRels, method: 8 },
    { name: 'word/document.xml', data: documentXml, method: 8 },
    { name: 'word/footnotes.xml', data: footnotesXml, method: 8 },
  ]);
}

export async function buildNaglowekStopkaDocx() {
  const f = DOCX_NAGLOWEK_STOPKA;
  const documentXml = XML_DECL
    + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">`
    + '<w:body>'
    + p(`Wnoszę o wyznaczenie terminu rozprawy. Pełnomocnik wnioskodawczyni ${f.bodyStrings[0]} podtrzymuje wnioski dowodowe.`)
    + '<w:sectPr>'
    + '<w:headerReference w:type="default" r:id="rId11"/>'
    + '<w:footerReference w:type="default" r:id="rId12"/>'
    + '</w:sectPr>'
    + '</w:body></w:document>';

  const headerXml = XML_DECL
    + `<w:hdr xmlns:w="${W_NS}">`
    + p(f.headerStrings[0])
    + p(`${f.headerStrings[1]}, NIP ${f.headerStrings[2]}`)
    + '</w:hdr>';

  const footerXml = XML_DECL
    + `<w:ftr xmlns:w="${W_NS}">`
    + p(`rachunek: ${f.footerStrings[0]} | ${f.footerStrings[1]}`)
    + '</w:ftr>';

  const documentRels = XML_DECL
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
    + '<Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    + '</Relationships>';

  return buildZip([
    {
      name: '[Content_Types].xml',
      data: contentTypes(
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
      ),
      method: 0,
    },
    { name: '_rels/.rels', data: ROOT_RELS, method: 0 },
    { name: 'word/_rels/document.xml.rels', data: documentRels, method: 8 },
    { name: 'word/document.xml', data: documentXml, method: 8 },
    { name: 'word/header1.xml', data: headerXml, method: 8 },
    { name: 'word/footer1.xml', data: footerXml, method: 8 },
  ]);
}
