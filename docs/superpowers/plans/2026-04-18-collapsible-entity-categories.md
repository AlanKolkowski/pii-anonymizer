# Collapsible Entity Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zmniejszyć pionową powierzchnię zajmowaną przez selektor encji w `index.html`: 7 kategorii jedna pod drugą, każda domyślnie zwinięta, rozwijana kliknięciem nagłówka (checkbox w nagłówku nadal pozwala toggle całej kategorii).

**Architecture:** Natywny `<details>/<summary>` zastępuje `<fieldset>/<legend>` w `src/ui/entity-selector.js`. CSS w `src/style.css` zmienia layout z grid na flex column, stylizuje summary jako klikalny nagłówek z chevronem i ukrywa natywny marker. Logika zaznaczania (state, onChange, refreshCategoryState, setSelected, getSelected, persystencja w localStorage) pozostaje bez zmian — zmianie podlega tylko warstwa DOM + CSS.

**Tech Stack:** Vanilla JS (ESM), CSS, `<details>/<summary>` HTML element. Brak frameworków. Brak testów jednostkowych dla UI (projekt ich nie ma dla `src/ui/`) — weryfikacja manualna w `npm run dev`.

**Referencja do specu:** `docs/superpowers/specs/2026-04-18-collapsible-entity-categories-design.md`

---

## File Structure

- **Modify:** `src/ui/entity-selector.js` — wymiana `<fieldset>/<legend>` na `<details>/<summary>`, dodanie `stopPropagation` na kliknięciu labela z tri-state checkboxem.
- **Modify:** `src/style.css` — zmiana `.entity-selector` z grid na flex column, usunięcie media query `max-width: 640px` (niepotrzebne przy pełnej szerokości), restyling `.entity-category` (nie jest już `fieldset`), stylowanie `summary` + chevron pseudo-element, ukrycie natywnego markera.

Jeden atomowy commit — obie zmiany są ze sobą sprzężone (CSS targetuje nową strukturę DOM, JS generuje elementy pod nowe style).

---

### Task 1: Przepisanie struktury DOM w entity-selector.js

**Files:**
- Modify: `src/ui/entity-selector.js` (cały plik)

- [ ] **Step 1: Zastąp zawartość `src/ui/entity-selector.js`**

```js
export function createEntitySelector(container, { categories, labels, initial, onChange }) {
  const state = new Set(initial);
  const perEntityInputs = new Map();
  const perCategoryInputs = new Map();

  container.innerHTML = '';
  container.classList.add('entity-selector');

  for (const cat of categories) {
    const details = document.createElement('details');
    details.className = 'entity-category';
    details.dataset.categoryId = cat.id;

    const summary = document.createElement('summary');
    summary.className = 'entity-category-summary';

    const catLabel = document.createElement('label');
    catLabel.className = 'entity-category-label';
    // Blokujemy propagację kliknięć wewnątrz labela, żeby klik w checkbox
    // (lub tekst labela, który synthesisuje click na inpucie) nie bubblował
    // do <summary> i nie togglował <details>.
    catLabel.addEventListener('click', (e) => e.stopPropagation());

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
    summary.appendChild(catLabel);
    details.appendChild(summary);

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
    details.appendChild(list);
    container.appendChild(details);

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
```

Kluczowe zmiany względem starej wersji:
- `document.createElement('fieldset')` → `document.createElement('details')` (z klasą `entity-category` — CSS selectory bez zmian).
- `document.createElement('legend')` → `document.createElement('summary')` z nową klasą `entity-category-summary`.
- Dodanie `catLabel.addEventListener('click', e => e.stopPropagation())` — zapobiega togglowaniu `<details>` przy klikaniu w tri-state checkbox / label.
- `fs.appendChild(legend)` → `details.appendChild(summary)`; `container.appendChild(fs)` → `container.appendChild(details)`.
- Brak atrybutu `open` na `<details>` → wszystkie kategorie start zwinięte.

### Task 2: Update CSS w style.css

**Files:**
- Modify: `src/style.css:290-346` (blok `.entity-selector` + media query)

- [ ] **Step 1: Zastąp blok `.entity-selector` (i media query pod nim) w `src/style.css`**

Znajdź w `src/style.css` następujący blok (linie ~290-346):

```css
.entity-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.entity-selector .entity-category {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin: 0;
}

.entity-selector .entity-category legend {
  padding: 0 0.25rem;
  font-weight: 600;
}

.entity-selector .entity-category-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}

.entity-selector .entity-category-count {
  color: #666;
  font-weight: 400;
  font-size: 0.9em;
}

.entity-selector .entity-category-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.25rem;
}

.entity-selector .entity-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95em;
  cursor: pointer;
}

.entity-selector .entity-row code {
  color: #888;
  font-size: 0.85em;
}

@media (max-width: 640px) {
  .entity-selector {
    grid-template-columns: 1fr;
  }
}
```

