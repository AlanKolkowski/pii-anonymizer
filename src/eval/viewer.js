import { createServer } from 'node:http';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  classifyEntities,
  buildAnnotatedText,
  buildLegend,
  buildCss,
  buildScript,
  humanizeDocName,
  buildSegmentationSection,
} from './report.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const DOCS_DIR = join(TEST_DATA_DIR, 'synthetic');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');
const PORT = parseInt(process.env.PORT ?? '4317', 10);

function pct(v) { return (v * 100).toFixed(1) + '%'; }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDelta(baseVal, newVal) {
  if (baseVal == null || newVal == null) return '';
  const diff = (newVal - baseVal) * 100;
  if (Math.abs(diff) < 0.05) return ` <span class="delta-zero">=</span>`;
  const sign = diff > 0 ? '+' : '';
  const cls = diff > 0 ? 'delta-pos' : 'delta-neg';
  return ` <span class="${cls}">${sign}${diff.toFixed(1)}pp</span>`;
}

function f1Badge(f1) {
  const cls = f1 >= 0.9 ? 'green' : f1 >= 0.7 ? 'yellow' : 'red';
  return `<span class="f1-badge ${cls}">F1: ${pct(f1)}</span>`;
}

// ── Data loading ───────────────────────────────────────────────────

async function listRuns() {
  const entries = await readdir(RESULTS_DIR);
  const runs = [];
  for (const entry of entries) {
    if (entry === 'latest' || entry === 'baseline') continue;
    try {
      const [scoresRaw, summaryRaw] = await Promise.all([
        readFile(join(RESULTS_DIR, entry, 'scores.json'), 'utf-8'),
        readFile(join(RESULTS_DIR, entry, 'summary.json'), 'utf-8'),
      ]);
      const summary = JSON.parse(summaryRaw);
      runs.push({
        runId: entry,
        label: summary.label || null,
        timestamp: summary.timestamp || null,
        scores: JSON.parse(scoresRaw),
      });
    } catch {
      // No scores yet or missing files — skip
    }
  }
  runs.sort((a, b) => a.runId.localeCompare(b.runId));

  let baselineId = null;
  try { baselineId = await readlink(join(RESULTS_DIR, 'baseline')); } catch {}
  let latestId = null;
  try { latestId = await readlink(join(RESULTS_DIR, 'latest')); } catch {}
  return { runs, baselineId, latestId };
}

