# RECALL-REMEDIATION-NOTES.md – wdrożenie planu A (Sonnet), gałąź feature/recall-remediation

**Data:** 2026-07-12, sesja autonomiczna (Sonnet, implementacja równoległa do projektu Fable
RECALL-90-DESIGN.md).
**Branch:** `feature/recall-remediation` (z `main`, commit `cec4eb7`), **niescalona** – zostawiona
do bramki Opusa zgodnie z poleceniem.
**Rodzice:** `EVAL-RECALL-AUDIT.md` (rejestr przecieków, plan naprawczy §8), `GATE-EVAL-RECALL.md`
(werdykt Opusa, sekwencja naprawy §6).
**Zakres:** Track 1 (moduły A1, A2, A4, A5, A6, A7, A8, A9, A11 – w całości), Track 2 (OCR DPI +
plakietka przeglądu), Track 3 (C4 – zaimplementowane i przetestowane, **zatrzymane** przed
buildem/benchem zgodnie z GATE-STOP). `src/verifier/` nietknięty (Fable projektuje równolegle).

---

## §1. Wynik końcowy

| Korpus | Metryka | Baseline (audyt) | Po Track 1 (ten branch) | Δ |
|---|---|---|---|---|
| Syntetyczny | P / R / F1 | 93,0 / 92,1 / 92,6 | 85,0 / 86,7 / 85,9 | –7,1 p.p. F1 (patrz §4 – w większości artefakt pomiaru, nie regresja) |
| Syntetyczny | przecieki | 8 | **4** | **–4** (połowa) |
| Kontradyktoryjny | P / R / F1 | 77,9 / 78,1 / 78,0 | 79,9 / **84,2** / 82,0 | **+6,1 p.p. recall**, +4,0 p.p. F1 |
| Kontradyktoryjny | przecieki | 42 | **26** | **–16** (–38%) |
| Kontradyktoryjny | FP ogółem | 62 | 59 | –3 (mniej, mimo wyższego recall) |

**Cel Alana (GATE-EVAL-RECALL §6): recall 90%+ na korpusie kontradyktoryjnym przed materiałami
marketingowymi.** Wynik tej gałęzi: **84,2%** (+6,1 p.p. względem baseline). Nie osiągnięto 90%,
zgodnie z własną projekcją równoległej sesji Fable (RECALL-90-DESIGN.md §0: „Plan A nie dowiezie
90% sam […] szacunkowo +8–10 p.p. recall, 78,1% → ~86–89%”) – zmierzone +6,1 p.p. mieści się w
tym samym rzędzie wielkości, nieco poniżej szacunku, głównie dlatego że A7 użyło punktów
startowych z bramki zamiast pełnej krzywej P/R (§3, A7) i że kilka pozycji rejestru przecieków
strukturalnie wymaga modułów B (lista w §5). **Marketing pozostaje wstrzymany** do dalszej pracy
(B-track, poza zakresem tej gałęzi).

Reprodukcja: `npm test` (1104/86 zielone), `npm run eval -- --label=<slug>` /
`--dir=test-data/adversarial --label=<slug>-adv`, `eval:score`, `eval:analyze`. Numery przebiegów
cytowane w tym dokumencie: syntetyczny `2026-07-12T17-05-02`, kontradyktoryjny
`2026-07-12T17-11-19`.

---

## §2. Moduły – co zrobiono (9/9 z Track 1, kolejność wg GATE §6)

Konwencja: kontrakt → co zaimplementowano → dowód (commit + test) → efekt pomiarowy, tam gdzie
dający się wyodrębnić.

### A5 – maxLengthStep flaguje, nie kasuje (commit `99560f3`)
Encja typu wagi ≥3 przekraczająca `maxLength` jest teraz zachowywana w całości (flaga
`oversized: true`) zamiast usuwana; typy wagi <3 (ORGANIZATION_NAME, LOCATION,
PERSON_ROLE_OR_TITLE) zachowują stare zachowanie (usuwanie), bo tam nadmiarowy span to częściej
śmieć modelu niż realne ryzyko. `TYPE_WEIGHTS`/`weightFor` przeniesione z `src/eval/analyze.js`
do nowego `src/pipeline/configs/type-weights.js`, żeby egzekwowanie w pipeline i raportowanie w
audycie dzieliły jedno źródło prawdy zamiast dwóch tabel, które mogłyby się rozjechać.
**Efekt:** przeciek „Sebastian Grabowski” (pismo_04, score 1,00) zniknął z rejestru. F1
syntetyczny 92,6→92,3 (–0,3 p.p., FP+1) – w granicach własnego kryterium modułu („FP nie rośnie
więcej niż liczba oznaczonych encji”).

