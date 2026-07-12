// Pins what the DOCX import path ACTUALLY extracts from documents that keep
// PII outside the main body flow (EVAL-RECALL-AUDIT.md part B, fixtures in
// src/docx-rebuild/test-helpers/docx-fixture.js — same bytes are written to
// test-data/adversarial/docx/ for manual testing).
//
// Measured behavior (mammoth.extractRawText, pinned below):
//   - table cell content IS extracted (flattened one cell per line);
//   - footnote content is SILENTLY dropped;
//   - page header and footer content is SILENTLY dropped;
//   - no warning message accompanies any of the drops.
//
// Product consequence: in today's text-based flow the dropped content never
// reaches the anonymized output (no direct leak), but the user gets no
// signal that parts of the document were never seen by the sieve. For the
// planned DOCX-rebuild flow (verbatim-copy recomposition), untouched parts
// pass through byte-for-byte — headers, footers and footnotes MUST be
// walked by the token engine or raw PII survives into the exported file.
// If an extractor change ever starts surfacing these parts, these pins
// break on purpose so the audit trail gets updated.
import { extractDocx } from './docx.js';
import {
  buildTabelaPrzypisyDocx,
  buildNaglowekStopkaDocx,
  DOCX_TABELA_PRZYPISY,
  DOCX_NAGLOWEK_STOPKA,
} from '../docx-rebuild/test-helpers/docx-fixture.js';

// Real mammoth, adapted: the app's browser build feeds { arrayBuffer },
// mammoth's Node build wants { buffer } — wrap so extractDocx's own code
// path (including its { arrayBuffer } call) runs unmodified.
async function loadNodeMammoth() {
  const mod = await import('mammoth');
  const mammoth = mod.default ?? mod;
  return {
    extractRawText: ({ arrayBuffer }) =>
      mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }),
  };
}

function fakeFile(bytes, name) {
  return {
    name,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('DOCX import: adversarial placements (tables, footnotes, header, footer)', () => {
  it('extracts every table cell (parties, PESELs, addresses reach the sieve)', async () => {
    const bytes = await buildTabelaPrzypisyDocx();
    const { text } = await extractDocx(fakeFile(bytes, 'adw_docx_01.docx'), {
      loadMammoth: loadNodeMammoth,
    });
    for (const s of DOCX_TABELA_PRZYPISY.bodyStrings) {
      expect(text).toContain(s);
    }
  });

  it('PINS: footnote content is silently dropped (never reaches the sieve)', async () => {
    const bytes = await buildTabelaPrzypisyDocx();
    const { text } = await extractDocx(fakeFile(bytes, 'adw_docx_01.docx'), {
      loadMammoth: loadNodeMammoth,
    });
    // The referencing sentence survives, the footnote body does not.
    expect(text).toContain('Dane świadka w przypisie.');
    for (const s of DOCX_TABELA_PRZYPISY.footnoteStrings) {
      expect(text).not.toContain(s);
    }
  });

  it('PINS: page header and footer content is silently dropped (never reaches the sieve)', async () => {
    const bytes = await buildNaglowekStopkaDocx();
    const { text } = await extractDocx(fakeFile(bytes, 'adw_docx_02.docx'), {
      loadMammoth: loadNodeMammoth,
    });
    for (const s of DOCX_NAGLOWEK_STOPKA.bodyStrings) {
      expect(text).toContain(s);
    }
    for (const s of [...DOCX_NAGLOWEK_STOPKA.headerStrings, ...DOCX_NAGLOWEK_STOPKA.footerStrings]) {
      expect(text).not.toContain(s);
    }
  });

  it('PINS: the drops produce no extraction warnings (user gets no signal)', async () => {
    const mod = await import('mammoth');
    const mammoth = mod.default ?? mod;
    for (const build of [buildTabelaPrzypisyDocx, buildNaglowekStopkaDocx]) {
      const bytes = await build();
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      expect(result.messages).toEqual([]);
    }
  });
});
