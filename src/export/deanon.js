import { deanonymizeText } from '../anonymizer.js';
import { effectiveOutcomeLegend } from '../substitution.js';
import { createZipBlob } from './zip.js';

const FORMAT_EXT = {
  pdf: 'pdf',
  docx: 'docx',
};

const ZIP_NAMES = {
  pdf: 'zdeanonimizowane-pdf.zip',
  docx: 'zdeanonimizowane-docx.zip',
};

const PAGE_WIDTH = 595.28; // A4 portrait in PDF points
const PAGE_HEIGHT = 841.89;
const PDF_SCALE = 2;
const PDF_MARGIN = 52;
const PDF_FONT_SIZE = 11;
const PDF_LINE_HEIGHT = 16;
const PDF_FONT = `${PDF_FONT_SIZE}px Inter, Arial, sans-serif`;
const PDF_TEXT_COLOR = '#171717';

function assertFormat(format) {
  if (!FORMAT_EXT[format]) throw new Error(`Unsupported export format: ${format}`);
}

function stripKnownExtension(label) {
  return String(label ?? '').trim().replace(/\.(txt|md|docx|pdf|rtf)$/i, '');
}

export function sanitizeFileStem(label, fallback = 'wynik') {
  const ascii = stripKnownExtension(label)
    .replace(/[łŁ]/g, (ch) => (ch === 'Ł' ? 'L' : 'l'))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[^a-z0-9._ -]+/g, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return ascii || fallback;
}