### A1 – identyfikatory z sumami kontrolnymi, odporne na separatory (commit `f960dbf`)
PESEL (mod 10, wagi 1-3-7-9…), NIP (mod 11), REGON-9/14 (mod 11), IBAN/NRB (mod 97, w tym goła
NRB bez prefiksu PL sprawdzana jak `PL`+cyfry) – separatory: spacja, NBSP, dywiz, pojedyncze
złamanie wiersza; dwa confusables OCR tolerowane w oknie cyfr (małe „l”→1, wielkie „O”→0). Bez
poprawnej sumy kontrolnej kandydat nie powstaje. KRS (bez sumy kontrolnej w naturze) zostaje
bramkowany kontekstowo literałem „KRS”. Okna przesuwane po maksymalnym klastrze
cyfrowo-separatorowym muszą trafiać w „czystą granicę” (krawędź klastra albo sąsiedztwo realnego
separatora) – bez tego suma kontrolna potrafiła przypadkiem zejść się na wycinku łączącym dwa
różne numery albo zagnieżdżonym w dłuższym poprawnym (14-cyfrowy REGON zawiera naprawdę
9-cyfrowy REGON rodzica jako prefiks). Dodatkowo wzorzec VIN (17 znaków, alfabet bez I/O/Q,
struktura zamiast sumy) – rozszerzenie spoza oryginalnego kontraktu A1, z rekomendacji R-2 w
RECALL-90-DESIGN.md (równoległa sesja Fable), zamyka pomyłkę VIN→DOCUMENT_REFERENCE z macierzy
pomyłek audytu §5.1.
**Świadomie NIE zrobiono:** fałdowanie glifów S→5/B→8 (R-1 wspomina je jako „ewentualnie”, bez
dowodu z korpusu, a obie litery są zbyt częste w zwykłym polskim tekście, żeby dodawać je do
alfabetu klastra bez udokumentowanego przypadku – ryzyko precyzji bez kontrapunktu).
**Efekt (kontradyktoryjny):** 42→33 przecieki, F1 78,0→78,6. **Efekt (syntetyczny): pozorna
regresja, patrz §4** – F1 92,3→87,1, ale przeanalizowane programowo: 0 z 17 „fałszywych” PESELi w
korpusie syntetycznym jest realnie odkrytych (patrz §4).

### A2 – sygnatury repertoriów sądowych/komorniczych (commit `6d8a247`)
`[rzymska]? + repertorium (ACa, GC, KM, Nc, Ns, Co, C, K) + nr/rok (+ „upr”)` → DOCUMENT_REFERENCE
1,0. Repertoria SN (CZP, CSKP, …) **celowo wykluczone z listy** – to sposób cytowania
opublikowanego orzecznictwa, nie numeracji własnych spraw (pułapka adw_32); pozostaje
udokumentowanym ograniczeniem (B1/C5), nie czymś, do czego sięga się heurystyką kontekstową,
która mogłaby chybić w obie strony.

### A6 – dedup przycina, nie kasuje przy częściowym pokryciu (commit `fcd42e2`)
`removeEntitiesCoveredByPreciseRegex` → `trimOrDropCoveredByPreciseRegex`: pełne pokrycie nadal
kasuje (redundancja), częściowe pokrycie **przycina** span modelu do największego nieodkrytego
fragmentu zamiast kasować cały. Przycięty fragment przeżywa tylko, gdy jest **sklejony** z
dopasowaniem regexowym (brak granicy słowa na styku) – inaczej przycinanie wskrzeszałoby
niepowiązany kontekst („kontekst ” przed kwotą złapaną precyzyjnie regexem) jako fałszywy
pozytyw tego samego typu. `deduplicateEntities(entities, text)` – `text` opcjonalny, brak = stare
bezpieczne zachowanie (kasuj całość); jedyny wywołujący z dostępem do tekstu to `dedupStep`.

