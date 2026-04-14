import { deanonymizeText } from './anonymizer.js';
import './style.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});

let currentLegend = null;
const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';

// --- DOM refs ---
const downloadBtn = document.getElementById('download-btn');
const modelStatus = document.getElementById('model-status');
const inputText = document.getElementById('input-text');
const anonymizeBtn = document.getElementById('anonymize-btn');
const resultSection = document.getElementById('result-section');
const anonymizedOutput = document.getElementById('anonymized-output');
const copyAnonymizedBtn = document.getElementById('copy-anonymized');
const legendTableBody = document.querySelector('#legend-table tbody');
const debugSection = document.getElementById('debug-section');
const debugPanel = document.getElementById('debug-panel');
const deanonymizeSection = document.getElementById('deanonymize-section');
const deanonymizeInput = document.getElementById('deanonymize-input');
const deanonymizeBtn = document.getElementById('deanonymize-btn');
const deanonymizeResultSection = document.getElementById(
  'deanonymize-result-section',
);
const deanonymizedOutput = document.getElementById('deanonymized-output');
const copyDeanonymizedBtn = document.getElementById('copy-deanonymized');

// --- Worker message handler ---
worker.onmessage = (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      modelStatus.textContent = `Downloading model... ${pct}%`;
      break;
    }
    case 'loaded':
      modelStatus.textContent = 'Model ready.';
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Model Loaded';
      anonymizeBtn.disabled = false;
      break;
    case 'error':
      modelStatus.textContent = `Error: ${msg.message}`;
      downloadBtn.disabled = false;
      anonymizeBtn.disabled = false;
      anonymizeBtn.textContent = 'Anonymize';
      break;
    case 'result':
      handleAnonymizationResult(msg);
      break;
  }
};

// --- Download model ---
downloadBtn.addEventListener('click', () => {
  downloadBtn.disabled = true;
  modelStatus.textContent = 'Initializing...';
  worker.postMessage({ type: 'load' });
});

// --- Anonymize ---
anonymizeBtn.addEventListener('click', () => {
  const text = inputText.value.trim();
  if (!text) return;
  anonymizeBtn.disabled = true;
  anonymizeBtn.textContent = 'Analyzing...';
  worker.postMessage({ type: 'classify', text });
});

function handleAnonymizationResult(msg) {
  const { anonymized, legend, debug } = msg;
  currentLegend = legend;

  anonymizedOutput.textContent = anonymized;

  legendTableBody.innerHTML = '';
  for (const [token, value] of Object.entries(legend)) {
    const row = document.createElement('tr');
    const tokenCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = token;
    tokenCell.appendChild(code);
    const valueCell = document.createElement('td');
    valueCell.textContent = value;
    row.appendChild(tokenCell);
    row.appendChild(valueCell);
    legendTableBody.appendChild(row);
  }

  resultSection.hidden = false;
  deanonymizeSection.hidden = false;
  deanonymizeResultSection.hidden = true;
  anonymizeBtn.disabled = false;
  anonymizeBtn.textContent = 'Anonymize';

  // Debug panel
  if (isDebug && debug) {
    renderDebugPanel(debug, anonymized, legend);
    debugSection.hidden = false;
  }
}

// --- Debug panel ---
function renderDebugPanel(debug, anonymized, legend) {
  debugPanel.innerHTML = '';

  for (const entry of debug) {
    const card = document.createElement('details');
    card.className = 'debug-step';

    const summary = document.createElement('summary');
    const c = entry.changes;
    const parts = [`<strong>${entry.step}</strong> <span class="debug-phase">${entry.phase}</span>`];

    if (c.segments) parts.push(`segments +${c.segments.added.length}`);
    if (c.entities) {
      const { added, removed, count } = c.entities;
      const bits = [];
      if (added.length) bits.push(`+${added.length}`);
      if (removed.length) bits.push(`-${removed.length}`);
      bits.push(`(${count.before}\u2192${count.after})`);
      parts.push(`entities ${bits.join(' ')}`);
    }
    if (c.anonymized) parts.push('anonymized changed');
    if (c.legend) parts.push(`legend +${Object.keys(c.legend.added).length}`);
    if (c.text) parts.push('text changed');
    if (Object.keys(c).length === 0) parts.push('<em>no changes</em>');

    summary.innerHTML = parts.join(' &middot; ');
    card.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'debug-step-body';

    if (c.entities) {
      if (c.entities.added.length > 0) {
        body.appendChild(makeEntityTable('Added', c.entities.added));
      }
      if (c.entities.removed.length > 0) {
        body.appendChild(makeEntityTable('Removed', c.entities.removed));
      }
    }

    if (c.segments) {
      const h = document.createElement('h5');
      h.textContent = `Segments (${c.segments.count.after})`;
      body.appendChild(h);
      const ul = document.createElement('ul');
      for (const seg of c.segments.added) {
        const li = document.createElement('li');
        li.textContent = `offset ${seg.offset}, ${seg.length} chars: "${seg.preview}..."`;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    if (c.legend) {
      const h = document.createElement('h5');
      h.textContent = `Legend (+${Object.keys(c.legend.added).length})`;
      body.appendChild(h);
      const table = document.createElement('table');
      table.className = 'debug-table';
      for (const [token, value] of Object.entries(c.legend.added)) {
        const row = document.createElement('tr');
        row.innerHTML = `<td><code>${escHtml(token)}</code></td><td>${escHtml(value)}</td>`;
        table.appendChild(row);
      }
      body.appendChild(table);
    }

    card.appendChild(body);
    debugPanel.appendChild(card);
  }

  // Copy full debug JSON button
  let copyBtn = document.getElementById('copy-debug-json');
  if (!copyBtn) {
    copyBtn = document.createElement('button');
    copyBtn.id = 'copy-debug-json';
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = 'Copy Debug JSON';
    copyBtn.style.marginTop = '0.5rem';
    debugPanel.appendChild(copyBtn);
  }
  copyBtn.onclick = () => {
    const output = { anonymized, legend, debug };
    navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy Debug JSON'; }, 2000);
  };
}

function makeEntityTable(label, entities) {
  const h = document.createElement('h5');
  h.textContent = `${label} (${entities.length})`;
  const table = document.createElement('table');
  table.className = 'debug-table';
  const thead = document.createElement('tr');
  thead.innerHTML = '<th>Type</th><th>Text</th><th>Span</th><th>Score</th>';
  table.appendChild(thead);
  for (const e of entities) {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escHtml(e.entity_group)}</td><td>${escHtml(e.text)}</td><td>${e.start}-${e.end}</td><td>${e.score?.toFixed(3) ?? ''}</td>`;
    table.appendChild(row);
  }
  const frag = document.createDocumentFragment();
  frag.appendChild(h);
  frag.appendChild(table);
  return frag;
}

function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// --- Copy anonymized ---
copyAnonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(anonymizedOutput.textContent);
  copyAnonymizedBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyAnonymizedBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});

// --- De-anonymize ---
deanonymizeBtn.addEventListener('click', () => {
  const text = deanonymizeInput.value.trim();
  if (!text || !currentLegend) return;
  const result = deanonymizeText(text, currentLegend);
  deanonymizedOutput.textContent = result;
  deanonymizeResultSection.hidden = false;
});

// --- Copy de-anonymized ---
copyDeanonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(deanonymizedOutput.textContent);
  copyDeanonymizedBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyDeanonymizedBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});
