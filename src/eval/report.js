import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { matchEntities } from './matching.js';
import { SOURCE_MARKERS, SOURCE_LABELS, sourcesToArray } from '../pipeline/sources.js';

function sourceMarker(source) {
  return SOURCE_MARKERS[source] || '?';
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

function renderSourceSup(source) {
  const sources = sourcesToArray(source);
  if (sources.length === 0) return '';
  const markers = sources.map(sourceMarker).join('');
  const label = sources.map(sourceLabel).join(', ');
  return `<sup class="src" aria-hidden="true" title="Source: ${escapeHtml(label)}">${markers}</sup>`;
}

function sourceTitleSuffix(source) {
  const sources = sourcesToArray(source);
  if (sources.length === 0) return '';
  return ` • source: ${sources.map(sourceLabel).join(', ')}`;
}

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const DOCS_DIR = join(TEST_DATA_DIR, 'synthetic');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

// ── Entity classification ──────────────────────────────────────────

export function classifyEntities(expected, predicted) {
  const { matched, missed, spurious, typeMismatched } = matchEntities(expected, predicted);
  const spans = [];

  for (const m of matched) {
    const pStart = m.predicted.start;
    const pEnd = m.predicted.end;
    const eStart = m.expected.start;
    const eEnd = m.expected.end;
    const exact = pStart === eStart && pEnd === eEnd;

    if (exact) {
      spans.push({
        start: pStart, end: pEnd,
        entity_group: m.predicted.entity_group,
        status: 'tp',
        score: m.predicted.score ?? null,
        source: m.predicted.source ?? null,
      });
    } else {
      // Partial match — counts as FP+FN in strict scoring
      const ovStart = Math.max(pStart, eStart);
      const ovEnd = Math.min(pEnd, eEnd);
      // Overlap region — detected but wrong boundary
      if (ovStart < ovEnd) {
        spans.push({
          start: ovStart, end: ovEnd,
          entity_group: m.predicted.entity_group,
          status: 'partial',
          score: m.predicted.score ?? null,
          source: m.predicted.source ?? null,
        });
      }
      // Expected-only region — model missed this part
      if (eStart < ovStart) {
        spans.push({
          start: eStart, end: ovStart,
          entity_group: m.expected.entity_group,
          status: 'partial-missed',
          score: null,
        });
      }
      if (eEnd > ovEnd) {
        spans.push({
          start: ovEnd, end: eEnd,
          entity_group: m.expected.entity_group,
          status: 'partial-missed',
          score: null,
        });
      }
      // Model-only region — model over-extended
      if (pStart < ovStart) {
        spans.push({
          start: pStart, end: ovStart,
          entity_group: m.predicted.entity_group,
          status: 'partial-extra',
          score: m.predicted.score ?? null,
          source: m.predicted.source ?? null,
        });
      }
      if (pEnd > ovEnd) {
        spans.push({
          start: ovEnd, end: pEnd,
          entity_group: m.predicted.entity_group,
          status: 'partial-extra',
          score: m.predicted.score ?? null,
          source: m.predicted.source ?? null,
        });
      }
    }
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
      source: e.source ?? null,
    });
  }

  for (const m of typeMismatched) {
    const pStart = m.predicted.start;
    const pEnd = m.predicted.end;
    const eStart = m.expected.start;
    const eEnd = m.expected.end;
    const ovStart = Math.max(pStart, eStart);
    const ovEnd = Math.min(pEnd, eEnd);

    // Overlap region — detected but wrong type
    if (ovStart < ovEnd) {
      spans.push({
        start: ovStart, end: ovEnd,
        entity_group: m.predicted.entity_group,
        expected_entity_group: m.expected.entity_group,
        status: 'mismatch',
        score: m.predicted.score ?? null,
        source: m.predicted.source ?? null,
      });
    }
    // Expected-only region
    if (eStart < ovStart) {
      spans.push({
        start: eStart, end: ovStart,
        entity_group: m.expected.entity_group,
        expected_entity_group: m.expected.entity_group,
        status: 'partial-missed',
        score: null,
      });
    }
    if (eEnd > ovEnd) {
      spans.push({
        start: ovEnd, end: eEnd,
        entity_group: m.expected.entity_group,
        expected_entity_group: m.expected.entity_group,
        status: 'partial-missed',
        score: null,
      });
    }
    // Model-only region
    if (pStart < ovStart) {
      spans.push({
        start: pStart, end: ovStart,
        entity_group: m.predicted.entity_group,
        status: 'partial-extra',
        score: m.predicted.score ?? null,
        source: m.predicted.source ?? null,
      });
    }
    if (pEnd > ovEnd) {
      spans.push({
        start: ovEnd, end: pEnd,
        entity_group: m.predicted.entity_group,
        status: 'partial-extra',
        score: m.predicted.score ?? null,
        source: m.predicted.source ?? null,
      });
    }
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
      const statusLabels = {
        tp: 'TP — exact match',
        partial: 'PARTIAL — detected, wrong boundary',
        'partial-missed': 'PARTIAL — model missed this part',
        'partial-extra': 'PARTIAL — model over-extended here',
        fp: 'FP',
        fn: 'FN',
        mismatch: 'MISMATCH',
      };
      const title = (span.status === 'mismatch'
        ? `assigned: ${span.entity_group}, expected: ${span.expected_entity_group} (MISMATCH)${scoreStr}`
        : `${span.entity_group} (${statusLabels[span.status] || span.status.toUpperCase()})${scoreStr}`)
        + sourceTitleSuffix(span.source);
      const extraAttrs = span.expected_entity_group ? ` data-expected-type="${span.expected_entity_group}"` : '';
      const isLastChunkOfSpan = span.end === to;
      const srcHtml = isLastChunkOfSpan ? renderSourceSup(span.source) : '';
      html += `<span class="entity ${span.entity_group} ${span.status}" data-type="${span.entity_group}" data-status="${span.status}" data-start="${span.start}" data-end="${span.end}"${extraAttrs} title="${escapeHtml(title)}">${chunk}${srcHtml}</span>`;
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

    .comparison-section > .comparison-table { margin-bottom: 0.5rem; }
    details.breakdown { margin: 0.4rem 0 0; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 4px; box-shadow: none; }
    details.breakdown > summary { padding: 0.4rem 0.75rem; font-size: 0.82rem; font-weight: 600; color: #444; }
    details.breakdown[open] > summary { border-bottom: 1px solid #eee; }
    details.breakdown > div.breakdown-body { padding: 0.25rem 0.5rem 0.5rem; }
    details.breakdown .comparison-table { margin-bottom: 0; font-size: 0.82rem; }

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
      cursor: copy;
    }

    .entity .src {
      font-size: 0.75em;
      opacity: 0.55;
      margin-left: 0.1em;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: none;
      color: #444;
      font-family: inherit;
    }

    .toast {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: #333;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      z-index: 1000;
      font-size: 0.85rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: toastFade 1.1s ease-out forwards;
      pointer-events: none;
    }
    @keyframes toastFade {
      0% { opacity: 0; transform: translateY(6px); }
      15%, 80% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(0); }
    }
    .entity.tp { background: rgba(var(--entity-rgb), 0.3); }
    .entity.partial { background: rgba(var(--entity-rgb), 0.2); border-bottom: 2px dotted #FF6F00; }
    .entity.partial-missed { border: 1px dashed #E65100; background: rgba(255, 111, 0, 0.08); }
    .entity.partial-extra { background: rgba(255, 0, 0, 0.06); text-decoration: wavy underline red; text-underline-offset: 3px; }
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

    details.section {
      margin: 0.5rem 0;
      background: #fafafa;
      border: 1px solid #e5e5e5;
      border-radius: 4px;
      box-shadow: none;
    }
    details.section > summary {
      padding: 0.5rem 0.75rem;
      font-size: 0.95rem;
      font-weight: 600;
      color: #333;
      list-style: revert;
    }
    details.section[open] > summary { border-bottom: 1px solid #eee; }
    details.section > div.section-body { padding: 0.75rem; }

    .segmentation-view .seg-view-toolbar {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 0.5rem;
    }
    .segmentation-view .seg-view-btn {
      padding: 0.3rem 0.75rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #f5f5f5;
      cursor: pointer;
      font-size: 0.8rem;
      font-family: inherit;
    }
    .segmentation-view .seg-view-btn:hover { background: #eee; }
    .segmentation-view .seg-view-btn.active {
      background: white;
      border-color: #1976d2;
      color: #1976d2;
      font-weight: 600;
    }
    .segmentation-view .seg-view-body { display: none; }
    .segmentation-view .seg-view-body.active { display: block; }

    .segmented-text {
      white-space: pre-wrap;
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
      font-size: 0.85rem;
      line-height: 1.9;
      padding: 1rem;
      background: #fdfdfd;
      border: 1px solid #eee;
      border-radius: 4px;
      margin-bottom: 0.75rem;
      overflow-x: auto;
    }
    .segmented-text .segment.seg-a { background: #BBDEFB; }
    .segmented-text .segment.seg-b { background: #FFF9C4; }
    .segmented-text .boundary-marker {
      display: inline-block;
      font-weight: bold;
      font-size: 0.9em;
      vertical-align: middle;
      padding: 0 1px;
      cursor: help;
    }
    .segmented-text .boundary-marker.missed { color: #c62828; }
    .segmented-text .boundary-marker.extra { color: #E65100; }
    .segmentation-metrics { margin-top: 0.5rem; width: auto; }
    .segmentation-metrics th, .segmentation-metrics td { white-space: nowrap; }
  `;
}

export function buildLegend(spans) {
  const types = {};
  for (const s of spans) {
    if (!types[s.entity_group]) types[s.entity_group] = { tp: 0, fp: 0, fn: 0, mismatch: 0, partial: 0 };
    // partial zones are sub-parts of a single partial match
    if (s.status === 'partial' || s.status === 'partial-missed' || s.status === 'partial-extra') {
      types[s.entity_group].partial++;
    } else {
      types[s.entity_group][s.status]++;
    }
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

  const styleLegend = `<div style="font-size:0.82rem;color:#555;margin-top:0.5rem">
    <strong>Visual guide:</strong>
    <span style="background:rgba(76,175,80,0.3);padding:0 4px;border-radius:2px">solid bg</span> = TP (exact match)
    &nbsp;&nbsp;
    <span style="background:rgba(76,175,80,0.2);border-bottom:2px dotted #FF6F00;padding:0 4px;border-radius:2px">orange dotted</span> = partial overlap
    &nbsp;&nbsp;
    <span style="border:1px dashed #E65100;background:rgba(255,111,0,0.08);padding:0 4px;border-radius:2px">orange dashed</span> = missed part of partial
    &nbsp;&nbsp;
    <span style="background:rgba(255,0,0,0.06);text-decoration:wavy underline red;text-underline-offset:3px;padding:0 4px;border-radius:2px">red wavy</span> = over-extended / FP
    &nbsp;&nbsp;
    <span style="border:1px dashed #999;background:rgba(158,158,158,0.1);padding:0 4px;border-radius:2px">gray dashed</span> = FN (fully missed)
    &nbsp;&nbsp;
    <span style="background:rgba(158,158,158,0.2);border:2px solid #FF6F00;padding:0 4px;border-radius:3px">orange border</span> = type mismatch
  </div>`;

  const presentSources = new Set();
  for (const s of spans) {
    for (const src of sourcesToArray(s.source)) presentSources.add(src);
  }
  let sourceLegend = '';
  if (presentSources.size > 0) {
    const items = [...presentSources]
      .map(src => `<span><strong>${sourceMarker(src)}</strong> ${escapeHtml(sourceLabel(src))}</span>`)
      .join(' &nbsp; ');
    sourceLegend = `<div style="font-size:0.82rem;color:#555;margin-top:0.35rem"><strong>Sources:</strong> ${items}</div>`;
  }

  return `<table class="legend-table">
    <thead><tr><th></th><th>Entity Type</th><th>TP</th><th>FP</th><th>FN</th>${hasMismatches ? '<th>Mis</th>' : ''}</tr></thead>
    <tbody>${rows}${mismatchDetails}</tbody>
  </table>${styleLegend}${sourceLegend}`;
}

// ── Click-to-copy script ───────────────────────────────────────────

export function buildScript() {
  return `
    (function () {
      const STATUS_LABELS = {
        tp: (t) => 'TP (' + t + ')',
        fp: (t) => 'FP (' + t + ')',
        fn: (t) => 'FN (' + t + ')',
        partial: (t) => 'PARTIAL overlap (' + t + ')',
        'partial-missed': (t) => 'PARTIAL missed (' + t + ')',
        'partial-extra': (t) => 'PARTIAL extra (' + t + ')',
      };

      function formatStatus(status, type, expectedType) {
        if (status === 'mismatch') {
          return 'MISMATCH (assigned: ' + type + ', expected: ' + expectedType + ')';
        }
        const fn = STATUS_LABELS[status];
        return fn ? fn(type) : status.toUpperCase() + ' (' + type + ')';
      }

      function showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1100);
      }

      async function copyPlaceholder(entity) {
        const details = entity.closest('[data-doc]');
        if (!details) return;
        const docName = details.dataset.doc;
        const start = parseInt(entity.dataset.start, 10);
        const end = parseInt(entity.dataset.end, 10);
        const status = entity.dataset.status;
        const type = entity.dataset.type;
        const expectedType = entity.dataset.expectedType;
        const source = (window.__evalSources || {})[docName] || '';
        const text = source.slice(start, end);

        const block = [
          'Dokument: ' + docName,
          'Pozycja: ' + start + '-' + end,
          'Status: ' + formatStatus(status, type, expectedType),
          'Tekst: ' + text,
          'Uwaga: ',
          '',
        ].join('\\n');

        try {
          await navigator.clipboard.writeText(block);
          showToast('Skopiowano (' + start + '-' + end + ')');
        } catch (err) {
          console.error('Clipboard write failed:', err);
          showToast('Błąd kopiowania — zobacz konsolę');
        }
      }

      document.addEventListener('click', (e) => {
        const segBtn = e.target.closest('.seg-view-btn');
        if (segBtn) {
          const container = segBtn.closest('.segmentation-view');
          if (!container) return;
          const view = segBtn.dataset.view;
          container.querySelectorAll('.seg-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
          container.querySelectorAll('.seg-view-body').forEach(d => d.classList.toggle('active', d.dataset.view === view));
          return;
        }

        const entity = e.target.closest('.entity');
        if (!entity) return;
        // Skip if user is selecting text (non-empty selection across entity)
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0 && sel.containsNode(entity, true)) return;
        copyPlaceholder(entity);
      });
    })();
  `;
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

const METRIC_VARIANTS = [
  { key: 'f1', label: 'F1' },
  { key: 'precision', label: 'Precision' },
  { key: 'recall', label: 'Recall' },
];

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

  const hasSegMetrics = columns.some(c => c.segF1 != null);
  const segRows = hasSegMetrics
    ? metricRow('Seg F1', c => c.segF1) +
      metricRow('Seg Precision', c => c.segPrecision) +
      metricRow('Seg Recall', c => c.segRecall)
    : '';

  const mainRows =
    metricRow('F1', c => c.f1) +
    metricRow('Precision', c => c.precision) +
    metricRow('Recall', c => c.recall) +
    segRows;

  const mainTable = `<table class="comparison-table">
    <thead><tr><th>Metric</th>${headerCells}</tr></thead>
    <tbody>${mainRows}</tbody>
  </table>`;

  function breakdownBlock(title, rowHeader, entries, getValueFor) {
    if (!entries || !entries.length) return '';
    const body = entries.map(e => metricRow(e.label, col => getValueFor(col, e.key))).join('');
    return `<details class="breakdown">
      <summary>${title}</summary>
      <div class="breakdown-body">
        <table class="comparison-table">
          <thead><tr><th>${rowHeader}</th>${headerCells}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </details>`;
  }

  let breakdowns = '';
  if (docRows && docRows.length) {
    const entries = docRows.map(d => ({ key: d, label: humanizeDocName(d) }));
    for (const { key: metricKey, label: metricLabel } of METRIC_VARIANTS) {
      breakdowns += breakdownBlock(
        `Per Document ${metricLabel}`,
        'Document',
        entries,
        (col, docKey) => col.documents?.[docKey]?.[metricKey] ?? null,
      );
    }
  }
  if (typeRows && typeRows.length) {
    const entries = typeRows.map(t => ({ key: t, label: t }));
    for (const { key: metricKey, label: metricLabel } of METRIC_VARIANTS) {
      breakdowns += breakdownBlock(
        `Per Type ${metricLabel}`,
        'Type',
        entries,
        (col, typeKey) => col.byType?.[typeKey]?.[metricKey] ?? null,
      );
    }
  }

  return `<div class="comparison-section">${mainTable}${breakdowns}</div>`;
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
      <td>${m.fp}${m.tpPartial ? ` <small style="color:#E65100">(${m.tpPartial}p)</small>` : ''}</td>
      <td>${m.fn}${m.tpPartial ? ` <small style="color:#E65100">(${m.tpPartial}p)</small>` : ''}</td>
    </tr>`)
    .join('\n');

  const partialNote = docScores.tpPartial
    ? ` &nbsp;|&nbsp; <span style="color:#E65100">${docScores.tpPartial} partial → FP+FN</span>`
    : '';

  return `
    <p>Precision: <strong>${pct(docScores.precision)}</strong> &nbsp;
       Recall: <strong>${pct(docScores.recall)}</strong> &nbsp;
       F1: <strong>${pct(docScores.f1)}</strong> &nbsp;
       TP: ${docScores.tp} &nbsp; FP: ${docScores.fp} &nbsp; FN: ${docScores.fn}${partialNote}</p>
    <table class="scoring-table">
      <thead><tr><th>Type</th><th>P</th><th>R</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Segmentation section ───────────────────────────────────────────

export function buildSegmentationSection(sourceText, expected, predicted, metrics) {
  if (!expected) {
    return `<p style="font-size:0.85rem;color:#666">No <code>expected-segments.json</code> for this document — run <code>npm run eval:snapshot-segments</code> and review.</p>`;
  }

  const expectedStarts = new Set(expected.map(s => s.start));
  const expectedEnds = new Set(expected.map(s => s.end));
  const predictedStarts = new Set(predicted.map(s => s.start));
  const predictedEnds = new Set(predicted.map(s => s.end));

  const sortedExpected = [...expected].sort((a, b) => a.start - b.start);
  const sortedPredicted = [...predicted].sort((a, b) => a.start - b.start);

  // Collect all boundary positions from both segmentations and classify each.
  // A position present in both sets is a correct boundary (not marked).
  const allBoundaries = new Set([
    ...expectedStarts, ...expectedEnds,
    ...predictedStarts, ...predictedEnds,
  ]);
  allBoundaries.delete(0);
  allBoundaries.delete(sourceText.length);

  const markers = [];
  for (const pos of allBoundaries) {
    const inExpected = expectedStarts.has(pos) || expectedEnds.has(pos);
    const inPredicted = predictedStarts.has(pos) || predictedEnds.has(pos);
    if (inExpected && inPredicted) continue;
    if (inExpected && !inPredicted) {
      markers.push({ pos, kind: 'missed', char: '▼' });
    } else {
      markers.push({ pos, kind: 'extra', char: '▲' });
    }
  }
  markers.sort((a, b) => a.pos - b.pos);

  const expectedHtml = renderSegmentedText(sourceText, sortedExpected, markers);
  const predictedHtml = renderSegmentedText(sourceText, sortedPredicted, markers);

  const m = metrics || { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0, tpPartial: 0 };
  const partialNote = m.tpPartial ? ` <small style="color:#E65100">(${m.tpPartial}p)</small>` : '';

  return `<div class="segmentation-view">
    <div class="seg-view-toolbar" role="tablist">
      <button type="button" class="seg-view-btn active" data-view="expected">Expected</button>
      <button type="button" class="seg-view-btn" data-view="predicted">Predicted</button>
    </div>
    <div class="segmented-text seg-view-body active" data-view="expected">${expectedHtml}</div>
    <div class="segmented-text seg-view-body" data-view="predicted">${predictedHtml}</div>
    <table class="scoring-table segmentation-metrics">
      <thead><tr><th>P</th><th>R</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th><th>Partial</th></tr></thead>
      <tbody><tr>
        <td>${pct(m.precision)}</td>
        <td>${pct(m.recall)}</td>
        <td>${pct(m.f1)}</td>
        <td>${m.tp}</td>
        <td>${m.fp}${partialNote}</td>
        <td>${m.fn}${partialNote}</td>
        <td>${m.tpPartial}</td>
      </tr></tbody>
    </table>
    <p style="font-size:0.82rem;color:#666;margin-top:0.5rem">
      <span style="color:#c62828">▼</span> missed split &nbsp;
      <span style="color:#E65100">▲</span> extra split &nbsp;
      (exact matches are not marked)
    </p>
  </div>`;
}

function renderSegmentedText(sourceText, sortedSegments, markers) {
  // Assign alternating shade per segment, skipping whitespace-only segments
  // so visible content always alternates even when the pipeline emits tiny
  // \n\n segments between sentences.
  const shadeOf = new Map();
  let visibleIdx = 0;
  for (const s of sortedSegments) {
    const text = sourceText.slice(s.start, s.end);
    if (text.replace(/\s/g, '').length === 0) {
      shadeOf.set(s, null);
    } else {
      shadeOf.set(s, visibleIdx % 2 === 0 ? 'seg-a' : 'seg-b');
      visibleIdx++;
    }
  }

  // Collect split points: every segment start/end and every marker pos.
  const points = new Set([0, sourceText.length]);
  for (const s of sortedSegments) { points.add(s.start); points.add(s.end); }
  for (const m of markers) { points.add(m.pos); }
  const sorted = [...points].sort((a, b) => a - b);

  let html = '';
  const segAt = (pos) => sortedSegments.find(s => s.start <= pos && pos < s.end);

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];

    // Marker at `from` (if any). Render before the text chunk.
    const markerHere = markers.find(m => m.pos === from);
    if (markerHere) {
      html += `<span class="boundary-marker ${markerHere.kind}" title="${markerHere.kind} boundary at char ${markerHere.pos}">${markerHere.char}</span>`;
    }

    const chunk = escapeHtml(sourceText.slice(from, to));
    const seg = segAt(from);
    const shade = seg ? shadeOf.get(seg) : null;
    if (seg && shade) {
      html += `<span class="segment ${shade}" data-start="${seg.start}" data-end="${seg.end}">${chunk}</span>`;
    } else {
      html += chunk;
    }
  }
  // Final marker at last position, if any.
  const last = sorted[sorted.length - 1];
  const tailMarker = markers.find(m => m.pos === last);
  if (tailMarker) {
    html += `<span class="boundary-marker ${tailMarker.kind}" title="${tailMarker.kind} boundary at char ${tailMarker.pos}">${tailMarker.char}</span>`;
  }
  return html;
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
      segF1: r.scores.overallSegments?.f1 ?? null,
      segPrecision: r.scores.overallSegments?.precision ?? null,
      segRecall: r.scores.overallSegments?.recall ?? null,
      documents: r.scores.documents,
      byType: r.scores.overall.byType,
    })),
    {
      runId,
      label: currentSummary.label || null,
      f1: scoresData.overall.f1,
      precision: scoresData.overall.precision,
      recall: scoresData.overall.recall,
      segF1: scoresData.overallSegments?.f1 ?? null,
      segPrecision: scoresData.overallSegments?.precision ?? null,
      segRecall: scoresData.overallSegments?.recall ?? null,
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
  const sourceTextsByDoc = {};
  for (const docName of docNames) {
    const docScores = scoresData.documents[docName];

    // Load source text
    let sourceText;
    try {
      sourceText = await readFile(join(DOCS_DIR, `${docName}.txt`), 'utf-8');
    } catch {
      sourceText = `(source text not found for ${docName})`;
    }
    sourceTextsByDoc[docName] = sourceText;

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
      const raw = await readFile(join(DOCS_DIR, `${docName}.expected.json`), 'utf-8');
      expected = JSON.parse(raw);
    } catch {}

    // Classify entities
    const spans = classifyEntities(expected, predicted);
    const annotatedHtml = buildAnnotatedText(sourceText, spans);
    const legendHtml = buildLegend(spans);
    const scoringHtml = buildScoringSection(docScores);

    // Load segments for segmentation view
    let expectedSegs = null;
    let predictedSegs = [];
    try {
      expectedSegs = JSON.parse(
        await readFile(join(DOCS_DIR, `${docName}.expected-segments.json`), 'utf-8'),
      );
    } catch {}
    try {
      predictedSegs = JSON.parse(
        await readFile(join(runDir, docName, 'segments.json'), 'utf-8'),
      );
    } catch {}
    const segmentationHtml = buildSegmentationSection(
      sourceText,
      expectedSegs,
      predictedSegs,
      docScores.segments ?? null,
    );

    // Per-document comparison table
    const docComparisonColumns = comparisonColumns.map(col => ({
      ...col,
      f1: col.documents?.[docName]?.f1 ?? null,
      precision: col.documents?.[docName]?.precision ?? null,
      recall: col.documents?.[docName]?.recall ?? null,
      segF1: col.documents?.[docName]?.segments?.f1 ?? null,
      segPrecision: col.documents?.[docName]?.segments?.precision ?? null,
      segRecall: col.documents?.[docName]?.segments?.recall ?? null,
      byType: col.documents?.[docName]?.byType ?? {},
    }));
    const docTypes = Object.keys(docScores.byType).sort();
    const docComparisonHtml = buildComparisonTable(docComparisonColumns, runId, {
      typeRows: docTypes,
    });

    docSections.push(`
      <details data-doc="${docName}">
        <summary>${humanizeDocName(docName)} ${f1Badge(docScores.f1)}</summary>
        <div>
          <details class="section" open><summary>Annotated Text</summary><div class="section-body">
            <div class="annotated-text">${annotatedHtml}</div>
            ${legendHtml}
          </div></details>
          <details class="section" open><summary>Scoring</summary><div class="section-body">${scoringHtml}</div></details>
          <details class="section"><summary>Segmentation</summary><div class="section-body">${segmentationHtml}</div></details>
          <details class="section"><summary>Comparison</summary><div class="section-body">${docComparisonHtml}</div></details>
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
  <p style="font-size:0.85rem;color:#666;margin-top:-1rem;margin-bottom:1.5rem">
    Strict scoring: only exact boundary matches count as TP. Partial overlaps count as FP+FN.
    ${scoresData.overall.tpPartial ? `(${scoresData.overall.tpPartial} partial matches penalized)` : ''}
  </p>

  <div class="section-title">Overall Comparison</div>
  ${overallComparisonHtml}

  ${docSections.join('\n')}

  <script>window.__evalSources = ${JSON.stringify(sourceTextsByDoc).replace(/</g, '\\u003c')};</script>
  <script>${buildScript()}</script>
</body>
</html>`;

  const outPath = join(runDir, 'report.html');
  await writeFile(outPath, html, 'utf-8');
  return outPath;
}
