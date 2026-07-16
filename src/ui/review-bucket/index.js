import { buildReviewViewModel } from './view-model.js';

// ST-4 (SCOPE-TIERS-DESIGN.md §4.2): the W2 review-bucket section rendered
// inside a source card. Groups collapsed by default; Maskuj/Pomiń are two
// EQUAL buttons (no default — R-ST-2: "pomiń" must never look like the
// blessed path); "zapamiętaj na stałe" is an explicit opt-in per decision.
// Air-gap by construction (§4.2 pkt 5): everything renders from the local
// document text; there is no copy button, no export, no clipboard — v1
// keeps the gate surface minimal (O-ST-8).

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderReviewBucket(root, { sourceId, state, entityLabels, callbacks, openTypes }) {
  root.innerHTML = '';
  root.classList.add('review-bucket');
  const { text, candidates, decisions } = state ?? {};
  if (!candidates || candidates.length === 0) {
    root.hidden = true;
    return;
  }
  root.hidden = false;

  const vm = buildReviewViewModel({ text, candidates, decisions, entityLabels });

  const header = el('div', 'rb-header');
  const title = el('span', 'rb-title', `Do przeglądu (${vm.pendingCount})`);
  title.dataset.testid = `review-badge-${sourceId}`;
  header.appendChild(title);

  if (vm.complete) {
    const done = el('span', 'rb-done', 'Przegląd zakończony');
    done.dataset.testid = `review-complete-${sourceId}`;
    header.appendChild(done);
  } else {
    const finish = el('button', 'btn btn-sm rb-finish', `Zakończ przegląd – pomiń pozostałe (${vm.pendingCount})`);
    finish.type = 'button';
    finish.dataset.testid = `review-finish-${sourceId}`;
    finish.addEventListener('click', () => callbacks.onFinishReview?.(sourceId));
    header.appendChild(finish);
  }
  root.appendChild(header);

  const note = el('div', 'rb-note',
    'Wartości wykryte, ale niemaskowane automatycznie. Maskowanie obejmie wszystkie wystąpienia; pominięte pozostają w tekście widoczne.');
  root.appendChild(note);

  for (const group of vm.groups) {
    const details = document.createElement('details');
    details.className = 'rb-group';
    details.dataset.testid = `review-group-${sourceId}-${group.type}`;
    // Collapsed by default (§4.2 pkt 2); reopened groups stay open across
    // re-renders within this card via the caller-held openTypes set.
    details.open = openTypes.has(group.type);
    details.addEventListener('toggle', () => {
      if (details.open) openTypes.add(group.type);
      else openTypes.delete(group.type);
    });

    const summary = el('summary', 'rb-group-head');
    summary.appendChild(el('span', 'rb-group-label',
      `${group.label} (${group.valueCount} wartości, ${group.occurrenceCount} wystąpień)`));
    if (group.pendingCount === 0) summary.appendChild(el('span', 'rb-group-done', '✓'));
    details.appendChild(summary);

    if (group.pendingCount > 0) {
      const bulk = el('div', 'rb-bulk');
      const bulkMask = el('button', 'btn btn-sm', 'Maskuj wszystkie');
      bulkMask.type = 'button';
      bulkMask.dataset.testid = `review-bulk-mask-${sourceId}-${group.type}`;
      bulkMask.addEventListener('click', () => callbacks.onBulkDecision?.(sourceId, group.type, 'mask'));
      const bulkSkip = el('button', 'btn btn-sm', 'Pomiń wszystkie');
      bulkSkip.type = 'button';
      bulkSkip.dataset.testid = `review-bulk-skip-${sourceId}-${group.type}`;
      bulkSkip.addEventListener('click', () => callbacks.onBulkDecision?.(sourceId, group.type, 'skip'));
      bulk.appendChild(bulkMask);
      bulk.appendChild(bulkSkip);
      details.appendChild(bulk);
    }

    for (const value of group.values) {
      const row = el('div', 'rb-row');
      row.dataset.testid = `review-row-${sourceId}-${value.valueKey}`;
      row.dataset.decision = value.decision ?? 'pending';

      const head = el('div', 'rb-row-head');
      head.appendChild(el('span', 'rb-value', `„${value.value}"`));
      head.appendChild(el('span', 'rb-count', `×${value.occurrenceCount}`));
      row.appendChild(head);

      const ctx = el('div', 'rb-context');
      ctx.appendChild(document.createTextNode(value.context.before));
      ctx.appendChild(el('mark', 'rb-mark', value.context.value));
      ctx.appendChild(document.createTextNode(value.context.after));
      row.appendChild(ctx);

      const actions = el('div', 'rb-actions');
      if (value.decision === null) {
        const remember = el('label', 'rb-remember');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.testid = `review-remember-${sourceId}-${value.valueKey}`;
        remember.appendChild(checkbox);
        remember.appendChild(document.createTextNode('zapamiętaj na stałe'));

        const mask = el('button', 'btn btn-sm', 'Maskuj');
        mask.type = 'button';
        mask.dataset.testid = `review-mask-${sourceId}-${value.valueKey}`;
        mask.addEventListener('click', () =>
          callbacks.onDecision?.(sourceId, value.valueKey, 'mask', { remember: checkbox.checked }));
        const skip = el('button', 'btn btn-sm', 'Pomiń');
        skip.type = 'button';
        skip.dataset.testid = `review-skip-${sourceId}-${value.valueKey}`;
        skip.addEventListener('click', () =>
          callbacks.onDecision?.(sourceId, value.valueKey, 'skip', { remember: checkbox.checked }));

        actions.appendChild(mask);
        actions.appendChild(skip);
        actions.appendChild(remember);
      } else {
        const badge = el('span', 'rb-decision',
          value.decision === 'mask' ? 'zamaskowane' : 'pominięte');
        if (value.origin === 'dictionary') {
          badge.textContent += ' (słownik)';
        } else if (value.origin === 'bulk') {
          badge.textContent += ' (zbiorczo)';
        }
        badge.dataset.testid = `review-decision-${sourceId}-${value.valueKey}`;
        actions.appendChild(badge);

        const undo = el('button', 'btn btn-sm btn-ghost', 'Cofnij');
        undo.type = 'button';
        undo.dataset.testid = `review-undo-${sourceId}-${value.valueKey}`;
        undo.addEventListener('click', () => callbacks.onUndo?.(sourceId, value.valueKey));
        actions.appendChild(undo);
      }
      row.appendChild(actions);
      details.appendChild(row);
    }
    root.appendChild(details);
  }
}
