import { deanonymizeText, anonymizeText } from './anonymizer.js';
import { createEntitySelector } from './ui/entity-selector.js';
import { createAnnotationEditor } from './ui/annotation-editor/index.js';
import { backfillOccurrencesStep } from './pipeline/steps/backfill.js';
import {
  ENTITY_CATEGORIES,
  ENTITY_LABELS,
  defaultEnabledEntities,
} from './pipeline/configs/entity-sources.js';
import './style.css';
import './ui/annotation-editor/styles.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});

let currentLegend = null;
let currentAnonymized = '';
let configuredOnce = false;
let classifyInFlight = false;
const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';
const LS_KEY = 'pii.selected-entities';

const modelStatus = document.getElementById('model-status');
const anonymizeBtn = document.getElementById('anonymize-btn');
const editTextBtn = document.getElementById('edit-text-btn');
const copyAnonymizedBtn = document.getElementById('copy-anonymized');
const resultSection = document.getElementById('result-section');
const legendTableBody = document.querySelector('#legend-table tbody');
const debugSection = document.getElementById('debug-section');
const debugPanel = document.getElementById('debug-panel');
const deanonymizeSection = document.getElementById('deanonymize-section');
const deanonymizeInput = document.getElementById('deanonymize-input');
const deanonymizeBtn = document.getElementById('deanonymize-btn');
const deanonymizeResultSection = document.getElementById('deanonymize-result-section');
const deanonymizedOutput = document.getElementById('deanonymized-output');
const copyDeanonymizedBtn = document.getElementById('copy-deanonymized');
const selectorRoot = document.getElementById('entity-selector-root');
const workspaceRoot = document.getElementById('workspace-root');

function loadSelectionFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((e) => typeof e === 'string');
  } catch {
    return null;
  }
}

const initialSelection = loadSelectionFromStorage() ?? defaultEnabledEntities();

let configureTimer = null;
function scheduleConfigure(enabledEntities) {
  clearTimeout(configureTimer);
  configureTimer = setTimeout(() => {
    worker.postMessage({ type: 'configure', enabledEntities });
  }, 300);
}

const selector = createEntitySelector(selectorRoot, {
  categories: ENTITY_CATEGORIES,
  labels: ENTITY_LABELS,
  initial: initialSelection,
  onChange(selected) {
    localStorage.setItem(LS_KEY, JSON.stringify(selected));
    updateAnonymizeButton();
    scheduleConfigure(selected);
  },
});

worker.postMessage({ type: 'configure', enabledEntities: selector.getSelected() });

const editor = createAnnotationEditor(workspaceRoot, {
  text: '',
  entities: [],
  entityCategories: ENTITY_CATEGORIES,
  entityLabels: ENTITY_LABELS,
  postEdit(text, entities) {
    return backfillOccurrencesStep({ text, entities }).entities;
  },
  onChange(newEntities) {
    refreshLegendAndAnonymized(editor.getText(), newEntities);
  },
  onModeChange(mode) {
    if (mode === 'annotation') {
      editTextBtn.hidden = false;
      copyAnonymizedBtn.hidden = false;
      anonymizeBtn.hidden = true;
    } else {
      editTextBtn.hidden = true;
      copyAnonymizedBtn.hidden = true;
      anonymizeBtn.hidden = false;
    }
  },
});

function refreshLegendAndAnonymized(text, entities) {
  if (!entities || entities.length === 0) {
    currentLegend = null;
    currentAnonymized = '';
    legendTableBody.innerHTML = '';
    resultSection.hidden = true;
    return;
  }
  const { anonymized, legend } = anonymizeText(text, entities);
  currentLegend = legend;
  currentAnonymized = anonymized;

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
}

function updateAnonymizeButton() {
  const hasSelection = selector.getSelected().length > 0;
  anonymizeBtn.disabled = !hasSelection || !configuredOnce || classifyInFlight;
  if (!hasSelection) {
    modelStatus.textContent = 'Wybierz przynajmniej jedną encję.';
  } else if (!classifyInFlight) {
    modelStatus.textContent = '';
  }
}

