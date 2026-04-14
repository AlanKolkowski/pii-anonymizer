import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { matchEntities } from './matching.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

// ── Entity classification ──────────────────────────────────────────

export function classifyEntities(expected, predicted) {
  const { matched, missed, spurious } = matchEntities(expected, predicted);
  const spans = [];

  for (const m of matched) {
    spans.push({
      start: m.predicted.start,
      end: m.predicted.end,
      entity_group: m.predicted.entity_group,
      status: 'tp',
      score: m.predicted.score ?? null,
    });
  }

  for (const e of missed) {
    spans.push({
      start: e.start,
      end: e.end,
      entity_group: e.entity_group,
      status: 'fn',
      score: null,
    });
  }

  for (const e of spurious) {
    spans.push({
      start: e.start,
      end: e.end,
      entity_group: e.entity_group,
      status: 'fp',
      score: e.score ?? null,
    });
  }

  return spans;
}

// ── HTML helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAnnotatedText(text, spans) {
  // Collect all boundary points
  const points = new Set([0, text.length]);
  for (const s of spans) {
    points.add(Math.max(0, s.start));
    points.add(Math.min(text.length, s.end));
  }
  const sorted = [...points].sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const chunk = escapeHtml(text.slice(from, to));

    // Find all spans covering this range (span.start <= from && span.end >= to)
    const covering = spans.filter(s => s.start <= from && s.end >= to);

    if (covering.length === 0) {
      html += chunk;
    } else {
      // Pick the most specific span (smallest range), prefer FP > FN > TP for visibility
      const statusPriority = { fp: 0, fn: 1, tp: 2 };
      covering.sort((a, b) => {
        const sizeA = a.end - a.start;
        const sizeB = b.end - b.start;
        if (sizeA !== sizeB) return sizeA - sizeB;
        return (statusPriority[a.status] ?? 3) - (statusPriority[b.status] ?? 3);
      });
      const span = covering[0];
      const title = `${span.entity_group} (${span.status.toUpperCase()})${span.score != null ? ` score: ${span.score.toFixed(3)}` : ''}`;
      html += `<span class="entity ${span.entity_group} ${span.status}" data-type="${span.entity_group}" data-status="${span.status}" title="${escapeHtml(title)}">${chunk}</span>`;
    }
  }

  return html;
}

// ── Document name humanization ─────────────────────────────────────

export function humanizeDocName(filename) {
  let name = filename;
  if (name.startsWith('pismo_')) name = name.slice(6);

  const digitMatch = name.match(/^(\d+)_(.+)$/);
  if (digitMatch) {
    const rest = digitMatch[2].replace(/_/g, ' ');
    return `${digitMatch[1]}. ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  }

  const rest = name.replace(/_/g, ' ');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
