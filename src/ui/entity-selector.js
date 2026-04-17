export function createEntitySelector(container, { categories, labels, initial, onChange }) {
  const state = new Set(initial);
  const perEntityInputs = new Map();
  const perCategoryInputs = new Map();

  container.innerHTML = '';
  container.classList.add('entity-selector');

  for (const cat of categories) {
    const fs = document.createElement('fieldset');
    fs.className = 'entity-category';
    fs.dataset.categoryId = cat.id;

    const legend = document.createElement('legend');
    const catLabel = document.createElement('label');
    catLabel.className = 'entity-category-label';
    const catInput = document.createElement('input');
    catInput.type = 'checkbox';
    catInput.addEventListener('change', () => {
      const turnOn = catInput.checked;
      for (const entity of cat.entities) {
        if (turnOn) state.add(entity);
        else state.delete(entity);
        const input = perEntityInputs.get(entity);
        if (input) input.checked = turnOn;
      }
      refreshCategoryState(cat.id);
      emit();
    });
    perCategoryInputs.set(cat.id, catInput);

    const catCount = document.createElement('span');
    catCount.className = 'entity-category-count';

    catLabel.appendChild(catInput);
    catLabel.append(` ${cat.label} `);
    catLabel.appendChild(catCount);
    legend.appendChild(catLabel);
    fs.appendChild(legend);

    const list = document.createElement('div');
    list.className = 'entity-category-list';
    for (const entity of cat.entities) {
      const row = document.createElement('label');
      row.className = 'entity-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.has(entity);
      input.dataset.entity = entity;
      input.addEventListener('change', () => {
        if (input.checked) state.add(entity);
        else state.delete(entity);
        refreshCategoryState(cat.id);
        emit();
      });
      perEntityInputs.set(entity, input);

      row.appendChild(input);
      row.append(` ${labels[entity] ?? entity} `);
      const code = document.createElement('code');
      code.textContent = entity;
      row.appendChild(code);
      list.appendChild(row);
    }
    fs.appendChild(list);
    container.appendChild(fs);

    refreshCategoryState(cat.id);
  }

  function refreshCategoryState(categoryId) {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    const total = cat.entities.length;
    const checked = cat.entities.filter((e) => state.has(e)).length;
    const input = perCategoryInputs.get(categoryId);
    input.checked = checked === total;
    input.indeterminate = checked > 0 && checked < total;
    const countEl = container
      .querySelector(`.entity-category[data-category-id="${categoryId}"] .entity-category-count`);
    if (countEl) countEl.textContent = `(${checked}/${total})`;
  }

  let suppress = false;
  function emit() {
    if (suppress) return;
    onChange([...state]);
  }

  return {
    getSelected() { return [...state]; },
    setSelected(entities) {
      suppress = true;
      state.clear();
      for (const e of entities) state.add(e);
      for (const [entity, input] of perEntityInputs) input.checked = state.has(entity);
      for (const cat of categories) refreshCategoryState(cat.id);
      suppress = false;
    },
    destroy() {
      container.innerHTML = '';
      container.classList.remove('entity-selector');
    },
  };
}
