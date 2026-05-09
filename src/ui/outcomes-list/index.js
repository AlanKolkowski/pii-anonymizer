import { deanonymizeText } from '../../anonymizer.js';

export function createOutcomesList(rootEl, opts) {
  rootEl.classList.add('outlist');

  const cards = new Map();
  let currentLegend = {};
  let nextDefaultLabelN = 1;

  const cardsHost = document.createElement('div');
  cardsHost.className = 'outlist-cards';
  rootEl.appendChild(cardsHost);

  // Inline "create outcome by paste" affordance — the spec's deferred
  // manual-paste flow. Routes through opts.onAdd(label, text), which the
  // host wires to the same code path as the write_outcome MCP handler.
  const addRow = document.createElement('div');
  addRow.className = 'outlist-add';

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'outlist-add-label';
  labelInput.dataset.testid = 'outcome-add-label';
  labelInput.value = `Wynik ${nextDefaultLabelN}`;
  addRow.appendChild(labelInput);

  const textInput = document.createElement('textarea');
  textInput.className = 'outlist-add-text';
  textInput.dataset.testid = 'outcome-add-text';
  textInput.rows = 6;
  textInput.placeholder = 'Wklej zanonimizowany tekst od LLM (z tokenami w stylu [PERSON_NAME_1])…';
  addRow.appendChild(textInput);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn-primary';
  submitBtn.dataset.testid = 'outcome-add-submit';
  submitBtn.textContent = 'Dodaj wynik';
  submitBtn.disabled = true;
  addRow.appendChild(submitBtn);

  rootEl.appendChild(addRow);

  function syncSubmitDisabled() {
    submitBtn.disabled = textInput.value.trim().length === 0;
  }
  textInput.addEventListener('input', syncSubmitDisabled);

  submitBtn.addEventListener('click', () => {
    const label = labelInput.value.trim();
    const text = textInput.value;
    if (label.length === 0 || text.trim().length === 0) return;
    if (typeof opts.onAdd === 'function') opts.onAdd(label, text);
    textInput.value = '';
    nextDefaultLabelN += 1;
    labelInput.value = `Wynik ${nextDefaultLabelN}`;
    syncSubmitDisabled();
  });

  function renderCard(id, label, tokenText, legend) {
    const card = cards.get(id);
    if (!card) return;
    card.labelEl.textContent = label;
    card.tokenText = tokenText;
    card.bodyEl.textContent = deanonymizeText(tokenText, legend);
  }

  function enterEditMode(id) {
    const card = cards.get(id);
    if (!card || card.editForm) return;

    const form = document.createElement('div');
    form.className = 'outlist-edit';

    const editLabelInput = document.createElement('input');
    editLabelInput.type = 'text';
    editLabelInput.className = 'outlist-add-label';
    editLabelInput.dataset.testid = `outcome-edit-label-${id}`;
    editLabelInput.value = card.labelEl.textContent;
    form.appendChild(editLabelInput);

    const editTextInput = document.createElement('textarea');
    editTextInput.className = 'outlist-add-text';
    editTextInput.dataset.testid = `outcome-edit-text-${id}`;
    editTextInput.rows = 6;
    editTextInput.value = card.tokenText;
    form.appendChild(editTextInput);

    const actions = document.createElement('div');
    actions.className = 'outlist-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary';
    saveBtn.dataset.testid = `outcome-edit-save-${id}`;
    saveBtn.textContent = 'Zapisz';
    actions.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.dataset.testid = `outcome-edit-cancel-${id}`;
    cancelBtn.textContent = 'Anuluj';
    actions.appendChild(cancelBtn);

    form.appendChild(actions);

    saveBtn.addEventListener('click', () => {
      const label = editLabelInput.value.trim();
      const text = editTextInput.value;
      if (label.length === 0 || text.trim().length === 0) return;
      if (typeof opts.onEdit === 'function') opts.onEdit(id, label, text);
      exitEditMode(id);
    });
    cancelBtn.addEventListener('click', () => exitEditMode(id));

    // Hide display body and head action buttons; show form.
    card.bodyEl.hidden = true;
    card.editBtn.hidden = true;
    card.copyBtn.hidden = true;
    card.wrapper.appendChild(form);
    card.editForm = form;
    editTextInput.focus();
  }

  function exitEditMode(id) {
    const card = cards.get(id);
    if (!card || !card.editForm) return;
    card.editForm.remove();
    card.editForm = null;
    card.bodyEl.hidden = false;
    card.editBtn.hidden = false;
    card.copyBtn.hidden = false;
  }

  return {
    addOutcome(id, label, tokenText, legend) {
      if (cards.has(id)) throw new Error(`outcome ${id} already exists`);
      currentLegend = legend;

      const wrapper = document.createElement('div');
      wrapper.className = 'outlist-card';
      wrapper.dataset.testid = `outcome-card-${id}`;

      const head = document.createElement('div');
      head.className = 'outlist-card-head';

      const labelEl = document.createElement('span');
      labelEl.className = 'outlist-label';
      labelEl.dataset.testid = `outcome-label-${id}`;
      head.appendChild(labelEl);

      const spacer = document.createElement('div');
      spacer.className = 'outlist-spacer';
      head.appendChild(spacer);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary';
      copyBtn.dataset.testid = `outcome-copy-${id}`;
      copyBtn.textContent = 'Kopiuj';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(cards.get(id)?.bodyEl.textContent ?? '');
        copyBtn.textContent = 'Skopiowano!';
        setTimeout(() => { copyBtn.textContent = 'Kopiuj'; }, 2000);
      });
      head.appendChild(copyBtn);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary';
      editBtn.dataset.testid = `outcome-edit-${id}`;
      editBtn.textContent = 'Edytuj';
      editBtn.addEventListener('click', () => enterEditMode(id));
      head.appendChild(editBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-secondary';
      removeBtn.dataset.testid = `outcome-remove-${id}`;
      removeBtn.textContent = 'Usuń';
      removeBtn.addEventListener('click', () => opts.onRemove(id));
      head.appendChild(removeBtn);

      wrapper.appendChild(head);

      const bodyEl = document.createElement('pre');
      bodyEl.className = 'outlist-body';
      bodyEl.dataset.testid = `outcome-body-${id}`;
      wrapper.appendChild(bodyEl);

      cardsHost.appendChild(wrapper);
      cards.set(id, { wrapper, head, labelEl, bodyEl, copyBtn, editBtn, removeBtn, tokenText: '', editForm: null });
      renderCard(id, label, tokenText, legend);
    },
    updateOutcome(id, label, tokenText, legend) {
      currentLegend = legend;
      renderCard(id, label, tokenText, legend);
    },
    removeOutcome(id) {
      const card = cards.get(id);
      if (!card) return;
      card.wrapper.remove();
      cards.delete(id);
    },
    refreshLegend(legend) {
      currentLegend = legend;
      for (const [id, card] of cards) {
        card.bodyEl.textContent = deanonymizeText(card.tokenText, legend);
      }
    },
    listIds() { return [...cards.keys()]; },
    dispose() {
      cards.clear();
      rootEl.classList.remove('outlist');
      rootEl.innerHTML = '';
    },
  };
}
