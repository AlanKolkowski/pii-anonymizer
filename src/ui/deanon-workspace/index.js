import { deanonymizeText } from '../../anonymizer.js';
import { applyPaletteVars } from '../entity-colors.js';

const CLOSE_ICON_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
const COPY_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="9" height="9" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg>';
const PASTE_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h4l1 2H5l1-2Z"/><path d="M5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V5A1.5 1.5 0 0 0 12 3.5h-1"/><path d="M5.5 7h5M5.5 10h4"/></svg>';

const TOKEN_RE = /\[([A-Z_]+_\d+)\]/g;

function entityTypeFromTokenId(tokenId) {
  return tokenId.replace(/_\d+$/, '');
}

function deanonOutputName(label) {
  if (!label) return 'wynik-deanon.txt';
  return /\.txt$/i.test(label) ? label.replace(/\.txt$/i, '-deanon.txt') : `${label}-deanon.txt`;
}

function defaultOutcomeLabel(outcomes) {
  const used = outcomes
    .map((o) => /^Wynik (\d+)$/.exec(o.label)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = used.length === 0 ? outcomes.length + 1 : Math.max(...used) + 1;
  return `Wynik ${next}`;
}

function tokenParts(text, legend) {
  const parts = [];
  let last = 0;
  let match;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const tokenId = match[1];
    const token = `[${tokenId}]`;
    const type = entityTypeFromTokenId(tokenId);
    parts.push({ token, tokenId, type, orig: legend[token] });
    last = TOKEN_RE.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function countRestored(text, legend) {
  return tokenParts(text, legend).filter((part) => part.token && part.orig).length;
}

function renderTokenPill(part, labels, mode) {
  const span = document.createElement('span');
  span.className = `anno deanon-token deanon-token-${mode}`;
  span.dataset.token = part.token;
  span.dataset.type = part.type;
  span.dataset.testid = `deanon-${mode}-token-${part.tokenId}`;
  if (part.orig) span.dataset.orig = part.orig;
  span.title = part.orig
    ? `${part.token} -> ${part.orig}`
    : `${part.token} · ${labels[part.type] ?? part.type}`;
  span.textContent = mode === 'output' && part.orig ? part.orig : part.token;
  applyPaletteVars(span, part.type);
  return span;
}

function renderParts(host, text, legend, labels, mode) {
  host.innerHTML = '';
  for (const part of tokenParts(text, legend)) {
    if (part.text !== undefined) {
      host.appendChild(document.createTextNode(part.text));
    } else if (mode === 'output' && !part.orig) {
      host.appendChild(document.createTextNode(part.token));
    } else {
      host.appendChild(renderTokenPill(part, labels, mode));
    }
  }
}

function emptyState(testid, title, body) {
  const el = document.createElement('div');
  el.className = 'editor-empty deanon-empty';
  el.dataset.testid = testid;
  el.innerHTML = `
    <span class="glyph" aria-hidden="true">↔</span>
    <h3>${title}</h3>
    <p>${body}</p>
  `;
  return el;
}

function makeSep() {
  const sep = document.createElement('span');
  sep.className = 'meta';
  sep.textContent = '·';
  return sep;
}

export function createDeanonWorkspace(rootEl, opts) {
  rootEl.classList.add('deanon-workspace');
  let activeId = null;

  const getOutcomes = opts.getOutcomes ?? (() => []);
  const getLegend = opts.getLegend ?? (() => ({}));
  const labels = opts.entityLabels ?? {};

  function currentOutcome(outcomes) {
    if (activeId && outcomes.some((o) => o.id === activeId)) {
      return outcomes.find((o) => o.id === activeId);
    }
    activeId = outcomes[0]?.id ?? null;
    return activeId ? outcomes.find((o) => o.id === activeId) : null;
  }

  function renderTabs(host, outcomes, active) {
    for (const outcome of outcomes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'ws-tab';
      tab.dataset.testid = `deanon-tab-${outcome.id}`;
      tab.classList.toggle('active', outcome.id === active?.id);
      tab.addEventListener('click', () => {
        activeId = outcome.id;
        render();
      });

      const dot = document.createElement('span');
      dot.className = 'dot';
      tab.appendChild(dot);

      const label = document.createElement('span');
      label.textContent = outcome.label;
      tab.appendChild(label);

      const close = document.createElement('span');
      close.className = 'close';
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', `Usuń ${outcome.label}`);
      close.innerHTML = CLOSE_ICON_SVG;
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onRemove?.(outcome.id);
      });
      tab.appendChild(close);

      host.appendChild(tab);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'ws-tab-add';
    addBtn.dataset.testid = 'deanon-add';
    addBtn.title = 'Dodaj wynik';
    addBtn.textContent = 'Dodaj';
    addBtn.addEventListener('click', () => opts.onAdd?.(defaultOutcomeLabel(outcomes), ''));
    host.appendChild(addBtn);
  }

  async function pasteIntoActive(active, outcomes) {
    const text = await navigator.clipboard?.readText?.();
    if (typeof text !== 'string') return;
    if (active) {
      opts.onUpdate?.(active.id, active.label, text);
      return;
    }
    opts.onAdd?.(defaultOutcomeLabel(outcomes), text);
  }

  async function copyActive(active, legend) {
    if (!active) return;
    await navigator.clipboard?.writeText?.(deanonymizeText(active.text, legend));
  }

  function renderInputPane(parent, outcomes, active, legend) {
    const pane = document.createElement('main');
    pane.className = 'tool-main deanon-pane deanon-pane-input';
    pane.dataset.testid = 'deanon-input-pane';

    const tabs = document.createElement('div');
    tabs.className = 'workspace-tabs';
    tabs.dataset.testid = 'deanon-tabs';
    renderTabs(tabs, outcomes, active);
    pane.appendChild(tabs);

    const editorPane = document.createElement('div');
    editorPane.className = 'editor-pane';

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const left = document.createElement('div');
    left.className = 'left';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = 'wejście · z LLM';
    left.appendChild(meta);
    if (active) {
      const size = document.createElement('span');
      size.className = 'meta';
      size.textContent = `${active.text.length} znaków`;
      left.appendChild(makeSep());
      left.appendChild(size);
    }
    toolbar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'right';
    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'btn btn-sm btn-ghost';
    pasteBtn.dataset.testid = 'deanon-paste';
    pasteBtn.innerHTML = `${PASTE_ICON_SVG} Wklej`;
    pasteBtn.addEventListener('click', () => { void pasteIntoActive(active, outcomes); });
    right.appendChild(pasteBtn);
    toolbar.appendChild(right);
    editorPane.appendChild(toolbar);

    if (!active) {
      editorPane.appendChild(emptyState(
        'deanon-empty-input',
        'Dodaj wynik LLM',
        'Wklej tekst w formie tokenów, np. [PERSON_NAME_1].',
      ));
    } else {
      const body = document.createElement('div');
      body.className = 'deanon-editor deanon-editor-input mono anno-style-highlight';
      body.dataset.testid = 'deanon-input-body';
      renderParts(body, active.text, legend, labels, 'input');
      editorPane.appendChild(body);
    }

    pane.appendChild(editorPane);
    parent.appendChild(pane);
  }

  function renderOutputPane(parent, active, legend) {
    const pane = document.createElement('main');
    pane.className = 'tool-main deanon-pane deanon-pane-output';
    pane.dataset.testid = 'deanon-output-pane';

    const tabs = document.createElement('div');
    tabs.className = 'workspace-tabs';
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ws-tab active';
    tab.dataset.testid = 'deanon-output-tab';
    tab.innerHTML = '<span class="dot"></span>';
    const label = document.createElement('span');
    label.textContent = deanonOutputName(active?.label);
    tab.appendChild(label);
    tabs.appendChild(tab);
    pane.appendChild(tabs);

    const editorPane = document.createElement('div');
    editorPane.className = 'editor-pane';

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const left = document.createElement('div');
    left.className = 'left';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = 'wyjście · zdeanonimizowane';
    left.appendChild(meta);
    if (active && Object.keys(legend).length > 0) {
      const restored = document.createElement('span');
      restored.className = 'meta deanon-restored-count';
      restored.dataset.testid = 'deanon-restored-count';
      restored.textContent = `${countRestored(active.text, legend)} tokenów odtworzonych`;
      left.appendChild(makeSep());
      left.appendChild(restored);
    }
    toolbar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'right';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-sm btn-primary';
    copyBtn.dataset.testid = 'deanon-copy';
    copyBtn.disabled = !active || Object.keys(legend).length === 0;
    copyBtn.innerHTML = `${COPY_ICON_SVG} Kopiuj`;
    copyBtn.addEventListener('click', () => { void copyActive(active, legend); });
    right.appendChild(copyBtn);
    toolbar.appendChild(right);
    editorPane.appendChild(toolbar);

    if (Object.keys(legend).length === 0) {
      editorPane.appendChild(emptyState(
        'deanon-empty-legend',
        'Brak legendy tokenów',
        'Deanonimizacja wymaga przynajmniej jednego zanonimizowanego dokumentu źródłowego.',
      ));
    } else if (!active) {
      editorPane.appendChild(emptyState(
        'deanon-empty-output',
        'Brak wyniku do odtworzenia',
        'Dodaj wynik LLM po lewej stronie.',
      ));
    } else {
      const body = document.createElement('div');
      body.className = 'deanon-editor deanon-editor-output anno-style-highlight';
      body.dataset.testid = 'deanon-output-body';
      renderParts(body, active.text, legend, labels, 'output');
      editorPane.appendChild(body);
    }

    pane.appendChild(editorPane);
    parent.appendChild(pane);
  }

  function render() {
    const outcomes = getOutcomes();
    const legend = getLegend();
    const active = currentOutcome(outcomes);
    rootEl.innerHTML = '';

    const body = document.createElement('div');
    body.className = 'tool-body tool-body-deanon';
    body.dataset.testid = 'deanon-workspace';
    renderInputPane(body, outcomes, active, legend);
    renderOutputPane(body, active, legend);
    rootEl.appendChild(body);
  }

  return {
    render,
    activateOutcome(id) {
      activeId = id;
      render();
    },
    refreshLegend() {
      render();
    },
    getActiveId() {
      return activeId;
    },
  };
}