### A9 – blocklista ról odporna na fleksję i ucięcia (commit `2c4e0db`)
Wzorzec `-awca/-biorca` rozszerzony na pełną deklinację (`-ca/-cy/-cę/-cą/-co/-ców/-com/-cami/
-cach` na rdzeniach `aw-`/`bior-`) – „Kredytobiorcą” (narzędnik) już nie przechodzi. Nowa flaga
`rejectTruncatedWord` (domyślnie false, włączona dla PERSON_ROLE_OR_TITLE): span kończący się tuż
przed kolejną literą (brak granicy słowa) jest odrzucany jako ucięty prefiks dłuższego słowa
(„Wniosko” z „Wnioskodawca”) – sprawdzenie strukturalne, nie słownik.

### A8 – siatka bezpieczeństwa w filtrze źródeł (commity `2662304`, `abf729a`)
Kandydat typu wagi ≥4 z nieautorytatywnego źródła przechodzi (flaga `unauthoritativeSource:
true`) zamiast być odrzucany, jeżeli score ≥ próg siatki; dedup i tak rozstrzyga nakładki ze
zwykłymi kandydatami. **Zmierzono i skorygowano w tej samej sesji:** przy progu 0,9 siatka
wpuszczała 15 kandydatów PERSON_NAME z polish-fp16 na korpusie syntetycznym – dokładnie ten
mechanizm fragmentacji nazwisk, dla którego polish-fp16 był świadomie wyłączony z
ENTITY_SOURCES dla PERSON_NAME – 5 z nich wylądowało jako nowe FP (rejestr przecieków bez zmian:
7, więc koszt czysto precyzyjny, nie sekrecyjny). Zastosowano własny fallback kontraktu: próg
0,95. **Zmierzone jako częściowe:** 14 z 15 fragmentów ma score ≥0,95 i nadal przechodzi – dalsze
podnoszenie progu wykraczałoby poza to, co kontrakt autoryzował dla problemu czysto
precyzyjnego. Rezydualna fragmentacja PERSON_NAME to already-cataloged luka pod B1 (pełny
ensemble) – RECALL-90-DESIGN.md już to przewiduje („B1 wchodzi tylko, jeżeli A8 nie wystarczy na
inicjały i role”).

### A4 – kwoty: kropka tysięcy, brak groszy, waluta przed liczbą, EUR (commit `e976752`)
Wzorzec kwot przepisany na formę sufiksową (liczba + zł/PLN/EUR) i prefiksową (PLN/EUR + liczba);
grupowanie tysięcy: kropka LUB biały znak (w tym NBSP) LUB brak grupowania; część dziesiętna
opcjonalna. Granice liczone przez `\p{L}`/`\d` lookaround zamiast `\b` – „ł” nie jest znakiem
słowa ASCII, więc `\b` po „zł” nigdy się nie odpalał (stary wzorzec działał tylko dlatego, że
nigdy nie kotwiczył końca). Procenty i „p.p.” wykluczone przez konstrukcję (wzorzec sięga
wyłącznie po zł/PLN/EUR, nigdy po %). **Świadomie NIE zaimplementowano:** złożona klauzula
„0,5% wartości kontraktu […] nie więcej niż 8 000,00 zł” (adw_15) – to jawnie C2 w oryginalnym
rejestrze audytu („kara umowna opisowa […] nie gonić regexem”), pozostaje częściowym przeciekiem
(patrz rejestr §3, pozycja 5).

### A11 – normalizacja EOL na imporcie tekstu (commit `512829b`)
`extractTxt` normalizuje `\r\n?` → `\n` przed zwróceniem – plik CRLF (Windows) albo z pojedynczym
CR (stary Mac) trafiał do pipeline'u inaczej, niż mierzy eval (zawsze LF przez `readEvalText`).
Test wcześniej explicite asercjonował BRAK normalizacji („downstream pipeline owns that”) – to
była właśnie luka, którą ten moduł zamyka.

