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
      cards.set(id, { wrapper, labelEl, bodyEl, copyBtn, tokenText: '' });
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
