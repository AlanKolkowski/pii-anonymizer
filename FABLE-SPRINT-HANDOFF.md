# FABLE-SPRINT-HANDOFF — mapa 10 branchy do bramkowania

**Data:** 2026-07-16 (aktualizacja: po awarii workflow przeglądu i po B3).
**Autor:** Fable (sesja implementacyjna, kolejka [1]–[9] + B3 na zlecenie
Opusa). **Odbiorca:** Opus (bramka), wtórnie Alan (decyzje).
**Stan:** wszystkie branche wypchnięte, zero niezacommitowanego WIP,
`npm test` zielony na KAŻDYM branchu przed każdym commitem (liczby niżej).
Nic nie mergowałam. Main i `allMask: true` nietknięte — warstwowość śpi.

Konwencja szczerości: sekcja „Na skróty / niepewne" przy każdym branchu
zawiera wszystko, co sama uważam za słabe, nieudowodnione albo odbiegające
od projektu. Jeżeli czegoś tu nie ma, to znaczy, że o tym nie wiem — nie,
że tego nie ma.

---

## 0. Sprawy przekrojowe (przeczytaj przed bramkowaniem czegokolwiek)

### 0.1 KONFLIKTY MERGE — trzy branche edytują te same linie konfiguracji

`feature/os1-ocr-spacing`, `feature/st5-signatures` i `feature/sg-lite`
każdy dodaje własny alias źródła i każdy zmienia TE SAME miejsca:

- `src/pipeline/configs/entity-sources.js` — mapa `SOURCES` + wiersze
  `ENTITY_SOURCES` (PERSON_NAME edytują dwa branche: os1 i sg-lite),
- `src/pipeline/configs/default.js` — lista kroków `createNerSteps`,
- `src/pipeline/configs/entity-sources.test.js` — oczekiwane listy
  `requiredSources` (test A12 i test unii),
- `src/pipeline/configs/default.test.js` — licznik kroków fazy ner
  (każdy branch zmienia 5→6 U SIEBIE),
- `src/pipeline/cache-orchestrator.js` — okolice budowy `merged`.

Po scaleniu WSZYSTKICH trzech wartości końcowe muszą być:
- kroki `createNerSteps`: **8** (ner, case-folded-ner, despaced-ner, regex,
  lexicon, special-category-lexicon, case-allowlist, gazetteer; kolejność:
  gazetteer OSTATNI — jego slot S3 czyta encje ról z wcześniejszych kroków;
  despaced po case-folded; case-allowlist po lexiconach),
- `requiredSources(defaultEnabledEntities())`: `['case-allowlist',
  'case-folded', 'despaced', 'gazetteer', 'lexicon', 'multilang-fp32',
  'polish-fp16', 'regex']`,
- unia dla `['PERSON_NAME','EMAIL_ADDRESS']`: case-folded, despaced,
  gazetteer, multilang-fp32, polish-fp16, regex.

### 0.2 Kolejność merge

1. **Stos ST:** `st3-bucket-engine` → `st6-mcp-boundary` → `st4-bucket-ui`.
   ST-6 i ST-4 są zbudowane NA ST-3 (rodzeństwo, nie łańcuch). ST-6
   modyfikuje `src/main.review-flow.test.js` (2 asercje — źródło w
   przeglądzie przestaje być czytelne dla mostu); ST-4 tego pliku nie tyka,
   więc rodzeństwo się nie gryzie.
2. **Trio detekcyjne:** os1 / st5 / sg-lite w dowolnej kolejności,
   sekwencyjnie, z ręcznym rozwiązaniem konfliktów wg 0.1.
3. **Reszta:** morph-w1-fleksja, st8-migration, docx-rebuild — praktycznie
   rozłączne (docx-rebuild dodaje `rawLength` w `src/tokens.js` +
   aktualizuje 2 asercje w `src/tokens.test.js`; nic innego tego nie tyka).

### 0.3 Współdzielone working tree — dwa incydenty