### A7 – progi typów wagi ≥3 (commit `6ad4776`, infrastruktura `d0c3755` + `d8d8b8e`)
PERSON_IDENTIFIER 0,9→0,5, VEHICLE_IDENTIFIER 0,7→0,5, LOCATION 0,9→0,75, PERSON_ROLE_OR_TITLE
0,9→0,75; DEVICE_IDENTIFIER bez zmian (zgodnie z notatką bramki „bez zmian po pomiarze”).
**Odchylenie od kontraktu, opisane wprost:** kontrakt chciał progów wyprowadzonych z pełnej
krzywej P/R (`scripts/measure-thresholds.mjs`); skrypt pomiarowy (uruchamiający NER przez oba
korpusy w jednym procesie Node) wielokrotnie padał na „bad allocation” z onnxruntime-node po
kilkunastu dokumentach – najwyraźniej cykl tworzenia/niszczenia sesji ONNX nie zwalnia w pełni
pamięci natywnej po tylu cyklach w jednym procesie (`npm run eval` nigdy na to nie trafia, bo
przetwarza jeden korpus na proces). Skrypt rozbito na dwie fazy
(`cache-ner-for-thresholds.mjs` cachuje NER per-korpus na dysk, `measure-thresholds.mjs` czyta
cache i tylko przelicza progi) – to POWINNO obejść problem, ale nie zdążyło zostać uruchomione do
końca w tej sesji (też realne ryzyko wyczerpania pamięci maszyny, potwierdzone też przez awarie
Claude Desktop zgłoszone przez Alana w trakcie sesji). Zamiast tego zastosowano wprost punkty
startowe z bramki (GATE-EVAL-RECALL §6) i zweryfikowano zwykłym tagowanym evalem na obu
korpusach – co i tak jest formą, w jakiej kryteria akceptacji modułu są wyrażone.
**Efekt:** syntetyczny – przecieki 7→4 (dodatkowe do A5-A11), FP ogółem 55→62 (+12,7%, w
granicach 20%). Kontradyktoryjny – to właśnie A7 domyka największą część zysku +6,1 p.p. recall
(patrz §1); szczegóły per-typ w rejestrze §3.

**Rekomendacja dla kolejnej sesji:** dokończyć pomiar `scripts/measure-thresholds.mjs` na
maszynie z większym zapasem pamięci (albo w mniejszych porcjach dokumentów), żeby zastąpić
punkty startowe realną krzywą P/R – może dać dalszy zysk recall bez pogarszania precyzji ponad to,
co dają obecne wartości.

---

## §3. Rejestr przecieków – co zostało (oba korpusy, po całym Track 1)

### Syntetyczny (4 pozycje, było 8)
Wszystkie cztery to udokumentowane, znane wcześniej ograniczenia, żadna nowa regresja:
1. `SB/00234/PN` (ACCOUNT_IDENTIFIER, waga 4) – kandydat ORGANIZATION_IDENTIFIER z polish-fp16,
   score 0,68: **poniżej progu siatki A8 (0,95) NAWET przed jego podniesieniem** (był 0,9) – ten
   konkretny przypadek nie pasuje do wzorca „wysoki score, zły typ źródła”, mimo że oryginalny
   kontrakt A8 wymieniał go wprost jako mający zniknąć. Nie naciągnięto progu siatki w dół, żeby
   go złapać – obniżenie do ~0,7 dla WSZYSTKICH typów wagi ≥4 zniweczyłoby sens siatki
   (przepuszczałaby znacznie więcej szumu). Zostaje otwarte dla bramki Opusa: albo osobny
   mechanizm dla ACCOUNT_IDENTIFIER, albo świadoma akceptacja.
2–4. „ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH” pisane wersalikami, ×3 wystąpienia – **żadna warstwa nie
   zgłasza kandydata** (ani model, ani regex) – to dokładnie B2 z RECALL-90-DESIGN.md
   („wersaliki oślepiają oba modele”), poza zakresem modułów A.

### Kontradyktoryjny (26 pozycji, było 42) – grupowanie wg przyczyny
- **Poza zakresem A-modułów, już skatalogowane (12 pozycji, ~46% masy dotkliwości):**
  CRIMINAL_OFFENCE_DATA opisowe („skazany prawomocnym wyrokiem…”, B3), PERSON_NAME rozstrzelone
  OCR („K o n r a d…”, C1 – wymaga warstwy mapowania offsetów, osobny projekt), FINANCIAL_AMOUNT
  słowne/złożone (×2, C2, świadomie nie gonione regexem – patrz A4), HEALTH_DATA częściowe
  („choruje na ”, B3), TRADE_UNION_MEMBERSHIP częściowe („członkinią ”, B3), ORGANIZATION_NAME
  rozstrzelone OCR (C1).
