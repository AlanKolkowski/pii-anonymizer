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

// ── Color palette ──────────────────────────────────────────────────

export const ENTITY_COLORS = {
  PERSON_NAME: '#4CAF50',
  POSTAL_ADDRESS: '#2196F3',
  PHONE_NUMBER: '#FF9800',
  EMAIL_ADDRESS: '#9C27B0',
  ORGANIZATION_NAME: '#00BCD4',
  ORGANIZATION_IDENTIFIER: '#607D8B',
  PERSON_IDENTIFIER: '#E91E63',
  DOCUMENT_REFERENCE: '#795548',
  FINANCIAL_AMOUNT: '#FFC107',
  BANK_ACCOUNT_IDENTIFIER: '#3F51B5',
  LOCATION: '#8BC34A',
  DATE_OF_BIRTH: '#FF5722',
  HEALTH_DATA: '#F44336',
  PERSON_ROLE_OR_TITLE: '#009688',
  PERSON_ATTRIBUTE: '#CDDC39',
  DOCUMENT_IDENTIFIER: '#673AB7',
  INCOME_COMPENSATION: '#FF6F00',
  PROPER_NAME: '#26A69A',
  VEHICLE_IDENTIFIER: '#5C6BC0',
  ACCOUNT_IDENTIFIER: '#EF5350',
};

const FALLBACK_COLOR = '#9E9E9E';

function getColor(entityGroup) {
  return ENTITY_COLORS[entityGroup] || FALLBACK_COLOR;
}

export function buildCss() {
  const colorVars = Object.entries(ENTITY_COLORS)
    .map(([type, color]) => `  --color-${type}: ${color};`)
    .join('\n');

  return `
    :root {
    ${colorVars}
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: #fafafa;
    }

    .header { margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .header .meta { color: #666; font-size: 0.9rem; }

    .big-metrics {
      display: flex;
      gap: 2rem;
      margin: 1rem 0 2rem;
    }
    .big-metric {
      text-align: center;
      padding: 1rem 1.5rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .big-metric .value { font-size: 2rem; font-weight: bold; }
    .big-metric .label { font-size: 0.85rem; color: #666; }

    details {
      margin-bottom: 1rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    summary {
      padding: 0.75rem 1rem;
      cursor: pointer;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    details[open] summary { border-bottom: 1px solid #eee; }
    details > div { padding: 1rem; }

    .f1-badge {
      font-size: 0.8rem;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-weight: normal;
    }
    .f1-badge.green { background: #c8e6c9; color: #2e7d32; }
    .f1-badge.yellow { background: #fff9c4; color: #f57f17; }
    .f1-badge.red { background: #ffcdd2; color: #c62828; }

    .annotated-text {
      white-space: pre-wrap;
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
      font-size: 0.85rem;
      line-height: 1.8;
      padding: 1rem;
      background: #fdfdfd;
      border: 1px solid #eee;
      border-radius: 4px;
      margin-bottom: 1rem;
      overflow-x: auto;
    }

    .entity {
      padding: 0.1rem 0;
      border-radius: 2px;
      cursor: help;
    }
    .entity.tp { background: rgba(var(--entity-rgb), 0.3); }
    .entity.fp { background: rgba(var(--entity-rgb), 0.3); text-decoration: wavy underline red; text-underline-offset: 3px; }
    .entity.fn { border: 1px dashed; background: rgba(var(--entity-rgb), 0.1); }

    ${Object.entries(ENTITY_COLORS).map(([type, color]) => {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `.entity.${type} { --entity-rgb: ${r}, ${g}, ${b}; border-color: ${color}; }`;
    }).join('\n    ')}
    .entity:not(${Object.keys(ENTITY_COLORS).map(t => `.${t}`).join(',')}) {
      --entity-rgb: 158, 158, 158;
      border-color: ${FALLBACK_COLOR};
    }

    .legend-table, .scoring-table, .comparison-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
    .legend-table th, .scoring-table th, .comparison-table th {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 2px solid #ddd;
      font-weight: 600;
    }
    .legend-table td, .scoring-table td, .comparison-table td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid #eee;
    }
    .legend-table tr:nth-child(even), .scoring-table tr:nth-child(even), .comparison-table tr:nth-child(even) {
      background: #f9f9f9;
    }

    .swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      vertical-align: middle;
      margin-right: 0.4rem;
    }

    .delta-pos { color: #2e7d32; }
    .delta-neg { color: #c62828; }
    .delta-zero { color: #999; }

    .section-title {
      font-size: 1rem;
      font-weight: 600;
      margin: 1rem 0 0.5rem;
    }
  `;
}

export function buildLegend(spans) {
  const types = {};
  for (const s of spans) {
    if (!types[s.entity_group]) types[s.entity_group] = { tp: 0, fp: 0, fn: 0 };
    types[s.entity_group][s.status]++;
  }

  const rows = Object.entries(types)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, counts]) => {
      const color = getColor(type);
      return `<tr>
        <td><span class="swatch" style="background:${color}"></span></td>
        <td>${type}</td>
        <td>${counts.tp}</td>
        <td>${counts.fp}</td>
        <td>${counts.fn}</td>
      </tr>`;
    })
    .join('\n');

  return `<table class="legend-table">
    <thead><tr><th></th><th>Entity Type</th><th>TP</th><th>FP</th><th>FN</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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
