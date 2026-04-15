import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { matchEntities } from './matching.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

// ── Entity classification ──────────────────────────────────────────

export function classifyEntities(expected, predicted) {
  const { matched, missed, spurious, typeMismatched } = matchEntities(expected, predicted);
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

  for (const m of typeMismatched) {
    spans.push({
      start: m.predicted.start,
      end: m.predicted.end,
      entity_group: m.predicted.entity_group,
      expected_entity_group: m.expected.entity_group,
      status: 'mismatch',
      score: m.predicted.score ?? null,
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
      // Pick the most specific span (smallest range), prefer FP > mismatch > FN > TP for visibility
      const statusPriority = { fp: 0, mismatch: 1, fn: 2, tp: 3 };
      covering.sort((a, b) => {
        const sizeA = a.end - a.start;
        const sizeB = b.end - b.start;
        if (sizeA !== sizeB) return sizeA - sizeB;
        return (statusPriority[a.status] ?? 4) - (statusPriority[b.status] ?? 4);
      });
      const span = covering[0];
      const scoreStr = span.score != null ? ` score: ${span.score.toFixed(3)}` : '';
      const title = span.status === 'mismatch'
        ? `assigned: ${span.entity_group}, expected: ${span.expected_entity_group} (MISMATCH)${scoreStr}`
        : `${span.entity_group} (${span.status.toUpperCase()})${scoreStr}`;
      const extraAttrs = span.expected_entity_group ? ` data-expected-type="${span.expected_entity_group}"` : '';
      html += `<span class="entity ${span.entity_group} ${span.status}" data-type="${span.entity_group}" data-status="${span.status}"${extraAttrs} title="${escapeHtml(title)}">${chunk}</span>`;
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
    .entity.mismatch { background: rgba(var(--entity-rgb), 0.2); border: 2px solid #FF6F00; border-radius: 3px; }

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
    if (!types[s.entity_group]) types[s.entity_group] = { tp: 0, fp: 0, fn: 0, mismatch: 0 };
    types[s.entity_group][s.status]++;
  }

  const hasMismatches = spans.some(s => s.status === 'mismatch');

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
        ${hasMismatches ? `<td>${counts.mismatch}</td>` : ''}
      </tr>`;
    })
    .join('\n');

  // Build mismatch detail rows: show each "predicted → expected" pair
  let mismatchDetails = '';
  if (hasMismatches) {
    const pairs = {};
    for (const s of spans) {
      if (s.status !== 'mismatch') continue;
      const key = `${s.entity_group} → ${s.expected_entity_group}`;
      pairs[key] = (pairs[key] || 0) + 1;
    }
    const detailRows = Object.entries(pairs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pair, count]) => `<tr><td></td><td colspan="${hasMismatches ? 5 : 4}" style="color:#E65100;font-size:0.82rem">⚠ ${pair} (×${count})</td></tr>`)
      .join('\n');
    mismatchDetails = detailRows;
  }

  return `<table class="legend-table">
    <thead><tr><th></th><th>Entity Type</th><th>TP</th><th>FP</th><th>FN</th>${hasMismatches ? '<th>Mis</th>' : ''}</tr></thead>
    <tbody>${rows}${mismatchDetails}</tbody>
  </table>`;
}

// ── Historical data loading ────────────────────────────────────────

export async function loadHistoricalScores(currentRunId) {
  const entries = await readdir(RESULTS_DIR);
  const runs = [];

  for (const entry of entries) {
    if (entry === 'latest' || entry === currentRunId) continue;
    try {
      const raw = await readFile(join(RESULTS_DIR, entry, 'scores.json'), 'utf-8');
      const scores = JSON.parse(raw);
      const summaryRaw = await readFile(join(RESULTS_DIR, entry, 'summary.json'), 'utf-8');
      const summary = JSON.parse(summaryRaw);
      runs.push({ runId: entry, label: summary.label || null, scores });
    } catch {
      // No scores.json — skip
    }
  }

  runs.sort((a, b) => a.runId.localeCompare(b.runId));

  // Take last 5 (excluding current)
  const recent = runs.filter(r => r.runId !== 'baseline').slice(-5);

  // Add baseline if not already in recent
  const baseline = runs.find(r => r.runId === 'baseline');
  if (baseline && !recent.some(r => r.runId === 'baseline')) {
    recent.unshift(baseline);
  }

  return recent;
}

// ── Comparison table ───────────────────────────────────────────────

function pct(v) { return (v * 100).toFixed(1) + '%'; }

export function formatDelta(oldVal, newVal) {
  const diff = (newVal - oldVal) * 100;
  if (Math.abs(diff) < 0.05) return `<span class="delta-zero">=</span>`;
  const sign = diff > 0 ? '+' : '';
  const cls = diff > 0 ? 'delta-pos' : 'delta-neg';
  return `<span class="${cls}">${sign}${diff.toFixed(1)}pp</span>`;
}

export function buildComparisonTable(columns, currentRunId, { docRows = null, typeRows = null } = {}) {
  const currentIdx = columns.findIndex(c => c.runId === currentRunId);
  const prevIdx = currentIdx > 0 ? currentIdx - 1 : -1;

  function metricRow(label, getValue) {
    const cells = columns.map((col, i) => {
      const val = getValue(col);
      let content = val != null ? pct(val) : '–';
      if (i === currentIdx && prevIdx >= 0) {
        const prevVal = getValue(columns[prevIdx]);
        if (val != null && prevVal != null) {
          content += ` ${formatDelta(prevVal, val)}`;
        }
      }
      return `<td>${content}</td>`;
    }).join('');
    return `<tr><td><strong>${label}</strong></td>${cells}</tr>`;
  }

  const headerCells = columns.map(c => {
    const label = c.label ? `${c.runId}<br><small>${c.label}</small>` : c.runId;
    const highlight = c.runId === currentRunId ? ' style="background:#e3f2fd"' : '';
    return `<th${highlight}>${label}</th>`;
  }).join('');

  let rows = '';
  rows += metricRow('F1', c => c.f1);
  rows += metricRow('Precision', c => c.precision);
  rows += metricRow('Recall', c => c.recall);

  if (docRows) {
    rows += `<tr><td colspan="${columns.length + 1}" style="padding:0.6rem;font-weight:600;background:#f5f5f5">Per Document F1</td></tr>`;
    for (const doc of docRows) {
      rows += metricRow(humanizeDocName(doc), c => c.documents?.[doc]?.f1 ?? null);
    }
  }

  if (typeRows) {
    rows += `<tr><td colspan="${columns.length + 1}" style="padding:0.6rem;font-weight:600;background:#f5f5f5">Per Type F1</td></tr>`;
    for (const type of typeRows) {
      rows += metricRow(type, c => c.byType?.[type]?.f1 ?? null);
    }
  }

  return `<table class="comparison-table">
    <thead><tr><th>Metric</th>${headerCells}</tr></thead>
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

// ── Scoring metrics section ────────────────────────────────────────

function buildScoringSection(docScores) {
  const rows = Object.entries(docScores.byType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, m]) => `<tr>
      <td>${type}</td>
      <td>${pct(m.precision)}</td>
      <td>${pct(m.recall)}</td>
      <td>${pct(m.f1)}</td>
      <td>${m.tp}</td>
      <td>${m.fp}</td>
      <td>${m.fn}</td>
    </tr>`)
    .join('\n');

  return `
    <div class="section-title">Scoring</div>
    <p>Precision: <strong>${pct(docScores.precision)}</strong> &nbsp;
       Recall: <strong>${pct(docScores.recall)}</strong> &nbsp;
       F1: <strong>${pct(docScores.f1)}</strong> &nbsp;
       TP: ${docScores.tp} &nbsp; FP: ${docScores.fp} &nbsp; FN: ${docScores.fn}</p>
    <table class="scoring-table">
      <thead><tr><th>Type</th><th>P</th><th>R</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── F1 badge ───────────────────────────────────────────────────────

function f1Badge(f1) {
  const cls = f1 >= 0.9 ? 'green' : f1 >= 0.7 ? 'yellow' : 'red';
  return `<span class="f1-badge ${cls}">F1: ${pct(f1)}</span>`;
}

// ── Main report generator ──────────────────────────────────────────

export async function generateReport(runId, scoresData) {
  const runDir = join(RESULTS_DIR, runId);
  const docNames = Object.keys(scoresData.documents).sort();

  // Load historical scores
  const historicalRuns = await loadHistoricalScores(runId);

  // Build comparison columns: historical + current
  const currentSummaryRaw = await readFile(join(runDir, 'summary.json'), 'utf-8');
  const currentSummary = JSON.parse(currentSummaryRaw);

  const comparisonColumns = [
    ...historicalRuns.map(r => ({
      runId: r.runId,
      label: r.label,
      f1: r.scores.overall.f1,
      precision: r.scores.overall.precision,
      recall: r.scores.overall.recall,
      documents: r.scores.documents,
      byType: r.scores.overall.byType,
    })),
    {
      runId,
      label: currentSummary.label || null,
      f1: scoresData.overall.f1,
      precision: scoresData.overall.precision,
      recall: scoresData.overall.recall,
      documents: scoresData.documents,
      byType: scoresData.overall.byType,
    },
  ];

  const allTypes = Object.keys(scoresData.overall.byType).sort();

  // Build overall comparison table
  const overallComparisonHtml = buildComparisonTable(comparisonColumns, runId, {
    docRows: docNames,
    typeRows: allTypes,
  });

  // Build per-document sections
  const docSections = [];
  for (const docName of docNames) {
    const docScores = scoresData.documents[docName];

    // Load source text
    let sourceText;
    try {
      sourceText = await readFile(join(TEST_DATA_DIR, `${docName}.txt`), 'utf-8');
    } catch {
      sourceText = `(source text not found for ${docName})`;
    }

    // Load predicted entities
    let predicted = [];
    try {
      const raw = await readFile(join(runDir, docName, 'entities.json'), 'utf-8');
      predicted = JSON.parse(raw);
      // Add text from source
      for (const e of predicted) {
        if (!e.text) e.text = sourceText.slice(e.start, e.end);
      }
    } catch {}

    // Load expected entities
    let expected = [];
    try {
      const raw = await readFile(join(TEST_DATA_DIR, `${docName}.expected.json`), 'utf-8');
      expected = JSON.parse(raw);
    } catch {}

    // Classify entities
    const spans = classifyEntities(expected, predicted);
    const annotatedHtml = buildAnnotatedText(sourceText, spans);
    const legendHtml = buildLegend(spans);
    const scoringHtml = buildScoringSection(docScores);

    // Per-document comparison table
    const docComparisonColumns = comparisonColumns.map(col => ({
      ...col,
      f1: col.documents?.[docName]?.f1 ?? null,
      precision: col.documents?.[docName]?.precision ?? null,
      recall: col.documents?.[docName]?.recall ?? null,
      byType: col.documents?.[docName]?.byType ?? {},
    }));
    const docTypes = Object.keys(docScores.byType).sort();
    const docComparisonHtml = buildComparisonTable(docComparisonColumns, runId, {
      typeRows: docTypes,
    });

    docSections.push(`
      <details>
        <summary>${humanizeDocName(docName)} ${f1Badge(docScores.f1)}</summary>
        <div>
          <div class="section-title">Annotated Text</div>
          <div class="annotated-text">${annotatedHtml}</div>
          ${legendHtml}
          ${scoringHtml}
          <div class="section-title">Comparison</div>
          ${docComparisonHtml}
        </div>
      </details>
    `);
  }

  // Assemble full HTML
  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eval Report — ${runId}</title>
  <style>${buildCss()}</style>
</head>
<body>
  <div class="header">
    <h1>Eval Report</h1>
    <div class="meta">
      Run: <strong>${runId}</strong>
      ${currentSummary.label ? ` — ${escapeHtml(currentSummary.label)}` : ''}
      &nbsp;|&nbsp; ${currentSummary.timestamp || ''}
      &nbsp;|&nbsp; ${docNames.length} documents
    </div>
  </div>

  <div class="big-metrics">
    <div class="big-metric">
      <div class="value">${pct(scoresData.overall.f1)}</div>
      <div class="label">F1</div>
    </div>
    <div class="big-metric">
      <div class="value">${pct(scoresData.overall.precision)}</div>
      <div class="label">Precision</div>
    </div>
    <div class="big-metric">
      <div class="value">${pct(scoresData.overall.recall)}</div>
      <div class="label">Recall</div>
    </div>
  </div>

  <div class="section-title">Overall Comparison</div>
  ${overallComparisonHtml}

  ${docSections.join('\n')}
</body>
</html>`;

  const outPath = join(runDir, 'report.html');
  await writeFile(outPath, html, 'utf-8');
  return outPath;
}