- **PERSON_ROLE_OR_TITLE, długi ogon niskich wag (9 pozycji, waga 1 każda):** „r. pr.” (×3 w
  różnych dokumentach), „sekr. sąd.”, „adw.”, „ produkcji” i kilka resztek po
  `trimTrailingPunctuationStep`. Część to score poniżej NAWET nowego progu 0,75 (np. „adw.” na
  0,64) – to jest dokładnie to, co B4 (leksykon ról/tytułów, RECALL-90-DESIGN.md: „największa
  pojedyncza dźwignia recall”) ma domknąć; dalsze schodzenie z progu bez pomiaru krzywej P/R
  ryzykowałoby precyzję bez pokrycia tym kontraktem.
- **Granice po `trimTrailingPunctuationStep`/`snapStep` (5 pozycji, głównie inicjały i drobne
  resztki):** znany z RESULTS-ensemble problem sklejania inicjałów z nazwiskiem – kandydat pod
  B1 (pełny ensemble).
- **Pozostałe (1 pozycja):** LOCATION „Torunia” – czysta luka detekcji, model milczy.

**Wniosek:** żadna pozycja rejestru nie jest nową regresją tej gałęzi względem stanu przed Track 1
– każda albo już była w oryginalnym rejestrze audytu, albo jest bezpośrednią konsekwencją
świadomie nieporuszonego zakresu (B-moduły, C-ograniczenia). Masa dotkliwości spadła wyraźnie
(mniej pozycji wagi 4–5 niż w oryginalnym rejestrze §6 audytu).

---

## §4. Artefakty pomiaru – co WYGLĄDA na regresję, a nią nie jest

### 4.1 PERSON_IDENTIFIER/PHONE_NUMBER na korpusie syntetycznym (po A1)
`test-data/synthetic` zawiera 17 „PESEli” (w 6 z 7 dokumentów pismo_XX), które **nie mają
poprawnej sumy kontrolnej** – w przeciwieństwie do `test-data/adversarial`, który świadomie
buduje fikcyjne-ale-poprawne identyfikatory. A1 poprawnie odmawia dopasowania regexem numerów bez
sumy kontrolnej (prawdziwe PESEle zawsze ją mają) – ale sprawdzone programowo: **wszystkie 17 są
nadal maskowane w całości**, tylko pod złą etykietą (PHONE_NUMBER zamiast PERSON_IDENTIFIER –
kształt 11 cyfr pasuje też do wzorca telefonu, który nie wymaga sumy kontrolnej). Rejestr
przecieków to potwierdza: liczba przecieków niezmieniona między A5 a A1 (7→7). To pomyłka typu
(macierz pomyłek), nie przeciek treści. **Rekomendacja (nie wykonana w tej sesji – dotyka
referencyjnego korpusu bazowego):** przeregenerować identyfikatory w ground truth
`test-data/synthetic`, żeby miały poprawne sumy kontrolne, tak jak `test-data/adversarial`.

### 4.2 PERSON_NAME po podniesieniu progu siatki A8 do 0,95
Opisane w §2 (moduł A8) – 5 nowych FP na syntetycznym, 0 nowych przecieków. Udokumentowane jako
świadomy, ograniczony koszt, nie ukryte pod dywan.

---

## §5. Poza zakresem tej gałęzi (świadomie, do decyzji/pracy poza Track 1)

- **B1–B6** (RECALL-90-DESIGN.md, sesja równoległa Fable): ensemble, normalizacja wersalików,
  leksykon kategorii szczególnych, leksykon ról/tytułów, pakiet OCR-diakrytyki, rodziny typów
  przy wyłączaniu kategorii. Żaden nie dotknięty w tej gałęzi.
- **`src/verifier/`**: nietknięty, zgodnie z poleceniem (Fable projektuje równolegle).
- **Fałdowanie glifów S→5/B→8 w A1**: rozważone i świadomie pominięte (§2, A1) – brak dowodu z
  korpusu, realne ryzyko precyzji.