worker.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      modelStatus.textContent = `Pobieranie modelu ${msg.file ?? ''}... ${pct}%`;
      break;
    }
    case 'configured':
      configuredOnce = true;
      updateAnonymizeButton();
      break;
    case 'result':
      classifyInFlight = false;
      console.log(`[bench-timing] result t=${performance.now().toFixed(2)}`);
      handleAnonymizationResult(msg);
      updateAnonymizeButton();
      break;
    case 'timing':
      console.log(`[bench-timing] ${msg.mark}${msg.alias ? ' alias=' + msg.alias : ''} t=${msg.t.toFixed(2)}`);
      break;
    case 'error':
      classifyInFlight = false;
      modelStatus.textContent = `Błąd: ${msg.message}`;
      anonymizeBtn.textContent = 'Anonimizuj';
      updateAnonymizeButton();
      break;
  }
};

anonymizeBtn.addEventListener('click', () => {
  const liveText = editor.getText();
  // Snapshot-aware: in text mode, ask the editor whether the text actually changed.
  if (editor.getMode() === 'text') {
    const { changed } = editor.commitTextMode(liveText);
    if (!changed) {
      // Editor flips back to annotation mode itself; no pipeline needed.
      return;
    }
  }
  const text = liveText.trim();
  if (!text) return;
  classifyInFlight = true;
  modelStatus.textContent = 'Analizowanie...';
  anonymizeBtn.textContent = 'Analizowanie...';
  anonymizeBtn.disabled = true;
  worker.postMessage({ type: 'classify', text });
});

editTextBtn.addEventListener('click', () => {
  editor.enterTextMode();
});

copyAnonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(currentAnonymized);
  copyAnonymizedBtn.textContent = 'Skopiowano!';
  setTimeout(() => { copyAnonymizedBtn.textContent = 'Kopiuj zanonimizowany'; }, 2000);
});

function handleAnonymizationResult(msg) {
  const { data: entities, anonymized, legend, debug } = msg;

  // The editor takes the entities; its onChange will rebuild legend/anonymized
  // from the canonical anonymizeText() so they stay in sync after manual edits.
  // We still cache the worker's first-pass values so rendering is consistent
  // even if no edits happen.
  currentLegend = legend;
  currentAnonymized = anonymized;
  editor.setEntities(entities);

  deanonymizeSection.hidden = false;
  deanonymizeResultSection.hidden = true;
  anonymizeBtn.textContent = 'Anonimizuj';

  if (isDebug && debug) {
    renderDebugPanel(debug, anonymized, legend);
    debugSection.hidden = false;
  }
}

