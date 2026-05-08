import { deanonymizeText, anonymizeText, buildTokenMapMulti, applyTokens } from './anonymizer.js';
import { createEntitySelector } from './ui/entity-selector.js';
import { createWorkspace } from './ui/workspace/index.js';
import { createSourcesList } from './ui/sources-list/index.js';
import { createOutcomesList } from './ui/outcomes-list/index.js';
import { extractText } from './file-import/index.js';
import { backfillOccurrencesStep } from './pipeline/steps/backfill.js';
import {
  ENTITY_CATEGORIES,
  ENTITY_LABELS,
  SOURCES,
  defaultEnabledEntities,
  requiredSources,
} from './pipeline/configs/entity-sources.js';
import './style.css';
import './ui/annotation-editor/styles.css';
import './ui/workspace/styles.css';
import './ui/sources-list/styles.css';
import './ui/outcomes-list/styles.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});

const sources = [];
const outcomes = [];
let legend = {};
let seen = {};
let lastRun = null;
const inFlightSourceIds = new Set();
let configuredOnce = false;
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';
const backendOverride = urlParams.get('backend');
const LS_KEY = 'pii.selected-entities';

function isAnyClassifyInFlight() { return inFlightSourceIds.size > 0; }

const anonymizeBtns = document.querySelectorAll('[data-action="anonymize"]');
const modelStatusEls = document.querySelectorAll('[data-status="model"]');

function setHidden(els, hidden) { els.forEach(el => { el.hidden = hidden; }); }
function setDisabled(els, disabled) { els.forEach(el => { el.disabled = disabled; }); }
function setText(els, text) { els.forEach(el => { el.textContent = text; }); }

const resultSection = document.getElementById('result-section');
const legendTableBody = document.querySelector('#legend-table tbody');
const debugSection = document.getElementById('debug-section');
const debugPanel = document.getElementById('debug-panel');
const outcomesSection = document.getElementById('outcomes-section');
const selectorRoot = document.getElementById('entity-selector-root');
const sourcesListRoot = document.getElementById('sources-list-root');
const outcomesListRoot = document.getElementById('outcomes-list-root');
const webnnHint = document.getElementById('webnn-hint');
const webnnHintTrigger = document.getElementById('webnn-hint-trigger');
const webnnHintPanel = document.getElementById('webnn-hint-panel');
const webnnHintClose = document.getElementById('webnn-hint-close');

// Show the hint only when:
//   - the browser doesn't expose WebNN, AND
//   - the user hasn't explicitly forced WASM via URL (they know what they're doing), AND
//   - at least one required source for the current entity selection actually
//     supports webnn-gpu — no point nagging when the user only enabled q8-backed types.
const webnnSupported = 'ml' in navigator;

function shouldShowWebnnHint(enabledEntities) {
  if (webnnSupported) return false;
  if (backendOverride === 'wasm') return false;
  return requiredSources(enabledEntities).some((alias) => {
    const def = SOURCES[alias];
    return def?.kind === 'hf' && def.backends?.includes('webnn-gpu');
  });
}

function setWebnnPanelOpen(open) {
  webnnHintPanel.hidden = !open;
  webnnHintTrigger.setAttribute('aria-expanded', String(open));
}

function updateWebnnHint(enabledEntities) {
  const show = shouldShowWebnnHint(enabledEntities);
  webnnHint.hidden = !show;
  document.body.classList.toggle('has-webnn-hint', show);
  if (!show) setWebnnPanelOpen(false);
}

webnnHintTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  setWebnnPanelOpen(webnnHintPanel.hidden);
});

webnnHintClose.addEventListener('click', () => {
  setWebnnPanelOpen(false);
});

// Click outside the panel closes it.
document.addEventListener('click', (e) => {
  if (webnnHint.hidden || webnnHintPanel.hidden) return;
  if (!webnnHint.contains(e.target)) setWebnnPanelOpen(false);
});

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
    worker.postMessage({ type: 'configure', enabledEntities, backend: backendOverride ?? 'auto' });
  }, 300);
}

const selector = createEntitySelector(selectorRoot, {
  categories: ENTITY_CATEGORIES,
  labels: ENTITY_LABELS,
  initial: initialSelection,
  onChange(selected) {
    localStorage.setItem(LS_KEY, JSON.stringify(selected));
    refreshAnonymizeButton();
    updateWebnnHint(selected);
    scheduleConfigure(selected);
  },
});

updateWebnnHint(initialSelection);

worker.postMessage({ type: 'configure', enabledEntities: selector.getSelected(), backend: backendOverride ?? 'auto' });

const ocrWarm = urlParams.get('ocr') === 'warm';
if (ocrWarm) {
  import('./ocr/index.js').then(({ getWorkerBackedOcr }) => {
    const ocr = getWorkerBackedOcr();
    ocr.init?.();
  });
}