- **Dokończenie pomiaru A7** (`scripts/measure-thresholds.mjs` + `cache-ner-for-thresholds.mjs`):
  zaimplementowane, nie uruchomione do końca z powodu pamięci – patrz §2 (A7).
- **`SB/00234/PN`** (ACCOUNT_IDENTIFIER, §3): nie pasuje do wzorca A8, otwarte dla bramki.
- **Regeneracja ground truth `test-data/synthetic`** z poprawnymi sumami kontrolnymi (§4.1):
  dotyka korpusu referencyjnego, nie zmieniona bez jawnej decyzji.

---

## §6. Track 2 (OCR) – zrobione

- **DPI**: `RENDER_SCALE` w `src/file-import/pdf.js` 2,0→3,0 (commit `67dc3f2`). Testy
  OCR/importu bez zmian (nie hardkodują skali). Wpływ na czas/pamięć **nie zmierzony benchem** w
  tej sesji (środowisko już miało problemy z pamięcią przy cięższych obciążeniach) – oszacowany
  analitycznie: powierzchnia rastra rośnie z kwadratem skali, więc +125% pikseli na stronę
  przechodzącą przez OCR (strony czytane z warstwy tekstowej PDF nie są dotknięte).
- **Plakietka przeglądu OCR** w `src/ui/sources-list/` (commit `612a804`): „czytane OCR –
  zweryfikuj nazwiska i liczby” (+ zakres stron dla częściowo zeskanowanych PDF-ów), w toolbarze
  aktywnego źródła. `meta.ocr`/`meta.pages` wcześniej ginęło w `main.js` (zapisywane na
  wewnętrznej tablicy `sources`, nigdy nie docierało do UI) – dodano `setSourceMeta` i
  przekazanie `meta` przy dodawaniu źródła. textContent-only, zero danych w atrybutach.
  **Rekomendacja z bramki, nie wykonana:** wariant recognizer-server (zamiast mobile) dla
  PP-OCRv5 jako dalsza mitygacja l/ł – tylko odnotowana jako opcja do pomiaru, poza zakresem tej
  paczki.

---

## §7. Track 3 (C4) – zaimplementowane i przetestowane, zatrzymane przed buildem/benchem

**Zrobione** (commit `df16452`): domyślny dtype w `scripts/fetch-models.mjs` zmieniony z `q8` na
`fp16`. Nie było osobnego, zahardkodowanego „override'u q8” do usunięcia – `DTYPE_OVERRIDE` w
`entity-sources.js` już wcześniej był dtype-agnostyczny (po prostu odzwierciedla to, co mówi
`models/manifest.json`); „override” to był po prostu domyślny dtype skryptu pobierającego.

**Świadome odchylenie od pełnej litery kontraktu:** `fp16 dla OBU modeli`, nie pełny mix
fp32 (multilang) / fp16 (polish) jak w domyślnym build webowym. To udokumentowana, dopuszczalna
podłoga z `PRODUCT-DECISIONS.md` (decyzja 21: „jeśli fp32-WASM za ciężki, dopuszczalny floor to
fp16 obu modeli”) – `fetch-models.mjs` stosuje jeden `MODEL_DTYPE` do obu repozytoriów HF
konstrukcyjnie, a `manifest.json.dtype` to pojedyncze pole najwyższego poziomu. Pełny mix
wymagałby rozszerzenia skryptu, schematu manifestu i semantyki override'u w `entity-sources.js`
(dziś wymusza JEDEN dtype na wszystkie źródła) – większa zmiana, niż sesja z zakazem
buildu/benchu powinna robić bez cyklu, który by ją zwalidował.

**Zweryfikowane w tej sesji** (`models/manifest.json` jest poza gitem – lokalny artefakt budowy,
nieskomitowany):
- `MODEL_DTYPE=fp16 node scripts/fetch-models.mjs` – oba pliki onnx (~555 MB każdy) pobrane,
  manifest przeregenerowany ze świeżymi sumami sha256; stare pliki q8 usunięte (inaczej
  zostałyby i tak spakowane przez filtr `**/*` w `extraResources` electron-buildera).