Zastąp go następującym:

```css
.entity-selector {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.entity-selector .entity-category {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0;
  margin: 0;
}

.entity-selector .entity-category-summary {
  list-style: none;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}

.entity-selector .entity-category-summary::-webkit-details-marker {
  display: none;
}

.entity-selector .entity-category-summary::before {
  content: '›';
  display: inline-block;
  font-size: 1.1em;
  line-height: 1;
  color: #666;
  transition: transform 0.15s ease;
  width: 0.9em;
  text-align: center;
}

.entity-selector .entity-category[open] > .entity-category-summary::before {
  transform: rotate(90deg);
}

.entity-selector .entity-category-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}

.entity-selector .entity-category-count {
  color: #666;
  font-weight: 400;
  font-size: 0.9em;
}

.entity-selector .entity-category-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0 0.75rem 0.5rem 0.75rem;
}

.entity-selector .entity-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95em;
  cursor: pointer;
}

.entity-selector .entity-row code {
  color: #888;
  font-size: 0.85em;
}
```

Kluczowe zmiany:
- `.entity-selector`: `grid` → `flex column`, gap zmniejszony do `0.5rem` (było `0.75rem`; przy pełnej szerokości mniejszy odstęp wygląda lepiej).
- Usunięta reguła dla `.entity-selector .entity-category legend` (nie ma już `<legend>`).
- Usunięte media query `@media (max-width: 640px)` (single column jest już domyślem).
- `.entity-category` `padding` wyzerowany; padding przeniesiony do `.entity-category-summary` i `.entity-category-list` — dzięki temu cały obszar summary (nie tylko tekst) jest klikalny i rozszerza się do krawędzi borderu.
- Nowe `.entity-category-summary`: `list-style: none` + `::-webkit-details-marker { display: none }` ukrywa natywny trójkąt w Chrome/Safari/Firefox.
- `::before` z `›` jako chevron, rotacja `90deg` gdy `details[open]`.

### Task 3: Manual verification

**Files:**
- None (weryfikacja runtime)

- [ ] **Step 1: Uruchom dev server**

Run: `npm run dev`

- [ ] **Step 2: Otwórz http://localhost:5173 i zweryfikuj sekwencję**

Checklist (wszystko musi działać):

1. **Start:** 7 kategorii jedna pod drugą, wszystkie zwinięte. Chevron `›` widoczny przy każdej. Body kategorii (lista encji) niewidoczne.
2. **Klik w nagłówek kategorii** (w obszar z tekstem, licznikiem, lub pustą przestrzeń summary — NIE w checkbox): kategoria się rozwija. Chevron obraca się o 90° (teraz wskazuje w dół). Widoczna lista encji.
3. **Ponowny klik w nagłówek:** kategoria się zwija. Chevron wraca do pozycji `›`.
4. **Klik w tri-state checkbox zwiniętej kategorii** (bez rozwijania): wszystkie encje w kategorii zostają zaznaczone/odznaczone. Licznik `(X/Y)` aktualizuje się. Kategoria pozostaje zwinięta (NIE rozwija się).
5. **Klik w tri-state checkbox rozwiniętej kategorii:** jak wyżej + wszystkie checkboxy w widocznej liście zmieniają stan. Kategoria pozostaje rozwinięta.
6. **Klik w pojedynczą encję w rozwiniętej kategorii:** przełącza stan tej jednej encji. Tri-state checkbox w nagłówku aktualizuje stan (checked/indeterminate/unchecked). Licznik `(X/Y)` odświeża się.
7. **Odświeżenie strony (F5):** wybór encji zachowany (localStorage `pii.selected-entities`). Wszystkie kategorie ponownie zwinięte (stan rozwinięcia NIE jest persystowany — zgodne ze specem).
8. **Przycisk "Anonimizuj":** działa tak samo jak przed zmianą (enablement reaguje na selekcję).

Jeśli którykolwiek punkt nie przechodzi — zdiagnozuj, fix, powtórz.

- [ ] **Step 3: Commit**

```bash
git add src/ui/entity-selector.js src/style.css
git commit -m "$(cat <<'EOF'
feat(ui): collapsible entity categories (stacked, default collapsed)

Kategorie w selektorze encji stackują się pionowo (jedna per wiersz) i są
domyślnie zwinięte. Tri-state checkbox w nagłówku nadal toggluje całą
kategorię bez rozwijania. Zmniejsza pionową powierzchnię zajmowaną przez
selektor z ~siedmiu boxów gridowych do siedmiu zwijanych wierszy.

Szczegóły w docs/superpowers/specs/2026-04-18-collapsible-entity-categories-design.md.
EOF
)"
```
