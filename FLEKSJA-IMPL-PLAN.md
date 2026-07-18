# FLEKSJA-IMPL-PLAN.md – fleksja „w całości": plan implementacyjny (finalizacja)

Status: **wersja 1.0 – finalizacja implementacyjna** (zero kodu w tej sesji;
plik UNTRACKED, czeka na bramkę Opusa, commit wykonuje Opus).
Autor: Fable (architekt). Data: 2026-07-18.
Wzorzec formatu: OCR-SPACING-DESIGN.md v2 (finalizacja: diagnoza → kontrakt →
kryterium akceptacji → test dowodzący → koszt → bramka).

**Rodzice (zbramkowane; ten dokument ich NIE renegocjuje, tylko domyka do
wdrożenia):**

- `LOCAL-VERIFIER-DESIGN.md` – §3 (fleksja bez LLM), §8 (plan substytucji),
  §9 (UX sugestii), rejestr O-1…O-10;
- `W1-W3-MORPHOLOGY-DESIGN.md` – specyfikacja wykonawcza W1/W2/W3;
  **bramka Opusa 2026-07-12: PROJEKT PRZYJĘTY** z dwoma warunkami do bramki
  W1: (1) wykładnia sui generis baz danych przez Alana, (2) leksykon ról
  §1.8 uzupełnić o `konsument`/`przedsiębiorca`/`poszkodowany`/`strona`;
- `PRODUCT-DECISIONS.md` – decyzje 12 (DOCX v1 forma bazowa, odmiana przez
  szew), 13 (zakres typów, miejscowości z form poświadczonych), 14 (zbiorcze
  zatwierdzanie pewnych), 15 (LLM poziomu 3 dopiero po v1), 16 (LM Studio:
  ścieżka ręczna (b)), 17 (anotacja przypadka w v1, parser ścisły),
  19 (nazwa „Weryfikacja pisma");
- `GATE-PHASE0.md` – S1 (`src/tokens.js`) i S2 (`src/substitution.js`)
  scalone do `main`, decyzje 2.1–2.4 (token kanoniczny, anotacja w MCP,
  okno ±40, single-pass);
- `DOCX-REBUILD-DESIGN.md` §8 – szew `resolveReplacement` jako punkt
  zaczepienia fleksji dla rekonstrukcji .docx.

**Czego ten plan dostarcza ponad rodziców:** (i) rozstrzygnięcie miejsca
obliczeń w potoku (nic w pipeline, wszystko po stronie deanonimizacji),
(ii) formy poświadczone wyprowadzane z ISTNIEJĄCEJ struktury `seen` – zero
zmian w tokenizacji, (iii) wiązanie planu sugestii z warstwą `decisions`
S2 na wszystkich ujściach, (iv) atrybucja przypadka form poświadczonych dla
typów bez morfologii (realizacja decyzji 13 dla miejscowości), (v) rozcięcie
laptop-safe / zależne od danych, (vi) rozstrzygnięcie roli LLM, (vii) fazy
FL-0…FL-7 z bramką GATE-FLEKSJA, (viii) rejestr decyzji O-FL dla Alana.

---

## §0. Werdykt i mapa życzenia Alana na architekturę

Alan chce fleksji „w całości": (a) wykrywać nazwiska we wszystkich formach,
(b) traktować je jako JEDNĄ grupę z anotacją przypadka
(`PERSON_NAME_1|M`, `PERSON_NAME_1|D`, …), (c) skutecznie deanonimizować
z użyciem przypadka właściwego dla zdania (token w kontekście dopełniacza
wstawia „Kowalskiego", nie „Kowalski").

| Życzenie | Stan | Co domyka ten plan |
|---|---|---|
| (a) wykrywanie form odmienionych jako ta sama osoba | DZIAŁA dziś: `couldBeSamePerson` + `INFLECTION_SUFFIXES` + rodziny -ski/-cki/-dzki (`src/anonymizer.js:5-98`) grupują warianty w jeden token przy tokenizacji | bez zmian; luki grupowania (nazwiska pospolite, alternacje) domykają osobne moduły SG/B-serii, nie fleksja |
| (b) jedna grupa + anotacja | S1 sparsuje `[PERSON_NAME_1\|D]` i zwróci `tokenId` bez anotacji (`src/tokens.js:29-41`); anotowany token przechodzi przez MCP (GATE-PHASE0 poz. 2.2); anotację pisze dziś wyłącznie LLM klienta (decyzja 17) | kontrakt „jedna grupa" domknięty w §4; anotacja WYCHODZĄCA (nasza, w tekście stokenizowanym) świadomie NIE w v1 – O-FL-4 |
| (c) deanonimizacja we właściwym przypadku | brak: każde wystąpienie dostaje `legend[token]` = formę pierwszego wystąpienia (`src/anonymizer.js:126-134`) | rdzeń planu: W1–W3 (dane + silnik + detektor) → plan sugestii → decyzje → S2 `decisions` → cztery ujścia (§5) + szew DOCX (§6) |

**Niezmienniki nadrzędne (dziedziczone, nie do dyskusji):**

- **Maskowanie nietknięte.** Fleksja jest warstwą DEANONIMIZACJI. Zero zmian
  w `src/pipeline/**`, `applyTokens`, `buildTokenMap`/`buildTokenMapMulti`,
  `ingestSource`, krokach i konfiguracji pipeline'u. Tekst stokenizowany
  (źródła, MCP, most) pozostaje bajt w bajt taki sam. Dowód: §11.
- **V2:** żadna forma nie wchodzi do pisma bez jawnej akceptacji człowieka;
  brak decyzji = zachowanie identyczne z dzisiejszym (golden bajt w bajt).
- **Zero kanału, zero nowego runtime'u, zero PII w spoczynku** (0.2
  W1-W3): dane morfologiczne kompilowane deweloperskim skryptem, artefakt
  w repo, silnik to czyste funkcje.
- v1 **bez generatywnego LLM-a** (rodzic §3.4, decyzja 15) – rozwinięcie
  i uzasadnienie dla Alana w §7.

---

## §1. Architektura end-to-end

Przepływ (wyłącznie strona deanonimizacji; na lewo od pierwszej strzałki
świat maskowania, nietknięty):

```
źródła + entities + seen  ──(inwersja, czysta funkcja)──►  formy poświadczone per token
                                                              │ (RAM, snapshot per wynik)
wynik LLM (tekst stokenizowany, opcjonalne [TYP_N|PRZYPADEK])  │
        │ findTokens (S1)                                      ▼
        ├──► W3 detectCase (kaskada sygnałów + anotacja jako głos) ─► zbiór przypadków + pewność
        ├──► W2 analyzePersonName / generateForm (morph-pl.json) ──► forma + źródło + alternatywy
        ▼
   PLAN SUGESTII per wystąpienie (K4)  ──►  UI „Weryfikacja pisma": zatwierdź / zostaw / wybierz
                                                              │ decyzje człowieka (RAM)
                                                              ▼
     resolveOccurrences(text, { legend, decisions }) + renderResolvedText   (S2)
                                                              │
        ┌──────────────┬───────────────┬─────────────────┬────┴──────────────┐
     podgląd        „Kopiuj"       karty wyników     eksport DOCX/PDF     (przyszłe) rekonstrukcja
     (pigułki)     (schowek)      (outcomes-list)    (export/deanon.js)    .docx (MD4, szew §8)
```