async function loadPredicted(runId, docName) {
  try {
    const raw = await readFile(join(RESULTS_DIR, runId, docName, 'entities.json'), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function loadPredictedSegments(runId, docName) {
  try {
    const raw = await readFile(join(RESULTS_DIR, runId, docName, 'segments.json'), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function loadSource(docName) {
  let text = '';
  let expected = [];
  let expectedSegments = null;
  try { text = await readFile(join(DOCS_DIR, `${docName}.txt`), 'utf-8'); } catch {}
  try { expected = JSON.parse(await readFile(join(DOCS_DIR, `${docName}.expected.json`), 'utf-8')); } catch {}
  try { expectedSegments = JSON.parse(await readFile(join(DOCS_DIR, `${docName}.expected-segments.json`), 'utf-8')); } catch {}
  return { text, expected, expectedSegments };
}

// ── Comparison table with baseline-relative deltas ────────────────

const METRIC_VARIANTS = [
  { key: 'f1', label: 'F1' },
  { key: 'precision', label: 'Precision' },
  { key: 'recall', label: 'Recall' },
];

function buildComparisonTable(columns, baselineId, { docRows = null, typeRows = null } = {}) {
  const baseline = columns.find(c => c.runId === baselineId);

  function metricRow(label, getValue) {
    const baseVal = baseline ? getValue(baseline) : null;
    const cells = columns.map(col => {
      const val = getValue(col);
      let content = val != null ? pct(val) : '–';
      if (col.runId !== baselineId) {
        content += formatDelta(baseVal, val);
      }
      return `<td>${content}</td>`;
    }).join('');
    return `<tr><td><strong>${escapeHtml(label)}</strong></td>${cells}</tr>`;
  }

  const headerCells = columns.map(c => {
    const isBase = c.runId === baselineId;
    const highlight = isBase ? ' style="background:#fff3e0" title="baseline"' : '';
    const label = c.label
      ? `${escapeHtml(c.runId)}<br><small>${escapeHtml(c.label)}</small>`
      : escapeHtml(c.runId);
    const badge = isBase ? ' <sup style="color:#E65100">★</sup>' : '';
    return `<th${highlight}>${label}${badge}</th>`;
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
      <summary>${escapeHtml(title)}</summary>
      <div class="breakdown-body">
        <table class="comparison-table">
          <thead><tr><th>${escapeHtml(rowHeader)}</th>${headerCells}</tr></thead>
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
    if (hasSegMetrics) {
      for (const { key: metricKey, label: metricLabel } of METRIC_VARIANTS) {
        breakdowns += breakdownBlock(
          `Per Document Seg ${metricLabel}`,
          'Document',
          entries,
          (col, docKey) => col.documents?.[docKey]?.segments?.[metricKey] ?? null,
        );
      }
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

// ── Dynamic report rendering ───────────────────────────────────────

async function renderReport(runIds, baselineId) {
  const { runs } = await listRuns();
  const selectedRuns = runIds.map(id => runs.find(r => r.runId === id)).filter(Boolean);

  if (selectedRuns.length === 0) {
    return { html: `<p style="padding:2rem;color:#666">Select at least one run from the sidebar.</p>`, sourceTextsByDoc: {} };
  }

  if (!baselineId || !selectedRuns.some(r => r.runId === baselineId)) {
    baselineId = selectedRuns[selectedRuns.length - 1].runId;
  }

  const docSet = new Set();
  const typeSet = new Set();
  for (const r of selectedRuns) {
    for (const d of Object.keys(r.scores.documents || {})) docSet.add(d);
    for (const t of Object.keys(r.scores.overall?.byType || {})) typeSet.add(t);
  }
  const docNames = [...docSet].sort();
  const allTypes = [...typeSet].sort();

  const columns = selectedRuns.map(r => ({
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
  }));

  const overallTable = buildComparisonTable(columns, baselineId, { docRows: docNames, typeRows: allTypes });
  const baselineRun = selectedRuns.find(r => r.runId === baselineId);
  const overall = baselineRun.scores.overall;

  const bigMetrics = `
    <div class="big-metrics">
      <div class="big-metric"><div class="value">${pct(overall.f1)}</div><div class="label">F1 (baseline)</div></div>
      <div class="big-metric"><div class="value">${pct(overall.precision)}</div><div class="label">Precision</div></div>
      <div class="big-metric"><div class="value">${pct(overall.recall)}</div><div class="label">Recall</div></div>
    </div>`;

  // Per-document sections with per-run tabs
  const sections = [];
  const sourceTextsByDoc = {};

  const defaultTabId = selectedRuns[selectedRuns.length - 1].runId;

  for (const docName of docNames) {
    const { text, expected, expectedSegments } = await loadSource(docName);
    sourceTextsByDoc[docName] = text;

    const tabs = [];
    const panes = [];

    for (const r of selectedRuns) {
      const isBase = r.runId === baselineId;
      const isActive = r.runId === defaultTabId;
      const predicted = await loadPredicted(r.runId, docName);
      const predictedSegments = await loadPredictedSegments(r.runId, docName);
      const docScore = r.scores.documents?.[docName];

      let paneBody;
      if (predicted == null && !docScore) {
        paneBody = `<p><em>No data for this document in this run.</em></p>`;
      } else {
        const preds = predicted || [];
        for (const e of preds) if (!e.text) e.text = text.slice(e.start, e.end);
        const spans = classifyEntities(expected, preds);
        const annotated = buildAnnotatedText(text, spans);
        const legend = buildLegend(spans);
        const scoringLine = docScore
          ? `<p style="margin-bottom:0.75rem">P: <strong>${pct(docScore.precision)}</strong> &nbsp; R: <strong>${pct(docScore.recall)}</strong> &nbsp; F1: <strong>${pct(docScore.f1)}</strong> &nbsp; TP: ${docScore.tp} &nbsp; FP: ${docScore.fp} &nbsp; FN: ${docScore.fn}${docScore.tpPartial ? ` &nbsp; <span style="color:#E65100">${docScore.tpPartial} partial</span>` : ''}</p>`
          : '';
        const segmentationHtml = buildSegmentationSection(
          text,
          expectedSegments,
          predictedSegments || [],
          docScore?.segments ?? null,
        );
        paneBody = `${scoringLine}
          <details class="section"><summary>Annotated Text</summary><div class="section-body">
            <div class="annotated-text">${annotated}</div>
            ${legend}
          </div></details>
          <details class="section"><summary>Segmentation</summary><div class="section-body">${segmentationHtml}</div></details>`;
      }

      const tabInner = r.label
        ? `<span class="tab-id">${escapeHtml(r.runId)}</span><span class="tab-label">${escapeHtml(r.label)}</span>`
        : `<span class="tab-id">${escapeHtml(r.runId)}</span>`;
      const star = isBase ? '<span class="tab-star">★</span>' : '';
      tabs.push(`<button class="tab-btn${isActive ? ' active' : ''}" data-run="${escapeHtml(r.runId)}" type="button">${tabInner}${star}</button>`);
      panes.push(`<div class="tab-pane${isActive ? ' active' : ''}" data-run="${escapeHtml(r.runId)}">${paneBody}</div>`);
    }

    // Per-doc comparison table
    const docColumns = columns.map(col => ({
      ...col,
      f1: col.documents?.[docName]?.f1 ?? null,
      precision: col.documents?.[docName]?.precision ?? null,
      recall: col.documents?.[docName]?.recall ?? null,
      segF1: col.documents?.[docName]?.segments?.f1 ?? null,
      segPrecision: col.documents?.[docName]?.segments?.precision ?? null,
      segRecall: col.documents?.[docName]?.segments?.recall ?? null,
      byType: col.documents?.[docName]?.byType ?? {},
    }));
    const docTypeSet = new Set();
    for (const r of selectedRuns) {
      const bt = r.scores.documents?.[docName]?.byType || {};
      for (const t of Object.keys(bt)) docTypeSet.add(t);
    }
    const docComparison = buildComparisonTable(docColumns, baselineId, { typeRows: [...docTypeSet].sort() });

    const baselineF1 = baselineRun.scores.documents?.[docName]?.f1 ?? 0;
    sections.push(`
      <details data-doc="${escapeHtml(docName)}">
        <summary>${humanizeDocName(docName)} ${f1Badge(baselineF1)}</summary>
        <div>
          <div class="tabs-bar">${tabs.join('')}</div>
          <div class="tab-panes">${panes.join('')}</div>
          <details class="section"><summary>Comparison</summary><div class="section-body">${docComparison}</div></details>
        </div>
      </details>
    `);
  }

  const html = `
    ${bigMetrics}
    <p style="font-size:0.85rem;color:#666;margin-top:-1rem;margin-bottom:1.5rem">
      Strict scoring. Deltas are relative to baseline <code>${escapeHtml(baselineId)}</code>.
    </p>
    <div class="section-title">Overall Comparison</div>
    ${overallTable}
    ${sections.join('\n')}
  `;

  return { html, sourceTextsByDoc, baselineId };
}

// ── HTML shell ─────────────────────────────────────────────────────

function buildShell(runs, baselineId, latestId) {
  const recent5 = new Set(runs.slice(-5).map(r => r.runId));
  const initialBaseline = baselineId || latestId || (runs.length ? runs[runs.length - 1].runId : null);

  const runItems = runs.map(r => {
    const defaultChecked = recent5.has(r.runId) || r.runId === baselineId;
    const isBaseline = r.runId === initialBaseline;
    const tsShort = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 16).replace('T', ' ') : '';
    return `<label class="run-item">
      <input type="checkbox" class="run-check" value="${escapeHtml(r.runId)}"${defaultChecked ? ' checked' : ''}>
      <input type="radio" name="baseline" class="run-baseline" value="${escapeHtml(r.runId)}"${isBaseline ? ' checked' : ''}>
      <span class="run-info">
        <span class="run-id">${escapeHtml(r.runId)}</span>
        ${r.label ? `<span class="run-label">${escapeHtml(r.label)}</span>` : ''}
        ${tsShort ? `<span class="run-ts">${escapeHtml(tsShort)}</span>` : ''}
      </span>
    </label>`;
  }).join('\n');

  const viewerCss = `
    body { max-width: none; padding: 0; display: grid; grid-template-columns: 340px 1fr; min-height: 100vh; background: #f5f5f5; }
    .sidebar { padding: 1rem; border-right: 1px solid #ddd; background: white; overflow-y: auto; max-height: 100vh; position: sticky; top: 0; }
    .main { padding: 1.5rem 2rem; max-width: 1200px; }
    .sidebar h1 { font-size: 1rem; margin-bottom: 0.75rem; }
    .sidebar h2 { font-size: 0.75rem; text-transform: uppercase; color: #666; margin: 0.75rem 0 0.4rem; letter-spacing: 0.05em; }
    .toolbar { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
    .toolbar button { font-size: 0.72rem; padding: 0.2rem 0.5rem; border: 1px solid #ccc; border-radius: 3px; background: white; cursor: pointer; }
    .toolbar button:hover { background: #f0f0f0; }
    .run-item { display: grid; grid-template-columns: auto auto 1fr; gap: 0.4rem; align-items: center; padding: 0.35rem 0.2rem; font-size: 0.78rem; border-bottom: 1px solid #f2f2f2; cursor: pointer; }
    .run-item:hover { background: #fafafa; }
    .run-info { display: flex; flex-direction: column; min-width: 0; }
    .run-id { font-family: "SF Mono", Menlo, monospace; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; }
    .run-label { color: #1976d2; font-size: 0.72rem; font-style: italic; }
    .run-ts { color: #999; font-size: 0.68rem; }
    .sidebar .meta { font-size: 0.72rem; color: #666; padding-top: 0.75rem; margin-top: 0.75rem; border-top: 1px solid #eee; }
    .sidebar .meta code { background: #f5f5f5; padding: 0 0.25rem; border-radius: 2px; }
    .tabs-bar { display: flex; gap: 0.2rem; margin-bottom: 0.75rem; border-bottom: 1px solid #ddd; flex-wrap: wrap; }
    .tab-btn { padding: 0.35rem 0.7rem; background: #f5f5f5; border: 1px solid #ddd; border-bottom: none; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 0.74rem; font-family: "SF Mono", Menlo, monospace; display: inline-flex; align-items: center; gap: 0.4rem; }
    .tab-btn .tab-label { color: #1976d2; font-style: italic; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .tab-btn.active .tab-label { color: #0d47a1; }
    .tab-btn .tab-star { color: #E65100; }
    .tab-btn:hover { background: #eee; }
    .tab-btn.active { background: white; font-weight: 600; color: #1976d2; border-color: #1976d2; position: relative; top: 1px; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    #content.loading { opacity: 0.5; pointer-events: none; }
    .empty { padding: 2rem; color: #666; text-align: center; }
    .comparison-section > .comparison-table { margin-bottom: 0.5rem; }
    details.breakdown { margin: 0.4rem 0 0; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 4px; box-shadow: none; }
    details.breakdown > summary { padding: 0.4rem 0.75rem; font-size: 0.82rem; font-weight: 600; color: #444; }
    details.breakdown[open] > summary { border-bottom: 1px solid #eee; }
    details.breakdown > div.breakdown-body { padding: 0.25rem 0.5rem 0.5rem; }
    details.breakdown .comparison-table { margin-bottom: 0; font-size: 0.82rem; }
  `;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eval Viewer</title>
  <style>${buildCss()}${viewerCss}</style>
</head>
<body>
  <aside class="sidebar">
    <h1>Eval Viewer</h1>
    <div class="toolbar">
      <button type="button" id="select-all">All</button>
      <button type="button" id="select-none">None</button>
      <button type="button" id="select-recent">Recent 5</button>
    </div>
    <h2>Runs <small style="color:#999;font-weight:normal;text-transform:none">(✓ show, ● baseline)</small></h2>
    <div class="runs">${runItems}</div>
    <div class="meta">
      <div>baseline → <code>${escapeHtml(baselineId || '(none)')}</code></div>
      <div>latest → <code>${escapeHtml(latestId || '(none)')}</code></div>
    </div>
  </aside>
  <main class="main">
    <div id="content" class="empty">Loading…</div>
  </main>
  <script>
    const content = document.getElementById('content');

    function ensureBaselineChecked() {
      const baselineRadio = document.querySelector('.run-baseline:checked');
      if (!baselineRadio) return;
      const cb = document.querySelector('.run-check[value="' + CSS.escape(baselineRadio.value) + '"]');
      if (cb && !cb.checked) cb.checked = true;
    }

    function ensureSomeBaseline() {
      const baselineRadio = document.querySelector('.run-baseline:checked');
      const checkedRuns = [...document.querySelectorAll('.run-check:checked')];
      if (checkedRuns.length === 0) return;
      if (!baselineRadio || !checkedRuns.some(c => c.value === baselineRadio.value)) {
        const last = checkedRuns[checkedRuns.length - 1];
        const radio = document.querySelector('.run-baseline[value="' + CSS.escape(last.value) + '"]');
        if (radio) radio.checked = true;
      }
    }

    async function refresh() {
      ensureBaselineChecked();
      ensureSomeBaseline();
      const runs = [...document.querySelectorAll('.run-check:checked')].map(i => i.value);
      const baseline = document.querySelector('.run-baseline:checked')?.value;
      if (runs.length === 0) {
        content.className = 'empty';
        content.innerHTML = '<p>Select at least one run.</p>';
        return;
      }
      content.classList.add('loading');
      const params = new URLSearchParams();
      for (const r of runs) params.append('run', r);
      if (baseline) params.set('baseline', baseline);
      try {
        const resp = await fetch('/api/report?' + params.toString());
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        window.__evalSources = data.sourceTextsByDoc || {};
        content.className = '';
        content.innerHTML = data.html;
      } catch (err) {
        content.className = 'empty';
        content.innerHTML = '<p style="color:#c62828">Error: ' + err.message + '</p>';
      }
    }

    document.addEventListener('change', (e) => {
      if (e.target.matches('.run-check, .run-baseline')) refresh();
    });

    document.addEventListener('click', (e) => {
      if (e.target.matches('#select-all')) {
        document.querySelectorAll('.run-check').forEach(i => i.checked = true);
        refresh();
      } else if (e.target.matches('#select-none')) {
        document.querySelectorAll('.run-check').forEach(i => i.checked = false);
        refresh();
      } else if (e.target.matches('#select-recent')) {
        const all = [...document.querySelectorAll('.run-check')];
        all.forEach(i => i.checked = false);
        all.slice(-5).forEach(i => i.checked = true);
        refresh();
      } else {
        const tabBtn = e.target.closest('.tab-btn');
        if (tabBtn) {
          const bar = tabBtn.closest('.tabs-bar');
          const runId = tabBtn.dataset.run;
          bar.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
          const panes = bar.parentElement.querySelector('.tab-panes');
          panes.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.run === runId));
        }
      }
    });

    refresh();
  </script>
  <script>${buildScript()}</script>
</body>
</html>`;
}

// ── HTTP server ────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const { runs, baselineId, latestId } = await listRuns();
      if (runs.length === 0) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
          <h1>No scored runs found</h1>
          <p>Run <code>npm run eval</code> then <code>npm run eval:score</code> first.</p>
        </body></html>`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildShell(runs, baselineId, latestId));
      return;
    }
    if (url.pathname === '/api/report') {
      const runIds = url.searchParams.getAll('run');
      const baseline = url.searchParams.get('baseline');
      const result = await renderReport(runIds, baseline);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('Viewer error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Eval viewer: http://localhost:${PORT}`);
});