W trakcie sesji drzewo robocze zostało DWUKROTNIE przełączone zewnętrznie
(narzędzie „epitaxy"/sesja równoległa). Skutki:

- Mój niezacommitowany WIP ST-4 został zacommitowany przez proces
  zewnętrzny jako `65205be` (autor: Alan) na `feature/st4-bucket-ui`.
  **AKTUALIZACJA: przejrzany linia-po-linii — patrz §9b** (6/7 plików to
  dosłownie mój kod, siódmy to równoważny wariant testu; grep GS-2 czysty).
- `feature/st8-migration` (c0ea2ae) powstał W CAŁOŚCI w sesji równoległej.
  **AKTUALIZACJA: przejrzany linia-po-linii — patrz §9b** (solidny,
  design-faithful; jeden nit komentarzowy przy sygnaturze stempla).

### 0.4 Przegląd kontradyktoryjny NIE odbył się — nie licz na niego

Na polecenie hardeningu odpaliłam workflow: 9 agentów-recenzentów (jeden na
branch, statycznie po `git diff main...branch`) z fazą weryfikacji znalezisk.
**Wszystkich 9 agentów uderzyło w limit sesji i NIE zwróciło wyników** —
puste listy „confirmed" w artefaktach workflow to skutek awarii, nie czysty
przegląd. Spaliło to ~880k tokenów bez rezultatu. Wniosek praktyczny: **jedyną
mapą słabych punktów jest ten dokument (sekcje „Na skróty / niepewne")** —
branche nie przeszły żadnej dodatkowej recenzji poza moimi własnymi testami.
Bramkuj tak, jakby nikt ich po mnie nie czytał, bo nikt ich nie czytał.

**AKTUALIZACJA (po świeżym limicie, sekwencyjnie, bez flot):** (1) dwa
obce commity przejrzane linia-po-linii — §9b; (2) trzy priorytetowe
ścieżki testowe ponownie uruchomione POJEDYNCZO na swoich branchach,
wszystkie zielone: property-test mapy offsetów OS-1 (despace.test.js,
22 testy, w tym 300-dokumentowy seeded fuzz — R-OS-1), test negatywny
ST-6 (mcp-review-boundary + listings, 17 testów — wszystkie 5 narzędzi
mostu grepowane po wartościach kandydatów goldena, zero trafień),
logika decyzji ST-3 (review-engine + review-flow, 33 testy — decyzja
per valueKey, pamięć dokument → rerun → słownik).

### 0.5 Czego NIE zrobiłam globalnie (zakazy sesji)

- Zero `npm run eval` / ładowania modeli. Skutek: wszystkie twierdzenia
  o niezmienności i skuteczności detekcji są udowodnione WYŁĄCZNIE testami
  jednostkowymi i goldenami z mockami. Tagowane przebiegi eval na obu
  korpusach (przed merge os1/st5/sg-lite) — do zrobienia na stacjonarnym PC.
- Zero danych zewnętrznych w repo (SGJP/PoliMorf/PESEL) — cała ścieżka za
  bramką O-3.

---

## 1. `feature/st3-bucket-engine` — silnik kosza W2 (1 commit, 3e9c8a0)

**Wg projektu:** SCOPE-TIERS-DESIGN.md §4.1 (kontrakt silnika ST-3).

**Zrobione:** `src/review-engine.js` — czyste funkcje: klucz `valueKey`
(fold identyczny z tierPartitionStep — `foldValue` wyeksportowany z
`tier-partition.js`), `reviewComplete` (pochodna, brak kandydatów =
complete), decyzje mask/skip per wartość z origin user/bulk/dictionary,
aplikacja „maskuj" przez dodanie encji + postEdit backfill (ten sam
mechanizm co annotation-editor), undo przez `appliedKeys` (diff pozycyjny
encji przed/po aplikacji, łapie też dosiane kopie), `finishReview`
(pending→skip/bulk), słownik trwały alwaysMask/alwaysSkip
(`pii.review-dictionary`, wartości foldowane, parse fail-open do pustego),
`resolveClassifyResult` (rerun: decyzje przeżywają, mask re-aplikowane,
słownik dosypuje TYLKO brakujące). Worker: `result` niesie
`candidates: ctx.reviewCandidates` (zawsze [] pod allMask). main.js: stan
`s.candidates`/`s.reviewDecisions`, rozstrzyganie w handlerze result.

**Testy:** 28 jednostkowych silnika + 5 jsdom okablowania; pakiet 2198.
Pokrywają: golden przepływu (mask→token→undo→jawne), precedencję
dokument>słownik, rerun bez duplikatów, fragmentację przy częściowym
pokryciu, korupcję słownika.

**Na skróty / niepewne:**
- **Fragmenty przy częściowym pokryciu.** §4.1 pkt 3 mówi „span, typ
  i source zachowane". Kandydat CZĘŚCIOWO pokryty encją mask nie może
  wejść całym spanem (applyTokens podmienia po offsetach — nakładki
  KORUMPUJĄ wynik; sprawdziłam mechanikę). Maskuję więc przycięte RESZTY
  jako osobne encje (fragmenty < 2 znaków przepadają). Skutek uboczny:
  legenda dostaje wpisy-fragmenty. Świadome odejście od litery projektu
  wymuszone twardym inwariantem; skomentowane w kodzie.
- **Undo nie cofa dosiewu fuzzy.** `appliedKeys` łapie kopie o tej samej
  foldowanej wartości; `fuzzyBackfill` (couldBeSamePerson) może dosiać
  ODMIANĘ o innej wartości — undo jej nie zdejmie. Identyczne zachowanie
  ma dzisiejszy removeToken w annotation-editorze, więc uznałam za spójne
  z produktem; ale to realna asymetria „cofnięcie przywraca stan".
- Decyzje o kluczach spoza bieżących kandydatów (stale) zostają w Mapie
  jako uśpiona pamięć — celowe, ale znaczy że Mapa rośnie z życiem
  dokumentu.
- Silnik nie ogranicza słownika do żadnych typów — **O-ST-2 (art. 9–10
  na stałe?) jest decyzją GS-3**, kod jej nie przesądza.

**Bramka:** GATE-SCOPE (GS-3 słownik vs D2). Bez ST-4/ST-6 silnik jest
martwy funkcjonalnie (nikt nie woła akcji) — ale stan i transport działają.

---

## 2. `feature/os1-ocr-spacing` — rozstrzelenia OCR (2 commity)

**Wg projektu:** OCR-SPACING-DESIGN.md §2.2, sekwencja §6.1 (OS-1
NER-primary; emisja resztkowa W2 świadomie NIEOBECNA — czeka na OS-2).

**Zrobione:** `src/pipeline/despace.js` (detektor gramatyki: gołe litery
z pojedynczą spacją, klasy T/C, N=4, frazy ≤3 białe znaki, granice), wariant
sklejony z mapą `origPos` + inwariant wierności znakowej sprawdzany PRZED
foldem C (fail-open per segment), `steps/despaced-ner.js` (brama
`ctx.meta.ocrProvenance`, inner createNerStep na wariantach, remap, source
`despaced`), konfiguracja (SOURCES/ENTITY_SOURCES 5 typów jak B2, próg 0,8),
cache-orchestrator (pole `despaced`, merge bramkowany proweniencją TEGO
wywołania), worker/main (flaga z meta importu: `meta.ocr` albo strona
`source:'ocr'`), eval run.js (proweniencja z nazwy pliku zawierającej
„ocr"). **Property-test mapy wszedł w PIERWSZYM commicie, integracja
w drugim** — dokładnie wg R-OS-1.

**Testy:** 22 despace (w tym 300-dokumentowy seeded fuzz: wierność,
monotoniczność, spany wstrzykniętych słów, roundtrip, determinizm)
+ 9 kroku + 6 goldenów pipeline; pakiet 2202.

**Tripwire'y T1–T4: NIE wystąpiły** (mapa przejściowa per krok, ctx.text
nietknięty, gramatyka spacje-only, kontrakty snap/dedup/merge bez zmian).

**Na skróty / niepewne:**
- **Rozszerzyłam gramatykę poza literę projektu:** split WIELKIE→mała po
  biegu ≥2 wersalików (bez tego „W O J E W Ó D Z K I w P o z n a n i u"
  traciło klasę przez doklejony przyimek). Projekt specyfikował tylko
  mała→WIELKA. Uważam to za domknięcie intencji; test przypina.
- **Reużycie `isStructuralMarkerSpan` z B2** na kandydatach despaced —
  NIE ma tego w projekcie OS. Uzasadnienie: sklejony+foldowany nagłówek
  („U M O W A K R E D Y T U"→„Umowa Kredytu") to dokładnie ta sama klasa
  FP, którą B2 zmierzył. Strażnik tylko filtruje (kierunek bezpieczny),
  golden przypina. Do akceptu na bramce.
- **Filtr coversWord** (kandydat musi pokrywać wykryte słowo; kandydaci
  czysto z regionu tożsamościowego odpadają) — moja decyzja w duchu
  gap-guarda B2, nie litera projektu OS.
- Znany limit R-OS-5 przypięty testem: dwa słowa C rozdzielone 1 spacją
  sklejają się w śmieciowy leksem („SĄDREJONOWY") — siatką jest brak
  potwierdzenia NER.
- ~~Zmapowane encje niosą surowe pola modelu (`word` z wariantu ≠ span
  z oryginału)~~ — **DOMKNIĘTE** w przebiegu hardeningowym (commit
  fef2c72): `word` jest zdejmowany przy remapie, mock testowy emituje go
  jak realny pipeline, żeby strip był przypięty.
- **Kryterium 2.3 pkt 2 (bajt w bajt bez flagi) na poziomie korpusu
  NIEUDOWODNIONE** — tylko golden izolacji. Eval na PC przed merge.

---

## 3. `feature/st5-signatures` — allowlista sygnatur + fallback JDG (1 commit)

**Wg projektu:** SCOPE-TIERS-DESIGN.md §5.2 (pkt 1–3, 5), §3.2 pkt 1.

**Zrobione:** `src/pipeline/case-allowlist.js` (parser struktury
`[wydział]? rep numer/rok [upr]?`, matcher z tolerancjami DOKŁADNIE
z kontraktu: NFC, spacje/NBSP/tab, JEDNO złamanie linii, spacje wokół „/",
case-insensitive, rok 2↔4 cyfry tylko przez literalny prefiks „20", „upr"
zawsze opcjonalne w dopasowaniu, wydział literalny I–XX, wpis bez wydziału
rozszerza span na wydział z tekstu), krok ner `case-allowlist` (aktywny
tylko przy niepustej liście; `DOCUMENT_REFERENCE`, score 1.0,
`forceTier:'mask'`), `steps/jdg-review-fallback.js` (pass-tier ORG
z niepokrytą sekwencją NAME_CANDIDATE → `forceTier:'review'`; twardy no-op
pod allMask), przewód: worker configure → cache-orchestrator (skan
NIEcache'owany — wyniki zależą od treści listy, cache NER jest po hashu
tekstu), main.js stan RAM/sesja (O-ST-3 — zero dysku), eval per-dokumentowy
`<nazwa>.options.json`.

**Testy:** 20 parsera/matchera (tabela wariantów + property 500 near-miss:
zero dopasowań innego numeru/roku) + 4 kroku + 7 fallbacku + 6 goldenów
(profil warstwowy: własna sygnatura maskowana, cytowanie SN jawne; pusta
lista bajt w bajt) + 5 tier-aware dedup/merge; pakiet 2204.

**NAJWAŻNIEJSZE dla bramki — dwie zmiany WSPÓLNEGO kodu (materia GS-5):**
1. `trimOrDropCoveredByPreciseRegex` w `src/anonymizer.js` dostał parametr
   `tierOf`: precyzyjny regex-hit warstwy `pass` (DOCKET_RE) POŁYKAŁ
   encję `forceTier:'mask'` o tym samym spanie — zamaskowana sygnatura
   wychodziła jawna. To H-1 w miejscu, którego projekt nie nazwał.
2. `mergeStep` jest teraz tier-aware (pary różnych warstw się nie scalają;
   `forceTier` przeżywa scalenie w tej samej warstwie): scalenie sąsiadów
   tego samego typu RÓŻNYCH warstw gubiło forceTier → jawna sygnatura.
   Projekt §9 wymieniał tylko dedup/backfill jako nośniki H-1 — **merge
   to luka projektu odkryta implementacją.**
   Obie zmiany: bez `tierOf` i pod allMask zachowanie bajt w bajt
   (przypięte testami w obu kierunkach), ale to jest dokładnie ten
   współdzielony kod, który GS-5 ma oglądać.

**Na skróty / niepewne:**
- Fallback JDG liczy pokrycie sekwencji przez OVERLAP (dotknięta przez
  jakąkolwiek encję mask = załatwiona) — inaczej golden ST-2 §3.3.2
  („kandydatów W2 zero z tego spanu" przy zamaskowanym nazwisku) byłby
  nie do spełnienia, bo NAME_CANDIDATE jest maksymalny. Cena: „PHU Marek
  Nowak" z zamaskowanym tylko „Marek" NIE trafia do kosza („Nowak"
  zostaje jawny w nazwie pass). Granica v1 przypięta testem; leksykon
  imion z morfologii ma to domknąć.
- Wpisy nieparsowalne są po cichu pomijane w matchingu — powierzchnia
  błędu dla użytkownika dopiero z UI (ST-4-era).
- `caseAllowlist` w main.js to stała pusta lista z komentarzem — setter
  przyjdzie z UI; do tego czasu funkcja jest martwa dla użytkownika webu.
- Repertorium jednotokenowe wyglądające jak liczba rzymska („X 123/23")
  AKCEPTUJĘ jako repertorium — decyzja z uzasadnieniem w kodzie.

---

## 4. `feature/sg-lite` — gazeter nazwisk kolizyjnych (1 commit)

**Wg projektu:** SURNAME-GAZETTEER-DESIGN.md §2.2 (pkt 1, 4–9), §2.4.

**Zrobione:** `data/surname-gazetteer.json` (SEED 34 wpisów z ręcznymi
formami fleksyjnymi, w tym alternacje Kozioł/Kozła i Gołąb/Gołębia;
slotOnly: Maj/Sobota/Środa/Listopad/Kwiecień; ~90 imion mianownikowych;
tytuły Pan/Pani+odmiana+`p.`; frazy funkcyjne S5), matcher case-SENSITIVE
(title/CAPS emitują, małe litery nigdy), sloty S1–S5 (S1 span
imię+nazwisko, S2 z inicjałem, S3 tytuł ALBO sąsiedztwo wykrytej encji
PERSON_ROLE_OR_TITLE — reuse, S4 role procesowe z nonEntity role-lexicon —
reuse, S5 frazy), start zdania bez slotu = cisza, slotOnly bez slotu =
cisza, dwuczłonowe przez dywiz z rozszerzeniem spanu, score 0.95, slot →
mask, bez slotu → `forceTier:'review'`; krok OSTATNI w fazie ner;
cache-orchestrator liczy gazeter NIEcache'owany na unii encji (S3 zależy
od ról, które zmieniają się z enabledEntities).

**Testy:** 6 spójności danych (ITERUJĄ po pliku — każdy przyszły wpis
objęty automatem: rozłączność form między lematami, freq 1–6, rozłączność
z nonEntity i blocklistą A9, imiona rozłączne z formami gazetera)
+ 18 matchera (kontrakt casingów per wpis × 3 casingi, wszystkie sloty,
granice zdań, „ul. 3 Maja", ptak na płocie) + 5 goldenów; pakiet 2194.

**Decyzje Alana (jawnie):**
- **O-SG-4:** pełna lista ~300–500 wpisów i skład slotOnly — NIE zgadywałam
  masowo, seed to 34 wpisy. Wymaga Twojej redakcji.
- **`freq` w seedzie to MOJE SZACUNKI**, nieweryfikowane z datasetem 1681
  (zakaz sieci/danych w sesji). Flaga w `_comment` pliku. Zweryfikować
  przy O-SG-4.
- Formy fleksyjne pisałam ręcznie — jestem ich w miarę pewna, ale
  redakcyjny rzut oka native'a (Ty) jest wskazany (szczególnie Gołąb,
  Kania, Cieśla).

**Największe ryzyko brancha:** pod dzisiejszym allMask **bezslotowe
dopasowania (intencjonalnie `review`) STAJĄ SIĘ MASKAMI** (allMask bije
forceTier — tak zaprojektowane w ST-2/GS-5). Czyli SG-lite w defaultowym
produkcie = nowe maski PERSON_NAME na title-case'owych słowach kolizyjnych
w środku zdania. Precyzja tego NIE jest zmierzona (zakaz eval). Golden
„ptaki/ulice" przechodzi, ale korpus pułapek FP musi przejść eval na PC
PRZED merge. Jeżeli precyzja siądzie — najprostszy wentyl: aktywować krok
dopiero razem z warstwowością albo zdjąć emisję bezslotową do OS-2-style
etapu.

---

## 5. `feature/morph-w1-fleksja` — morfologia W1 + K1-lite (2 commity)

**Wg projektu:** W1-W3-MORPHOLOGY-DESIGN.md §1 (W1), §2.4/§2.4.1 (silnik
klas), §2.2 pkt 1–2 i §2.3 (K1-lite).

**Zrobione (KOD, zero danych):** `src/verifier/morph/paradigms.js` (klasy
z §2.4: przymiotnikowe -ski/-cki/-dzki m/f i -ny/-owy jako reguły;
rzeczownikowe męskie twarde z zamkniętymi tabelami §2.4.1 — mutacje Ms,
velar/soft → -u, -iem po k/g, ortografia miękkich ń→ni; e-ruchome -ek;
żeńskie -a z palatalizacją C/Ms; żeńskie nieodmienne; klasy ryzykowne
(-el/-ec, męskie -a/-o, pozostałe przymiotnikowe) DOMYŚLNIE
dictionary-only — zero zgadywania), heurystyka obcych §2.6, inwersja
lematyzacyjna SAMOWALIDUJĄCA (kandydat przeżywa tylko, gdy regeneracja
odtwarza formę), `load.js` (kontrakt §1.6, fail-closed, indeks odwrotny),
`role-lemmas.js` (katalog §1.8), `scripts/morph/compile-core.mjs`
(kompilator CZYSTY: parsowanie .tab/CSV z twardą walidacją, sekcja imion
Z1∩Z2, SŁOWNIK ODEJMUJĄCY §1.4.2 z tabelą zgodności per klasa i degradacją
<98% do meta.klasyStatus, sekcja ról, kubełki frekwencji, determinizm bajt
w bajt, raport §1.4.4 z decyzją rozmiaru §1.5), `fetch-morph-sources.mjs`
(TOFU: bez locka odmawia, --anchor wypisuje sumy do ręcznego przeglądu,
weryfikacja fail-closed), `analyze.js` (K1-lite: parser struktury wartości
+ rodzaj wg trzech źródeł §2.3).

**Testy:** 20 silnika + 13 kompilator/loader (fikstury syntetyczne ręczne)
+ 9 K1-lite; pakiet 2207.

**Na skróty / niepewne (to jest branch o największej niepewności
MERYTORYCZNEJ, świadomie):**
- **Tabele alternacji pisałam z własnej znajomości polskiej fleksji.**
  Projekt przewiduje ich walidację EMPIRYCZNĄ przez kompilator na 100%
  leksemów SGJP (§1.4.2) — i to się jeszcze NIE wydarzyło (brak danych,
  O-3). Do tego czasu klasy „rule" są hipotezą złagodzoną konserwatywnymi
  defaultami.
- **Semantyka kolumn .tab i tagsetu SGJP ZAŁOŻONA** (forma/lemat/tag/
  klasyfikacja; tagi typu `subst:sg:nom.voc:m1`). Projekt §1.1 wprost każe
  przybić ją testem na realnym pliku przy kotwiczeniu — parser twardo
  waliduje KSZTAŁT, ale semantyka może wymagać korekt po pierwszym fetchu.
  To samo dotyczy nagłówków CSV z dane.gov.pl (parser toleruje ,/; i szuka
  kolumn po nazwach, ale realne pliki mogą mieć inne nagłówki).
- Wołacz: żeńskie -a = jawna luka (null), męskie rzeczownikowe W=Ms —
  standard gramatyczny, ale bez pomiaru.
- Inwersja zwraca też pseudo-lematy („Mroczk" obok „Mroczek") — konsument
  MUSI dyskryminować słownikiem/frekwencją; udokumentowane.
- **Niezrobione z K1/K3:** `analyzePersonName` w pełnej formie
  (lematyzacja przez indeks + pinowanie poświadczeń), `generateForm`
  (zbiory przypadków, kolaps D=B, flagi wariantywne), `fullParadigm`,
  goldeny G1–G20. Fundamenty (struktura+rodzaj+paradygmaty+inwersja) są;
  brakuje warstwy orkiestrującej. Następna sesja.
- Brak wpisów THIRD_PARTY_NOTICES i locka — CELOWO (wchodzą z danymi
  przez bramkę O-3, §1.2.4/§1.9).

---

## 6. `feature/st6-mcp-boundary` — twarda granica mostu (1 commit, NA ST-3)

**Wg projektu:** SCOPE-TIERS-DESIGN.md §7.1 pkt 1–3.

**Zrobione:** `isReadableSource` += `reviewComplete(candidates,
reviewDecisions)`; `read_source` dla źródła w przeglądzie zwraca błąd
„w przeglądzie" BEZ liczb, wartości i kontekstów; wariant miękki odrzucony
zgodnie z O-ST-5. Test NEGATYWNY end-to-end: realna powłoka aplikacji,
źródło w przeglądzie, wywołane WSZYSTKIE 5 narzędzi mostu, grep każdej
odpowiedzi po wartości i typie kandydata — zero trafień. Przypięte:
skip-all na czysto-W2 źródle nadal nieczytelny (zero encji mask,
hasDetectedEntities), tekst po ludzkim „pomiń" czytelny Z wartością
(zgodne z więzem — decyzja człowieka), źródła sprzed warstw (bez pól)
zachowują się identycznie jak dziś.

**Testy:** 5 jednostkowych listings + 2 e2e; pakiet 2205. Dwie asercje
ST-3 w `main.review-flow.test.js` zaktualizowane NA TYM branchu (pending →
odmowa zamiast czytelności) — to jest ta zmiana zachowania, dla której
moduł istnieje.

**Na skróty / niepewne:**
- **GS-1 (wyścigi):** przejrzałam ścieżki — granica czyta żywy stan
  źródła synchronicznie w chwili wywołania narzędzia, a stan
  candidates/decisions/entities jest ustawiany atomowo w handlerze
  result; nie znalazłam okna. ALE nie napisałam dedykowanego testu
  wyścigu configure/classify/rerun — uznaj za niepokryte i oceń przy
  GS-1.
- Komunikat odmowy zawiera id źródła (jak istniejące odmowy) — id jest
  syntetyczne (uuid), uznałam za bezpieczne.

---

## 7. `feature/st4-bucket-ui` — UI kosza (1 commit 65205be, NA ST-3)

**Wg projektu:** SCOPE-TIERS-DESIGN.md §4.2/§4.3.

**Zrobione (patrz też 0.3 — autorstwo commita):** sekcja „Do przeglądu
(N)" na karcie źródła: N = nierozstrzygnięte WARTOŚCI, grupy po typie
malejąco po TYPE_WEIGHTS (art. 9–10 pierwsze), domyślnie zwinięte
(stan otwarcia trzymany per karta), wiersz wartości z licznikiem
wystąpień i kontekstem zdaniowym z LOKALNEGO tekstu, Maskuj/Pomiń jako
RÓWNORZĘDNE przyciski (R-ST-2), „zapamiętaj na stałe" jako jawny opt-in
piszący słownik, decyzje słownikowe/bulk oznaczone i odwracalne per
dokument, akcje zbiorcze per typ, „Zakończ przegląd — pomiń pozostałe
(N)", znacznik „Przegląd zakończony". Zero kopiuj/eksport w koszu
(O-ST-8). main.js: akcje przez silnik ST-3 + refreshLegend/setSourceEntities
(te same ścieżki co annotation-editor).

**Testy:** 6 view-model + 8 e2e UI; pakiet na branchu 2212.

**Na skróty / niepewne:**
- Kontekst zdaniowy to REGEXOWA aproksymacja zdań (±1 „zdanie" po
  [.!?\n], cap 160 zn.) — projekt mówił o reuse segmentów pipeline'u,
  ale segmenty nie żyją w stanie głównego wątku; wysłanie ich w result
  podwoiłoby payload. Odejście udokumentowane.
- §4.2 pkt 4 („ponowna anonimizacja unieważnia complete tylko przy NOWYCH
  valueKey") realizuje się przez pamięć decyzji ST-3 — nie ma osobnego
  mechanizmu; działa z konstrukcji, przypięte testem rerunu w ST-3.
- Znacznik complete żyje w sekcji kosza; nie dodałam osobnej plakietki na
  tabie/liście dokumentów.

---

## 8. `feature/st8-migration` — migracja (1 commit c0ea2ae, NIE MÓJ)

Zrobiony w całości przez sesję równoległą; przeczytałam commit message
(snapshot golden legendy, stempel konfiguracji per result, odmowa
score-compat przy scoringVersion/tiersConfig mismatch) i uruchomiłam
pakiet (2175 zielony). **Nie przeglądałam kodu.** Bramkuj bez taryfy.

---

## 9. `feature/docx-rebuild` — MD3+MD4+MD5+UI+docs+MD6-częściowe (9 commitów, HEAD c6521a8)

**Kontekst:** Twoja instrukcja „nie zaczynaj DOCX" dotarła PO tym, jak
całość była już zaimplementowana i wypchnięta (robiłam kolejkę Alana
[8] w jej kolejności). Nic po instrukcji nie dopisywałam.

**Wg projektu:** DOCX-REBUILD-DESIGN.md §3–§6, §9; MD1/MD2 (zip-reader/
writer) były już na main.

**Zrobione:**
- `ooxml-inspect.js` (MD3): części PO RELACJACH, rejectDoctype jako
  kontrola podstawowa (C-DOCX-1; parsererror = odrzucenie CAŁEGO pliku),
  makra/Strict czytelnie odrzucane (C-DOCX-9), klasyfikacja egress §9.3
  (hiperłącza dozwolone+liczone; attachedTemplate/obraz zdalny/OLE/
  INCLUDE*/DDE* blokują — P-2 twarda).
- `token-engine.js` (MD4): strumień akapitu po namespace, reguła
  najbliższego przodka w:p (txbx = osobne akapity), SENTINELE U+FFFC
  (token przerwany elementem NIE jest dopasowany → raport
  „przerwany-elementem"), instrText/delText wyłączone + liczone
  raport-only, WSPÓLNA gramatyka tokenów (src/tokens.js; `findTokens`
  dostał `rawLength` — anotacje `[TYP_n|D]` podmieniane w całości),
  reguła pierwszego runu §4.4, jeden przebieg (zero kaskady), wartości
  legendy WYŁĄCZNIE jako węzły tekstowe DOM (test ze złośliwą wartością),
  sanityzacja C0/CR/LF, xml:space=preserve.
- `rebuild-docx.js` (MD5-core): orkiestrator z bramkami (egress → blokada
  bez bajtów; zero podmian → blokada P-4; rezydua nie blokują), części
  bez podmian verbatim (C-DOCX-10 test na strumieniach skompresowanych),
  zbiór wpisów identyczny (C-DOCX-5).
- UI §3.4: import „Importuj pismo od AI (DOCX)" w Deanonimizuj (inspekcja
  przy imporcie, podgląd mammoth read-only, bajty tylko RAM), plakietka
  DOCX, Wklej zablokowane, koordynator odrzuca update tekstu wpisów DOCX
  (dotyczy też write_outcome), eksport DOCX przez rekonstrukcję (tekstowe
  jak dziś), raport z liczbami Z SILNIKA w pasku stanu, strażnik MCP
  przypięty (payloady bez bytes/inspection). `docs/docx-rebuild.md`.

**Testy:** 12+15+5+11 nowych; pakiet 2208.

**Na skróty / niepewne (dużo, bo moduł duży):**
- ~~Skan rezyduów jest PRE-podmianowy~~ — **DOMKNIĘTE** w przebiegu
  hardeningowym (commit 985fa1b): skan chodzi po FINALNYM strumieniu
  akapitu po aplikacji planu (§6.2 dosłownie); literał tokena wstrzyknięty
  wartością jest raportowany z własnym powodem `literał-w-wartości`
  (nadal nigdy nie podmieniany — reguła jednego przebiegu §4.5 stoi);
  akapity bez podmian reużywają zbudowany strumień (zero dodatkowego
  kosztu). Przypięte testem.
- **O-6 (wierność XMLSerializer wobec realnego Worda) NIEZWERYFIKOWANE** —
  złote pliki w Word/LibreOffice to MD6, poza zasięgiem tej sesji.
  Deklarację XML doklejam heurystycznie, bo jsdom-owy serializer ją gubi;
  zachowanie serializera w realnym Chromium może się różnić od jsdom —
  testów w realnej przeglądarce (Playwright, kryterium MD5) NIE MA.
- ~~Fixtury testowe używają metody store (0)…~~ — **DOMKNIĘTE** (a649964):
  CompressionStream JEST dostępny w vitest/jsdom (Node 22 global); round-trip
  deflate w teście integracyjnym (inflate → verbatim-copy nietkniętych wpisów
  na strumieniach SKOMPRESOWANYCH → recompress części zmienionej) + kanarek
  środowiska, który zawali test, gdyby streams kiedyś zniknęły (cichy skip
  nie może udawać pokrycia).
- PDF wpisu DOCX zostaje płaski z podglądu (odnotowane w docs).
- Blokada egress w eksporcie wielodokumentowym: JEDEN zablokowany wpis
  DOCX wywala CAŁY eksport (zachowawczo; per-plik pominięcie byłoby
  może lepszym UX — decyzja produktowa).
- ~~MD6 w całości niezrobione~~ — **CZĘŚCIOWO DOMKNIĘTE**, patrz niżej
  „Dokończenie 2026-07-17"; zostały wyłącznie elementy wymagające
  środowiska (smoke z modelami/binarką, realny Word).

### Dokończenie 2026-07-17 (na Twoje polecenie #5: „dokończ porządnie")

Sześć commitów ponad stan z pierwotnego wpisu:

- **a649964** testy: deflate round-trip (jw.), wynik pola `w:fldSimple`
  podmieniany normalnie przy nietkniętej instrukcji-atrybucie (§5.1),
  eksport mieszany (wpis DOCX + tekstowy w jednym ZIP: raport tylko dla
  rekonstruowanego, wewnętrzny document.xml zdeanonimizowany), pomiar MD6.
- **POMIAR §3.1 wykonany** (`rebuild-docx.perf.test.js`, log-only,
  asercje na poprawność nie na czas): realistyczne pismo ~15 stron /
  ~94 KB XML = **113 ms w jsdom** (Chromium szybszy) → próg ~200 ms
  NIEprzekroczony → decyzja projektu „wątek główny, bez Web Locka"
  POTWIERDZONA pomiarem. Stress 150 stron: 764 ms, wzrost liniowy.
- **e722b0e** złote pliki §12: `test-data/docx/` — `golden-pismo.docx`
  (KAŻDA struktura §5 w jednym pliku: run-split, hyperlink, fldSimple,
  ins/del, nagłówek+stopka, dozwolony hiperlink zewnętrzny) + 5 wrogich
  (attachedTemplate, DOCTYPE/XXE, billion-laughs, makra, nie-ZIP);
  generator deterministyczny (zerowe timestampy ZIP = regeneracja bajt
  w bajt); **`goldens.test.js` wiąże ZACOMMITOWANE bajty z silnikiem**
  (golden: 8 podmian/0 rezyduów, delText raport-only, rels bajtowo
  identyczne; wrogie: dokładne kody odmów). README = scenariusz
  ręcznego testu Word/LibreOffice dla Alana (RD-2, papier firmowy,
  pułapka F9).
- **4e31bed** `.gitattributes` (NOWY plik repo-wide): `*.docx`, `*.pdf`,
  `*.png`, `*.onnx` jako `binary` — po incydencie autocrlf z audytu eval;
  złote pliki nie mogą być konwertowane przy checkout. UWAGA DLA BRAMKI:
  dotyczy całego repo, nie tylko tej gałęzi (świadome — inne gałęzie nie
  mają .gitattributes, konflikt niemożliwy).
- **26f5c72** incydent: `token-engine.test.js` był traktowany przez
  git/grep jako BINARNY — jeden literalny bajt 0x00 w asercji
  sanitizeValue (pozostałość moich heredoców). Diff byłby nieczytelny
  dla Twojego przeglądu. Zamieniony na escape, asercja ta sama, 15/15.
- **c6521a8** dokumenty §11: SECURITY-CHECKLIST sekcja 3 + 10 wierszy
  C-DOCX-1…10 (każdy PASS z dowodem plik:linia + nazwane suity, w tym
  goldeny), poprawki C-INP-5 (DRUGI konsument DOCX — każda zmiana DOCX
  przechodzi OBA tory) i C-PERS-1 (bajty RAM-only), sekcja testów
  przedwydaniowych z uczciwymi `?`; THREAT-MODEL wiersz STRIDE bomby
  dekompresyjnej + akapit S4 o drugim konsumencie z odsyłaczem do §9
  projektu (S-DOCX-1…6, RD-1…4); SECURITY.md §14 wpis o zmianie stanu.
  **Rozjazd projektu:** §11.3 kazał „przenieść z planów" pozycję
  „formatowany eksport deanonimizacji", która w §14 NIGDY nie istniała —
  wpis powstał teraz, z adnotacją o rozjeździe.

**Świadomie NIEZROBIONE (środowisko, nie lenistwo) — do MD6 przy bramce:**
- rozszerzenie `desktop:smoke` (+`:packaged`/`:offline`) o import
  golden/hostile: harness wymaga modeli i binarki (zakaz sesji);
  smoke napisany na ślepo bez JEDNEGO uruchomienia = fałszywy dowód,
  wolałam uczciwe `?` w checkliście z dokładną instrukcją,
- ręczny test Word/LibreOffice (scenariusz gotowy w
  `test-data/docx/README.md`),
- O-6 (serializer w realnym Chromium vs jsdom) BEZ ZMIAN niezweryfikowane —
  pełnoprzepływowe e2e wymaga legendy → modeli; nawet import-only e2e nie
  pokryje serializera bez eksportu. Realny Chromium dopiero przy bramce.

---

## 9a. `feature/b3-art910-extension` — rozszerzenie leksykonu art. 9–10 (1 commit)

**Wg projektu:** RECALL-90-DESIGN.md §2.3 (kotwica+dopełnienie; polityka
spanu B3 BEZ ZMIAN — SCOPE-TIERS §6.3). Zrobione na zlecenie Opusa z listą
dokładnych fraz-wycieków wagi 5 z holdoutu.

**Zrobione (DANE-only, matcher/krok nietknięte):** 8 nowych wpisów
+ poszerzona kotwica `criminal-skazany-za` (stara NIE pokrywała „skazany
wyrokiem za" ani „skazany prawomocnie za" — to były realne wycieki).
Nowe: toczy-się-przeciwko-postępowanie (obie frazy z holdoutu jedną
kotwicą), tymczasowo-aresztowany (sam fakt = art. 10, analogia
„niekarany"), postawiono-zarzut (zaimek mu/jej/im OBOWIĄZKOWY — odsiewa
procesowe zarzuty apelacyjne), delegat-związkowy, wiece-organizacji,
członek-partii, struktura-partyjna, pod-opieką-medyczną.

**Testy:** pakiet data-driven pokrywa każdy wpis automatycznie
(pozytyw+negatyw+mustCover); pułapki adw_32/33/34 nadal ZERO trafień;
golden adw_38 zaktualizowany 4→5 (nowa kotwica zdrowotna łapie PIĄTY
prawdziwy fakt zdrowotny, który fixture zawsze zawierał — zysk pokrycia,
nie over-triggering; przypięte rozbiciem per kategoria). Pakiet 2189.

**Na skróty / niepewne:**
- `health-pod-opieka` wymaga kwalifikatora medycznego przez SUFIKSY
  (-logiczną/-iatryczną/-chirurgiczną, lekar/medyczn/poradni/szpital) —
  świadome tarcie z zasadą „zero taksonomii" (§2.3 pkt 4), wymuszone
  pułapką „pod opieką kuratora" (częste w pismach rodzinnych). Opisane
  w `note` wpisu; do akceptu na bramce.
- Frazy z listy Opusa wpisałam jako examplePositive w realistycznych
  zdaniach — NIE mam dostępu do samego holdoutu, więc dokładne konteksty
  holdoutowe mogą się różnić od moich zdań testowych; kotwice są jednak
  szersze niż pojedyncze zdanie.
- Eval tagowany po tej zmianie danych — do zrobienia na PC jak dla trio
  detekcyjnego (dyscyplina „eval po każdej zmianie src/pipeline" obejmuje
  dane leksykonu).

---

## 9b. Przegląd obcych commitów 65205be / c0ea2ae (na zlecenie Opusa, linia-po-linii)

### 65205be (`feature/st4-bucket-ui`) — ZWERYFIKOWANY, czysty

Diff przeczytany w całości vs SCOPE-TIERS §4.2. Ustalenia:

- **6 z 7 plików to DOSŁOWNIE mój WIP** (view-model.js, view-model.test.js,
  index.js renderera, styles.css, sources-list, main.js — porównane linia
  po linii z tym, co pisałam przed przełączeniem drzewa; zero obcych
  wstawek). Siódmy plik (`main.review-bucket-ui.test.js`) to redakcyjny
  WARIANT mojego testu e2e: ta sama struktura i 8 przypadków (badge liczy
  WARTOŚCI, grupy zwinięte + grep air-gap po Kopiuj/Eksport, mask→undo
  round-trip po liczniku tokenów, skip z równorzędnym stylem R-ST-2,
  słownik tylko na jawny checkbox + kontrola negatywna, bulk+finish,
  plakietka „słownik" odwracalna, brak kandydatów → sekcja ukryta);
  jedyna różnica: DOM-owa asercja kolejności grup wypadła, ale porządek
  wag jest przypięty w view-model.test (HEALTH_DATA przed kwotami).
- **Grep bezpieczeństwa po całym diffie (GS-2): czysto.** Zero
  clipboard/fetch/WebSocket/navigator; `innerHTML` wyłącznie czyszczące
  (`root.innerHTML = ''`) i harness testowy; cała treść wchodzi przez
  `textContent`/`createTextNode`. Żadnego eksportu ani schowka kosza.
- Pokrycie §4.3: pkt 1/3/4 wprost w e2e; pkt 2 (rerun) na poziomie ST-3
  (review-flow); pkt 5 (annotation-editor nietknięty) — plik bez zmian
  w diffie.

Werdykt: bramkuj jak mój kod, bo to jest mój kod — z jednym
przeredagowanym testem o równoważnym pokryciu.

### c0ea2ae (`feature/st8-migration`) — ZWERYFIKOWANY, solidny, 1 nit

Diff przeczytany w całości vs SCOPE-TIERS §8. Ustalenia:

- **Snapshot golden (§8.1 pkt 3/§8.2):** test w outcomes-coordinator —
  token ORG deanonimizuje się bajt w bajt po tym, jak żywa legenda go
  traci (symulacja piwotu przez refreshLegend) ✓.
- **Stempel konfiguracji (§8.1 pkt 2, R-ST-4):** sygnatura łapana
  W CHWILI DISPATCHU (`inFlightConfigStamps` w dispatchNextClassify),
  stemplowana na result — poprawne wobec wyścigu „zmiana selekcji w trakcie
  classify"; fallback na bieżącą sygnaturę przy braku wpisu; odświeżanie
  plakietek podpięte pod onChange selektora; dryf powrotny czyści znacznik
  bez re-runu (wynika z porównania `!==`); nic nie reanonimizuje się samo ✓.
  Dedykowany test `main.config-stamp.test.js` (182 linie) pokrywa cykl.
- **Odmowa eval:compare (§8.1 pkt 4):** czysty moduł `score-compat.js` —
  różnica scoringVersion (w tym format sprzed piwotu = null) albo
  tiersConfig ⇒ delty ukryte + głośne ostrzeżenie z instrukcją re-score;
  dwa przebiegi PRZED-piwotowe (null==null) pozostają porównywalne —
  poprawnie ✓. Wpięte w compare.js przez bramkowanie sameEnabled.
- **NIT (nie-bug):** komentarz przy `currentConfigSignature()` twierdzi,
  że tierOverrides/allMask „dołączą do sygnatury automatycznie" z UI
  O-ST-7 — nieprawda w sensie dosłownym: sygnatura zawiera dziś TYLKO
  `entities` i przy wdrożeniu O-ST-7 trzeba ją jawnie rozszerzyć o jedno
  pole. Zero skutku runtime dziś (main nie ustawia warstw); odnotować
  przy implementacji O-ST-7.

Werdykt: merge-owalny bez poprawek; nit do zapamiętania przy O-ST-7.

---

## 10. Otwarte decyzje — zestawienie

| Decyzja | Kto | Blokuje |
|---|---|---|
| O-SG-4: pełna lista nazwisk + slotOnly + weryfikacja freq z datasetem 1681 | Alan | rozszerzenie SG-lite (seed może wejść wcześniej) |
| O-3: kotwiczenie SGJP/PESEL, licencje u źródła, sui generis (1.2.3) | Alan + Opus | dane morfologii, SG-full, B4-full |
| O-ST-2: art. 9–10 w trwałym słowniku | Alan (werdykt w GS-3) | nic w kodzie — silnik nie ogranicza |
| O-ST-3: trwałość allowlisty (kod = RAM/sesja, rekomendacja projektu) | Alan (w GATE-SCOPE) | nic — zaimplementowane zachowawczo |
| Eval tagowany os1/st5/sg-lite/b3-art910 na obu korpusach | PC stacjonarny | merge tych czterech branchy |
| GATE-SCOPE (GS-1…GS-6) | Opus | merge st3/st4/st5/st6 |
| O-1…O-9 + C-DOCX-1…10 | Opus | merge docx-rebuild |

---

## 11. Pułapki napotkane po drodze (żeby następny się nie potknął)

1. **applyTokens NIE toleruje nakładających się encji** (podmiana po
   offsetach od końca koroduje tekst przy nakładce) — stąd fragmentacja
   w ST-3 i tier-aware trim/merge w ST-5. Każdy przyszły kod dodający
   encje do `s.entities` musi utrzymać rozłączność.
2. **Cache NER jest po hashu tekstu** — wynik zależny od KONFIGURACJI
   (allowlista, proweniencja, role dla S3 gazetera) nie może być
   cache'owany bez klucza konfiguracji; wzorce: skan na świeżo
   (allowlista, gazeter) albo bramkowanie merge'a flagą bieżącego
   wywołania (despaced).
3. `String.raw` + polskie/niewidzialne znaki w heredocach potrafią
   przemycić NBSP/kontrolne znaki do źródła — po dwóch wpadkach pisałam
   klasy znaków wyłącznie jawnymi escape'ami i weryfikowałam bajtowo.
4. Współdzielone working tree potrafi się przełączyć pod ręką (0.3) —
   commitować gęsto, sprawdzać `git branch --show-current` przed seriami
   edycji.
5. `w:fldSimple` trzyma instrukcję w ATRYBUCIE (nie w tekście) — skan
   wrogich pól musi patrzeć i w `w:instrText`, i w `w:fldSimple/@w:instr`.
6. matchAll + współdzielony regex z lastIndex = zdradliwe; w despace
   trzymam osobny sticky regex do rozszerzania dywizowego.