function renderDebugPanel(debug, anonymized, legend) {
  debugPanel.innerHTML = '';

  for (const entry of debug) {
    const card = document.createElement('details');
    card.className = 'debug-step';

    const summary = document.createElement('summary');
    const c = entry.changes;
    const parts = [`<strong>${entry.step}</strong> <span class="debug-phase">${entry.phase}</span>`];

    if (c.segments) parts.push(`segmenty +${c.segments.added.length}`);
    if (c.entities) {
      const { added, removed, count } = c.entities;
      const bits = [];
      if (added.length) bits.push(`+${added.length}`);
      if (removed.length) bits.push(`-${removed.length}`);
      bits.push(`(${count.before}\u2192${count.after})`);
      parts.push(`encje ${bits.join(' ')}`);
    }
    if (c.anonymized) parts.push('tekst zanonimizowany zmieniony');
    if (c.legend) parts.push(`legenda +${Object.keys(c.legend.added).length}`);
    if (c.text) parts.push('tekst zmieniony');
    if (Object.keys(c).length === 0) parts.push('<em>brak zmian</em>');

    summary.innerHTML = parts.join(' &middot; ');
    card.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'debug-step-body';

    if (c.entities) {
      if (c.entities.added.length > 0) {
        body.appendChild(makeEntityTable('Dodane', c.entities.added));
      }
      if (c.entities.removed.length > 0) {
        body.appendChild(makeEntityTable('Usunięte', c.entities.removed));
      }
    }

    if (c.segments) {
      const h = document.createElement('h5');
      h.textContent = `Segmenty (${c.segments.count.after})`;
      body.appendChild(h);
      const ul = document.createElement('ul');
      for (const seg of c.segments.added) {
        const li = document.createElement('li');
        li.textContent = `offset ${seg.offset}, ${seg.length} znaków: "${seg.preview}..."`;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    if (c.legend) {
      const h = document.createElement('h5');
      h.textContent = `Legenda (+${Object.keys(c.legend.added).length})`;
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

  let copyBtn = document.getElementById('copy-debug-json');
  if (!copyBtn) {
    copyBtn = document.createElement('button');
    copyBtn.id = 'copy-debug-json';
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = 'Kopiuj JSON debug';
    copyBtn.style.marginTop = '0.5rem';
    debugPanel.appendChild(copyBtn);
  }
  copyBtn.onclick = () => {
    const output = { anonymized, legend, debug };
    navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    copyBtn.textContent = 'Skopiowano!';
    setTimeout(() => { copyBtn.textContent = 'Kopiuj JSON debug'; }, 2000);
  };
}

function makeEntityTable(label, entities) {
  const h = document.createElement('h5');
  h.textContent = `${label} (${entities.length})`;
  const table = document.createElement('table');
  table.className = 'debug-table';
  const thead = document.createElement('tr');
  thead.innerHTML = '<th>Typ</th><th>Tekst</th><th>Zakres</th><th>Pewność</th><th>Źródło</th>';
  table.appendChild(thead);
  for (const e of entities) {
    const row = document.createElement('tr');
    const src = Array.isArray(e.source) ? e.source.join(', ') : (e.source ?? '');
    row.innerHTML = `<td>${escHtml(e.entity_group)}</td><td>${escHtml(e.text)}</td><td>${e.start}-${e.end}</td><td>${e.score?.toFixed(3) ?? ''}</td><td>${escHtml(src)}</td>`;
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

deanonymizeBtn.addEventListener('click', () => {
  const text = deanonymizeInput.value.trim();
  if (!text || !currentLegend) return;
  const result = deanonymizeText(text, currentLegend);
  deanonymizedOutput.textContent = result;
  deanonymizeResultSection.hidden = false;
});

copyDeanonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(deanonymizedOutput.textContent);
  copyDeanonymizedBtn.textContent = 'Skopiowano!';
  setTimeout(() => { copyDeanonymizedBtn.textContent = 'Kopiuj do schowka'; }, 2000);
});

updateAnonymizeButton();

// WebMCP integration
const mcp = new WebMCP({ channelName: 'pii_anonymizer' });
mcp.registerTool(
  'read_anonymized_text',
  'Read the current anonymized text from the PII anonymizer',
  { type: "object", properties: {} },
  () => {
    if (!currentLegend) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: 'No anonymized text available. Run anonymization first.' }) }]
      };
    }
    return {
      content: [{
        type: "text",
        text: currentAnonymized
      }]
    };
  }
);
mcp.registerTool(
  'write_deanonymize_text',
  'Write text to the deanonymize input field; the deanonymized result is shown in the browser but never returned to protect PII',
  {
    type: "object",
    properties: {
      text: { type: "string", description: "Text containing anonymization tokens (e.g. [PERSON_NAME_1])" }
    },
    required: ["text"]
  },
  (args) => {
    if (!currentLegend) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: 'No legend available. Run anonymization first.' }) }]
      };
    }
    const text = args.text;
    deanonymizeInput.value = text;
    const result = deanonymizeText(text, currentLegend);
    deanonymizedOutput.textContent = result;
    deanonymizeResultSection.hidden = false;
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true }) }]
    };
  }
);