const sourcesList = createSourcesList(sourcesListRoot, {
  entityCategories: ENTITY_CATEGORIES,
  entityLabels: ENTITY_LABELS,
  postEdit(text, entities) {
    return backfillOccurrencesStep({ text, entities }).entities;
  },
  onAddPaste() {
    const id = crypto.randomUUID();
    const label = nextPasteLabel();
    sources.push({
      id, label, text: '', entities: [], meta: null, status: 'idle', error: null,
    });
    sourcesList.addSource(id, label, { text: '', entities: [], status: 'idle' });
    sourcesList.enterTextMode(id);
    refreshAnonymizeButton();
  },
  async onAddFiles(files) {
    for (const file of files) await addSourceFromFile(file);
  },
  onRemove(id) {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const removed = sources[idx];
    if (removed.status === 'ready' && removed.entities.length > 0) {
      const ok = window.confirm(`Usunąć "${removed.label}"?`);
      if (!ok) return;
    }
    sources.splice(idx, 1);
    sourcesList.removeSource(id);
    refreshLegend();
    refreshAnonymizeButton();
  },
  onRename(id, label) {
    const s = sources.find((x) => x.id === id);
    if (s) s.label = label;
  },
  onAnnotationChange(id, entities) {
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    s.entities = entities;
    refreshLegend();
  },
  onModeChange() { refreshAnonymizeButton(); },
});

const outcomesList = createOutcomesList(outcomesListRoot, {
  onRemove(id) {
    const idx = outcomes.findIndex((o) => o.id === id);
    if (idx === -1) return;
    outcomes.splice(idx, 1);
    outcomesList.removeOutcome(id);
    if (outcomes.length === 0) outcomesSection.hidden = true;
  },
});

function nextPasteLabel() {
  const used = sources
    .map((s) => /^Wklejony tekst (\d+)$/.exec(s.label)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return `Wklejony tekst ${next}`;
}

async function addSourceFromFile(file) {
  const id = crypto.randomUUID();
  const label = file.name || `Plik ${sources.length + 1}`;
  sources.push({
    id, label, text: '', entities: [], meta: null, status: 'pending', error: null,
  });
  sourcesList.addSource(id, label, { text: '', entities: [], status: 'pending' });
  try {
    const { text, meta } = await extractText(file);
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    s.text = text;
    s.meta = meta;
    s.status = 'idle';
    s.error = null;
    sourcesList.setSourceText(id, text);
    sourcesList.setSourceStatus(id, 'idle');
  } catch (err) {
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    s.status = 'error';
    s.error = err.message;
    sourcesList.setSourceStatus(id, 'error', err.message);
  }
  refreshAnonymizeButton();
}

function refreshLegend() {
  const ready = sources.filter((s) => s.status === 'ready' && s.entities.length > 0);
  if (ready.length === 0) {
    legend = {};
    seen = {};
    legendTableBody.innerHTML = '';
    resultSection.hidden = true;
    outcomesList.refreshLegend({});
    return;
  }
  const built = buildTokenMapMulti(
    ready.map((s) => ({ text: s.text, entities: s.entities })),
  );
  seen = built.seen;
  legend = built.legend;

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
  outcomesList.refreshLegend(legend);
}

function anonymizedTextFor(sourceId) {
  const s = sources.find((x) => x.id === sourceId);
  if (!s || s.status !== 'ready') return null;
  return applyTokens(s.text, s.entities, seen);
}

function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function refreshAnonymizeButton() {
  const hasSelection = selector.getSelected().length > 0;
  const hasAnyText = sources.some((s) => (s.text ?? '').trim().length > 0);
  const blocked = !configuredOnce || isAnyClassifyInFlight();
  setDisabled(anonymizeBtns, blocked || !hasSelection || !hasAnyText);
  if (!hasSelection) setText(modelStatusEls, 'Wybierz przynajmniej jedną encję.');
  else if (!isAnyClassifyInFlight()) setText(modelStatusEls, '');
}

worker.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      setText(modelStatusEls, `Pobieranie modelu ${msg.file ?? ''}... ${pct}%`);
      break;
    }
    case 'backend-resolved':
      console.log(`[main] WebNN ${msg.webnnAvailable ? 'available — fp32 models will run on GPU' : 'unavailable — all models on WASM'} (requested=${msg.requested})`);
      break;
    case 'configured':
      configuredOnce = true;
      refreshAnonymizeButton();
      break;
    case 'result': {
      console.log(`[bench-timing] result t=${performance.now().toFixed(2)}`);
      const id = msg.id;
      const s = sources.find((x) => x.id === id);
      if (s) {
        s.entities = msg.data;
        s.status = 'ready';
        s.error = null;
        sourcesList.setSourceEntities(id, msg.data);
        sourcesList.setSourceStatus(id, 'ready');
      }
      inFlightSourceIds.delete(id);
      refreshLegend();
      if (isDebug && msg.debug) {
        renderDebugPanel(msg.debug, msg.anonymized, msg.legend);
        debugSection.hidden = false;
      }
      if (!isAnyClassifyInFlight()) {
        const allEmpty = sources.every((x) => x.entities.length === 0);
        if (allEmpty) {
          setText(modelStatusEls, 'Nie znaleziono żadnych danych osobowych w tekście.');
        } else {
          setText(modelStatusEls, '');
        }
        lastRun = {
          texts: new Map(sources.map((x) => [x.id, x.text])),
          enabledEntities: [...selector.getSelected()].sort(),
        };
        setText(anonymizeBtns, 'Anonimizuj');
      } else {
        setText(modelStatusEls, `Analizowanie ${sources.length - inFlightSourceIds.size}/${sources.length}…`);
      }
      refreshAnonymizeButton();
      break;
    }
    case 'timing':
      console.log(`[bench-timing] ${msg.mark}${msg.alias ? ' alias=' + msg.alias : ''} t=${msg.t.toFixed(2)}`);
      break;
    case 'error': {
      const id = msg.id;
      const s = id ? sources.find((x) => x.id === id) : null;
      if (s) {
        s.status = 'error';
        s.error = msg.message;
        sourcesList.setSourceStatus(id, 'error', msg.message);
      }
      if (id) inFlightSourceIds.delete(id);
      if (!isAnyClassifyInFlight()) setText(anonymizeBtns, 'Anonimizuj');
      setText(modelStatusEls, `Błąd: ${msg.message}`);
      refreshAnonymizeButton();
      break;
    }
  }
};