Jedno źródło prawdy: wszystkie ujścia konsumują TEN SAM wynik
`resolveOccurrences` z TĄ SAMĄ mapą decyzji. „Pokazane = skopiowane =
wyeksportowane" jest wtedy własnością konstrukcyjną, domkniętą testem hashy
(C-VER-4).

---

## §2. Silnik morfologiczny (zadanie 1)

### 2.1 Źródło danych i licencje

Rozstrzygnięte w `W1-W3-MORPHOLOGY-DESIGN.md` §1.1–§1.2, potwierdzone
u źródła (odczyt 2026-07-12, nie z pamięci):

- **Z1 SGJP** (zrzut `.tab` dystrybuowany z projektem Morfeusz 2,
  `sgjp-20260628.tab.gz`, 41 MB gz): **BSD-2-Clause** – deklaracja na
  stronie licencji Morfeusza 2; jedyne źródło paradygmatów (imiona,
  nazwiska, role). Morfeusz-program NIEUŻYWANY (zero nowego runtime'u).
- **Z2/Z3 listy imion i nazwisk z rejestru PESEL** (dane.gov.pl, datasety
  1667/1681, Ministerstwo Cyfryzacji): **CC0 1.0** – metadane API portalu.
- **Z4 PoliMorf** (BSD-2): wyłącznie rezerwa, jeśli pomiar pokrycia G-W1-3
  wykaże braki nazwisk w SGJP.

Pozostałe do domknięcia przy bramce danych (checklista 1.2.5 W1-W3 +
warunki bramki 2026-07-12): (1) obejrzenie pliku licencyjnego wypakowanego
z wnętrza archiwum `.tab.gz` (kompilator commituje go do
`scripts/morph/licenses/`), (2) wykładnia sui generis do baz danych –
**decyzja radcy, nie Legalisu** (O-FL-1), (3) wpisy do
`THIRD_PARTY_NOTICES.md` wg gotowca 1.2.4 W1-W3, (4) uzupełnienie listy ról
§1.8 o `konsument`, `przedsiębiorca`, `poszkodowany`, `strona` (warunek
bramki projektu).

### 2.2 Pinowanie, suma w repo, integralność (mechanizm – bez zmian względem W1)

- `scripts/morph-sources.lock.json`: nazwa, wersja, URL, `sha256`, licencja,
  link do deklaracji, data kotwiczenia – commit locka jest jawnym aktem TOFU
  przeglądanym na bramce (dyscyplina C-INT-7/8).
- `scripts/fetch-morph-sources.mjs` (wzorzec `fetch-models.mjs`): pobiera do
  `scripts/.cache/morph/` (gitignore), fail-closed przy niezgodności sumy,
  tryb `--anchor` do pierwszego kotwiczenia. Transport (HTTP) nie jest
  zaufany; zaufanie pochodzi z sumy w repo i przeglądu po kompilacji.
- `scripts/compile-morph-data.mjs`: deterministyczny (podwójna kompilacja
  bajt w bajt), **słownik odejmujący** (reguły W2 przepuszczone przez 100%
  leksemów nazwiskowych SGJP; do artefaktu wchodzą wyłącznie delty; klasa
  poniżej progu zgodności 98% zdegradowana do „tylko słownik"), raport
  `COMPILE-REPORT.md` commitowany obok artefaktu.
- Artefakt `src/verifier/morph/data/morph-pl.json` **commitowany do repo**;
  suma artefaktu w locku; test CI: suma pliku == lock.

### 2.3 Rozmiar, format, ładowanie: NIE jak modele NER

Modele NER to setki MB ONNX ładowane przez `@huggingface/transformers`
w workerze z `resources/models/` (desktop, kotwica B1) albo z huba (web).
Dane morfologiczne to INNY reżim:

| Cecha | Modele NER | `morph-pl.json` |
|---|---|---|
| Rozmiar | ~0,5–1,6 GB | cel ≤ 5 MB (sekcje: `imiona` setki KB, `nazwiska`-delty setki KB, `role` dziesiątki KB, `frekwencja` dziesiątki–setki KB) |
| Dystrybucja | poza repo, pobierane/instalator | **w repo**, buduje się do bundla |
| Ładowanie | worker, `loadModel` DI, budżet `MEMORY_BUDGET_MB = 1680` (`src/worker.js:39`) | statyczny import JSON przez bundler (jak `identifier-patterns.json` w `src/anonymizer.js:3`), parsowanie wbudowanym `JSON.parse` |
| Integralność | manifest + `electron/model-integrity.mjs` | `app.asar` + fuse `EnableEmbeddedAsarIntegrityValidation` (C-VER-2 wariant a) |
| Sieć | web: hub; desktop: nigdy | **nigdy, w żadnym wariancie** |

Reguła decyzyjna rozmiaru (tabela 1.5 W1-W3, wiążąca): ≤ 5 MB → bundle/asar;
> 5 MB → `resources/morph/` + wpis w `models/manifest.json` + weryfikacja
runtime (C-VER-2 wariant b); > 10 MB → STOP, cięcie progów frekwencji.
Miejsce obliczeń: ≤ 3 MB surowego JSON-a → dopuszczalny wątek główny
(fleksja jest milisekundowa, plan liczy się przy wklejeniu wyniku);
większy → wyłącznie worker. Decyzja pomiarowa zapisana w raporcie
kompilacji (O-FL-6). Artefakt importuje DOKŁADNIE jeden moduł
(`src/verifier/morph/load.js`), żeby bundler nie zdublował danych.

Środowiska: przeglądarka (web i desktop) – bundle; testy vitest – zwykły
import JSON z repo, offline; Node-owy eval NIE konsumuje morfologii
(pipeline nietknięty).

### 2.4 API generacji (kontrakt W2 – referencja, zero delt)

Kontrakt `src/verifier/morph/` pozostaje dokładnie taki, jak w W1-W3 §2.1:

- `analyzePersonName(value, attestedForms, morph)` → struktura słów, rodzaj,
  `lematM`, paradygmat, wariantywność, `poswiadczoneWgPrzypadka`, źródło
  rodzaju ALBO flaga (`obce`/`struktura`/`imię-nieznane`/
  `rodzaj-niejednoznaczny`/`dane-niedostępne`);
- `generateForm(analiza, zbiorPrzypadkow)` → forma + przypadek + źródło
  (`poświadczona`/`słownik`/`reguła`) ALBO flaga (`przypadek-nieustalony`/
  `formy-rozbieżne`/`wariantywne`/`nie-umiem-odmienić`) z alternatywami;
- `fullParadigm(analiza)` → komplet 7 przypadków z jawnymi lukami.

Zasady twarde bez zmian: wejściem jest ZBIÓR przypadków (kolaps D=B męskich
robi W2, nie W3); zero propozycji przy niepewności („nigdy najlepszy
strzał"); determinizm; każda forma wskazuje źródło. Goldeny G1–G20 (§2.8
W1-W3) są kryterium akceptacji – w tym G12: wartość legendy „Jana
Kowalskiego" + kontekst mianownikowy → propozycja „Jan Kowalski"
ZASTĘPUJĄCA wartość legendy (to jest rdzeń problemu „legenda trzyma
pierwsze wystąpienie, nie mianownik").

### 2.5 Konsumenci artefaktu (jeden słownik prawdy)

`morph-pl.json` ma zapowiedzianych konsumentów poza fleksją – kontrakt
loadera musi ich nie blokować (afordancja danych, nie sprzężenie kodu):

| Konsument | Sekcja | Zapowiedź |
|---|---|---|
| W2/W3 (ten plan) | wszystkie | rodzic §3 |
| A9 audytu (blocklista ról zna dziś tylko mianownik) | `role` + indeks form + `isTruncatedRolePrefix` | W1-W3 §3.5 |
| B4-full (role/tytuły pipeline'u) | `role` | RECALL-90 §6.2 R-6 |
| SG-full (gazeter nazwisk) | `nazwiska` + paradygmaty | SURNAME-GAZETTEER §2.2 pkt 3 |

---

## §3. Wykrywanie przypadka: gdzie w potoku (zadanie 2)

### 3.1 Rozstrzygnięcie architektoniczne

**Ani osobny krok pipeline'u, ani „przy tokenizacji".** Całość liczy się
po stronie deanonimizacji, przy budowie planu sugestii (workspace wyników),
w dwóch komplementarnych miejscach:

1. **Analiza form poświadczonych (wiedza źródłowa)** – leniwie, przy
   snapshocie wyniku: jakie warianty danej osoby/nazwy widzieliśmy
   w źródłach i JAKI przypadek każdy wariant realizuje (§3.2–§3.3).
2. **Detekcja przypadka wymaganego (wiedza wynikowa)** – W3 `detectCase`
   na tekście stokenizowanym WYNIKU, per wystąpienie tokenu, przy budowie
   planu (§3.4).

Pipeline anonimizacji nie zna pojęcia przypadka. To domyka wymóg
niezmienności maskowania z konstrukcji, nie z testu (test i tak jest, §11).

### 3.2 Formy poświadczone: inwersja `seen`, zero zbierania przy tokenizacji

Ustalenie z kodu (delta względem założenia rodzica §2.2, że warianty „są
gubione"): `buildTokenMap`/`buildTokenMapMulti` JUŻ zachowują każdy surowy
wariant – `ingestSource` wpisuje `seen[rawKey] = token` dla każdej formy
powierzchniowej różnej od kanonicznej (`src/anonymizer.js:136-139`),
a `main.js` trzyma `seen` w stanie modułu i odbudowuje w `refreshLegend()`
(`src/main.js:45,635-649`). Formy poświadczone to czysta inwersja:

```
deriveAttested(readySources, seen) →
  { "[PERSON_NAME_1]": { formy: ["Jan Kowalski", "Jana Kowalskiego", …],
                         wystapieniaZrodlowe: [ { forma, kontekstPrzed, kontekstPo } ] } }
```

Kontrakt:

- czysta funkcja nad istniejącym stanem (`sources` ready + `seen`); iteracja
  po encjach źródeł daje formy RAZEM z kontekstem źródłowym (±40 znaków
  surowego tekstu wokół spanu) – potrzebnym do atrybucji przypadka typów bez
  morfologii (§3.3); wariant minimalny (sama inwersja `seen`, bez kontekstów)
  wystarcza dla PERSON_NAME;
- wynik żyje WYŁĄCZNIE w RAM; snapshot per wynik (`attestedSnapshot`) robiony
  w tych samych miejscach co `legendSnapshot`
  (`src/ui/outcomes-coordinator.js:28,42`); helper
  `effectiveOutcomeAttested(outcome, live)` lustrzany do
  `effectiveOutcomeLegend` (`src/substitution.js:111-113`);
- struktura NIGDY nie przechodzi przez kanały (WebMCP/most), nie trafia do
  `localStorage`, debug ani logów – realizacja O-2 i C-VER-8; koordynator
  dostaje akcesor `getSeen`/`getSources` obok istniejącego `getLegend`,
  żadnych nowych ścieżek serializacji;
- formy nieparsowalne (śmieci OCR) nie blokują analizy – W2 pomija je
  w pinowaniu (K1.4), trafiają do struktury tylko jako surowe stringi.

### 3.3 Atrybucja przypadka form poświadczonych

Dwie ścieżki, zależnie od typu:

- **PERSON_NAME:** morfologicznie – `analyzePersonName` analizuje każdy
  wariant poświadczony aparatem słownikowo-regułowym i buduje
  `poswiadczoneWgPrzypadka` (kontrakt W2 już to przewiduje). Zero nowych
  mechanizmów.
- **Typy bez morfologii w v1 (`LOCATION`, `ORGANIZATION_NAME`,
  `PERSON_ALIAS` – decyzja 13):** atrybucja z KONTEKSTU ŹRÓDŁOWEGO
  wariantu: nad `kontekstPrzed` z §3.2 uruchamiany jest podzbiór kaskady
  W3 ograniczony do sygnałów mocnych i jednoznacznych (przyimek z tabeli
  S-P, apozycja roli z pełnym dopasowaniem formy). Przykład: źródło
  zawierało „w Toruniu" → wariant „Toruniu" dostaje zbiór {B,Ms} z „w",
  zawężony do {Ms} jeśli współsygnał (np. „zamieszkały w Toruniu") na to
  pozwala; bez sygnału → wariant bez atrybucji.
  Nowa czysta funkcja `attributeAttestedCase(wystapienieZrodlowe, deps)`
  w `src/verifier/case-detector/` (reuse tabel W3; zero osobnych danych).

Użycie przy generacji (porządek K3 rodzica, doprecyzowany):

1. wymagany zbiór przypadków ∩ atrybucja wariantu poświadczonego ≠ ∅
   → **forma poświadczona dosłownie** (`zrodlo: 'poświadczona'`);
   pewność „wysoka" wymaga jednoznaczności po OBU stronach;
2. (tylko PERSON_NAME) słownik → reguła – jak W2 §2.7;
3. flaga. Dla typów bez morfologii NIE MA kroku 2–3: brak pasującego
   poświadczenia = flaga „brak formy poświadczonej dla przypadku X",
   z formą bazową bez zmian.

**Uczciwe ograniczenie (zapisać w docs):** warianty odmiany, które przy
tokenizacji dostały OSOBNE tokeny (np. „Toruń" i „Toruniu" – `LOCATION` nie
ma normalizatora grupującego, `src/anonymizer.js:117-124`), nie
cross-pollinują form między tokenami. Scalanie wariantów miejscowości
wymaga bazy nazw (TERYT/SGJP-miejscowości) i jest jawnie odłożone do v1.1
(dokładnie po linii decyzji 13). W praktyce v1 dla tych typów daje:
potwierdzenie zgodności przypadka (wysoka pewność, identyczność) albo
flagę – nigdy błędną generację.

### 3.4 Detekcja przypadka wystąpień wyniku (W3 – referencja)

Bez delt względem W1-W3 §3: kaskada S-A (apozycja do roli, indeks WSZYSTKICH
form lp z sekcji `role`), S-P (tabela przyimków), S-R (rekcja czasowników),
S-M (pozycja podmiotu), S-T (anotacja z tokenu – dane niezaufane, decyzja
17: zgodna podnosi pewność, sprzeczna → `nieustalony`, samotna → co
najwyżej „niska"); algebra przecięcia zbiorów; okno = bieżące zdanie,
200 znaków w lewo / 80 w prawo; inne tokeny w oknie nieprzezroczyste;
goldeny H1–H18. `occurrence` dla `detectCase` pochodzi z `findTokens` (S1)
i niesie `index`, `rawLength`, `case?` – `rawLength` wymaga wyniesienia
istniejącego `rawTokenLength` z S2 do eksportu (`src/substitution.js:18-22`);
to JEDYNA dopuszczalna delta w S2 (czysta, bez zmiany zachowania).

Dwa okna kontekstu współistnieją zgodnie z GATE-PHASE0 poz. 2.3: okno
zdaniowe 200/80 służy DETEKCJI (W3), okno ±40 z S2 służy INWALIDACJI
decyzji (§5.4) i kontekstom szwu DOCX – potwierdzone, nie do scalania.

### 3.5 Kiedy liczone i za ile

Plan przeliczany przy: utworzeniu wyniku, aktualizacji tekstu wyniku,
`refreshLegend` (dokładnie zdarzenia, przy których dziś powstaje
`legendSnapshot`). Koszt: analiza 1000 wartości < 100 ms (G-W2-6), okno
zdaniowe per wystąpienie liniowe – plan dla wyniku 20 tys. znaków
z 50 wystąpieniami ma być niezauważalny (< 50 ms, log w teście
orientacyjnym). Web Lock NIEPOTRZEBNY (to nie jest długa praca; W6/rescan,
który go wymaga, jest poza tym planem).

---

## §4. „Jedna grupa": kontrakt tożsamości (zadanie 3)

1. **`tokenId` jest kluczem tożsamości wszędzie.** S1 gwarantuje:
   `[PERSON_NAME_1|D]` → `tokenId = "PERSON_NAME_1"`, `token =
   "[PERSON_NAME_1]"` (forma kanoniczna), `case = "D"` osobnym polem
   (`src/tokens.js:29-41`). Wszystkie wystąpienia z dowolną anotacją
   wskazują TEN SAM wpis legendy.
2. **Kontrakt z legendą – bez zmian semantyki.** `legend[token]` = forma
   pierwszego wystąpienia (jak dziś, `src/anonymizer.js:126-134`); klucz
   zawsze kanoniczny; anotacja NIGDY nie wchodzi do klucza. `lematM`
   (mianownik z analizy W2) jest własnością warstwy analizy, nie legendy:
   legenda NIE jest przepisywana na mianownik (złamałoby golden zgodności
   wstecznej i zaskoczyło każdy istniejący test). Mianownik pojawia się
   jako propozycja przy wystąpieniach w kontekście M (golden G12) oraz –
   opcjonalnie, wyłącznie prezentacyjnie – jako dopisek w UI legendy
   („forma bazowa: Jan Kowalski"), bez mutacji struktury.
3. **`seen`, liczniki, rezerwacje tokenów** – nie znają pojęcia przypadka;
   `collectReservedTokens` działa na formach kanonicznych (S1), więc token
   anotowany w źródłowym tekście rezerwuje swój kanoniczny odpowiednik.
4. **Granica MCP.** Wchodzące `write_outcome` z tokenami anotowanymi jest
   poprawne (GATE-PHASE0 poz. 2.2, wspólna gramatyka w `containsToken`,
   `src/mcp/listings.js:29-31`); wychodzące `read_source` niesie tokeny BEZ
   anotacji (maskowanie nietknięte). Dokumentacja narzędzi (docs/webmcp.md,
   sekcja WebMCP w CLAUDE.md) dostaje akapit: „LLM może opcjonalnie
   anotować tokeny przypadkiem `[TYP_N|M/D/C/B/N/Ms/W]`; anotacja jest
   niewiążącą wskazówką dla deanonimizacji, każda inna treść po `|`
   unieważnia token" – to zmiana opisu, nie kontraktu (kontrakt wszedł
   z decyzją 17).
5. **S2 liczy surowe długości poprawnie** (`rawTokenLength`,
   `src/substitution.js:18-22`) – wystąpienie anotowane zajmuje więcej
   znaków niż kanoniczne i podmiana o tym wie; `splitTokenParts` w UI
   renderuje pigułkę kanoniczną (anotacja niewidoczna dla oka użytkownika
   poza trybem debugowym sugestii – celowo, szum zerowy).

---

## §5. Generacja przy deanonimizacji: plan → decyzje → S2 → cztery ujścia (zadanie 4)

### 5.1 Struktury

**Plan** (wyliczany, ulotny, per wynik) – kształt K4 rodzica / W1-W3 §4:

```
plan[outcomeId] = [ { occurrenceIndex, tokenId, current, proposed?, case?,
                      confidence: 'wysoka'|'niska', rationale, alternatives,
                      flags: [...] } ]
```

Reguła pewności bez zmian (W1-W3 §4): „wysoka" ⟺ `detectCase` dał pewność
wysoką ∧ `generateForm` zwrócił formę ze źródłem bez flagi `wariantywne`.

**Decyzje** (wprowadzane wyłącznie przez człowieka, ulotne, per wynik):

```
decisions[outcomeId] = Map<occurrenceIndex,
  { text, tokenId, anchor }>   // anchor = hash(±40 znaków tekstu
                               // stokenizowanego wokół wystąpienia)
```

Warstwa `decyzja ?? resolver ?? baza` już istnieje w S2
(`resolveOccurrences`, `src/substitution.js:30-79`). Fleksja v1 używa
WYŁĄCZNIE warstwy `decisions`; `resolveReplacement` zostaje tożsamościowy
(nieprzekazywany) na ujściach płaskich – jego konsumentem jest szew DOCX
(§6). Zatwierdzenie sugestii = wpis do `decisions`; „zostaw formę obecną" =
brak wpisu; „wybierz inną formę" (pełny paradygmat) = wpis z formą wybraną.

### 5.2 Cztery ujścia: stan dziś → stan po FL-5

| Ujście | Dziś | Po zmianie |
|---|---|---|
| podgląd wyjścia | `renderParts` buduje z `splitTokenParts` + legendy, pigułka pokazuje `part.orig` (`src/ui/deanon-workspace/index.js:108-134`) | render z `resolveOccurrences(text, {legend, decisions})`: pigułka pokazuje `finalText` wystąpienia + stan (baza / sugestia / zatwierdzona / nierozwiązany) |
| „Kopiuj" | `deanonymizeText` (`src/ui/deanon-workspace/index.js:275`) | `renderResolvedText` z TEGO SAMEGO wyniku `resolveOccurrences` |
| karty wyników | `deanonymizeText` (`src/ui/outcomes-list/index.js:65,209`) | jw. (formy zatwierdzone; bez decyzji = jak dziś) |
| eksport DOCX/PDF | `buildDeanonExportEntries` → `deanonymizeText` (`src/export/deanon.js:73`) | jw. |

`deanonymizeText(text, legend)` (`src/anonymizer.js:994-996`) pozostaje
jako fasada zgodności (plan pusty ↔ identyczne zachowanie); ujścia
przechodzą na wywołanie z `decisions`. Jedno miejsce składa
`{legend, decisions}` dla wyniku (moduł planu), ujścia go konsumują –
zakaz liczenia decyzji per ujście.

### 5.3 UI (podzbiór W7 potrzebny fleksji; nazwa: „Weryfikacja pisma", decyzja 19)

- Pigułka-sugestia odróżnialna od dzisiejszej: pokazuje formę OBECNĄ,
  obok proponowaną z przypadkiem słownie („→ Janowi Kowalskiemu,
  celownik"); klik = menu wystąpienia: zatwierdź · zostaw · wybierz inną
  formę (pełny paradygmat) · pokaż uzasadnienie (tekst `rationale` z W3).
- „Zatwierdź wszystkie pewne (N)" – wyłącznie pewność „wysoka"
  (decyzja 14); niepewne per sztuka; to nadal jawny gest człowieka (V2).
- Liczniki nieprzejrzanych sugestii przy „Kopiuj"/„Eksportuj" – informacja,
  nie zapora (§9.3 rodzica).
- Rendering wyłącznie `textContent` (C-VER-7); nazwy przypadków po polsku
  słownie (§9.4); sekcja „Nieścisłości" (checkery W5, scalone wcześniej)
  może dojść do tego samego panelu PÓŹNIEJ – fleksja jej nie wymaga i na
  nią nie czeka.

### 5.4 Cykl życia i inwalidacja decyzji

- Plan przeliczany przy zdarzeniach z §3.5; decyzje trzymane przy wyniku
  (jak `legendSnapshot`), giną z zamknięciem aplikacji (D2 bez zmian).
- Po aktualizacji tekstu wyniku: `findTokens` od nowa; decyzja przeżywa
  ⟺ na jej `occurrenceIndex` nadal stoi ten sam `tokenId` ∧ `anchor`
  (hash ±40 znaków otoczenia) się zgadza. Inaczej: decyzja odrzucona
  (fail-closed do formy bazowej) + licznik „unieważnione zmianą tekstu".
  Zero prób „inteligentnego" przenoszenia decyzji – przewidywalność ponad
  spryt.

### 5.5 Kryteria akceptacji (FL-5)

1. Plan pusty / zero decyzji → wszystkie CZTERY ujścia bajt w bajt jak
   dziś (golden na istniejących przypadkach `src/anonymizer.test.js` +
   e2e porównawcze; C-VER-3).
2. Z decyzjami: hash tekstu podglądu == hash schowka == hash treści
   eksportu (C-VER-4, wzorzec §6.8 mostu).
3. Inwalidacja: test aktualizacji tekstu (decyzja przeżywa nietknięte
   otoczenie, ginie przy zmianie otoczenia/tokenu).
4. Żadna ścieżka nie zmienia tekstu bez decyzji człowieka (przegląd +
   testy: brak interakcji = brak zmian; „zatwierdź wszystkie pewne"
   obejmuje wyłącznie wysokie).
5. Wydajność: plan 20 tys. znaków / 50 wystąpień < 50 ms (log).

---

## §6. Szew DOCX: rekonstrukcja z odmianą (zadanie 7, część DOCX)

Stan: MD1/MD2 (kontener ZIP) scalone; MD4 (token-engine XML) jeszcze nie
istnieje. Decyzja 12: v1 DOCX wstawia formę bazową; odmiana dochodzi
„projektem (b) przez gotowy szew `resolveReplacement` (§8)". Ten plan JEST
projektem (b) po stronie fleksji – kontrakt konsumpcji:

1. **Te same decyzje, ten sam porządek.** MD4 enumeruje tokeny strumienia
   tekstowego dokumentu w kolejności dokumentu; `occurrenceIndex` musi być
   zdefiniowany identycznie jak w `findTokens(outcome.text)` nad podglądem
   tekstowym tego samego wyniku (import .docx tworzy podgląd tekstowy –
   decyzja 10 – i to ON jest tekstem wyniku). Konsument dostaje od modułu
   planu projekcję `decisions` i stosuje ją w szwie:
   `resolveReplacement(part) = decyzja(occurrenceIndex) ?? baseValue`.
2. **Asercja zgodności, fail-closed.** Przy każdym wystąpieniu MD4
   porównuje `tokenId` z decyzją; rozjazd (inna enumeracja, np. tekst
   w polach/przypisach) = decyzja pominięta, forma bazowa, wpis do raportu
   rezyduów – nigdy cicha podmiana w złym miejscu.
3. **Raport różnic.** Każda podmiana formą ≠ `baseValue` dostaje wiersz
   raportu „odmieniono: «Jana Kowalskiego» → «Janowi Kowalskiemu»
   (celownik, decyzja radcy)" – użytkownik widzi w raporcie, że wartość
   została ODMIENIONA, nie podmieniona na inną (kontrakt §8
   DOCX-REBUILD).
4. **Sanityzacja.** Forma z decyzji przechodzi tę samą sanityzację co
   wartość bazowa (§4.6 DOCX-REBUILD); formy pochodzą ze słownika/reguł/
   poświadczeń i są zwykłym tekstem – żadnych nowych klas treści.
5. **Zgodność wsteczna.** Zero decyzji → rekonstrukcja identyczna
   z dzisiejszą specyfikacją MD (forma bazowa wszędzie).

Test dowodzący (kontraktowy, niezależny od terminu MD4): symulowany
strumień części tekstowych z tokenami → enumeracja → zastosowanie decyzji
→ asercje 1–5. Realny e2e wchodzi razem z MD4; do tego czasu kontrakt
w repo trzyma szew stabilnym.

---

## §7. Rola lekkiego lokalnego LLM: rozstrzygnięcie (zadanie 5)

### 7.1 Skąd wspomnienie „miał być pod to LLM"

`MCP-BRIDGE-DESIGN.md` §9.4 (RB-2) zapowiadał „lokalny LLM-weryfikator"
jako wizję. Projekt weryfikatora ROZSTRZYGNĄŁ tę wizję tak (rodzic §1.2,
§3.4, §5; decyzje 15–16, zatwierdzone przez Alana): fleksja i najcenniejsze
wykrywanie nieścisłości NIE potrzebują LLM-a; generatywny model to
wyłącznie opcjonalny POZIOM 3 (nieścisłości semantyczne), nie w v1,
a LM Studio dostępne od zaraz ścieżką ręczną „Kopiuj pakiet weryfikacyjny"
(schowek, zero kanału). Nic z tamtych werdyktów nie wymaga zmiany – niżej
precyzyjny podział pracy, żeby decyzja Alana była świadoma.

### 7.2 Co robi silnik deterministyczny, a co mógłby dokładać LLM

| Zadanie | Silnik deterministyczny (ten plan) | Co dołożyłby LLM |
|---|---|---|
| ustalenie lematu, rodzaju, paradygmatu | słownik SGJP/PESEL + klasy reguł; luki = jawna flaga | nic ponad; ryzyko zmyślenia paradygmatu |
| **generacja formy** („Kowalskiego") | słownik → reguła → poświadczenie; audytowalne źródło każdej formy; tryb błędu = flaga | tryb błędu = **podmiana nazwiska/treści** (błąd klasy treści, nie formy) – DYSKWALIFIKACJA w piśmie procesowym, rodzic §3.4; ODRZUCONE NA STAŁE |
| **wykrycie przypadka** w zdaniu wyniku | kaskada S-A/S-P/S-R/S-M + anotacja S-T; sprzeczność/brak sygnału = uczciwy `nieustalony` (flaga, decyzja człowieka) | rozstrzyganie zdań bez sygnału lokalnego (składnia długodystansowa); możliwy jako DODATKOWY GŁOS w kaskadzie – nigdy rozstrzygający; kandydat v1.1+, wyłącznie po pomiarze (7.3) |
| nieścisłości semantyczne pisma (sprzeczne akapity itd.) | poza fleksją; checkery W5 + rescan W6 pokrywają klasy deterministyczne | poziom 3 (decyzja 15: po v1, po benchmarku W9, komponent opcjonalny) |

Wniosek techniczny: w FLEKSJI jedyną realną niszą LLM-a jest zamiana CZĘŚCI
flag „przypadek nieustalony" na sugestie niskiej pewności. Sugestie niskie
i tak wymagają decyzji per sztuka (V2), więc zysk przepustowości jest mały,
a koszt duży: artefakt 0,5–1,5 GB obok budżetu workera 1680 MB
(`src/worker.js:39` – współrezydencja z modelami NER wymaga ewikcji),
benchmark W9, osobna bramka (O-6), nowy łańcuch dostaw.

### 7.3 Rekomendacja (do decyzji O-FL-2)

**v1: bez LLM-a w fleksji – w całości deterministycznie.** Warunek powrotu
POMIAROWY, nie z apetytu: jeżeli po wdrożeniu FL telemetria lokalna planu
(licznik flag w UI, zero wysyłki czegokolwiek) pokaże, że na realnych
pismach Alana > ~20% wystąpień PERSON_NAME kończy jako `nieustalony`,
wraca temat „LLM jako głos w K2" osobnym mini-projektem: wymagania wtedy –
model mały (≤ ~1,5 B, q4, WASM w workerze, wzorzec (i) z §5.1 rodzica),
licencja potwierdzona U ŹRÓDŁA na dzień decyzji (kandydaci polskojęzyczni
typu rodzina Bielik – licencji NIE przesądzam z pamięci), benchmark W9
(jakość/latencja/pamięć na sprzęcie kancelaryjnym, podłoga 16 GB RAM),
komponent opcjonalny instalatora, kotwica integralności jak modele NER,
bramka Opusa (O-6). LM Studio: pozostaje ścieżka ręczna (decyzja 16b);
integracja API nie wraca w tym planie w ogóle (werdykt O-7 rodzica).

Uczciwa konsekwencja dla Alana: bez LLM-a część wystąpień pozostanie
flagami do ręcznego wyboru formy (jedno kliknięcie z menu paradygmatu).
Z LLM-em te flagi stałyby się sugestiami „niskimi"… które i tak wymagają
tego samego kliknięcia. Różnica realna jest mniejsza, niż się wydaje.

---

## §8. Podział laptop-safe vs zależny od danych/PC (zadanie 6)

Konwencja sprzętowa projektu: PC = stacjonarny (32 GB), laptop = 15,4 GB,
podłoga specyfikacji 16 GB. Fleksja NIE uruchamia `npm run eval`
(pipeline nietknięty – asercja w PR zamiast evalu, dokładnie wzorzec
W1-W3 §6.5), więc ryzyko zamulenia laptopa dotyczy wyłącznie kompilacji
danych.

| Praca | Klasa | Uzasadnienie |
|---|---|---|
| FL-0 leksykon ról + tabele przyimków/rekcji (dane w plikach) | laptop-safe | pliki KB-owe, czysta redakcja |
| FL-1a kompilator + testy na mini-fixture | laptop-safe | fixture `scripts/morph/fixtures/sgjp-mini.tab` (mały wyciąg formatu; do czasu zakotwiczenia realnego zrzutu – syntetyczny w formacie z dokumentacji, po zakotwiczeniu – regenerowany wyciąg z realnego pliku z notą BSD-2) |
| FL-1b pobranie 41 MB gz + pełna kompilacja + pomiar rozmiaru + raport | **PC (zalecane)** | zrzut SGJP po rozpakowaniu to setki MB tekstu; kompilator MA streamować linia-po-linii (kontrakt: szczyt pamięci < 1 GB, log w raporcie); na laptopie dopuszczalne wyłącznie świadomie, poza godzinami pracy na sprawach |
| FL-2/FL-3 silnik W2 + detektor W3 + goldeny | laptop-safe | czyste funkcje, artefakt z repo, offline |
| FL-4 formy poświadczone + atrybucja | laptop-safe | czyste funkcje nad stanem UI |
| FL-5/FL-6 plan + ujścia + UI + testy e2e | laptop-safe | vitest + Playwright bez modeli NER (deanonimizacja nie ładuje ONNX) |
| FL-7 kontrakt szwu DOCX | laptop-safe | testy kontraktowe bez realnych .docx od AI |
| (warunkowy, poza planem) benchmark W9 LLM | **PC** | inferencja, pamięć |

Zero nowych zależności runtime w każdym punkcie (G-W1-7).

---

## §9. Fazy implementacyjne FL-0…FL-7

Kolejność zgodna z W1→W2→W3→W4 rodzica; FL-0/FL-1a/FL-2/FL-3 można
prowadzić równolegle z FL-4. Rozmiary: S (≤1 dzień), M (2–4 dni).

| Faza | Zakres (kontrakt) | Kryterium akceptacji / test dowodzący | Rozmiar | Bramka |
|---|---|---|---|---|
| **FL-0** | `src/verifier/case-detector/role-lemmas.js` (lista §1.8 W1-W3 **+ konsument/przedsiębiorca/poszkodowany/strona**), `prepositions.js`, `verbs.js` (dane w plikach, katalogi otwarte) | testy spójności danych (rozłączność, kompletność form po FL-1b); przegląd redakcyjny | S | nie |
| **FL-1a** | `fetch-morph-sources.mjs` (fail-closed, `--anchor`), `compile-morph-data.mjs` (streaming, słownik odejmujący, determinizm), mini-fixture, kontrakt loadera `load.js` | G-W1-1, G-W1-4 (na fixture), G-W1-7; podwójna kompilacja bajt w bajt | M | nie |
| **FL-1b** | kotwiczenie realnych źródeł: lock + sumy + licencje wypakowane, pełna kompilacja, `morph-pl.json` + `COMPILE-REPORT.md`, pomiar rozmiaru + decyzja bytowania (tabela 1.5), wpisy notices, goldeny pokrycia | G-W1-2, G-W1-3, G-W1-5, G-W1-6, G-W1-8; pakiet 1.9 W1-W3 | M | **TAK: GATE-FLEKSJA-DANE (O-3)** |
| **FL-2** | silnik W2: `paradigms.js` (współdzielony z kompilatorem), `analyze.js`, `generate.js` | goldeny G1–G20; G-W2-1…6 (flagi osiągalne, determinizm, czystość, zdegradowane klasy nie generują, 1000 wartości < 100 ms) | M | nie (przegląd zbiorczy) |
| **FL-3** | detektor W3: indeks form ról, `detect.js`, `isTruncatedRolePrefix`; eksport `rawTokenLength` z S2 | goldeny H1–H18; G-W3-1…7; testy anotacji H11–H13 (S-T) | M | nie (przegląd zbiorczy) |
| **FL-4** | `deriveAttested` (inwersja `seen` + konteksty źródłowe), `attributeAttestedCase` (typy bez morfologii), `attestedSnapshot` + `effectiveOutcomeAttested`, akcesory koordynatora | test inwersji na korpusie syntetycznym (każdy `rawKey` obecny); test atrybucji („w Toruniu"→{Ms}); test C-VER-8 (zero serializacji: struktura nieobecna w postMessage MCP, localStorage, debug) | S | nie (wchodzi pod bramkę FL-5) |
| **FL-5** | moduł planu (`src/verifier/plan.js`): K4 + decyzje + inwalidacja (anchor ±40); przełączenie 4 ujść na `resolveOccurrences({legend, decisions})` | kryteria §5.5 pkt 1–5 (bajt w bajt bez decyzji; hashe C-VER-4; inwalidacja; V2; wydajność) | M | **TAK: GATE-FLEKSJA (O-10)** |
| **FL-6** | UI „Weryfikacja pisma" (podzbiór): pigułki sugestii, menu wystąpienia, „Zatwierdź wszystkie pewne (N)", liczniki przy Kopiuj/Eksportuj | e2e: zatwierdź/zostaw/wybierz/zbiorczo; eksport przed akceptacją = stan dzisiejszy (C-VER-3); C-VER-7 (`textContent`); język §9.4 | M | razem z FL-5 (jedna bramka nad gałęzią) |
| **FL-7** | kontrakt szwu DOCX (§6): projekcja decyzji dla MD4, testy kontraktowe, wiersze raportu „odmieniono" | asercje §6 pkt 1–5 na symulowanym strumieniu; realny e2e dopiero z MD4 | S | razem z FL-5 |

Po FL-7: aktualizacje dokumentów (§10.3 rodzica): SECURITY-CHECKLIST
(C-VER-1…4, 6–8 wchodzą; C-VER-5 dotyczy W6 – poza planem),
THREAT-MODEL (A9–A11, RV-1/RV-4/RV-5), THIRD_PARTY_NOTICES (1.2.4),
docs/webmcp.md + CLAUDE.md (anotacja jako wskazówka; „wspiera przegląd,
nie zastępuje").

**Poza zakresem tego planu (jawnie):** W6 rescan NER (poziom 2, przycisk
„Sprawdź krzyżowo" – decyzja 18; osobna gałąź z bramką O-4/O-5), UI sekcji
„Nieścisłości" dla checkerów W5, poziom 3 LLM (decyzja 15), pełna generacja
miejscowości (v1.1, druga baza), sklejanie form pełnych z poświadczeń
częściowych, liczba mnoga ról, rodzaj z kontekstu roli (kandydaci v1.1
z §4 W1-W3).

---

## §10. GATE-FLEKSJA (bramka; zadanie 7)

Dyscyplina certyfikowanego `main`: gałąź funkcyjna (np. `feature/fleksja`)
z werdyktem przed merge (precedens `feature/h3-hc2`). Dwie bramki etapowe:

**GATE-FLEKSJA-DANE (po FL-1b; rdzeń O-3):** pakiet = lock + sumy +
wypakowane pliki licencji + `COMPILE-REPORT.md` (tabela zgodności klas,
anomalie, rozmiary) + diff notices + decyzja bytowania (tabela 1.5) +
checklista licencyjna 1.2.5 dla Alana, w tym **warunki bramki projektu
z 2026-07-12:** wykładnia sui generis (radca) i uzupełniony leksykon ról.
Werdykt obejmuje: łańcuch dostaw (TOFU, transport vs kotwica), licencje,
miejsce bytowania, jakość danych.

**GATE-FLEKSJA (przed merge całości; rdzeń O-10):**

| ID | Kryterium |
|---|---|
| G-F1 | werdykt GATE-FLEKSJA-DANE wykonany; suma artefaktu == lock; test podmiany bajtu danych = fail-closed w wariancie bytowania z decyzji |
| G-F2 | goldeny W2 (G1–G20) i W3 (H1–H18) zielone; determinizm; czystość statyczna modułów (`console.*`, sieć, storage, DOM – zero) |
| G-F3 | formy poświadczone: inwersja kompletna; C-VER-8 (RAM-only, zero ścieżek przez kanały/persystencję/debug) |
| G-F4 | zgodność wsteczna: zero decyzji → 4 ujścia bajt w bajt jak przed gałęzią (C-VER-3) |
| G-F5 | „pokazane = skopiowane = wyeksportowane" z decyzjami: hashe równe (C-VER-4) |
| G-F6 | V2: brak jakiejkolwiek automatycznej zmiany tekstu; zbiorcze obejmuje wyłącznie „wysokie"; inwalidacja decyzji fail-closed |
| G-F7 | anotacje: H11–H13 (zgodna/sprzeczna/samotna), śmieciowa anotacja nie-tokenem (S1), outcome z samym tokenem anotowanym przechodzi MCP (test z GATE-PHASE0 2.2) |
| G-F8 | maskowanie nietknięte: zero zmian w `src/pipeline/**` (asercja w PR), publiczne kontrakty `applyTokens`/`buildTokenMap*` niezmienione (istniejące testy), eval świadomie nieuruchamiany z tego powodu |
| G-F9 | kontrakt szwu DOCX: testy §6 zielone; raport różnic zawiera każdą odmienioną podmianę |
| G-F10 | wydajność: G-W2-6 i budżet planu (§5.5 pkt 5) zalogowane; zero nowych zależności runtime (`package.json` diff pusty w `dependencies`) |

---

## §11. Bezpieczeństwo i niezmienniki: gdzie DOKŁADNIE się wpinamy

**Pliki dotykane (zamknięta lista) – wszystko po stronie deanonimizacji:**

| Plik | Zmiana |
|---|---|
| `src/substitution.js` | wyłącznie eksport istniejącego `rawTokenLength` (+ ewentualnie `effectiveOutcomeAttested` obok `effectiveOutcomeLegend`) – zero zmian zachowania |
| `src/ui/outcomes-coordinator.js` | `attestedSnapshot` obok `legendSnapshot`; przeliczenie planu w tych samych trzech miejscach |
| `src/ui/deanon-workspace/index.js` | render z `resolveOccurrences`; „Kopiuj" z tego samego wyniku; UI sugestii |
| `src/ui/outcomes-list/index.js` | konsumpcja planu zamiast gołego `deanonymizeText` |
| `src/export/deanon.js` | jw. dla eksportu |
| `src/main.js` | przekazanie akcesorów `getSeen`/`getSources` do koordynatora |
| nowe: `src/verifier/morph/**`, `src/verifier/case-detector/**`, `src/verifier/attested.js`, `src/verifier/plan.js`, `src/ui/verify-panel/**`, `scripts/morph*` | całość nowej logiki |

**Czego NIE dotykamy (i co tego pilnuje):** `src/pipeline/**` (asercja
w PR + istniejące testy), `applyTokens`/`buildTokenMap*`/`ingestSource`
(testy istniejące), payloady MCP (`src/mcp/listings.js` bez zmian; przez
granicę idą nadal wyłącznie tokeny i syntetyczne etykiety), profil
`allMask` i partycja warstw (fleksja nie zna pojęcia warstwy), legenda
(klucze i wartości bez zmian).

**Niezmienniki egzekwowane testem:** all-mask/maskowanie bajt w bajt
(G-F8), V2 (G-F4/G-F6), RAM-only nowych struktur (G-F3), reguła redakcji
logów rozszerzona o formy i findings (C-VER-6, test statyczny wzorca
C-PERS-7), rendering `textContent` (C-VER-7), zero sieci w module
(C-VER-1). Debug pipeline'u nie dostaje niczego nowego (plan i decyzje nie
przechodzą przez `{anonymized, legend, debug}`).

---

## §12. Rejestr decyzji otwartych O-FL (dla Alana; zadanie 8)

| Nr | Decyzja | Rekomendacja | Uwagi |
|---|---|---|---|
| **O-FL-1** | **Licencje słowników – PIERWSZA decyzja, warunkuje FL-1b.** Podstawa: **SGJP dane fleksyjne BSD-2-Clause** (deklaracja projektu Morfeusz 2, zweryfikowana u źródła 2026-07-12), **listy PESEL CC0 1.0** (metadane dane.gov.pl). Do akceptacji: (a) odczyt BSD-2 po obejrzeniu pliku licencji wypakowanego z archiwum, (b) wykładnia sui generis baz danych (warunek bramki 2026-07-12; CC0 pokrywa wprost, BSD-2 milczy), (c) wpisy notices 1.2.4 jako wystarczająca nota „w materiałach towarzyszących" | przyjąć BSD-2+CC0 jako podstawę; PoliMorf (też BSD-2) wyłącznie jeśli pomiar pokrycia wymusi | bez tej decyzji nie ma kotwiczenia źródeł |
| **O-FL-2** | **LLM w v1 fleksji: tak/nie** | **NIE** – v1 w całości deterministyczna (§7); powrót wyłącznie pomiarowy (> ~20% wystąpień `nieustalony` na realnych pismach), jako głos w kaskadzie, nigdy generacja; wtedy osobny projekt + W9 + bramka | spójne z decyzjami 15/16; zmiana wymagałaby nowej bramki, nie tego planu |
| O-FL-3 | Auto-akceptacja sugestii „wysokich" bez gestu (przy wklejeniu wyniku) | **NIE w v1** – V2/O-10; ekwiwalentem jest jeden klik „Zatwierdź wszystkie pewne (N)" | ewentualne „auto" = renegocjacja V2 za osobną bramką |
| O-FL-4 | Anotacja WYCHODZĄCA: czy tekst stokenizowany źródeł ma nieść `[PERSON_NAME_1\|D]` | **NIE w v1** – zmienia bajty maskowania, kontrakt MCP i dowody niezmienności; kandydat v1.1 (opt-in) po pomiarze skuteczności kaskady na wynikach bez anotacji | dziś anotacje pisze wyłącznie LLM w swoim wyniku (decyzja 17) |
| O-FL-5 | Potwierdzenie zakresu typów v1 (= decyzja 13): PERSON_NAME pełny potok; LOCATION/ORGANIZATION_NAME/PERSON_ALIAS wyłącznie poświadczone (mechanizm §3.3), bez cross-token | potwierdzić | pełna generacja miejscowości = v1.1 z bazą TERYT/SGJP-miejscowości |
| O-FL-6 | Miejsce obliczeń: wątek główny (artefakt ≤ 3 MB) vs worker | wątek główny, JEŚLI pomiar FL-1b ≤ 3 MB (prostota, zero podwójnego ładowania) | decyzja pomiarowa, zapisywana w COMPILE-REPORT i werdykcie GATE-FLEKSJA-DANE |

---

## §13. Ryzyka

| Nr | Ryzyko | Mitygacja |
|---|---|---|
| R-FL-1 | rozjazd enumeracji wystąpień podgląd ↔ DOCX (MD4) | anchor `tokenId`+kontekst, fail-closed do bazy, wpis raportu (§6 pkt 2) |
| R-FL-2 | śmieci OCR w formach poświadczonych | parsowalność bramkuje pinowanie (K1.4); nieparsowalne nie generują |
| R-FL-3 | artefakt > 5 MB | tabela 1.5: `resources/`+manifest; > 10 MB STOP i cięcie progów |
| R-FL-4 | habituacja („zatwierdź wszystko" bez czytania) | zbiorcze wyłącznie wysokie; niepewne per sztuka; liczniki nieprzejrzanych (RV-4) |
| R-FL-5 | wariantywność odmiany nazwisk (Kozioł: Kozioła/Kozła) | poświadczenie przed generacją; flaga `wariantywne` z alternatywami, nigdy „wysoka" (RV-1) |
| R-FL-6 | oczekiwanie automatu („skuteczna deanonimizacja" = sama się odmienia) | komunikacja produktowa: jeden gest zbiorczy; O-FL-3 zostawia furtkę na przyszłą, bramkowaną zmianę |
| R-FL-7 | dryf między `attestedSnapshot` a `legendSnapshot` (różne momenty) | oba snapshoty robione w TYM SAMYM miejscu koordynatora, atomowo |

---

*Koniec planu. Następne kroki: (1) decyzje Alana O-FL-1…O-FL-6 (licencja
pierwsza), (2) bramka Opusa nad tym dokumentem, (3) implementacja FL-0…FL-1
i bramka GATE-FLEKSJA-DANE, (4) FL-2…FL-7 i GATE-FLEKSJA przed merge.
Dokument nie zmienia żadnego werdyktu rodziców; przy rozbieżności
interpretacji wiążą: PRODUCT-DECISIONS.md, potem rodzice, potem ten plan.*
