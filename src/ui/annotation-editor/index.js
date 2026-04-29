import {
  overlapsAny,
  addEntity,
  removeToken,
  updateTypeForToken,
  updateBoundaries,
  tokensFromEntities,
} from './operations.js';
import { colorFor } from '../entity-colors.js';

const TOAST_TIMEOUT_MS = 2200;

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function createAnnotationEditor(rootEl, options) {
  const {
    text: initialText = '',
    entities: initialEntities = [],
    entityCategories = [],
    entityLabels = {},
    postEdit = (_text, ents) => ents,
    onChange = () => {},
    onModeChange = () => {},
  } = options ?? {};

  let text = initialText;
  let entities = initialEntities;
  let mode = entities.length > 0 ? 'annotation' : 'text';
  let textSnapshot = text;

  let selectedIndex = -1; // index into entities
  let popoverEl = null;
  let confirmEl = null;
  let toastTimer = null;

  rootEl.classList.add('ann-editor');

  // Toolbar (mode pill only — buttons live in host)
  const toolbarEl = document.createElement('div');
  toolbarEl.className = 'ann-editor-toolbar';
  const modePillEl = document.createElement('span');
  modePillEl.className = 'ann-editor-mode';
  toolbarEl.appendChild(modePillEl);
  rootEl.appendChild(toolbarEl);

  // Body — switches between textarea and surface
  const bodyEl = document.createElement('div');
  rootEl.appendChild(bodyEl);

  // ── Mode rendering ────────────────────────────────────────
  function renderMode() {
    if (mode === 'text') {
      modePillEl.textContent = 'Tryb: tekst';
      modePillEl.classList.add('text');
    } else {
      modePillEl.textContent = 'Tryb: adnotacje';
      modePillEl.classList.remove('text');
    }
    closeAllOverlays();
    if (mode === 'text') {
      renderTextMode();
    } else {
      renderAnnotationMode();
    }
  }

  function renderTextMode() {
    bodyEl.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.className = 'ann-editor-textarea';
    ta.value = text;
    ta.placeholder = 'Wklej tekst zawierający dane osobowe...';
    ta.addEventListener('input', () => {
      text = ta.value;
    });
    bodyEl.appendChild(ta);
    // focus after a tick so layout settles
    requestAnimationFrame(() => ta.focus());
  }

  function renderAnnotationMode() {
    bodyEl.innerHTML = '';
    const surface = document.createElement('div');
    surface.className = 'ann-editor-surface';
    bodyEl.appendChild(surface);

    if (entities.length === 0) {
      surface.textContent = text;
      bindSurfaceSelectionHandler(surface);
      return;
    }

    const tokens = tokensFromEntities(entities, text);
    const sortedIndices = entities
      .map((_, i) => i)
      .sort((a, b) => entities[a].start - entities[b].start);

    let cursor = 0;
    for (const idx of sortedIndices) {
      const e = entities[idx]; // original reference
      if (e.start > cursor) {
        surface.appendChild(document.createTextNode(text.slice(cursor, e.start)));
      }
      const token = tokens.get(idx);
      const span = renderEntity(e, idx, token);
      surface.appendChild(span);
      cursor = e.end;
    }
    if (cursor < text.length) {
      surface.appendChild(document.createTextNode(text.slice(cursor)));
    }

    bindSurfaceSelectionHandler(surface);
  }

  function renderEntity(entity, index, token) {
    const span = document.createElement('span');
    span.className = 'ann-ent';
    span.dataset.index = String(index);
    span.dataset.type = entity.entity_group;
    if (token) span.dataset.token = token;
    if (index === selectedIndex) span.classList.add('selected');

    // Cross-occurrence hover: highlight all entities sharing this token.
    span.addEventListener('mouseenter', () => activateToken(token));
    span.addEventListener('mouseleave', () => deactivateToken(token));

    const color = colorFor(entity.entity_group);
    span.style.setProperty('--ent-bg', hexToRgba(color, 0.3));
    span.style.setProperty('--ent-color', color);

    // chip (token + X)
    const chip = document.createElement('span');
    chip.className = 'ann-ent-chip';
    chip.textContent = token ?? '';
    chip.contentEditable = 'false';

    const x = document.createElement('span');
    x.className = 'ann-ent-chip-x';
    x.textContent = '×';
    x.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openConfirmDelete(span, entity, token);
    });
    chip.appendChild(x);
    span.appendChild(chip);

    // text content
    span.appendChild(
      document.createTextNode(text.slice(entity.start, entity.end)),
    );

    // handles (only when selected)
    if (index === selectedIndex) {
      const lh = document.createElement('span');
      lh.className = 'ann-ent-handle l';
      lh.contentEditable = 'false';
      attachDragHandle(lh, index, 'left');
      span.appendChild(lh);
      const rh = document.createElement('span');
      rh.className = 'ann-ent-handle r';
      rh.contentEditable = 'false';
      attachDragHandle(rh, index, 'right');
      span.appendChild(rh);
    }

    span.addEventListener('mousedown', (ev) => {
      // ignore clicks that originate on chip's X or handles (handled separately)
      const t = ev.target;
      if (t.classList && (t.classList.contains('ann-ent-chip-x') || t.classList.contains('ann-ent-handle'))) return;
      ev.stopPropagation();
    });
    span.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.classList && (t.classList.contains('ann-ent-chip-x') || t.classList.contains('ann-ent-handle'))) return;
      ev.stopPropagation();
      openEditPopover(span, entity, index);
    });

    return span;
  }

  function activateToken(token) {
    if (!token) return;
    const sel = `.ann-ent[data-token="${CSS.escape(token)}"]`;
    for (const el of bodyEl.querySelectorAll(sel)) {
      el.classList.add('ann-ent-token-active');
    }
  }
  function deactivateToken(token) {
    if (!token) return;
    const sel = `.ann-ent[data-token="${CSS.escape(token)}"]`;
    for (const el of bodyEl.querySelectorAll(sel)) {
      el.classList.remove('ann-ent-token-active');
    }
  }

  // ── Selection (create new entity) ─────────────────────────
  function bindSurfaceSelectionHandler(surface) {
    surface.addEventListener('mouseup', () => {
      // give the selection time to settle
      setTimeout(() => handleTextSelection(surface), 0);
    });
  }

  function handleTextSelection(surface) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) return;

    // Compute character offsets within `text` by walking the surface text content,
    // skipping nodes inside chips/handles (they're contentEditable=false but still
    // contribute to text nodes; we filter by class on ancestors).
    const offsets = computeRangeOffsets(surface, range);
    if (!offsets) return;
    let { start, end } = offsets;
    if (end <= start) return;

    // Strip leading/trailing whitespace from the selection
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return;

    if (overlapsAny(start, end, entities)) {
      showToast('Nie można nakładać adnotacji', 'Zaznaczenie pokrywa się z istniejącą adnotacją.');
      sel.removeAllRanges();
      return;
    }

    sel.removeAllRanges();
    openCreatePopover(surface, start, end);
  }

  function computeRangeOffsets(surface, range) {
    // Walk surface text nodes; only count nodes that are NOT inside a chip or handle.
    let start = -1;
    let end = -1;
    let acc = 0;
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p && p !== surface) {
          if (p.classList && (p.classList.contains('ann-ent-chip') || p.classList.contains('ann-ent-handle'))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (node === range.startContainer && start < 0) {
        start = acc + range.startOffset;
      }
      if (node === range.endContainer && end < 0) {
        end = acc + range.endOffset;
      }
      acc += len;
    }
    if (start < 0 || end < 0) return null;
    if (end < start) [start, end] = [end, start];
    return { start, end };
  }

  // ── Edit popover ──────────────────────────────────────────
  function openEditPopover(anchorEl, entity, index) {
    closeAllOverlays();
    selectedIndex = index;
    renderAnnotationMode();
    const newAnchor = bodyEl.querySelector(`.ann-ent[data-index="${index}"]`);
    if (!newAnchor) return;

    const pop = document.createElement('div');
    pop.className = 'ann-popover';

    const typeLabel = document.createElement('label');
    typeLabel.className = 'ann-popover-label';
    typeLabel.textContent = 'Typ';
    pop.appendChild(typeLabel);

    const select = buildTypeSelect(entity.entity_group);
    pop.appendChild(select);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${entity.start}–${entity.end} · "${truncate(text.slice(entity.start, entity.end), 60)}"`;
    pop.appendChild(meta);

    select.addEventListener('change', () => {
      const newType = select.value;
      if (newType === entity.entity_group) return;
      const next = updateTypeForToken(entities, entity, newType, text);
      commitChange(next);
    });

    document.body.appendChild(pop);
    positionPopover(pop, newAnchor);
    popoverEl = pop;

    bindOutsideClickToClose(pop);
  }

  // ── Create popover ────────────────────────────────────────
  function openCreatePopover(surface, start, end) {
    closeAllOverlays();
    const pop = document.createElement('div');
    pop.className = 'ann-popover';

    const label = document.createElement('label');
    label.className = 'ann-popover-label';
    label.textContent = 'Nowa adnotacja';
    pop.appendChild(label);

    const select = buildTypeSelect(null);
    pop.appendChild(select);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${start}–${end} · "${truncate(text.slice(start, end), 60)}"`;
    pop.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Utwórz';
    btn.disabled = true;
    pop.appendChild(btn);

    select.addEventListener('change', () => {
      btn.disabled = !select.value;
    });

    btn.addEventListener('click', () => {
      const type = select.value;
      if (!type) return;
      const candidate = { entity_group: type, start, end, score: 1.0, source: 'manual' };
      const next = addEntity(entities, candidate);
      if (next === entities) {
        showToast('Nie można nakładać adnotacji', 'Zaznaczenie pokrywa się z istniejącą adnotacją.');
        return;
      }
      commitChange(next);
    });

    // anchor at the selection's bounding rect
    document.body.appendChild(pop);
    positionPopoverAtChars(pop, surface, start);
    popoverEl = pop;

    bindOutsideClickToClose(pop);
  }

  // ── Confirm delete ────────────────────────────────────────
  function openConfirmDelete(anchorEl, entity, token) {
    closeAllOverlays();
    const tokens = tokensFromEntities(entities, text);
    const anchorIndex = entities.indexOf(entity);
    const targetToken = tokens.get(anchorIndex);
    let count = 0;
    for (const t of tokens.values()) if (t === targetToken) count++;

    const box = document.createElement('div');
    box.className = 'ann-confirm';
    box.innerHTML = `
      <div class="ann-confirm-title">Usunąć ${escapeHtml(token ?? entity.entity_group)}?</div>
      <div class="ann-confirm-body">${count > 1 ? `Z dokumentu zostanie usuniętych <strong>${count}</strong> wystąpień.` : 'Adnotacja zostanie usunięta z dokumentu.'} Operację można cofnąć tylko ponownym uruchomieniem anonimizacji.</div>
      <div class="ann-confirm-actions">
        <button class="cancel">Anuluj</button>
        <button class="danger">${count > 1 ? 'Usuń wszystkie' : 'Usuń'}</button>
      </div>
    `;
    document.body.appendChild(box);
    positionPopover(box, anchorEl);
    confirmEl = box;

    box.querySelector('.cancel').addEventListener('click', () => closeAllOverlays());
    box.querySelector('.danger').addEventListener('click', () => {
      const next = removeToken(entities, entity, text);
      commitChange(next);
    });

    bindOutsideClickToClose(box);
  }

  // ── Drag handle ───────────────────────────────────────────
  function attachDragHandle(handleEl, index, side) {
    handleEl.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const surface = bodyEl.querySelector('.ann-editor-surface');
      if (!surface) return;

      const startEntity = entities[index];
      const startStart = startEntity.start;
      const startEnd = startEntity.end;

      function onMove(e) {
        const charPos = charPosFromPoint(surface, e.clientX, e.clientY);
        if (charPos == null) return;
        let newStart = startStart;
        let newEnd = startEnd;
        if (side === 'left') {
          newStart = Math.max(0, Math.min(charPos, startEnd - 1));
        } else {
          newEnd = Math.max(startStart + 1, Math.min(charPos, text.length));
        }
        const next = updateBoundaries(entities, index, newStart, newEnd);
        if (next === null) return; // overlap, ignore this frame
        // Live update during drag without committing through postEdit (that runs on release)
        entities = next;
        renderAnnotationMode();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // commit final state through postEdit + onChange
        commitChange(entities);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function charPosFromPoint(surface, clientX, clientY) {
    let pos;
    if (document.caretPositionFromPoint) {
      const cp = document.caretPositionFromPoint(clientX, clientY);
      if (!cp) return null;
      pos = { node: cp.offsetNode, offset: cp.offset };
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(clientX, clientY);
      if (!r) return null;
      pos = { node: r.startContainer, offset: r.startOffset };
    } else {
      return null;
    }

    if (!surface.contains(pos.node)) return null;
    let acc = 0;
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p && p !== surface) {
          if (p.classList && (p.classList.contains('ann-ent-chip') || p.classList.contains('ann-ent-handle'))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      if (node === pos.node) return acc + pos.offset;
      acc += node.nodeValue.length;
    }
    return null;
  }

  // ── Helpers ───────────────────────────────────────────────
  function buildTypeSelect(currentType) {
    const select = document.createElement('select');
    if (!currentType) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— wybierz typ —';
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);
    }
    for (const cat of entityCategories) {
      const grp = document.createElement('optgroup');
      grp.label = cat.label;
      for (const type of cat.entities) {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = `${type} — ${entityLabels[type] ?? ''}`;
        if (type === currentType) opt.selected = true;
        grp.appendChild(opt);
      }
      select.appendChild(grp);
    }
    return select;
  }

  function commitChange(newEntities) {
    let processed = newEntities;
    try {
      processed = postEdit(text, newEntities) ?? newEntities;
    } catch (err) {
      console.error('[annotation-editor] postEdit failed:', err);
      processed = newEntities;
    }
    entities = processed;
    selectedIndex = -1;
    closeAllOverlays();
    if (mode !== 'annotation') {
      mode = 'annotation';
      onModeChange(mode);
    }
    renderAnnotationMode();
    onChange(entities);
  }

  function positionPopover(popEl, anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const popH = popEl.offsetHeight;
    const popW = popEl.offsetWidth;
    let top = window.scrollY + r.bottom + 6;
    let left = window.scrollX + r.left;
    // keep within viewport horizontally
    const maxLeft = window.scrollX + window.innerWidth - popW - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    // flip above if no room below
    if (r.bottom + popH + 12 > window.innerHeight) {
      top = window.scrollY + r.top - popH - 6;
    }
    popEl.style.top = `${top}px`;
    popEl.style.left = `${left}px`;
  }

  function positionPopoverAtChars(popEl, surface, charStart) {
    // Find the text node + offset for charStart and use a Range to get a rect.
    let acc = 0;
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p && p !== surface) {
          if (p.classList && (p.classList.contains('ann-ent-chip') || p.classList.contains('ann-ent-handle'))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (acc + len >= charStart) {
        const range = document.createRange();
        range.setStart(node, charStart - acc);
        range.setEnd(node, charStart - acc);
        const rect = range.getBoundingClientRect();
        const fakeAnchor = { getBoundingClientRect: () => rect };
        positionPopover(popEl, fakeAnchor);
        return;
      }
      acc += len;
    }
    // fallback
    positionPopover(popEl, surface);
  }

  function bindOutsideClickToClose(el) {
    function onDoc(ev) {
      if (el.contains(ev.target)) return;
      // Don't close if user clicked inside another piece of editor chrome (handles, chips)
      // — those handle their own state.
      closeAllOverlays();
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') {
        closeAllOverlays();
        document.removeEventListener('mousedown', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
      }
    }
    // Schedule listener attach in next frame so the click that opened the overlay
    // doesn't immediately close it.
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    });
  }

  function closeAllOverlays() {
    if (popoverEl && popoverEl.parentNode) popoverEl.parentNode.removeChild(popoverEl);
    if (confirmEl && confirmEl.parentNode) confirmEl.parentNode.removeChild(confirmEl);
    popoverEl = null;
    confirmEl = null;
    if (selectedIndex >= 0) {
      selectedIndex = -1;
      if (mode === 'annotation') renderAnnotationMode();
    }
  }

  function showToast(title, body) {
    const existing = document.querySelector('.ann-toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'ann-toast';
    el.innerHTML = `<strong>⚠ ${escapeHtml(title)}</strong><br>${escapeHtml(body)}`;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => {
      el.classList.add('fading');
      setTimeout(() => el.remove(), 320);
    }, TOAST_TIMEOUT_MS);
  }

  function truncate(s, n) {
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  // ── Public API ───────────────────────────────────────────
  function setEntities(newEntities) {
    entities = newEntities ?? [];
    selectedIndex = -1;
    if (entities.length > 0 && mode !== 'annotation') {
      mode = 'annotation';
      onModeChange(mode);
    }
    renderMode();
    onChange(entities);
  }

  function enterTextMode() {
    if (mode === 'text') return;
    mode = 'text';
    textSnapshot = text;
    renderMode();
    onModeChange(mode);
  }

  function commitTextMode(newText) {
    text = newText;
    const changed = newText !== textSnapshot;
    if (!changed) {
      mode = 'annotation';
      renderMode();
      onModeChange(mode);
      return { changed: false };
    }
    // Text actually changed — keep mode='text' until host runs pipeline and calls setEntities
    return { changed: true };
  }

  function getText() {
    // In text mode, the live textarea owns the value; pull current
    if (mode === 'text') {
      const ta = bodyEl.querySelector('.ann-editor-textarea');
      if (ta) return ta.value;
    }
    return text;
  }

  function setText(newText) {
    text = newText;
    textSnapshot = newText;
    entities = [];
    selectedIndex = -1;
    mode = 'text';
    renderMode();
    onModeChange(mode);
    onChange(entities);
  }

  function dispose() {
    closeAllOverlays();
    rootEl.classList.remove('ann-editor');
    rootEl.innerHTML = '';
  }

  // initial render
  renderMode();
  onModeChange(mode);

  return {
    setEntities,
    setText,
    enterTextMode,
    commitTextMode,
    getText,
    getEntities: () => entities,
    getTextSnapshot: () => textSnapshot,
    getMode: () => mode,
    dispose,
  };
}