anonymizeBtns.forEach(btn => btn.addEventListener('click', () => {
  for (const s of sources) {
    if (sourcesList.getMode(s.id) === 'text') {
      const live = sourcesList.getText(s.id);
      sourcesList.commitTextMode(s.id, live);
      s.text = sourcesList.getText(s.id);
    }
  }
  const toClassify = sources.filter((s) => (s.text ?? '').trim().length > 0);
  if (toClassify.length === 0) return;

  for (const s of toClassify) {
    s.status = 'pending';
    s.error = null;
    sourcesList.setSourceStatus(s.id, 'pending');
    inFlightSourceIds.add(s.id);
  }
  setText(modelStatusEls, `Analizowanie 0/${toClassify.length}…`);
  setText(anonymizeBtns, 'Analizowanie...');
  refreshAnonymizeButton();
  for (const s of toClassify) {
    worker.postMessage({ type: 'classify', id: s.id, text: s.text });
  }
}));

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

refreshAnonymizeButton();

const mcp = new WebMCP({ channelName: 'pii_anonymizer' });

function jsonContent(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
function textContent(value) {
  return { content: [{ type: 'text', text: value }] };
}

mcp.registerTool(
  'list_sources',
  'List all anonymized source documents that are ready. Returns id, label, and char_count for each. Text contents are token-form (PII never crosses this boundary).',
  { type: 'object', properties: {} },
  () => {
    const ready = sources.filter((s) => s.status === 'ready');
    const items = ready.map((s) => {
      const anonymized = applyTokens(s.text, s.entities, seen);
      return { id: s.id, label: s.label, char_count: anonymized.length };
    });
    return jsonContent(items);
  },
);

mcp.registerTool(
  'read_source',
  'Read the anonymized (token-form) text of a single source by id. PII is never returned.',
  {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  ({ id }) => {
    const s = sources.find((x) => x.id === id);
    if (!s || s.status !== 'ready') return jsonContent({ error: `Source ${id} not ready` });
    return textContent(applyTokens(s.text, s.entities, seen));
  },
);

mcp.registerTool(
  'list_outcomes',
  'List all outcome documents (LLM-produced, in token form). Returns id, label, char_count.',
  { type: 'object', properties: {} },
  () => jsonContent(outcomes.map((o) => ({ id: o.id, label: o.label, char_count: o.text.length }))),
);

mcp.registerTool(
  'read_outcome',
  'Read the tokenized text of an outcome by id (the LLM\'s own previous output).',
  {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  ({ id }) => {
    const o = outcomes.find((x) => x.id === id);
    if (!o) return jsonContent({ error: `Outcome ${id} not found` });
    return textContent(o.text);
  },
);

mcp.registerTool(
  'write_outcome',
  'Create or update an outcome document. Provide id to update an existing outcome; omit id to create a new one. text MUST be in token form (e.g. [PERSON_NAME_1]); the browser deanonymizes it for the human user only and never returns PII.',
  {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      text: { type: 'string' },
    },
    required: ['label', 'text'],
  },
  ({ id, label, text }) => {
    if (typeof label !== 'string' || label.trim().length === 0) {
      return jsonContent({ error: 'label must be a non-empty string' });
    }
    if (typeof text !== 'string') {
      return jsonContent({ error: 'text must be a string' });
    }
    if (id) {
      const o = outcomes.find((x) => x.id === id);
      if (!o) return jsonContent({ error: `Outcome ${id} not found` });
      o.label = label;
      o.text = text;
      outcomesList.updateOutcome(id, label, text, legend);
      outcomesSection.hidden = false;
      return jsonContent({ id, success: true });
    }
    const newId = crypto.randomUUID();
    outcomes.push({ id: newId, label, text });
    outcomesList.addOutcome(newId, label, text, legend);
    outcomesSection.hidden = false;
    return jsonContent({ id: newId, success: true });
  },
);
