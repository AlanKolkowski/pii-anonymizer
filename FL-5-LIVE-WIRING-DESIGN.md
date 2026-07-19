# FL-5-LIVE-WIRING-DESIGN.md – wpięcie gotowego resolvera fleksji w żywe ujścia deanonimizacji

**Autor:** Fable (architekt), na zlecenie Opusa. **Data:** 2026-07-19.
**Status:** projekt do bramki GATE-FL5, zero kodu produkcyjnego w tym kroku.
**Baza:** `main` (czysty), silnik fleksji KOMPLETNY i udowodniony
(`src/verifier/flexion-resolver.test.js` zielony na MINI_LEXICON), ale
martwy w żywej aplikacji poza eksportem DOCX.

**Cel Alana (dosłownie):** „Fleksja ma działać w całości, wyłapywać,
oznaczać jako jedną grupę (PERSON_NAME_1|M, PERSON_NAME_1|D) i skutecznie
deanonimizować, łącznie z użyciem odpowiedniego przypadka do danego
zdania."

Kontrakt „jednej grupy" JUŻ jest spełniony i udowodniony: `findTokens`
(`src/tokens.js:32-51`) zwraca `tokenId` bez anotacji, `legend[token]`
kluczuje po formie kanonicznej (`src/substitution.test.js:199-201`),
a test `flexion-resolver.test.js:51-70` dowodzi: dwa wystąpienia
`[PERSON_NAME_1]` i `[PERSON_NAME_1|D]` dzielą JEDEN wpis legendy
i odmieniają się niezależnie per wystąpienie. FL-5 niczego tu nie zmienia,
tylko doprowadza ten mechanizm do oczu i schowka Alana.

---

## §1. Stan faktyczny (zweryfikowany w kodzie, nie z pamięci)

1. **Szew istnieje i czeka.** `resolveOccurrences(text, {legend, decisions,
   resolveReplacement})` (`src/substitution.js:35-90`) ma trójwarstwową
   precedencję `decyzja ?? resolver ?? baza`. Fasada
   `deanonymizeText(text, legend)` (`src/anonymizer.js:1220-1222`) woła ją
   BEZ resolvera: tożsamość przez pominięcie.
2. **Resolver gotowy.** `createFlexionResolver({morph, seen, minConfidence})`
   (`src/verifier/flexion-resolver.js:46-75`): PERSON_NAME only (decyzja 13),
   kaskada `detectCase` (S-P przyimki, S-R rząd czasownika, S-A apozycja
   roli, S-T adnotacja niezaufana, decyzja 17), fail-closed `'nieustalony'`,
   próg `minConfidence:'wysoka'` (FD-4/O-DOCX-2(a)).
