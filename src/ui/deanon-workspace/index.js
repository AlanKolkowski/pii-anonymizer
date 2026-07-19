import { deanonymizeText } from '../../anonymizer.js';
import { applyPaletteVars } from '../entity-colors.js';
import { splitTokenParts } from '../../tokens.js';
import { effectiveOutcomeLegend } from '../../substitution.js';

const CLOSE_ICON_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
const COPY_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="9" height="9" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg>';
const PASTE_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h4l1 2H5l1-2Z"/><path d="M5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V5A1.5 1.5 0 0 0 12 3.5h-1"/><path d="M5.5 7h5M5.5 10h4"/></svg>';
const DOWNLOAD_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8"/><path d="M4.5 6.5 8 10l3.5-3.5"/><path d="M3 13.5h10"/></svg>';

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
  return splitTokenParts(text).map((part) =>
    part.token ? { ...part, orig: legend[part.token] } : part,
  );
}

function countRestored(text, legend) {
  return tokenParts(text, legend).filter((part) => part.token && part.orig).length;
}

function countTokenStats(outcomes, legend) {
  const stats = { restored: 0, unresolved: 0 };
  for (const outcome of outcomes) {
    const outcomeLegend = effectiveOutcomeLegend(outcome, legend);
    for (const part of tokenParts(outcome.text ?? '', outcomeLegend)) {
      if (!part.token) continue;
      if (part.orig) stats.restored += 1;
      else stats.unresolved += 1;
    }
  }
  return stats;
}

