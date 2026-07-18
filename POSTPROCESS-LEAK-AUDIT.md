# POSTPROCESS-LEAK-AUDIT.md — audyt kanałów wycieku ogona postprocessingu

**Data:** 2026-07-18
**Autor:** Opus (bramka bezpieczeństwa), na kanwie znaleziska 6.5 Sonneta z HC-1.
**Status:** audyt zakończony; klasa „tier-ślepych kanałów drop/re-type" **domknięta** trzema strażnikami lint, skonsolidowanymi w `src/pipeline/configs/tier-safety.js` (commity `f90b130` merge + `9d80edf` maxLength/blocklist), wszystko na `feature/h3-hc2`.
**Powiązane:** `H-3-CLOSURE-DESIGN.md` (kanał H-3), `SCOPE-TIERS-DESIGN.md` (model warstw), `GATE-SCOPE.md` (bramka warstwowości).

---

## 1. Cel i metoda

Znalezisko 6.5 (Sonnet, przy HC-1) pokazało, że `mergeStep` może po cichu przetypować encję `mask` na `pass` i żaden test tego strukturalnie nie łapie. Pytanie audytu: **czy merge to jedyny taki kanał, czy jest ich więcej?**

Metoda: przejść KAŻDY krok ogona postprocessingu (`createPostprocessSteps`, `configs/default.js:102-117`) i dla każdego zadać jedno pytanie:

> Czy ten krok może DROPNĄĆ albo PRZETYPOWAĆ (na mniej chroniącą warstwę) encję warstwy `mask`, w sposób, który po aktywacji `allMask:false` skończy się wyciekiem?

Metoda jest strukturalna (czytanie kodu + niezmienniki configu), nie pomiarowa — dlatego w pełni wykonalna na laptopie, bez modeli i evala, i daje dowody z konstrukcji, nie ze statystyki.

## 2. Model wycieku (dlaczego aktywacja zawęża powierzchnię)

Kluczowa obserwacja: **jedyny krok, który zachowuje się inaczej w `allMask:false` niż w dzisiejszym `allMask:true`, to `tierPartitionStep`** (dropuje warstwę `pass`, bucketuje `review`). Wszystkie kroki przedpartycyjne biegną identycznie w obu trybach (poza `dedup`/`backfill`, które przez `tierOf` w allMask:true wrzucają wszystko do jednego kosza `mask` — kierunek bezpieczny).

Stąd powierzchnia wycieku aktywacji to dokładnie:
1. **Przetypowanie `mask` → `pass` PRZED partycją** — encja będąca PII dostaje etykietę typu `pass`, więc `tierPartition` ją dropuje. To jest kanał H-3.
   - podkanał (a): model taguje PII typem pass (DOCUMENT_REFERENCE / ORGANIZATION_NAME) — zamknięty regexami HC-2 (identyfikatory) + gazeterem/despace (nazwiska),
   - podkanał (b): kandydat mask przegrywa z szerszym kandydatem pass w dedupie — zamknięty frontierem per-warstwa (ST-2, dowód: gole HC-1),
   - podkanał (c): `merge` re-taguje span mask na host pass — **domknięty strażnikiem** (6.5).
2. **`tierPartition` sam dropuje/mis-tieruje encję `mask`** — chroni fail-safe (`tierFor` → domyślnie `mask`).
3. **Krok przedpartycyjny DROPUJE encję `mask`** na podstawie proxy INNEGO niż warstwa — jeśli proxy rozjedzie się z warstwą, encja `mask` znika → wyciek. **To jest klasa, którą ten audyt bada (sekcja 4).**

## 3. Kanały krok po kroku (werdykt)

| Krok | Operacja | Może dropnąć/przetypować mask? | Werdykt |
|---|---|---|---|
| `sourceFilter` | drop po typie (wyłączone typy) | tak, ale **zamierzenie** (config `enabledEntities`) | poza klasą — kompletność configu (decyzja 20: art. 9-10 domyślnie ON) |
| `threshold` | drop po `score` | tak, **zamierzenie** (precyzja) | poza klasą — granica recall; regexy/gazeter mają score 1.0, więc nietykalne. Pytanie projektowe → sekcja 6 |
| `refineFinancialAmount` | reshape (`map`) | nie — tylko FINANCIAL_AMOUNT (review), nigdy nie dropuje | solidny |
| `snap` | reshape do granic słów | nie dropuje (reshape) | solidny (reshape, nie drop) |
| `trimTrailingPunctuation` | reshape (trym końcówki) | nie dropuje | solidny (reshape, nie drop) |
| `blocklist` | **DROP** (wartość/wzorzec/truncate) + trym | **TAK — tier-ślepy** | **domknięty (strażnik B, `9d80edf`)** |
| `maxLength` | **DROP** gdy za-długi i waga < 3 | **TAK — tier-ślepy** | **domknięty (strażnik A, `9d80edf`)** |
| `dedup` | drop nakładających się | tak, ale **tier-aware** (frontier per warstwa) | solidny (dowód: gole HC-1) |
| `merge` | **RE-TYPE** na host | **TAK — tier-ślepy** | **domknięty (strażnik merge, `f90b130`)** |
| `tierPartition` | drop `pass`, bucket `review` | to jest DECYZJA; fail-safe → `mask` | solidny (fail-safe poprawny) |
| `tokenize` | przypisanie tokenów | nie dropuje | solidny |

## 4. Klasa „tier-ślepych kanałów drop/re-type" — domknięta

