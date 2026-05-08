// Regenerates the binary e2e fixtures from sample.txt.
// Run: node scripts/build-e2e-fixtures.js

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Document, Paragraph, TextRun, Packer } from 'docx';
import { createCanvas } from '@napi-rs/canvas';

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

function renderTextImage({ width, height, lines, fontSize = 32 }) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'black';
  ctx.font = `${fontSize}px sans-serif`;
  let y = fontSize + 20;
  for (const line of lines) {
    ctx.fillText(line, 40, y);
    y += fontSize + 10;
  }
  return canvas.toBuffer('image/png');
}

async function buildPhotoPng() {
  const png = renderTextImage({
    width: 1200,
    height: 600,
    lines: [
      'Jan Kowalski',
      'ul. Marszalkowska 1, 00-001 Warszawa',
      'PESEL: 80010112345',
    ],
  });
  writeFileSync(join(FIXTURES, 'sample-photo.png'), png);
  console.log('wrote sample-photo.png');
}

async function buildScannedPdf() {
  const png = renderTextImage({
    width: 1200,
    height: 1600,
    lines: ['Jan Kowalski', 'ul. Marszalkowska 1, 00-001 Warszawa'],
  });
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([595, 842]);
  page.drawImage(img, { x: 50, y: 50, width: 495, height: 700 });
  const bytes = await pdf.save();
  writeFileSync(join(FIXTURES, 'sample-scanned.pdf'), bytes);
  console.log('wrote sample-scanned.pdf');
}

async function buildMixedPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const p1 = pdf.addPage([595, 842]);
  let y = 800;
  for (const line of ['Strona pierwsza', 'Jan Kowalski tekstowo']) {
    p1.drawText(line, { x: 50, y, size: 14, font, color: rgb(0, 0, 0) });
    y -= 20;
  }

  const png = renderTextImage({
    width: 1200,
    height: 800,
    lines: ['Strona druga', 'Anna Nowak'],
  });
  const img = await pdf.embedPng(png);
  const p2 = pdf.addPage([595, 842]);
  p2.drawImage(img, { x: 50, y: 100, width: 495, height: 400 });

  const bytes = await pdf.save();
  writeFileSync(join(FIXTURES, 'sample-mixed.pdf'), bytes);
  console.log('wrote sample-mixed.pdf');
}

await buildDocx();
await buildTextPdf();
await buildScannedPdf();
await buildMixedPdf();
await buildPhotoPng();
console.log('done');
