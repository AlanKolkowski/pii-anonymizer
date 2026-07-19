import { applyPaletteVars } from '../entity-colors.js';
import { findTokens, splitTokenParts } from '../../tokens.js';
import { effectiveOutcomeLegend, rawTokenLength, resolveOccurrences, renderResolvedText } from '../../substitution.js';

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

// DOCX-IMPL-PLAN.md FD-2/FD-5: grammatical case codes → Polish words — the
// ONE place this mapping lives (the engine only ever emits the code, never
// the word, per §3.3).
const CASE_LABELS = {
  M: 'mianownik', D: 'dopełniacz', C: 'celownik', B: 'biernik',
  N: 'narzędnik', Ms: 'miejscownik', W: 'wołacz',
};

function declinedLabel(n) {
  return `odmieniono ${n} ${pluralPl(n, 'formę', 'formy', 'form')}`;
}

// Flattens every export report's per-part `declined` rows (FD-2) plus the
// PERSON_NAME refusal counter (FD-2/O-FL-2) into one view for the
// expandable detail panel under the run bar.
function flexionReportRows(reports) {
  const rows = [];
  let refused = 0;
  for (const { report } of Array.isArray(reports) ? reports : []) {
    refused += report?.flexionDeclined?.count ?? 0;
    for (const part of report?.parts ?? []) {
      for (const row of part.declined ?? []) rows.push(row);
    }
  }
  return { rows, refused };
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

// FL-5 K4 (§3.2 FL-5-LIVE-WIRING-DESIGN.md): a resolveOccurrences occurrence
// pill — OUTPUT pane only. Unlike renderTokenPill/tokenParts (still used
// as-is by the INPUT pane, which shows tokens, not resolved values, and is
// deliberately untouched by FL-5), this always shows occ.finalText: with no
// resolver that's just baseValue (source 'baza', identical to today), with
// one it may be the generated/attested inflected form (source 'resolver').
function renderOccurrencePill(occ) {
  const span = document.createElement('span');
  span.className = 'anno deanon-token deanon-token-output';
  span.dataset.token = occ.token;
  span.dataset.type = occ.type;
  span.dataset.testid = `deanon-output-token-${occ.tokenId}`;
  span.dataset.orig = occ.finalText;
  span.title = `${occ.token} -> ${occ.finalText}`;
  span.textContent = occ.finalText;
  applyPaletteVars(span, occ.type);
  return span;
}

// Private interleaving helper (O-FL5-7: not a S2 delta, kept local to this
// module) — walks resolveOccurrences' result using the EXACT same spacer
// arithmetic renderResolvedText uses (rawTokenLength via findTokens), so the
// concatenation of these DOM text nodes is byte-identical to what copyActive
// puts on the clipboard (G-FL5-2). A 'nierozwiązany' occurrence (no legend
// entry at all) is a bare text node carrying its own finalText (===
// the canonical token, annotation stripped) — matching today's
// !part.orig branch in renderParts/tokenParts exactly.
function renderResolvedParts(host, text, occurrences) {
  host.innerHTML = '';
  const rawLengthByIndex = new Map();
  for (const match of findTokens(text)) rawLengthByIndex.set(match.index, rawTokenLength(match));

  let cursor = 0;
  for (const occ of occurrences) {
    if (occ.index > cursor) host.appendChild(document.createTextNode(text.slice(cursor, occ.index)));
    if (occ.source === 'nierozwiązany') {
      host.appendChild(document.createTextNode(occ.finalText));
    } else {
      host.appendChild(renderOccurrencePill(occ));
    }
    const rawLength = rawLengthByIndex.get(occ.index) ?? occ.token.length;
    cursor = occ.index + rawLength;
  }
  if (cursor < text.length) host.appendChild(document.createTextNode(text.slice(cursor)));
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
  const exportState = { busy: false, format: null, message: '', flexionRows: [], flexionRefused: 0 };

  function setExportState(next) {
    Object.assign(exportState, next);
  }

  const EXPORT_MESSAGE_TIMEOUT_MS = 6000;
  let exportMessageTimer = null;
  let lastRenderSignature = null;

  // FL-5 K4/§3.5: three additive signature ingredients, each defaulting to a
  // stable constant when the caller doesn't supply a getter (main.js wires
  // them in K5) — existing callers/tests are unaffected, byte for byte.
  // Without these, refreshLegend()'s no-op-skip (renderSignature equality)
  // would silently skip a needed re-render whenever ONLY the attested-forms
  // set changes underneath an unchanged legend (a new source variant, the
  // flag flipping, or the morph artifact finishing its async load) — the
  // screen would then show a stale inflection.
  const getFlexionEnabled = opts.getFlexionEnabled ?? (() => false);
  const getMorphReady = opts.getMorphReady ?? (() => false);
  const getSeenVersion = opts.getSeenVersion ?? (() => 0);

  function renderSignature() {
    return JSON.stringify({
      legend: getLegend(),
      outcomes: getOutcomes().map((o) => [o.id, o.label, o.text, Boolean(o.docx)]),
      activeId,
      busy: exportState.busy,
      message: exportState.message,
      flexionRows: exportState.flexionRows.length,
      flexionEnabled: getFlexionEnabled(),
      morphReady: getMorphReady(),
      seenVersion: getSeenVersion(),
    });
  }

  // DOCX-REBUILD §6.2/O-5: the reconstruction report line comes from the
  // ENGINE's numbers, never from the text preview; rendered via textContent
  // like every other status (C-DOCX-4). FD-2/FD-5: a declined (inflected)
  // count is informational, never a block — it rides in the same line.
  function reportSummary(reports) {
    if (!Array.isArray(reports) || reports.length === 0) return '';
    let replaced = 0;
    let left = 0;
    let declined = 0;
    for (const { report } of reports) {
      replaced += report?.totals?.replaced ?? 0;
      left += report?.totals?.left ?? 0;
      declined += report?.totals?.declined ?? 0;
    }
    let text = ` · rekonstrukcja DOCX: ${replaced} tokenów podmienionych`;
    if (declined > 0) text += ` · ${declinedLabel(declined)}`;
    if (left > 0) text += ` · UWAGA: ${left} tokenów pozostało w dokumencie — otwórz plik i uzupełnij ręcznie przed podpisem`;
    return text;
  }

  async function runExport(format) {
    const outcomes = getOutcomes();
    const legend = getLegend();
    if (exportState.busy || outcomes.length === 0) return;
    if (typeof opts.onExport !== 'function') return;

    clearTimeout(exportMessageTimer);
    setExportState({
      busy: true, format, message: exportStartMessage(format, outcomes.length), flexionRows: [], flexionRefused: 0,
    });
    render();
    try {
      const result = await opts.onExport(format);
      const { rows, refused } = flexionReportRows(result?.reports);
      setExportState({
        busy: false,
        format: null,
        message: exportSuccessLabel(format, result?.count ?? outcomes.length, result?.archive)
          + reportSummary(result?.reports),
        flexionRows: rows,
        flexionRefused: refused,
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

  // FL-5 K4/§3.3: the SAME resolveOccurrences construction the output pane
  // renders from (opts.getResolveReplacement(active), pure/deterministic) —
  // G-FL5-2's U1==U2 hash equality holds by construction, not by sharing
  // state. No resolver (opts omits getResolveReplacement, or the caller's
  // flag is off) reduces to exactly the old deanonymizeText behavior (proven
  // byte-for-byte in substitution.test.js's facade golden).
  async function copyActive(active, legend) {
    if (!active) return;
    const outcomeLegend = effectiveOutcomeLegend(active, legend);
    const resolveReplacement = typeof opts.getResolveReplacement === 'function' ? opts.getResolveReplacement(active) : undefined;
    const occurrences = resolveOccurrences(active.text, { legend: outcomeLegend, resolveReplacement });
    await navigator.clipboard?.writeText?.(renderResolvedText(occurrences, active.text));
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
    // FL-5 K4/§3.2: one resolveOccurrences call, shared by the restored/
    // inflected counters AND the body below — a single construction per
    // render, never re-derived per consumer (G-FL5-2 determinism).
    const resolveReplacement = active && typeof opts.getResolveReplacement === 'function'
      ? opts.getResolveReplacement(active)
      : undefined;
    const occurrences = active
      ? resolveOccurrences(active.text, { legend: activeLegend, resolveReplacement })
      : [];
    if (active && Object.keys(activeLegend).length > 0) {
      const restored = document.createElement('span');
      restored.className = 'meta deanon-restored-count';
      restored.dataset.testid = 'deanon-restored-count';
      restored.textContent = `${countRestored(active.text, activeLegend)} tokenów odtworzonych`;
      left.appendChild(makeSep());
      left.appendChild(restored);

      // §3.2: "odmieniono N form" — informational only (never a gate),
      // counted from source==='resolver' occurrences of THIS render's own
      // occurrences array; hidden entirely at N=0 so flag-off/no-resolver
      // outcomes show nothing new at all.
      const inflectedCount = occurrences.filter((o) => o.source === 'resolver').length;
      if (inflectedCount > 0) {
        const inflected = document.createElement('span');
        inflected.className = 'meta deanon-inflected-count';
        inflected.dataset.testid = 'deanon-inflected-count';
        inflected.textContent = declinedLabel(inflectedCount);
        left.appendChild(makeSep());
        left.appendChild(inflected);
      }
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
      renderResolvedParts(body, active.text, occurrences);
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

  // FD-5: expandable detail panel under the run bar — the declined
  // ("odmieniono") rows from the last export's report, plus the refusal
  // count (O-FL-2). Collapsed by default, textContent only (C-DOCX-4): no
  // HTML interpolation of legend-derived values anywhere in this panel.
  function renderFlexionReport(parent) {
    if (exportState.flexionRows.length === 0) return;

    const details = document.createElement('details');
    details.className = 'deanon-flexion-report';
    details.dataset.testid = 'deanon-flexion-report';

    const summary = document.createElement('summary');
    summary.textContent = `${declinedLabel(exportState.flexionRows.length)} przy rekonstrukcji DOCX`;
    details.appendChild(summary);

    const list = document.createElement('ul');
    list.dataset.testid = 'deanon-flexion-rows';
    for (const row of exportState.flexionRows) {
      const li = document.createElement('li');
      const casLabel = CASE_LABELS[row.przypadek] ?? row.przypadek ?? '';
      li.textContent = `${row.token}: „${row.z}” → „${row.na}”${casLabel ? ` (${casLabel})` : ''}`
        + (row.part ? ` · ${row.part}` : '');
      list.appendChild(li);
    }
    details.appendChild(list);

    if (exportState.flexionRefused > 0) {
      const note = document.createElement('p');
      note.className = 'meta';
      note.dataset.testid = 'deanon-flexion-refused';
      const occurrenceLocative = pluralPl(exportState.flexionRefused, 'wystąpieniu', 'wystąpieniach', 'wystąpieniach');
      note.textContent = `Silnik nie odmienił nazwiska w ${exportState.flexionRefused} ${occurrenceLocative}`
        + ' – pozostała forma z legendy.';
      details.appendChild(note);
    }

    parent.appendChild(details);
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
    renderFlexionReport(rootEl);

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