Trzy kroki podejmowały decyzję drop/re-type na podstawie proxy, które **nie jest warstwą**, i były bezpieczne dziś tylko przez **zbieżność configu**, nie przez gwarancję strukturalną. Każdy dostał czystą funkcję lint w `src/pipeline/configs/tier-safety.js`, uruchamianą na realnym configu w każdym przebiegu CI (`tier-safety.test.js`, 32 testy):

1. **`merge`** — re-typuje span na warstwę właściciela reguły. `findUnsafeMergeRules(rules, tierFor)`: flaguje regułę, w której właściciel (host) jest mniej chroniący niż typ pochłaniany (`rank(mask)=2 > review=1 > pass=0`). Realny config czysty (jedyna reguła międzytypowa `POSTAL_ADDRESS [mask] ⊃ LOCATION [review]` idzie bezpiecznie, mask ≥ review).

2. **`maxLength`** — dropuje za-długą encję gdy `weightFor(typ) < OVERSIZE_WEIGHT_THRESHOLD` (3). `findMaskTypesDroppableByMaxLength(rules, tierFor, weightFor, threshold)`: flaguje mask-typ z `maxLength != null ∧ weight < threshold`. Realny config czysty — jedyny mask-typ z wagą < 3 (`ORGANIZATION_IDENTIFIER`) ma `maxLength: null`. Próg importowany z `max-length.js` (anty-dryf).

3. **`blocklist`** — dropuje encję po wartości / wzorcu / `rejectTruncatedWord`. `findMaskTypesWithDropBlocklist(rules, tierFor)`: flaguje mask-typ z niepustą blocklist/blocklistPatterns lub rejectTruncatedWord. Realny config czysty — tylko PERSON_ROLE_OR_TITLE (review) je deklaruje.

**Zakres invariantu (mask-only, świadomie):** guardy A/B flagują wyłącznie warstwę mask — drop typu review/pass w tych kanałach bywa zamierzony (bloklista PERSON_ROLE to celowe tłumienie szumu na review). Merge-strażnik flaguje też review pochłonięty przez pass (tam to ciche re-tagowanie, nie własne filtrowanie typu).

**Dlaczego lint, nie tier-aware runtime:** uczynienie `maxLength`/`blocklist` tier-aware zmieniłoby zachowanie all-mask (dziś LOCATION waga 2 z maxLength 100 jest dropowana gdy za-długa; tier-aware w all-mask by ją zachowała), łamiąc niezmienność all-mask == dziś udowodnioną w `tier-partition-invariance.test.js`. Lint egzekwuje niezmiennik świata aktywowanego bez dotykania runtime — potwierdzone pustymi diffami `merge.js`/`blocklist.js` i wyłącznie eksportem w `max-length.js`.

## 5. Zweryfikowane jako solidne (bez luki)

- **`tierPartition`** — fail-safe `tierFor` domyślnie `mask` (nieznany/nowy typ maskowany, nigdy przepuszczany); review fully-masked odfiltrowany jako szum; pass dropowany z definicji.
- **`dedup`** — `deduplicateEntities(entities, text, tierOf)`, frontier per-warstwa; mask nie przegrywa z pass (dowód: gole HC-1, 6 realnych wycieków).
- **`refineFinancialAmount` / `snap` / `trim` / `tokenize`** — reshape lub przypisanie, nigdy drop encji mask.

## 6. Pytanie projektowe (do rozważenia przez Alana / Fable, wymaga pomiaru PC)

`threshold` dropuje encję poniżej progu per-typ, **niezależnie od warstwy**. Encja `mask` wykryta przez MODEL z niskim score (np. PERSON_NAME 0,4 przy progu 0,5) jest dropowana → w świecie aktywowanym to wyciek nazwiska, które model JEDNAK widział. Filozofia produktu (PRODUCT-DECISIONS decyzja 20/21: „nadmiar maskowania odwracalny, przeciek nie") **argumentuje za** progiem-podłogą dla warstwy mask (bias ku maskowaniu). To zmienia balans recall/precyzja i wymaga pomiaru na PC — kandydat na projekt Fable (mechanizm + plan pomiaru), nie autonomiczna zmiana. Nie jest to luka strukturalna, tylko strojenie granicy recall.

## 7. Residuum i granice

- Kompletność H-3 dla podkanału (a) (model taguje PII jako pass) jest **ograniczona recall'em detekcji** — regexy/gazeter muszą wyprodukować kandydata mask dla każdego realnego PII. Zamknięto 6 zmierzonych wycieków; „nienazwane" PII tagowane jako pass pozostają możliwe, dlatego **konieczny re-pomiar na holdout na PC (GH-4)** przed werdyktem GATE-H3 i przed aktywacją.
- Strażniki tej klasy chronią przed REGRESJĄ configu (przyszła groźna edycja), nie zastępują pomiaru pokrycia.
- `sourceFilter`/`threshold` to kanały ZAMIERZONE (config/precyzja) — ich „bezpieczeństwo" to kompletność domyślnej konfiguracji i strojenie progów, osobny tor produktowy, nie strażnik strukturalny.

## 8. Wynik

Klasa „tier-ślepych kanałów drop/re-type" domknięta: KAŻDY (merge re-type, maxLength drop, blocklist drop) ma stojącego strażnika CI. Strukturalna strona kanału H-3 kompletna trójwarstwowo: podkanał (a) regexami HC-2, (b) frontierem + goldenami HC-1, (c) strażnikami tej klasy. Do finalnego domknięcia i aktywacji brakuje już tylko pomiaru pokrycia na PC (GH-4) i decyzji Alana O-HC-5/O-HC-6. Runtime bajt w bajt dzisiejszy (lint-only), main nietknięty.