function pluralPl(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function docsLabel(n) {
  return `${n} ${pluralPl(n, 'dokument wynikowy', 'dokumenty wynikowe', 'dokumentów wynikowych')}`;
}

function tokensLabel(n) {
  return `${n} ${pluralPl(n, 'token odtworzony', 'tokeny odtworzone', 'tokenów odtworzonych')}`;
}

function unresolvedLabel(n) {
  const word = pluralPl(n, 'token', 'tokeny', 'tokenów');
  const verb = pluralPl(n, 'pozostanie', 'pozostaną', 'pozostanie');
  const adjective = pluralPl(n, 'niezmieniony', 'niezmienione', 'niezmienionych');
  return `${n} ${word} ${verb} ${adjective}`;
}

function formatRunBarStats(outcomes, legend, exportState) {
  if (exportState.message) return exportState.message;
  if (outcomes.length === 0) return '0 dokumentów wynikowych';
  if (Object.keys(legend).length === 0) {
    return `${docsLabel(outcomes.length)} · brak legendy tokenów`;
  }
  const stats = countTokenStats(outcomes, legend);
  const parts = [docsLabel(outcomes.length), tokensLabel(stats.restored)];
  if (stats.unresolved > 0) parts.push(unresolvedLabel(stats.unresolved));
  return parts.join(' · ');
}

function exportFormatName(format) {
  return format === 'pdf' ? 'PDF' : 'DOCX';
}

function exportBusyLabel(format, count) {
  const ext = exportFormatName(format);
  return count === 1 ? `Tworzę ${ext}…` : `Tworzę ${ext}-y…`;
}

function exportDefaultLabel(format, count) {
  const ext = exportFormatName(format);
  return count === 1 ? `Eksportuj ${ext}` : `Eksportuj ${ext}-y`;
}

function exportStartMessage(format, count) {
  const ext = exportFormatName(format);
  return count === 1 ? `Generuję plik ${ext}…` : `Generuję ${ext}-y i pakuję do ZIP…`;
}

function exportSuccessLabel(format, count, archive) {
  const ext = exportFormatName(format);
  if (!archive || count === 1) return `Pobrano plik ${ext}`;
  return `Pobrano ${count} ${pluralPl(count, `plik ${ext}`, `pliki ${ext}`, `plików ${ext}`)} w paczce ZIP`;
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
  const exportState = { busy: false, format: null, message: '' };

  function setExportState(next) {
    Object.assign(exportState, next);
  }

  const EXPORT_MESSAGE_TIMEOUT_MS = 6000;
  let exportMessageTimer = null;
  let lastRenderSignature = null;

  function renderSignature() {
    return JSON.stringify({
      legend: getLegend(),
      outcomes: getOutcomes().map((o) => [o.id, o.label, o.text, Boolean(o.docx)]),
      activeId,
      busy: exportState.busy,
      message: exportState.message,
    });
  }

  // DOCX-REBUILD §6.2/O-5: the reconstruction report line comes from the
  // ENGINE's numbers, never from the text preview; rendered via textContent
  // like every other status (C-DOCX-4).
  function reportSummary(reports) {
    if (!Array.isArray(reports) || reports.length === 0) return '';
    let replaced = 0;
    let left = 0;
    for (const { report } of reports) {
      replaced += report?.totals?.replaced ?? 0;
      left += report?.totals?.left ?? 0;
    }
    const base = ` · rekonstrukcja DOCX: ${replaced} tokenów podmienionych`;
    if (left === 0) return base;
    return `${base} · UWAGA: ${left} tokenów pozostało w dokumencie — otwórz plik i uzupełnij ręcznie przed podpisem`;
  }

  async function runExport(format) {
    const outcomes = getOutcomes();
    const legend = getLegend();
    if (exportState.busy || outcomes.length === 0) return;
    if (typeof opts.onExport !== 'function') return;

    clearTimeout(exportMessageTimer);
    setExportState({ busy: true, format, message: exportStartMessage(format, outcomes.length) });
    render();
    try {
      const result = await opts.onExport(format);
      setExportState({
        busy: false,
        format: null,
        message: exportSuccessLabel(format, result?.count ?? outcomes.length, result?.archive)
          + reportSummary(result?.reports),
      });
    } catch (err) {
      const fallback = format === 'pdf'
        ? 'Nie udało się wygenerować PDF-ów'
        : 'Nie udało się wygenerować DOCX-ów';
      setExportState({ busy: false, format: null, message: err?.message || fallback });
    }
    render();
    exportMessageTimer = setTimeout(() => {
      exportState.message = '';
      render();
    }, EXPORT_MESSAGE_TIMEOUT_MS);
  }

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
    await navigator.clipboard?.writeText?.(deanonymizeText(active.text, effectiveOutcomeLegend(active, legend)));
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
    // DOCX-REBUILD §3.4: DOCX outcomes carry a badge; the preview is
    // read-only (bytes are the source of truth) and the import-time
    // inspection is surfaced right here.
    if (active?.docx) {
      const badge = document.createElement('span');
      badge.className = 'meta deanon-docx-badge';
      badge.dataset.testid = 'deanon-docx-badge';
      badge.textContent = 'DOCX · podgląd tylko do odczytu';
      left.appendChild(makeSep());
      left.appendChild(badge);
      const hyperlinks = active.docx.inspection?.external?.hyperlinks ?? 0;
      if (hyperlinks > 0) {
        const linksMeta = document.createElement('span');
        linksMeta.className = 'meta';
        linksMeta.dataset.testid = 'deanon-docx-hyperlinks';
        linksMeta.textContent = `${hyperlinks} hiperłączy zewnętrznych`;
        left.appendChild(makeSep());
        left.appendChild(linksMeta);
      }
    }
    toolbar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'right';
    if (typeof opts.onImportDocx === 'function') {
      const importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = '.docx';
      importInput.style.display = 'none';
      importInput.dataset.testid = 'deanon-import-docx-input';
      importInput.addEventListener('change', () => {
        const file = importInput.files?.[0];
        importInput.value = '';
        if (file) void opts.onImportDocx(file);
      });
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'btn btn-sm btn-ghost';
      importBtn.dataset.testid = 'deanon-import-docx';
      importBtn.textContent = 'Importuj pismo od AI (DOCX)';
      importBtn.addEventListener('click', () => importInput.click());
      right.appendChild(importInput);
      right.appendChild(importBtn);
    }
    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'btn btn-sm btn-ghost';
    pasteBtn.dataset.testid = 'deanon-paste';
    pasteBtn.disabled = Boolean(active?.docx);
    pasteBtn.title = active?.docx
      ? 'Wpis DOCX: źródłem prawdy są bajty pliku — podgląd nie podlega edycji.'
      : '';
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
    const activeLegend = effectiveOutcomeLegend(active, legend);
    if (active && Object.keys(activeLegend).length > 0) {
      const restored = document.createElement('span');
      restored.className = 'meta deanon-restored-count';
      restored.dataset.testid = 'deanon-restored-count';
      restored.textContent = `${countRestored(active.text, activeLegend)} tokenów odtworzonych`;
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
    copyBtn.disabled = !active || Object.keys(activeLegend).length === 0;
    copyBtn.innerHTML = `${COPY_ICON_SVG} Kopiuj`;
    copyBtn.addEventListener('click', () => { void copyActive(active, legend); });
    right.appendChild(copyBtn);
    toolbar.appendChild(right);
    editorPane.appendChild(toolbar);

    if (!active) {
      editorPane.appendChild(emptyState(
        'deanon-empty-output',
        'Brak wyniku do odtworzenia',
        'Dodaj wynik LLM po lewej stronie.',
      ));
    } else if (Object.keys(activeLegend).length === 0) {
      editorPane.appendChild(emptyState(
        'deanon-empty-legend',
        'Brak legendy tokenów',
        'Deanonimizacja wymaga przynajmniej jednego zanonimizowanego dokumentu źródłowego.',
      ));
    } else {
      const body = document.createElement('div');
      body.className = 'deanon-editor deanon-editor-output anno-style-highlight';
      body.dataset.testid = 'deanon-output-body';
      renderParts(body, active.text, activeLegend, labels, 'output');
      editorPane.appendChild(body);
    }

    pane.appendChild(editorPane);
    parent.appendChild(pane);
  }

  function renderRunBar(parent, outcomes, legend) {
    const bar = document.createElement('div');
    bar.className = 'run-bar deanon-run-bar';
    bar.dataset.testid = 'deanon-run-bar';

    const left = document.createElement('div');
    left.className = 'left';
    const stats = document.createElement('span');
    stats.className = 'run-bar-stats';
    stats.dataset.testid = 'deanon-run-bar-stats';
    stats.textContent = formatRunBarStats(outcomes, legend, exportState);
    stats.title = outcomes.length === 1
      ? 'Eksport tworzy lokalnie pojedynczy plik dla aktywnego dokumentu wynikowego.'
      : 'Eksport tworzy lokalnie paczkę ZIP z osobnym plikiem dla każdego dokumentu wynikowego.';
    left.appendChild(stats);
    bar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'right';
    const canExport = outcomes.length > 0
      && outcomes.some((outcome) => Object.keys(effectiveOutcomeLegend(outcome, legend)).length > 0)
      && typeof opts.onExport === 'function';
    const disabledReason = outcomes.length === 0
      ? 'Dodaj przynajmniej jeden dokument wynikowy'
      : !outcomes.some((outcome) => Object.keys(effectiveOutcomeLegend(outcome, legend)).length > 0)
        ? 'Eksport wymaga legendy tokenów z anonimizacji'
        : 'Eksport chwilowo niedostępny';

    for (const format of ['pdf', 'docx']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.dataset.testid = `deanon-export-${format}`;
      btn.disabled = exportState.busy || !canExport;
      btn.title = canExport
        ? outcomes.length === 1
          ? `Pobierz plik ${format.toUpperCase()} dla dokumentu wynikowego`
          : `Pobierz ZIP z osobnymi plikami ${format.toUpperCase()} dla wszystkich wyników`
        : disabledReason;
      const label = exportState.busy && exportState.format === format
        ? exportBusyLabel(format, outcomes.length)
        : exportDefaultLabel(format, outcomes.length);
      btn.innerHTML = `${DOWNLOAD_ICON_SVG} ${label}`;
      btn.addEventListener('click', () => { void runExport(format); });
      right.appendChild(btn);
    }

    bar.appendChild(right);
    parent.appendChild(bar);
  }

  function render() {
    const outcomes = getOutcomes();
    const legend = getLegend();
    const active = currentOutcome(outcomes);

    const prevInputBody = rootEl.querySelector('[data-testid="deanon-input-body"]');
    const prevOutputBody = rootEl.querySelector('[data-testid="deanon-output-body"]');
    const preservedScroll = {
      input: prevInputBody ? { top: prevInputBody.scrollTop, left: prevInputBody.scrollLeft } : null,
      output: prevOutputBody ? { top: prevOutputBody.scrollTop, left: prevOutputBody.scrollLeft } : null,
    };

    rootEl.innerHTML = '';

    const body = document.createElement('div');
    body.className = 'tool-body tool-body-deanon';
    body.dataset.testid = 'deanon-workspace';
    renderInputPane(body, outcomes, active, legend);
    renderOutputPane(body, active, legend);
    rootEl.appendChild(body);
    renderRunBar(rootEl, outcomes, legend);

    if (preservedScroll.input) {
      const node = rootEl.querySelector('[data-testid="deanon-input-body"]');
      if (node) { node.scrollTop = preservedScroll.input.top; node.scrollLeft = preservedScroll.input.left; }
    }
    if (preservedScroll.output) {
      const node = rootEl.querySelector('[data-testid="deanon-output-body"]');
      if (node) { node.scrollTop = preservedScroll.output.top; node.scrollLeft = preservedScroll.output.left; }
    }

    lastRenderSignature = renderSignature();
  }

  return {
    render,
    activateOutcome(id) {
      activeId = id;
      render();
    },
    // Status line in the run bar (textContent sink only) — used by the DOCX
    // import path for inspection warnings and failures.
    showMessage(message) {
      clearTimeout(exportMessageTimer);
      setExportState({ message });
      render();
      exportMessageTimer = setTimeout(() => {
        exportState.message = '';
        render();
      }, EXPORT_MESSAGE_TIMEOUT_MS);
    },
    refreshLegend() {
      const sig = renderSignature();
      if (sig === lastRenderSignature) return;
      render();
    },
    getActiveId() {
      return activeId;
    },
  };
}
