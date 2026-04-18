# Collapsible entity categories

## Problem

Selektor encji na frontendzie (`src/ui/entity-selector.js`) renderuje 7 kategorii
w siatce (`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`) z pełną
listą encji w każdej. Przy obecnej liczbie kategorii zajmuje to większość ekranu
zanim user w ogóle dotrze do pola wklejania tekstu.

## Rozwiązanie

Kategorie jedna pod drugą (pełna szerokość), każda domyślnie zwinięta, rozwijana
kliknięciem nagłówka. Nagłówek pozostaje w pełni funkcjonalny: tri-state checkbox
nadal pozwala zaznaczyć/odznaczyć wszystkie encje w kategorii bez rozwijania.

## Decyzje

- Nagłówek zwiniętej kategorii: tri-state checkbox + label + licznik `(X/Y)` +
  chevron wskazujący stan (opcja A z pytania 1).
- Stan zwinięte/rozwinięte **nie** jest persystowany — każde odświeżenie strony
  zaczyna ze wszystkim zwiniętym (opcja A z pytania 2).
- Brak globalnego przycisku "rozwiń wszystkie / zwiń wszystkie" — każdą kategorię
  rozwija się osobno (opcja A z pytania 3).

## Zakres zmian

Tylko dwa pliki:
- `src/ui/entity-selector.js` — zmiana struktury DOM.
- `src/style.css` — układ siatki i stylowanie chevrona.

Logika zaznaczania (`state: Set`, `onChange`, `refreshCategoryState`,
`setSelected`, `getSelected`, persistencja wyboru w `localStorage` pod
`pii.selected-entities`) pozostaje nietknięta.

### Struktura DOM

Każda kategoria: `<details>` (bez `open`) zamiast obecnego `<fieldset>`,
`<summary>` zamiast `<legend>`. Wewnątrz `<details>` ta sama lista
`<label class="entity-row">` co teraz.

```
<details class="entity-category" data-category-id="...">
  <summary>
    <label class="entity-category-label">
      <input type="checkbox"> Personal Identity
      <span class="entity-category-count">(3/6)</span>
    </label>
  </summary>
  <div class="entity-category-list">
    <label class="entity-row">...</label>
    ...
  </div>
</details>
```

### Interakcje

- Klik w checkbox nagłówka (zarówno sam input jak i tekst labela): toggluje
  wszystkie encje w kategorii; **nie** rozwija ani nie zwija kategorii.
  Realizacja: `click` listener na całym elemencie `<label class="entity-category-label">`
  wywołujący `e.stopPropagation()`. To wystarczy, bo `<details>` toggluje się na
  eventcie `click` docierającym do `<summary>`, a zatrzymanie propagacji na
  poziomie labela blokuje zarówno kliknięcie w input (native) jak i w tekst
  labela (który synthesisuje click na inpucie — ten też zostaje przechwycony).
- Klik w resztę `<summary>` (label tekst, licznik, chevron, pusta przestrzeń):
  natywne rozwijanie/zwijanie przez `<details>`.
- Zaznaczenie pojedynczej encji wewnątrz rozwiniętej kategorii: bez zmian.

### Stylowanie

- `.entity-selector`: `display: flex; flex-direction: column; gap: 0.75rem;`
  (usunąć `grid-template-columns` i media query `max-width: 640px`).
- `.entity-category` (było `fieldset`): usunąć `fieldset`-specyficzne reguły jeśli
  są, zachować border/border-radius/padding.
- `summary::before`: pseudo-element chevron `▶` (lub `›`), rotacja `90deg` gdy
  `details[open] > summary::before`, transition.
- Ukryć natywny marker: `summary::-webkit-details-marker { display: none; }` oraz
  `summary { list-style: none; }`.
- `summary`: `cursor: pointer; user-select: none;` dla wygody.

## Testowanie

Brak testów jednostkowych dla selektora (sprawdzone: `src/ui/` nie ma plików
`*.test.js`). Weryfikacja manualna w `npm run dev`:
- start: wszystkie kategorie zwinięte
- klik w nagłówek rozwija; klik ponownie zwija; chevron się obraca
- klik w tri-state checkbox w zwiniętej kategorii: zmienia stan zaznaczenia
  wszystkich encji w kategorii, kategoria pozostaje zwinięta
- licznik `(X/Y)` odświeża się na bieżąco
- selekcja pojedynczej encji w rozwiniętej kategorii działa
- `localStorage` (`pii.selected-entities`) nadal zapisuje i wczytuje wybór

## Co zostaje poza zakresem

- Globalny przycisk expand/collapse all (odrzucone w pytaniu 3).
- Persystencja stanu rozwinięcia (odrzucone w pytaniu 2).
- Zmiana layoutu wewnątrz rozwiniętej kategorii (np. dwukolumnowa lista encji).
- Animacje rozwijania inne niż domyślne dla `<details>`.
