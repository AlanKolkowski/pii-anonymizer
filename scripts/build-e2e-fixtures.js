// Regenerates the binary e2e fixtures from sample.txt.
// Run: node scripts/build-e2e-fixtures.js

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Document, Paragraph, TextRun, Packer } from 'docx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'e2e', 'fixtures');

const sampleText = readFileSync(join(FIXTURES, 'sample.txt'), 'utf8').trim();

async function buildDocx() {
  const doc = new Document({
    sections: [{
      properties: {},
      children: sampleText.split(/\r?\n/).map((line) =>
        new Paragraph({ children: [new TextRun(line)] })
      ),
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(join(FIXTURES, 'sample.docx'), buffer);
  console.log('wrote sample.docx');
}

async function buildTextPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]); // A4
  let y = 800;
  for (const line of sampleText.split(/\r?\n/)) {
    page.drawText(line, { x: 50, y, size: 12, font, color: rgb(0, 0, 0) });
    y -= 20;
  }
  const bytes = await pdf.save();
  writeFileSync(join(FIXTURES, 'sample-text.pdf'), bytes);
  console.log('wrote sample-text.pdf');
}

async function buildScannedPdf() {
  // Image-only PDF: a page with a drawn rectangle (no extractable text glyphs).
  // pdfjs.getTextContent() will return zero text items, triggering ScannedPdfError.
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 50, width: 500, height: 700, color: rgb(0.95, 0.95, 0.95) });
  page.drawRectangle({ x: 80, y: 700, width: 440, height: 30, color: rgb(0.7, 0.7, 0.7) });
  const bytes = await pdf.save();
  writeFileSync(join(FIXTURES, 'sample-scanned.pdf'), bytes);
  console.log('wrote sample-scanned.pdf');
}

await buildDocx();
await buildTextPdf();
await buildScannedPdf();
console.log('done');