export function uniqueDeanonFileName(label, index, format, used = new Set(), options = {}) {
  assertFormat(format);
  const ext = FORMAT_EXT[format];
  const prefix = options.prefix === false ? '' : `${String(index + 1).padStart(2, '0')}-`;
  const stem = sanitizeFileStem(label, `wynik-${index + 1}`);
  const base = `${prefix}${stem}-deanon`;
  let candidate = `${base}.${ext}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}.${ext}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function hasEffectiveLegend(outcomes, liveLegend) {
  if (liveLegend && Object.keys(liveLegend).length > 0) return true;
  return outcomes.some((outcome) => Object.keys(outcome?.legendSnapshot ?? {}).length > 0);
}

export function buildDeanonExportEntries(outcomes, legend, format, options = {}) {
  assertFormat(format);
  const used = new Set();
  return outcomes.map((outcome, index) => ({
    name: uniqueDeanonFileName(outcome.label, index, format, used, options),
    label: outcome.label,
    text: deanonymizeText(outcome.text ?? '', effectiveOutcomeLegend(outcome, legend)),
  }));
}

function textLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

async function generateDocxBlob(entry) {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const lines = textLines(entry.text);
  const children = lines.length > 0
    ? lines.map((line) => new Paragraph({
      children: [new TextRun({ text: line })],
    }))
    : [new Paragraph('')];

  const doc = new Document({
    creator: 'pii.tools',
    title: entry.label || entry.name,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

function makeCanvasPage() {
  if (typeof document === 'undefined') {
    throw new Error('PDF export requires a browser document');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(PAGE_WIDTH * PDF_SCALE);
  canvas.height = Math.ceil(PAGE_HEIGHT * PDF_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context for PDF export');

  ctx.setTransform(PDF_SCALE, 0, 0, PDF_SCALE, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.fillStyle = PDF_TEXT_COLOR;
  ctx.font = PDF_FONT;
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

function splitLongToken(ctx, token, maxWidth) {
  const chars = Array.from(token);
  const parts = [];
  let current = '';
  for (const ch of chars) {
    const candidate = current + ch;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapLine(ctx, line, maxWidth) {
  const normalized = String(line ?? '').replace(/\t/g, '    ');
  if (normalized.length === 0) return [''];

  const tokens = normalized.split(/(\s+)/).filter((token) => token.length > 0);
  const lines = [];
  let current = '';

  for (const token of tokens) {
    const candidate = current + token;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    const trimmed = current.trimEnd();
    if (trimmed) lines.push(trimmed);

    const next = token.trimStart();
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    const longParts = splitLongToken(ctx, next, maxWidth);
    lines.push(...longParts.slice(0, -1));
    current = longParts.at(-1) ?? '';
  }

  if (current.trimEnd()) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [''];
}

async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Could not render PDF page image'));
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderPdfPageImages(text) {
  const maxWidth = PAGE_WIDTH - PDF_MARGIN * 2;
  const maxY = PAGE_HEIGHT - PDF_MARGIN;
  let page = makeCanvasPage();
  let y = PDF_MARGIN;
  const pngs = [];

  async function pushPage() {
    pngs.push(await canvasToPngBytes(page.canvas));
    page = makeCanvasPage();
    y = PDF_MARGIN;
  }

  const sourceLines = textLines(text);
  for (const sourceLine of sourceLines) {
    const visualLines = wrapLine(page.ctx, sourceLine, maxWidth);
    for (const visualLine of visualLines) {
      if (y + PDF_LINE_HEIGHT > maxY) await pushPage();
      page.ctx.fillStyle = PDF_TEXT_COLOR;
      page.ctx.font = PDF_FONT;
      page.ctx.fillText(visualLine, PDF_MARGIN, y);
      y += PDF_LINE_HEIGHT;
    }
  }

  pngs.push(await canvasToPngBytes(page.canvas));
  return pngs;
}

async function generatePdfBlob(entry) {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('pii.tools');
  pdfDoc.setProducer('pii.tools');
  pdfDoc.setTitle(entry.label || entry.name);

  const pngs = await renderPdfPageImages(entry.text);
  for (const png of pngs) {
    const image = await pdfDoc.embedPng(png);
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

async function generateFileBlob(entry, format) {
  return format === 'docx' ? generateDocxBlob(entry) : generatePdfBlob(entry);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// DOCX-REBUILD §3.4/§6.3/§9.3: a DOCX outcome exports through the surgical
// reconstruction instead of the flat generator — same file name pipeline,
// same download path. Export gates throw with the user-facing diagnosis;
// residues do NOT block (the report carries them).
//
// DOCX-IMPL-PLAN.md FD-3: `resolveReplacement` (the flexion seam) is an
// OPTIONAL pass-through, undefined by default — flat exports (text/PDF,
// buildDeanonExportEntries above) never receive it in this plan (§4.2:
// those outputs stay at the base legend value until FL-5); only the DOCX
// reconstruction gets a chance to inflect, and only when its caller built
// a resolver at all.
async function rebuildDocxBlob(outcome, legend, resolveReplacement) {
  const { rebuildDocx } = await import('../docx-rebuild/rebuild-docx.js');
  const outcomeLegend = effectiveOutcomeLegend(outcome, legend);
  const { status, bytes, report } = await rebuildDocx(outcome.docx.bytes, outcomeLegend, { resolveReplacement });
  if (status === 'blocked-egress') {
    const findings = report.egress.blocked.map((b) => b.type).join(', ');
    throw new Error(`Eksport zablokowany: dokument zawiera odwołania zewnętrzne (${findings}). Usuń je w edytorze i zaimportuj ponownie.`);
  }
  if (status === 'blocked-no-replacements') {
    throw new Error('Eksport zablokowany: w dokumencie nie znaleziono żadnego tokenu z legendy (zły plik albo cudza legenda).');
  }
  return { blob: new Blob([bytes], { type: DOCX_MIME }), report };
}

export async function exportDeanonOutcomes({ outcomes, legend, format, resolveReplacement }) {
  assertFormat(format);
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw new Error('Brak dokumentów wynikowych do eksportu');
  }
  if (!hasEffectiveLegend(outcomes, legend)) {
    throw new Error('Eksport wymaga legendy tokenów');
  }

  const archive = outcomes.length > 1;
  const entries = buildDeanonExportEntries(outcomes, legend, format, { prefix: archive });
  const files = [];
  const reports = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const outcome = outcomes[i];
    if (format === 'docx' && outcome?.docx?.bytes) {
      const { blob, report } = await rebuildDocxBlob(outcome, legend, resolveReplacement);
      files.push({ name: entry.name, data: blob });
      reports.push({ name: entry.name, report });
    } else {
      files.push({ name: entry.name, data: await generateFileBlob(entry, format) });
    }
  }

  if (files.length === 1) {
    return {
      blob: files[0].data,
      fileName: files[0].name,
      count: 1,
      format,
      archive: false,
      files: [files[0].name],
      ...(reports.length > 0 && { reports }),
    };
  }

  const blob = await createZipBlob(files);
  return {
    blob,
    fileName: ZIP_NAMES[format],
    zipName: ZIP_NAMES[format],
    count: files.length,
    format,
    archive: true,
    files: files.map((file) => file.name),
    ...(reports.length > 0 && { reports }),
  };
}

export const exportDeanonOutcomesZip = exportDeanonOutcomes;

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