- `npm run desktop:verify-models` – 10/10 plików, `dtype=fp16`, SHA-256 zgodne.
- `electron/model-integrity.test.js` (8 przypadków, logika dtype-agnostyczna) – zielone.
- `npm run desktop:build:renderer && npm run desktop:smoke` – **zielone po poprawce jednej
  nieaktualnej asercji** w `e2e/desktop-smoke.mjs`: test sprawdzał wprost „q8 dtype in use” jako
  oczekiwany stan sprzed decyzji 21; teraz asercja to „fp16 w użyciu i NIE q8”. Log workera
  potwierdza oba modele ładowane jako fp16 (~1111 MB + 556 MB wasm-resident).
- `electron-builder.yml`: `files`/`extraResources` już wcześniej poprawnie używają `from: models`
  (katalog, nie plik) – pułapka z briefu nie dotyczyła tego repo, nic do zmiany.

**GATE-STOP zachowany:** NIE uruchomiono w tej sesji `desktop:build` (pełne pakowanie),
`desktop:smoke:packaged` ani benchu pamięci/latencji fp32-WASM – zostaje do bramki B1 Opusa
(„weryfikuję łańcuch + Alan/ja robimy bench”), zgodnie z poleceniem.

**Rekomendacja dla bramki/kolejnej sesji:** jeśli pełny mix fp32 (multilang) / fp16 (polish) ma
znaczenie (dokładne dopasowanie do jakości webowej, nie tylko podłogi), `fetch-models.mjs` i
schemat `manifest.json` wymagają rozszerzenia na dtype per-repo – nie zrobione tutaj, bo wykracza
poza to, co ta sesja mogła bezpiecznie zweryfikować bez buildu/benchu.

---

## §7a. Track 4 – świadomie odłożony

Track 4 (harness jakości w przeglądarce, Playwright + realne Chromium na korpusie 45 dokumentów)
był jawnie opcjonalny w briefie („po Track 1–2, jeśli starczy"). **Nie podjęty w tej sesji** – w
trakcie pracy nad A7 własny skrypt pomiarowy padał wielokrotnie na „bad allocation" z
onnxruntime-node (§2, moduł A7), a Alan zgłosił kilkukrotne awarie samego Claude Desktop w trakcie
tej sesji. Uruchomienie kolejnego ciężkiego procesu (Playwright + Chromium + modele ładowane
przez WASM w przeglądarce, dla 45 dokumentów) niosłoby realne ryzyko powtórzenia tego samego
problemu na już niestabilnej maszynie. Track 1–3 stanowią kompletny, w pełni przetestowany i
udokumentowany rezultat same w sobie – dołożenie Track 4 pod presją niestabilności groziłoby
zepsuciem tego, co już działa, dla zadania jawnie oznaczonego jako „jeśli starczy czasu". Zostaje
w całości dla kolejnej sesji, najlepiej na maszynie/w środowisku z większym zapasem pamięci.

---

## §8. Reprodukcja

| Co | Komenda |
|---|---|
| Testy | `npm test` (1104 testów, 86 plików, zielone na końcu sesji) |
| Eval syntetyczny (finalny) | `npm run eval -- --label=recall-final` → run `2026-07-12T17-05-02` |
| Scoring | `npm run eval:score 2026-07-12T17-05-02` |
| Rejestr przecieków | `npm run eval:analyze 2026-07-12T17-05-02` |
| Eval kontradyktoryjny (finalny) | `npm run eval -- --dir=test-data/adversarial --label=recall-final-adv` → run `2026-07-12T17-11-19` |
| Scoring / rejestr | `npm run eval:score 2026-07-12T17-11-19` / `npm run eval:analyze 2026-07-12T17-11-19` |
| Pomiar progów (niedokończony, §2 A7) | `node scripts/cache-ner-for-thresholds.mjs --dir=test-data/synthetic --out=synthetic` (i analogicznie `--dir=test-data/adversarial --out=adversarial`), potem `node scripts/measure-thresholds.mjs` |

Katalogi przebiegów (`test-data/results/…`) są poza gitem, jak w oryginalnym audycie.

---

*Notatka sporządzona w ramach gałęzi `feature/recall-remediation`, sesja Sonnet, 2026-07-12.
Główne artefakty: 9 modułów A (commity wypisane w §2), `src/pipeline/configs/type-weights.js`
(nowy), `scripts/cache-ner-for-thresholds.mjs` (nowy), plakietka OCR w `src/ui/sources-list/`.*