3. **Jedyne żywe wpięcie:** eksport DOCX. `src/main.js:570-586`
   (`exportDeanonDocuments`) buduje resolver
   `createFlexionResolver({ morph: null, seen, minConfidence: 'wysoka' })`
   i podaje go WYŁĄCZNIE do rekonstrukcji DOCX
   (`src/export/deanon.js:247-259`, `rebuildDocxBlob`). Ujścia płaskie
   świadomie go nie dostają (komentarz `src/export/deanon.js:240-246`:
   „stays at the base legend value until FL-5").
4. **`morph = null` w żywej apce.** Artefakt `morph-pl.json` nie istnieje
   (FL-1b/GATE-FLEKSJA-DANE przed nami, `src/verifier/morph/data/` pusty).
   Tryb ograniczony §4.4 DOCX-IMPL-PLAN, granice zweryfikowane w kodzie:
   - działa: formy poświadczone end-to-end (`deriveAttested(seen)` →
     `buildAttestedByCase` → precedencja poświadczeń w `generateForm`,
     `src/verifier/morph/generate.js:92-96`), nazwiska regułowe
     (`paradigms.js`, klasy `rule` w `DEFAULT_CLASS_STATUS:21-34`), w tym
     wzorce „J. Kowalski" (inicjał przechodzi, nazwisko się odmienia);
   - milczy: S-A (wymaga `morph.formaDoLematu` sekcji `role`,
     `src/verifier/case-detector/detect.js:36-43`);
   - odmawia: pełne imię+nazwisko z GENERACJI (słowo typu `imię` bez
     paradygmatu w słowniku → flaga, `generate.js:24-29`), nazwiska obce,
     rodzaj niejednoznaczny.
5. **`seen` i legenda żyją w `main.js`** (`src/main.js:45-46`), przebudowa
   przy każdej zmianie źródeł/adnotacji (`refreshLegend`,
   `src/main.js:696-710`, `buildTokenMapMulti`). `seen` trzyma KAŻDY surowy
   wariant powierzchniowy („PERSON_NAME::Jana Kowalskiego" → ten sam token
   co „PERSON_NAME::Jan Kowalski", normalizator `couldBeSamePerson`,
   `src/anonymizer.js:100-141`). Wyniki niosą `legendSnapshot`
   (`src/ui/outcomes-coordinator.js:10-12, 31, 49`), NIE niosą snapshotu
   `seen` (ryzyko R-D9, §4 niżej).
6. **Wzorzec dowodu wiringu istnieje:** `src/main.docx-export.test.js:264-315`
   (FD-3): przez PRAWDZIWE `main.js`, formy poświadczone z `seen`, bez
   artefaktu morfologicznego, „od [PERSON_NAME_1]" → odmiana w bajtach
   eksportu. Ten sam przepis udowodni ekran i schowek.

### Kluczowy dowód dla polityki bezpieczeństwa: forma mieszana jest niemożliwa konstrukcyjnie

`buildFormForCase` (`src/verifier/morph/generate.js:14-70`) buduje formę
CAŁEJ nazwy atomowo, słowo po słowie: pierwsza flaga na KTÓRYMKOLWIEK
słowie przerywa i zwraca odmowę całości. Przy `morph=null` słowo typu
`imię` ZAWSZE flaguje (`imię-nieznane`), więc „Jan Kowalski" nie może
wyjść jako „Jan Kowalskiego": wyjdzie w całości forma bazowa albo
w całości forma poprawna (poświadczona lub wygenerowana z kompletem
danych). Punkt 3 zlecenia („nigdy forma mieszana") jest już własnością
silnika, FL-5 musi jej tylko nie zepsuć: żadne ujście nie skleja form
per słowo, wszystkie konsumują całościowy `finalText` wystąpienia.

---

## §2. Mapa ujść: każde żywe wywołanie deanonimizacji

Wszystkie żywe ścieżki przechodzą przez `deanonymizeText` (fasada bez
resolvera) albo przez pigułkowy render oparty o `splitTokenParts`.
Inwentarz kompletny (grep `deanonymizeText|resolveOccurrences|splitTokenParts`
po `src/`, zweryfikowany wpis po wpisie):

| # | Ujście | Miejsce | Dziś | Skąd legenda | Skąd `seen` po FL-5 |
|---|---|---|---|---|---|
| U1 | **ekran: panel wyjścia deanon** | `src/ui/deanon-workspace/index.js:437-512` (`renderOutputPane` → `renderParts:150-161` → `tokenParts:25-29`) | `splitTokenParts` + `legend[part.token]`, pigułka pokazuje `part.orig`; **anotacja `\|D` jest w ogóle niewidoczna** (`splitTokenParts`, `src/tokens.js:53-64`, gubi `case`) | `effectiveOutcomeLegend(active, legend)` (`:466`) | builder z `main.js` przez nowy `opts.getResolveReplacement(outcome)` |
| U2 | **schowek: przycisk „Kopiuj"** | `src/ui/deanon-workspace/index.js:327-330` (`copyActive`) | `deanonymizeText(active.text, effectiveOutcomeLegend(...))` | jw. | ten sam builder, TEN SAM wynik `resolveOccurrences` co U1 |
| U3 | **eksport płaski PDF** (zawsze) i **DOCX płaski** (wynik bez bajtów `.docx`) | `src/export/deanon.js:67-75` (`buildDeanonExportEntries:73`) | `deanonymizeText(outcome.text, effectiveOutcomeLegend(...))` | `effectiveOutcomeLegend(outcome, legend)` | parametr `resolveReplacementFor(outcome)` z `exportDeanonOutcomes` |
| U4 | **eksport DOCX z rekonstrukcją** (wynik z bajtami) | `src/export/deanon.js:247-259` + `src/main.js:575` | **JEDYNE wpięte**: resolver `morph:null, seen żywe, 'wysoka'` | `effectiveOutcomeLegend` w `rebuildDocxBlob:249` | przechodzi na wspólny builder (naprawa R-D9, §4) |
| U5 | licznik „N tokenów odtworzonych" | `deanon-workspace/index.js:31-46, 471` | `tokenParts` (obecność w legendzie) | jw. | bez zmian (semantyka: odtworzony = ma wpis legendy); dochodzi licznik „odmieniono N" z wystąpień |

**Nie-ujścia (świadomie poza mapą):**

- `src/ui/outcomes-list/index.js:65, 209`: moduł LEGACY, w żywej aplikacji
  nieużywany. `main.js` nie importuje `createOutcomesList`, a koordynator
  dostaje `NOOP_OUTCOMES_LIST` (`src/ui/outcomes-coordinator.js:3-8, 16`;
  `src/main.js:488-492` nie przekazuje `outcomesList`). Konsumenci: tylko
  testy. Wpinanie = martwa praca; komentarz w `flexion-resolver.js:18-21`
  (wymienia outcomes-list jako ujście) do aktualizacji w K6.
- **Granica MCP**: `read_outcome`/`list_outcomes` czytają wyłącznie
  `outcome.text` (tokeny). Deanonimizacja nigdy nie przechodzi przez most,
  fleksja więc też nie. Zero zmian.
- Kierunek maskowania (`buildTokenMap`/`applyTokens`/`anonymizeText`):
  nietykalny, poza zakresem, niezmiennik §8.

**Wymóg spójności (nowy, rdzeń FL-5):** dla jednego wyniku U1 == U2 == U3
co do tekstu (hash), a U4 zgodny z podglądem U1 tego samego wyniku
(adaptacja kryterium §5.5 pkt 2 FLEKSJA-IMPL-PLAN). Gwarancja przez
konstrukcję: jeden builder resolvera per wynik + determinizm silnika
(czyste funkcje, brak losowości), a nie przez synchronizację ręczną.

---

## §3. Architektura wpięcia

### 3.1 Właściciel i nowy moduł pomocniczy

`main.js` pozostaje właścicielem `seen`/`legend`/artefaktu (wzorzec FD-3,
komentarz `src/main.js:551-569`). Logika składania zależności wychodzi do
nowego, czystego modułu, żeby była testowalna bez bootowania `main.js`:

**`src/verifier/flexion-live.js`** (nowy, ~60 linii, czyste funkcje):

```js
// Domknięcie R-D9: zaufaj wpisom `seen` dla tokenu T tylko wtedy, gdy
// żywa legenda i legenda efektywna wyniku wskazują dla T TĘ SAMĄ wartość
// (ten sam człowiek). Inaczej: wpisy T odpadają, resolver widzi dla T
// wyłącznie samą wartość bazową (mniej pokrycia, nigdy złe nazwisko).
export function filterSeenForLegend(seen, liveLegend, effectiveLegend)

// Jedyny punkt konstrukcji resolvera dla WSZYSTKICH ujść:
// zwraca funkcję resolveReplacement albo undefined (fleksja wyłączona).
// Zawsze minConfidence: 'wysoka' (O-FL5-1), zawsze seen przefiltrowane.
export function buildOutcomeResolver({ enabled, morph, seen, liveLegend, outcome })
```

`buildOutcomeResolver` wewnętrznie: `effectiveOutcomeLegend(outcome,
liveLegend)` → `filterSeenForLegend` → `createFlexionResolver({ morph,
seen: filtered, minConfidence: 'wysoka' })`. `enabled === false` →
`undefined` → `resolveOccurrences` zachowuje się DOKŁADNIE jak dziś
(tożsamość przez pominięcie, zero nowych gałęzi w S2).

### 3.2 U1 ekran: render z wystąpień zamiast z `splitTokenParts`

`renderOutputPane` przechodzi z `tokenParts(text, legend)` na wynik
`resolveOccurrences(active.text, { legend: activeLegend,
resolveReplacement })`. Prywatny helper w `deanon-workspace/index.js`
(NIE delta S2, O-FL5-7) skleja przeplot tekst/pigułka tym samym
spacerem co `renderResolvedText` (`src/substitution.js:99-115`), używając
eksportowanego `rawTokenLength` i `findTokens`:

- część tekstowa → `document.createTextNode` z oryginalnego wycinka;
- wystąpienie ze źródłem `baza`/`resolver` → pigułka: `textContent =
  occ.finalText`, `data-orig = occ.finalText`, `title = token -> finalText`
  (bez zmian wizualnych względem dzisiejszych pigułek; stany „sugestia/
  zatwierdzona" to FL-6);
- `source === 'nierozwiązany'` → goły węzeł tekstowy z tokenem
  (dzisiejsze zachowanie gałęzi `!part.orig`).

Panel WEJŚCIA (`renderInputPane`) zostaje na `splitTokenParts` (pokazuje
tokeny, nie wartości). Znana drobnostka: pigułka wejścia nie pokazuje
anotacji `|D` (splitTokenParts ją zjada) – kandydat do FL-6, poza FL-5.

Licznik: do toolbara wyjścia dochodzi „odmieniono N form" liczony z tych
samych wystąpień (`occurrences.filter(o => o.source === 'resolver').length`),
`textContent`, informacyjnie (nigdy zapora). Wiersze szczegółowe
z przypadkiem słownie wymagają `note`, którego S2 świadomie nie
propaguje – to FL-6 (O-FL5-7), licznik zbiorczy wystarcza w v1.

### 3.3 U2 schowek: ten sam wynik, `renderResolvedText`

`copyActive` woła ten sam `resolveOccurrences` (ta sama konstrukcja
zależności) i składa `renderResolvedText(occurrences, active.text)`.
Determinizm silnika gwarantuje U1 == U2 bez współdzielenia stanu;
test i tak przybija hash (G-FL5-2).

### 3.4 U3 eksport płaski: parametr per wynik

`exportDeanonOutcomes` przyjmuje `resolveReplacementFor(outcome)`
(funkcja → funkcja|undefined) zamiast dzisiejszego pojedynczego
`resolveReplacement`:

- `buildDeanonExportEntries` dostaje ją i buduje
  `renderResolvedText(resolveOccurrences(text, { legend: eff,
  resolveReplacement: resolveReplacementFor(outcome) }), text)` zamiast
  `deanonymizeText` (`src/export/deanon.js:73`);
- gałąź rekonstrukcji DOCX (`:277-280`) bierze TĘ SAMĄ funkcję dla danego
  wyniku (to naprawia U4 na wspólny builder, §4);
- jedynym konsumentem `exportDeanonOutcomes` jest `main.js:576` (grep),
  więc zmiana sygnatury jest lokalna; brak parametru → zachowanie
  dzisiejsze (testy `deanon.test.js` zielone bez zmian).

### 3.5 `main.js`: składanie i odświeżanie

- statyczny import `createFlexionResolver` + `flexion-live.js` (silnik to
  ~55 KB źródeł bez danych, pomiar niżej §5.4; żadnego kosztu startowego
  poza parsowaniem);
- artefakt morfologiczny ładowany asynchronicznie i JEDNORAZOWO przez
  nowy, jedyny punkt importu danych `src/verifier/morph/artifact.js`
  (§5.2); do czasu załadowania `morph = null` (tryb ograniczony, poprawny);
  po załadowaniu wymuszone `deanonWorkspace.render()`;
- `deanonWorkspace` dostaje w opts
  `getResolveReplacement: (outcome) => buildOutcomeResolver({ enabled,
  morph, seen, liveLegend: legend, outcome })`;
- `exportDeanonDocuments` przechodzi na
  `resolveReplacementFor: (outcome) => buildOutcomeResolver({...})`,
  kasując inline konstrukcję z `main.js:575`;
- **`renderSignature` musi objąć nowe wejścia renderu** (dziś:
  legenda+wyniki+activeId+busy+message, `deanon-workspace/index.js:199-208`):
  dochodzi `enabled`, bit „morph załadowany" i `seenVersion` (licznik
  inkrementowany w `refreshLegend`, getter w opts). Bez tego
  `refreshLegend()` pominie re-render, gdy zmieni się WYŁĄCZNIE zbiór form
  poświadczonych (legenda bez zmian, nowy wariant fleksyjny w źródle) i
  ekran zostanie z nieaktualną odmianą.

---

## §4. Domknięcie R-D9: dryf `seen` względem `legendSnapshot`

DOCX-IMPL-PLAN §4.2 przyjął żywe `seen` z argumentem: „poświadczenia
zmieniają najwyżej DOSTĘPNOŚĆ odmiany, nigdy tożsamość wartości",
i jawnie odłożył parytet snapshotów do FL-5 (R-D9, `DOCX-IMPL-PLAN.md:641`).

**Analiza FL-5: ten argument ma dziurę przy renumeracji tokenów.**
`refreshLegend` (`src/main.js:696-710`) buduje `seen`+legendę OD ZERA przy
każdej zmianie źródeł. Scenariusz osiągalny dziś w U4: (a) wynik ma
`legendSnapshot` z `[PERSON_NAME_1] = "Jan Kowalski"`, (b) Alan zmienia
źródła, po przebudowie `[PERSON_NAME_1]` wskazuje INNĄ osobę („Anna
Nowak"), (c) `deriveAttested(seen)["[PERSON_NAME_1]"]` niesie teraz formy
Nowak, (d) `buildAttestedByCase` (`src/verifier/morph/analyze.js:283-298`)
NIE weryfikuje przynależności formy poświadczonej do wartości bazowej,
(e) `generateForm` bierze poświadczenie PRZED słownikiem i regułą
(`generate.js:93-96`) → przy zgodnym przypadku do pisma wchodzi
**nazwisko innej osoby**. Prawdopodobieństwo niskie (wymaga kolizji
numeracji i zgodności przypadka), skutek katastrofalny w piśmie
procesowym, dokładnie w priorytecie Alana „bezpieczeństwo/brak błędów".

**Naprawa (tania, bezstanowa, fail-closed):** `filterSeenForLegend`
(§3.1). Wpis `seen` `"TYP::forma" → token` przechodzi tylko, gdy
`effectiveLegend[token]` istnieje ORAZ `liveLegend[token] ===
effectiveLegend[token]`. Wynik bez snapshotu: legenda efektywna to żywa,
filtr przepuszcza wszystko (zachowanie dzisiejsze). Wynik ze snapshotem
po renumeracji: wpisy skolidowanego tokenu odpadają, resolver widzi tylko
wartość bazową – mniej odmiany, nigdy cudze nazwisko. Konstrukcja `seen`
gwarantuje resztę: wpisy pod tokenem to zawsze jedna grupa
`couldBeSamePerson` z tej samej przebudowy.

**Zakres obowiązywania: bezwarunkowo, także U4 poza flagą** (O-FL5-3).
To korekta bezpieczeństwa istniejącej ścieżki, nie funkcja. Jedyna
sankcjonowana zmiana zachowania przy fladze wyłączonej: w opisanym rogu
DOCX przestaje móc wstawić cudze poświadczenie (wcześniej nigdy nie było
to zachowanie poprawne). Odrzucona alternatywa: `attestedSnapshot` per
wynik (nowy stan w RAM na każdy wynik, kolejny cykl życia do pilnowania;
filtr daje ten sam skutek bez stanu). Opcjonalne utwardzenie w samym
resolverze (walidacja `couldBeSamePerson(forma, baseValue)`) ODŁOŻONE:
FL-5 nie modyfikuje udowodnionego silnika (decyzja do ewentualnego
FL-6/FL-core, wpis w §9).

---

## §5. Strategia morfologii laptop-safe (podłoga 16 GB, zero wielkich pobrań)

### 5.1 Drabinka artefaktów zamiast „wszystko albo nic"

Wpięcie (§3) jest CAŁKOWICIE niezależne od artefaktu: `morph` wchodzi
parametrem, wymiana artefaktu to podmiana danych bez zmiany linii kodu
ujść. Drabinka, każdy szczebel z osobnym, małym przeglądem:

| Szczebel | Zawartość | Rozmiar JSON (szacunek) | Co odblokowuje | Kiedy |
|---|---|---|---|---|
| **A0 – bez artefaktu** (`morph=null`, stan dzisiejszy) | – | 0 | poświadczenia end-to-end, nazwiska regułowe, „J. Kowalski" | już działa |
| **A1 – `role`-v0** (rekomendowany RAZEM z FL-5) | pełne paradygmaty 47 lematów z `role-lemmas.js:7-22`, autorstwo ręczne + przegląd Alana (język procesowy = jego codzienność) | ~4-8 KB | sygnał S-A zaczyna głosować → `wysoka` bez anotacji w apozycjach („powodowi [P_1]"), więcej odmian przy tym samym fail-closed | z FL-5 |
| **A2 – `imiona`-core (FL-5a)** | inwentarz+rodzaj+frekwencja z list PESEL CC0 (dane.gov.pl, datasety 1667/1681, jak w FLEKSJA-IMPL-PLAN §2.1); paradygmaty generowane skryptem `scripts/compile-morph-core.mjs` z tabel klas (w dużej mierze reuse `generateSurnameParadigm` dla regularnych + tabela `-ia/-ja` + wyjątki ręczne), commit CAŁEJ wygenerowanej tabeli do przeglądu | top-200 imion: ~30-60 KB; próg frekwencyjny (rząd 2-4 tys. imion): ~0,3-0,8 MB | pełne „Jan Kowalski" → „Janowi Kowalskiemu" z GENERACJI (nie tylko z poświadczeń); rodzaj z imienia odblokowuje nazwiska rzeczownikowe („Jan Nowak" → „Jana Nowaka", dziś flaga `rodzaj-niejednoznaczny`) | osobny krok po FL-5, własny mini-przegląd |
| **A3 – pełny SGJP (FL-1b)** | bez zmian względem FLEKSJA-IMPL-PLAN (kompilacja na PC, lock+sumy+licencje, cel ≤5 MB) | ≤5 MB | nazwiska-wyjątki (alternacje Kozioł/Gołąb), rzadkie imiona, wariantywność | PC, GATE-FLEKSJA-DANE |

Wniosek rozstrzygający pytanie zlecenia: **bundlowanie skompilowanych
danych imion CC0 (A2) TAK, jako FL-5a, ale nie jako warunek wpięcia**.
Samo `morph=null` + poświadczenia już dają odmianę pełnych nazw tam,
gdzie źródło zawierało odmieniony wariant (w pismach procesowych częste),
i to jest udowodnione przez istniejący test FD-3. A2 dokłada generację
tam, gdzie poświadczeń brak.

### 5.2 Format, ładowanie, jedyny punkt importu

- Format: dokładnie `morph-pl/1` (`src/verifier/morph/load.js:11, 22-89`),
  sekcje `imiona`/`nazwiska`/`role` wymagane (mogą być puste obiekty).
  Plik: `src/verifier/morph/data/morph-pl-core.json`. A1/A2 wypełniają
  kolejne sekcje TEGO SAMEGO pliku; A3 podmienia go na artefakt z locka.
- Ładowanie w przeglądarce: **dynamiczny `import()` JSON przez bundler**
  (code-split chunk, wzorzec lazy-importów `main.js:571-574`), następnie
  `loadMorphData(json)`; singleton w nowym
  `src/verifier/morph/artifact.js` (jedyny moduł importujący dane, zgodnie
  z regułą §2.3 FLEKSJA-IMPL-PLAN, żeby bundler nie zdublował danych).
  Zero workera: wątek główny dozwolony do 3 MB surowego JSON (O-FL-6),
  wszystkie szczeble A1-A2 mieszczą się z wielokrotnym zapasem. Zero
  sieci w każdym wariancie (web i desktop: dane w bundlu; desktop: asar
  z fuse integralności pokrywa artefakt automatycznie, C-VER-2 wariant a).
- vitest/jsdom: zwykły import JSON z repo, offline; testy silnika dalej na
  `MINI_LEXICON` przez DI (bez zmian).

### 5.3 Pamięć i podłoga 16 GB

`loadMorphData` buduje odwrotny indeks w pamięci (koszt RAM zamiast
rozmiaru artefaktu, `load.js:53-80`). Szacunki zachowawcze (Mapy V8
~3-5x rozmiaru JSON): A1 <0,1 MB, A2 top-200 <0,5 MB, A2 z progiem
frekwencyjnym 2-4 MB, A3 ≤25 MB. Wszystko pomijalne wobec podłogi 16 GB
i wobec budżetu modeli NER (`MEMORY_BUDGET_MB = 1680`). Fleksja nie
dotyka workera modeli, ONNX ani eval: **żaden krok FL-5/FL-5a nie
uruchamia modeli i nie wymaga PC** (kompilacja A2 to czytanie CSV rzędu
pojedynczych MB; jedynie A3 pozostaje zadaniem na PC wg FLEKSJA-IMPL §7).

### 5.4 Koszt bundla kodu

Statyczny import silnika do `main.js`: `flexion-resolver.js` + kaskada +
morfologia = ~55 KB źródeł łącznie (pomiar `wc -c`, przed minifikacją;
tabele `prepositions.js`/`verbs.js` w tym). Bez znaczenia dla startu
aplikacji; dane (jedyny realny ciężar) idą osobnym chunkiem dynamicznym.

---

## §6. Polityka poprawności (priorytet: brak błędów, nigdy zgadywanie)

1. **Próg `minConfidence: 'wysoka'` we WSZYSTKICH ujściach bez
   zatwierdzania per wystąpienie** (U1-U4), dokładnie jak DOCX
   (O-DOCX-2(a)). `'wysoka'` = zbiór zawężony do jednego przypadka ORAZ
   co najmniej jeden sygnał spoza niezaufanej anotacji
   (`detect.js:116-117`). Sugestie `'niska'` czekają na UI przeglądu
   (FL-6), w v1 są odmową.
2. **Łańcuch fail-closed (kompletny, po kolei):** typ ≠ PERSON_NAME →
   odmowa; `analyzePersonName` flaga (struktura/obce/rodzaj) → odmowa;
   `detectCase` `'nieustalony'` (brak sygnału, sygnały sprzeczne,
   anotacja sprzeczna z kontekstem) → odmowa; pewność < próg → odmowa;
   `generateForm` flaga (`imię-nieznane`, `nie-umiem-odmienić`,
   `wariantywne`, `przypadek-nieustalony`, formy rozbieżne) → odmowa.
   Każda odmowa = warstwa `baza` w S2 = dzisiejsza forma z legendy,
   bajt w bajt. Nigdy wybór „najlepszego strzału".
3. **Nigdy forma mieszana:** atomowość `buildFormForCase` (dowód §1).
4. **Nigdy cudze nazwisko:** `filterSeenForLegend` (§4).
5. **Anotacja LLM pozostaje niezaufana** (decyzja 17): sama daje najwyżej
   `'niska'` (= odmowa przy progu), sprzeczna z kontekstem daje
   `'nieustalony'`; błędna anotacja nie może zepsuć pisma (macierz
   przykładów wiążących: DOCX-IMPL-PLAN §4.3, testy
   `flexion-resolver.test.js:110-161` już to przybijają).
6. **Znane ograniczenie (świadome, do kupienia na bramce):** klasa
   regułowa `noun-masculine` regularyzuje alternacje samogłoskowe
   (wygeneruje „Gołąba", nie „Gołębia"). W odmianie NAZWISK forma
   regularyzowana jest w uzusie często dopuszczalna (nazwiska opierają
   się alternacji częściej niż rzeczowniki pospolite), a klasy o niskiej
   zgodności są już zdegradowane do `dictionary-only`
   (`paradigms.js:21-34`: `-el`, `-a`, `-o`). Ekspozycja identyczna jak
   w U4 dziś (zbramkowanym). Pełne domknięcie: słownik odejmujący A3;
   opcjonalnie krótka ręczna lista wyjątków w A2 (O-FL5-8).

---

## §7. Flaga aktywacji

Projekt: **mechanizm wpięty w 100%, aktywacja jednym przełącznikiem,
wartość domyślna to osobna decyzja Alana** (wzorzec `allMask` z ST-2:
kod scalony, śpi do aktywacji).

- `src/main.js`: `const FLEXION_LIVE_DEFAULT = <decyzja bramki>;` +
  odczyt `localStorage` pod kluczem `pii.deanon-flexion`
  (`'1'`/`'0'` nadpisuje default; wzorzec `GPU_LS_KEY`,
  `src/main.js:68`). Bez UI przełącznika w v1 (DevTools/localStorage
  wystarczy; checkbox to FL-6 razem z panelem przeglądu).
- Zakres flagi: **U1+U2+U3** (nowe ujścia). **U4 poza flagą** – odmiana
  w rekonstrukcji DOCX jest już zbramkowana (GATE-DOCX/O-DOCX-2) i
  wyłączanie jej flagą FL-5 byłoby regresją zachowania z `main`.
- Flaga OFF ⇒ `buildOutcomeResolver` zwraca `undefined` ⇒ U1-U3 bajt
  w bajt jak dziś (to jest testowalne golden-testami bez żadnego mocka,
  bo dzisiejsze testy nie przekazują resolvera).

**Rekomendacja Fable: default ON (`true`).** Argumenty: (1) to jest
wprost cel #2 Alana, wyrażony zdaniem „ma działać w całości"; (2) polityka
`'wysoka'` + fail-closed czyni koszt błędu minimalnym, a każda odmiana
jest WIDOCZNA na ekranie przed użyciem (U1 to podgląd, nie ślepy kanał);
(3) strona deanonimizacji: ryzyko wycieku maskowania zerowe z konstrukcji;
(4) stan dzisiejszy jest niespójny (U4 odmienia, U1-U3 nie: podgląd DOCX
pokazuje co innego niż eksport) i OFF tę niespójność utrwala; (5) licznik
„odmieniono N" daje kontrolę człowieka w tym samym duchu co raport DOCX.
Decyzja pozostaje przy Alanie na bramce (G-FL5-9).

---

## §8. Niezmienniki (z dowodami do sprawdzenia na bramce)

| Niezmiennik | Dowód |
|---|---|
| Maskowanie bajt w bajt nietknięte | FL-5 nie dotyka `anonymizer.js` poza ZEROWĄ zmianą (fasada zostaje), `worker.js`, pipeline'u ani tokenizacji; istniejący test `flexion-resolver.test.js:163-171` + golden S2 na korpusie syntetycznym (`substitution.test.js:282-305`) zostają zielone bez modyfikacji |
| Flaga OFF = dzisiejsze bajty U1-U3 | istniejące testy workspace/eksportów przechodzą BEZ zmian (nie przekazują resolvera); nowy golden e2e z `pii.deanon-flexion=0` |
| Air-gap | artefakt w repo/bundlu, jedyny import w `artifact.js`; zero `fetch`/URL; desktop: asar+fuse pokrywa plik automatycznie |
| Granica MCP | payloady mostu czytają `outcome.text` (tokeny); fleksja żyje wyłącznie za granicą deanonimizacji w UI; `seen`/`morph` nie wchodzą do żadnej struktury serializowanej (jak O-7/C-VER-8) |
| Laptop-safe | zero modeli, zero eval, zero pobrań; artefakt ≤1 MB (A1/A2); pamięć §5.3 |
| Wydajność | smoke: 20 tys. znaków / 50 wystąpień < 50 ms na render (kryterium §5.5 pkt 5 rodzica; log, nie zapora). Uwaga implementacyjna: `analyzePersonName` liczy się per wystąpienie; przy przekroczeniu limitu dozwolona memoizacja per token WEWNĄTRZ jednej konstrukcji resolvera (czysta, bez zmiany kontraktu) |
| Test-first | każdy krok K3-K5 zaczyna od czerwonego testu (§11) |

---

## §9. Rejestr decyzji O-FL5 (rekomendacje Fable, rozstrzyga Alan/Opus)

| # | Decyzja | Rekomendacja | Uzasadnienie / uwagi |
|---|---|---|---|
| O-FL5-1 | FL-5-LIVE = auto-apply `'wysoka'` na U1-U3 (precedens O-DOCX-2(a)) ZAMIAST warstwy `decisions` z §5.1-5.4 FLEKSJA-IMPL-PLAN; warstwa decyzji + „Weryfikacja pisma" przesuwa się W CAŁOŚCI do FL-6 | przyjąć | S2 już ma precedencję `decyzja > resolver > baza`: FL-6 doda decyzje NAD działającym resolverem bez zmiany kontraktu; §5.2-5.5 rodzica pozostają mapą FL-6 |
| O-FL5-2 | jeden punkt konstrukcji: `buildOutcomeResolver` per wynik, wspólny dla U1-U4; kasacja inline konstrukcji `main.js:575` | przyjąć | spójność ekran=schowek=eksport z konstrukcji, nie z dyscypliny |
| O-FL5-3 | `filterSeenForLegend` obowiązuje bezwarunkowo (także U4, poza flagą) | przyjąć | korekta bezpieczeństwa R-D9 (§4): jedyna sankcjonowana delta U4 przy fladze OFF |
| O-FL5-4 | flaga `pii.deanon-flexion` + `FLEXION_LIVE_DEFAULT`; zakres U1-U3; U4 poza flagą | przyjąć mechanizm; **default ON = osobna decyzja Alana (G-FL5-9)** | §7 |
| O-FL5-5 | artefakt drabinką: A1 `role`-v0 (ręcznie + przegląd Alana) razem z FL-5; A2 imiona-core PESEL CC0 jako FL-5a z własnym mini-przeglądem tabeli; A3 = FL-1b bez zmian | przyjąć A1 teraz, A2 jako następny krok | A1 to największy zysk detekcji na bajt (S-A → `wysoka` bez anotacji); odstępstwo od „role z SGJP": świadome, laptop-safe, wymienne przy A3 |
| O-FL5-6 | `outcomes-list` (legacy, nieużywany w żywej apce) poza zakresem wpięcia; aktualizacja komentarza `flexion-resolver.js:18-21` | przyjąć | §2 (koordynator: NOOP) |
| O-FL5-7 | zero delt S2: helper przeplotu prywatny w workspace; `note` niepropagowane (licznik zbiorczy z `source==='resolver'`; wiersze z przypadkiem słownie = FL-6) | przyjąć | dyscyplina minimalnych delt SHARED-FOUNDATION |
| O-FL5-8 | alternacje nazwisk regułowych (§6 pkt 6): akceptacja do A3, opcjonalna ręczna lista wyjątków w A2 | zaakceptować ekspozycję (równa dzisiejszemu U4), listę wyjątków dodać w A2 | wariantywność uzusu; pełne domknięcie = słownik odejmujący |

---

## §10. GATE-FL5 – co sprawdza Opus przed scaleniem

| # | Warunek |
|---|---|
| G-FL5-1 | flaga OFF: U1-U3 bajt w bajt jak `main` (istniejące testy bez modyfikacji + nowy golden z flagą OFF); jedyna delta U4 = filtr R-D9 (test rogu dryfu) |
| G-FL5-2 | flaga ON: hash tekstu panelu wyjścia == hash schowka == hash treści eksportu płaskiego dla tego samego wyniku (przepis FD-3, formy poświadczone, bez artefaktu) |
| G-FL5-3 | podgląd tekstowy wyniku DOCX == tekst z rekonstrukcji na przykładzie FD-3 (spójność U1/U4) |
| G-FL5-4 | maskowanie: `flexion-resolver.test.js:163-171` + golden S2 zielone bez zmian; grep potwierdza zero modyfikacji `buildTokenMap`/`applyTokens`/`anonymizeText` |
| G-FL5-5 | regresja dryfu: scenariusz §4 (snapshot + renumeracja + kolizja tokenu) NIE wstawia formy innej osoby w żadnym ujściu |
| G-FL5-6 | air-gap i MCP: jedyny import artefaktu w `artifact.js`, zero nowych ścieżek sieciowych, payloady mostu niezmienione |
| G-FL5-7 | grep: każda produkcyjna konstrukcja `createFlexionResolver` przechodzi przez `buildOutcomeResolver` i niesie `minConfidence:'wysoka'` (wyjątki tylko w testach) |
| G-FL5-8 | smoke wydajności: <50 ms / 20 tys. znaków / 50 wystąpień (log w teście) |
| G-FL5-9 | decyzje Alana zaprotokołowane: default flagi (rekomendacja ON), A1 role-v0 (tak/nie), priorytet FL-5a, licznik „odmieniono N" w toolbarze (rekomendacja: tak) |

---

## §11. Plan implementacji dla Sonneta (test-first, czerwony → zielony)

Gałąź: `feature/fl5-live-wiring` od `main`. Po każdym kroku: `npm test`
(pełny vitest). Eval NIE dotyczy (pipeline nietknięty), modele NIE są
ładowane w żadnym teście tego planu.

**K1. `filterSeenForLegend` (nowy `src/verifier/flexion-live.js`).**
Czerwone: (a) bez snapshotu przepuszcza wszystko (identyczność), (b) róg
R-D9: token wskazuje inną wartość w legendzie żywej niż efektywnej →
wpisy tokenu odpadają, (c) klucze bez `::`/obce tokeny: nie wybucha.
Zielone: implementacja (czysta funkcja, ~15 linii).

**K2. `buildOutcomeResolver` (ten sam moduł).** Czerwone: (a)
`enabled:false` → `undefined`, (b) `enabled:true` → funkcja, która na
wejściu FD-4 z `MINI_LEXICON` zachowuje się jak
`createFlexionResolver({minConfidence:'wysoka'})`, (c) `seen`
przefiltrowane (spy/scenariusz R-D9 przez publiczne zachowanie: forma
innej osoby nie wychodzi). Zielone: implementacja (~15 linii).

**K3. Eksport płaski (`src/export/deanon.js`).** Czerwone:
`buildDeanonExportEntries` z `resolveReplacementFor` odmienia wpis
(przepis: token z anotacją `|D` + poświadczony dopełniacz w `seen`);
bez parametru → wynik identyczny z `deanonymizeText` (golden). Zielone:
przełączenie `:73` na `resolveOccurrences`+`renderResolvedText`,
sygnatura `exportDeanonOutcomes({..., resolveReplacementFor})`, gałąź
DOCX `:277-280` bierze `resolveReplacementFor(outcome)`. Istniejące
`deanon.test.js`/`deanon-docx.test.js` zielone (aktualizacja wywołań
w `deanon-docx.test.js:74,97` na nową sygnaturę, zachowanie bez zmian).

**K4. Workspace (`src/ui/deanon-workspace/index.js`).** Czerwone (jsdom):
(a) z `opts.getResolveReplacement` panel wyjścia pokazuje w pigułce formę
odmienioną (`data-orig` = finalText), (b) „Kopiuj" wkłada do schowka
DOKŁADNIE `textContent` panelu (hash), (c) bez opts → dzisiejsze snapshoty
(istniejące testy bez zmian), (d) licznik „odmieniono N form" widoczny
tylko przy N>0, (e) `refreshLegend` re-renderuje po zmianie `seenVersion`.
Zielone: prywatny helper przeplotu (spacer `renderResolvedText` +
`rawTokenLength`), `renderOutputPane`/`copyActive` na wspólnym wyniku
`resolveOccurrences`, rozszerzenie `renderSignature`.

**K5. `main.js` (właściciel).** Czerwone (wzorzec bootApp z
`main.docx-export.test.js:264-315`): (a) przepis FD-3 dla ekranu:
źródło z dwoma wystąpieniami osoby (mianownik+dopełniacz), wynik
„od [PERSON_NAME_1]" → panel wyjścia i schowek niosą „Jana Kowalskiego"
(bez artefaktu, `morph=null`), (b) to samo dla eksportu płaskiego DOCX
(flat, wynik bez bajtów), (c) `localStorage pii.deanon-flexion='0'` →
formy bazowe wszędzie, (d) róg R-D9 e2e: po podmianie źródeł wynik ze
snapshotem nie dostaje cudzej formy (także w U4). Zielone: statyczny
import silnika, flaga, `seenVersion`, `getResolveReplacement` w opts
workspace, `resolveReplacementFor` w eksporcie, kasacja `main.js:575`,
`artifact.js` (na razie artefakt pusty-poprawny `morph-pl/1` z sekcjami
`{}` albo od razu A1) + wymuszony render po załadowaniu.

**K6. A1 `role`-v0 (za zgodą z G-FL5-9).** Czerwone: golden S-A:
„powodowi [PERSON_NAME_1]" → celownik `'wysoka'` z artefaktem (dziś:
brak sygnału). Zielone: `morph-pl-core.json` z sekcją `role` (47 lematów,
paradygmaty ręczne), PLIK DO PRZEGLĄDU ALANA W CAŁOŚCI przed merge;
test spójności: każdy lemat z `ROLE_LEMMAS` ma komplet 7 form.

**K7. Porządki.** Aktualizacja komentarzy: `flexion-resolver.js:18-21`
(moduł już nie jest inert; outcomes-list = legacy), `export/deanon.js:240-246`
(„until FL-5" wykonane), `main.js:551-569` (nowy przepływ). Smoke
wydajności (G-FL5-8). Wpis do `PROJECT-MAP.md`. Werdykt do `GATE-FL5.md`.

Poza planem Sonneta (osobne kroki po bramce): FL-5a (A2, kompilator +
przegląd tabeli imion), FL-6 (UI przeglądu sugestii `'niska'`, warstwa
`decisions` wg §5.2-5.4 rodzica), A3/FL-1b (PC).

---

## §12. Poza zakresem FL-5 (twarde granice)

- UI przeglądu sugestii `'niska'`, „Zatwierdź wszystkie pewne (N)",
  wiersze raportu z przypadkiem słownie na ekranie: FL-6.
- Pełny SGJP, nazwiska-wyjątki, wariantywność z alternatywami: FL-1b/A3.
- Typy inne niż PERSON_NAME (LOCATION/ORGANIZATION_NAME z form
  poświadczonych): decyzja 13, późniejsza faza.
- Modyfikacje silnika (`flexion-resolver.js`, `morph/*`, `case-detector/*`):
  zero delt w FL-5 (jedyny wyjątek: NOWE moduły `flexion-live.js`
  i `artifact.js` obok, plus dane).
- Kierunek maskowania, pipeline NER, eval, most MCP: nietykalne.
