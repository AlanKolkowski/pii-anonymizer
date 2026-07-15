# SCOPE-TIERS-DESIGN.md – trójwarstwowy zakres anonimizacji (architektura)

**Wersja:** 1.0 (projekt, zero kodu)
**Data:** 2026-07-14
**Autor:** Fable (architekt), sesja po pomiarze holdout i piwocie zakresu
**Cel nadrzędny:** wdrożenie modelu trzech warstw z `ZAKRES-ANONIMIZACJI.md`
(kierunek zatwierdzony przez Alana 2026-07-14): W1 maskuj automatycznie
(cel recall ≥ 95% na rzeczywistych danych osobowych), W2 wykrywaj i oddaj
decyzję radcy, W3 nie maskuj – bez utraty żadnej z dzisiejszych gwarancji
air-gap i human-in-the-loop.
**Źródło prawdy zakresu:** `ZAKRES-ANONIMIZACJI.md` §3 (macierz 35 typów →
warstwy; wszystkie wiersze rozstrzygnięte, w tym DATE_OF_BIRTH → W1,
ORGANIZATION_IDENTIFIER → W1). Ten dokument NIE zmienia przypisań –
projektuje mechanikę, która je wykonuje i pozwala je zmieniać bez kodu.
**Rodzice:** `RECALL-90-DESIGN.md` (moduły B1–B6, korpus 2.0, GATE-RECALL-90),
`SHARED-FOUNDATION-DESIGN.md` (S1 gramatyka tokenów, S2 substytucja),
`THREAT-MODEL.md` (aktywa A1/A2, decyzje D2/D3), `MCP-BRIDGE-DESIGN.md`
(granica mostu), `test-data/adversarial/README.md` (polityka anotacji).
**Granice tej sesji:** zero zmian w `src/**`. Nie renegocjuję modułów B1–B6
ani bramki GATE-RECALL-90 – ten projekt jest równoległy i styka się z nimi
w JEDNYM miejscu: kolejności filtra `enabledEntities` na końcu postprocessu
(§3.4). Produktem sesji jest wyłącznie ten plik.

**Konwencja:** moduł → kontrakt → kryterium akceptacji → test dowodzący →
koszt (S ≤ pół dnia, M 1–2 dni, L projekt) → bramka Opusa (tak/nie).
Rejestr decyzji otwartych dla Alana: **O-ST-n** (§8.1); ryzyka: **R-ST-n**
(§8.2). Fragmenty JSON to schematy kontraktów, nie kod.

**Kolizja oznaczeń, jawnie:** „W1/W2/W3" w tym dokumencie oznacza WARSTWY
ZAKRESU z `ZAKRES-ANONIMIZACJI.md` (maskuj / do decyzji / nie maskuj) –
NIE moduły W1–W9 weryfikatora z `LOCAL-VERIFIER-DESIGN.md`. Odwołania do
tamtych modułów są kwalifikowane („W5 weryfikatora"). W kodzie warstwy
dostają wartości semantyczne `mask` / `review` / `pass` (§2.2), żeby kolizja
nie przeniknęła do źródeł.

---

## §0. Teza i mapa projektu

1. **Filtr typów przestaje być binarny.** Dziś typ jest „włączony albo
   niewidzialny" (`sourceFilterStep`, `src/pipeline/steps/source-filter.js:30`).
   Model trzech warstw wymaga trzeciego i czwartego ujścia: „wykryty, ale
   nie maskowany – pokazany radcy" (W2) oraz „wykryty, ale przepuszczony"
   (W3). Ujście encji staje się funkcją dwóch niezależnych wymiarów:
   `enabledEntities` (użytkownik: czy typ w ogóle uczestniczy) × warstwa
   (radca-konfigurator: co się dzieje z wykrytym typem).
2. **Warstwa jest daną konfiguracyjną**, nie logiką – nowy plik
   `src/pipeline/configs/type-tiers.js` obok `type-weights.js`, z identyczną
   dyscypliną współdzielenia (jedno źródło dla pipeline'u, eval i UI) –
   moduł ST-1.
3. **Jedna decyzja maskowania na końcu postprocessu** – moduł ST-2 wprowadza
   krok partycji warstw dokładnie w miejscu, w które B6 (RECALL-90 §2.6)
   planuje przesunąć filtr `enabledEntities`. Docelowo to JEDEN krok
   o dwóch semantykach (rodziny typów B6 + warstwy ST); kontrakt styku
   w §3.4, bez renegocjacji B6.
4. **Kosz do przeglądu (W2) to rozszerzenie istniejącego wzorca, nie nowy
   świat.** Aplikacja MA już przegląd wykrytych encji per token
   (annotation-editor: usuwanie, zmiana typu, dodawanie przez zaznaczenie –
   `src/ui/annotation-editor/index.js`), ma silnik decyzji per wystąpienie
   po stronie deanonimizacji (S2, `src/substitution.js:30`) i ma tani rerun
   postprocessu bez inferencji (`src/pipeline/cache-orchestrator.js:246`).
   Kosz W2 komponuje te trzy istniejące mechanizmy – moduły ST-3/ST-4.
5. **W3 nie znaczy „ślepy".** Detekcja typów W3 dalej biega i ma dwóch
   konsumentów: allowlistę sygnatur własnych (podpowiedzi) i wydzielanie
   części osobowej z nazw JDG/kancelarii – moduł ST-5.
6. **Benchmark dzieli się na trzy liczby:** W1 ścisły recall (liczba do
   obrony, cel 95%+), W2 „pokrycie do przeglądu" (czy zaproponowano),
   W3 poza scoringiem – moduł ST-7, z deltą polityki anotacji korpusu 2.0.
7. **Air-gap bez wyjątków:** W2 to UI lokalne; kandydaci do przeglądu nie
   istnieją w żadnym payloadzie mostu, a źródło staje się czytelne dla MCP
   dopiero po zamknięciu przeglądu – moduł ST-6, pod bramką Opusa razem
   z ST-4 (§7, GATE-SCOPE).

Mapa zależności: ST-1 → ST-2 → {ST-3 → ST-4, ST-5} → ST-6 → GATE-SCOPE;
ST-7 (scoring + korpus) równolegle od zaraz; ST-8 (migracja) domyka.
Jedyny punkt wspólny z torem recall: §3.4 (kolejność filtra, B6/R7).

---

## §1. Stan dzisiejszy i luka (dlaczego to nie jest „zmiana listy typów")

### 1.1 Dziś wszystkie włączone typy są de facto W1

`createPostprocessSteps` (`src/pipeline/configs/default.js:77-95`):
`sourceFilterStep` → progi → snap/trim/blocklist/maxLength → `dedupStep` →
`backfillOccurrencesStep` → `mergeStep` → `tokenizeStep`. Każda encja, która
dożyje końca, jest tokenizowana (`applyTokens`) i wchodzi do legendy.
Jedyne pokrętło użytkownika to `enabledEntities` (panel kategorii,
`src/main.js:321-331`, localStorage `pii.selected-entities`) – binarne.

Konsekwencja zmierzona (holdout 206 dok.): benchmark karał za niemaskowanie
danych, które nie są danymi osobowymi (76% „ogółem" vs ~86% na rdzeniu W1,
`ZAKRES-ANONIMIZACJI.md` §4), a pisma były zaśmiecone tokenami sądów,
sygnatur cytowanych wyroków i kwot.

### 1.2 Trzy hazardy, które ujawnia dopiero przejście na warstwy

Nazywam je z góry, bo to one dyktują kształt kontraktów ST-2/ST-5:

- **H-1 (dedup zjada W1 na rzecz W3).** `deduplicateEntities`
  (`src/anonymizer.js:723-760`) rozstrzyga nakładki bez patrzenia na typ:
  przy zbliżonych score wygrywa szerszy span. Dziś to bez znaczenia (oba
  spany i tak są maskowane); po piwocie „Kancelaria Radcy Prawnego Jan
  Kowalski" (ORGANIZATION_NAME, W3) wygrałaby z zagnieżdżonym „Jan Kowalski"
  (PERSON_NAME, W1) – i nazwisko wyszłoby JAWNE, bo zwycięzca nie jest
  maskowany. Nadmaskowanie przestało być siatką bezpieczeństwa dla pomyłek
  arbitrażu – arbitraż musi stać się świadomy warstw (ST-2 pkt 3).
- **H-2 (backfill blokowany przez W3).** `backfillOccurrencesStep` odmawia
  dosiania wystąpienia nakładającego się z JAKĄKOLWIEK istniejącą encją
  (`overlapsAny`, `src/pipeline/steps/backfill.js:49-53`). Nazwisko wykryte
  w komparycji nie zostanie dosiane wewnątrz spanu nazwy JDG, bo span ORG
  „zajmuje miejsce" – mimo że ORG nie będzie maskowany (ST-2 pkt 4).
- **H-3 (pomyłka typu przez granicę warstw).** To warstwowa odmiana L9
  z RECALL-90 §1.3: PESEL zaklasyfikowany jako DOCUMENT_REFERENCE (W3)
  nie byłby maskowany – identyczna mechanika jak B6, tylko kanałem nie jest
  wyłączenie kategorii przez użytkownika, lecz konfiguracja warstw. Dlatego
  decyzja maskowania musi zapadać na WSZYSTKICH nakładających się
  kandydatach sprzed rozstrzygnięcia typu – dokładnie kontrakt B6, ust. 1,
  rozszerzony o wymiar warstwy (§3.4).

### 1.3 Co już istnieje i jest reużywane (żeby nie budować drugi raz)

| Istniejący mechanizm | Miejsce | Rola w tym projekcie |
|---|---|---|
| przegląd encji per token (usuń / zmień typ / dodaj z zaznaczenia) | `src/ui/annotation-editor/index.js:130-379`, `operations.js:41-59` | wzorzec interakcji i granularności dla kosza W2 (ST-3/ST-4) |
| rerun postprocessu bez inferencji (cache NER po hashu tekstu) | `src/pipeline/cache-orchestrator.js:66-282` | tania zmiana konfiguracji warstw i re-partycja (ST-2, ST-8) |
| dosiew wystąpień per wartość | `src/pipeline/steps/backfill.js` | komplet wystąpień kandydata W2 przed decyzją; dosiew po decyzji „maskuj" (ST-3) |
| globalna legenda przeliczana z całości + snapshoty na wynikach | `src/main.js:635-649`, `src/ui/outcomes-coordinator.js:25-46`, `effectiveOutcomeLegend` (`src/substitution.js:111-113`) | stabilność deanonimizacji przy re-maskowaniu (ST-3 pkt 6, ST-8) |
| czyste funkcje payloadów mostu | `src/mcp/listings.js:25-95` | jedno miejsce egzekwowania granicy W2 (ST-6) |
| detektor sygnatur repertoriów | `DOCKET_RE`, `src/anonymizer.js:500-513` | podpowiedzi do allowlisty sygnatur własnych (ST-5) |
| blocklisty fraz jako konfiguracja | `ENTITY_RULES.blocklist`, `src/pipeline/configs/entity-rules.js:74` | precedens: fraza generyczna to konfiguracja, nie PII (trwały słownik, ST-3 pkt 5) |

---

## §2. ST-1 – konfiguracja warstw `TYPE_TIERS`

### 2.1 Miejsce

Nowy plik `src/pipeline/configs/type-tiers.js`, obok `type-weights.js`
i z tym samym uzasadnieniem współdzielenia: przypisanie typ→warstwa
konsumują pipeline (decyzja maskowania), eval (podział scoringu W1/W2/W3)
i UI (badge warstwy w panelu kategorii, nagłówki kosza). Jedna wersja,
zero dryfu.

### 2.2 Kontrakt

1. Eksport `TYPE_TIERS`: mapa `typ → 'mask' | 'review' | 'pass'`
   o wartościach przepisanych 1:1 z macierzy `ZAKRES-ANONIMIZACJI.md` §3
   (W1→`mask`, W2→`review`, W3→`pass`). Plik jest DANĄ: zmiana warstwy typu
   to edycja jednej linii, bez dotykania logiki. Komentarz nagłówkowy
   wskazuje macierz jako źródło prawdy i wymaga aktualizacji obu miejsc
   razem (dyscyplina jak `TYPE_WEIGHTS` ↔ analyze).
2. Eksport `tierFor(type)`: dla typu nieznanego zwraca **`mask`**
   (fail-safe: nowy/nieprzewidziany typ jest maskowany, nigdy przepuszczany;
   symetria z `weightFor` zwracającym 3, ale w stronę bezpieczną).
3. Przypisanie startowe (z macierzy; pełna lista w ZAKRES §3):
   - `mask` (W1): PERSON_NAME, PERSON_ALIAS, PERSON_IDENTIFIER,
     POSTAL_ADDRESS, EMAIL_ADDRESS, PHONE_NUMBER, CONTACT_HANDLE,
     BANK_ACCOUNT_IDENTIFIER, PAYMENT_CARD, PAYMENT_CARD_SECURITY,
     ACCOUNT_IDENTIFIER, DEVICE_IDENTIFIER, VEHICLE_IDENTIFIER,
     DATE_OF_BIRTH, ORGANIZATION_IDENTIFIER, AUTH_SECRET, IP_ADDRESS,
     GEO_LOCATION, COOKIE_IDENTIFIER;
   - `review` (W2): PERSON_ROLE_OR_TITLE, PERSON_ATTRIBUTE, HEALTH_DATA,
     GENETIC_DATA, BIOMETRIC_DATA, RELIGION_OR_BELIEF, POLITICAL_OPINION,
     SEXUAL_ORIENTATION, TRADE_UNION_MEMBERSHIP, ETHNIC_ORIGIN,
     CRIMINAL_OFFENCE_DATA, FINANCIAL_AMOUNT, INCOME_COMPENSATION, LOCATION;
   - `pass` (W3): DOCUMENT_REFERENCE, ORGANIZATION_NAME.
4. **Override użytkownika (radcy):** worker przyjmuje w `configure`
   opcjonalną mapę `tierOverrides` (analogia `enabledEntities`,
   `src/worker.js:399-419`); UI trzyma ją w localStorage
   (`pii.type-tiers`), edycja w ustawieniach zaawansowanych – zakres UI
   rozstrzyga O-ST-7. Efektywna warstwa = `tierOverrides[type] ??
   TYPE_TIERS[type] ?? 'mask'`. Override to konfiguracja (żadnych wartości
   z dokumentów), więc trwałość w localStorage nie dotyka D2 THREAT-MODEL.
5. **Relacja do `enabledEntities`:** wymiary są niezależne. Typ wyłączony
   nie uczestniczy wcale (jak dziś, do czasu B6; po B6 – semantyka rodzin
   typów, §3.4). Typ włączony trafia do ujścia wskazanego warstwą. Panel
   kategorii (`ENTITY_CATEGORIES`) NIE zmienia struktury – dostaje jedynie
   oznaczenie warstwy przy typie; kategorie art. 9–10 pozostają domyślnie
   włączone (decyzja 20/A12, `entity-sources.js:164-178` – piwot ich nie
   cofa: te typy są nadal WYKRYWANE, zmienia się ujście na kosz W2).

### 2.3 Kryterium akceptacji

Test spójności: każdy typ z `ENTITY_SOURCES` ma jawną warstwę w `TYPE_TIERS`
(zero dziur, zero typów-widm spoza `ENTITY_SOURCES`); `tierFor` na typie
spoza mapy zwraca `mask`; wartości ograniczone do trójki
`mask|review|pass`. Zgodność z macierzą ZAKRES §3 przybita w teście
literalną listą (jeśli ktoś zmieni konfigurację, test wymusza świadomą
aktualizację obu miejsc – wzorzec „zamierzona zmiana wymaga zmiany testu").

### 2.4 Test dowodzący

`src/pipeline/configs/type-tiers.test.js`: pełne pokrycie typów × trzy
wartości × fail-safe; test krzyżowy z `TYPE_WEIGHTS` dokumentujący
niezmiennik: żaden typ wagi 5 nie jest `pass` (art. 9–10 są `review`,
identyfikatory `mask`) – strażnik przeciw literówce w konfiguracji.

**Koszt:** S. **Bramka Opusa:** nie (dane konfiguracyjne zatwierdzone przez
Alana w ZAKRES §3; strażnik wagi-5-nie-pass jest częścią kontraktu).

---

## §3. ST-2 – partycja warstw w postprocessie (i styk z B6)

### 3.1 Zasada

Decyzja „co się dzieje z wykrytą encją" zapada RAZ, na końcu postprocessu,
kiedy wszystkie kroki jakościowe (progi, granice, dedup, dosiew, scalanie)
już zrobiły swoje. Nowy krok `tierPartitionStep` (nazwa do dyspozycji
Sonneta, kontrakt nie) wchodzi po `mergeStep`, przed `tokenizeStep`
(`src/pipeline/configs/default.js:81-93`) i dzieli `ctx.entities` na trzy
ujścia.

### 3.2 Kontrakt

1. **Wejście:** `ctx.entities` po merge. **Wyjście:**
   - `ctx.entities` = wyłącznie encje maskowane: efektywna warstwa `mask`
     ALBO flaga `forceTier: 'mask'` (nadawana przez allowlistę sygnatur,
     ST-5); tylko one idą do `tokenizeStep` i legendy;
   - `ctx.reviewCandidates` = encje warstwy `review`, wzbogacone o pole
     `occurrenceOf` (klucz wartości, pkt 5) – NIE są tokenizowane;
   - encje `pass` znikają z kontekstu wynikowego; pozostają widoczne
     w `ctx.debug` (diff kroku rejestruje `removed`, jak każdy filtr –
     `src/pipeline/runner.js` robi to automatycznie), więc eval i debug
     panel widzą, co przepuszczono.
2. **Schemat kandydata** (kontrakt danych, nie kod):
   ```
   { entity_group, start, end, score, source,
     tier: 'review',
     valueKey }        // fold(text.slice(start,end)) + typ – klucz decyzji
   ```
   Kandydat NIE materializuje wartości ani kontekstu – niesie offsety;
   wartość i kontekst wycina konsument (UI) z tekstu, który i tak ma.
   Zero nowych kopii PII w strukturach przelotowych.
3. **Arbitraż międzywarstwowy w dedupie (H-1).** Kontrakt dla
   `deduplicateEntities` (`src/anonymizer.js:723`): nakładki rozstrzygane
   są WYŁĄCZNIE między encjami tej samej efektywnej warstwy; para spanów
   różnych warstw przechodzi dalej nietknięta (obie encje żyją). Skutki:
   - „Jan Kowalski" (mask) wewnątrz „Kancelaria Radcy Prawnego Jan
     Kowalski" (pass): oba spany docierają do partycji; mask jest
     tokenizowany, pass przepuszczony – w piśmie zostaje
     „Kancelaria Radcy Prawnego [PERSON_NAME_1]" (dokładnie rozstrzygnięcie
     ZAKRES §3, wiersz ORGANIZATION_NAME);
   - kandydat `review` zagnieżdżony w maskowanym spanie `mask` jest
     w partycji USUWANY z kosza (jego znaki są już ukryte; pokazywanie
     radcy zamaskowanego fragmentu to szum); kandydat częściowo pokryty
     trafia do kosza z pełnym spanem (największa niepokryta reszta jest
     i tak niewidoczna dla użytkownika w tekście zanonimizowanym – decyzja
     „maskuj" obejmie całość, nadmiar maskowania jest tani, spójnie z A5/A6);
   - wewnątrz jednej warstwy dedup działa BEZ ZMIAN (w tym
     `trimOrDropCoveredByPreciseRegex`, który z konstrukcji jest same-type).
4. **Dosiew przez granicę warstw (H-2).** Kontrakt dla
   `backfillOccurrencesStep`: kolizję (`overlapsAny`) liczy się wyłącznie
   względem encji warstw `mask` i `review`; span `pass` nie blokuje dosiewu.
   Nazwisko z komparycji zostaje dosiane także wewnątrz nazwy JDG.
   (Uwaga wykonawcza: backfill biegnie przed partycją, więc „warstwa encji"
   jest tu wyliczana z `tierFor`, nie z pola – jedna funkcja, oba kroki.)
5. **Klucz wartości `valueKey`** = `entity_group + '::' + fold(value)`,
   gdzie `fold` = NFC, trim, collapse whitespace, `toLowerCase` (locale
   'pl'). To klucz agregacji kandydatów w koszu ORAZ klucz pamięci decyzji
   (ST-3). Świadomie NIE używa `couldBeSamePerson` – wartości W2 to frazy
   (role, kwoty, fakty art. 9–10), nie nazwiska; koreferencja fleksyjna
   zostaje po stronie W1, gdzie żyje dziś.
6. **Pomyłki typu przez granicę warstw (H-3):** rozstrzyga wspólny krok
   decyzji maskowania z B6 – §3.4. Do czasu wejścia B6: częściowa osłona
   istnieje z konstrukcji pkt 3 (kandydaci obu typów żyją, jeżeli oba
   źródła coś wyemitowały) plus regexy z sumami kontrolnymi A1 nadają
   PESEL/NIP/IBAN właściwy typ ze score 1,0 – ale kanał „model widzi TYLKO
   DOCUMENT_REFERENCE tam, gdzie stoi PESEL" domyka dopiero B6. Jawnie:
   ST-2 NIE obiecuje domknięcia H-3 przed B6 (R-ST-6).

### 3.3 Kryterium akceptacji

1. **Niezmienność single-tier:** przy konfiguracji `tierOverrides`
   ustawiającej wszystkie typy na `mask` wyniki OBU korpusów są bajt w bajt
   identyczne z dzisiejszymi (dowód, że tier-aware dedup i backfill nie
   zmieniają ścieżki jednowarstwowej – analogia warunku niezmienności B6).
2. Golden JDG: dokument z „Kancelaria Radcy Prawnego Jan Kowalski"
   + „Jan Kowalski" osobno w tekście → wynik zawiera
   „Kancelaria Radcy Prawnego [PERSON_NAME_n]", nazwa kancelarii poza
   nazwiskiem jawna, kandydatów W2 zero z tego spanu.
3. Golden kosza: dokument z „wdowiec" (PERSON_ATTRIBUTE) ×3 →
   `reviewCandidates` zawiera 3 wystąpienia pod jednym `valueKey`,
   tekst zanonimizowany zawiera „wdowiec" jawnie (przed decyzją).
4. Kandydat review w pełni pokryty maskowanym spanem nie trafia do kosza.

### 3.4 Styk z B6 (jedyny punkt wspólny z torem recall – opis, nie renegocjacja)

Kontrakt B6 (RECALL-90 §2.6): (a) decyzja o maskowaniu spanu zapada na
wszystkich nakładających się kandydatach sprzed rozstrzygnięcia typu –
jeżeli JAKIKOLWIEK kandydat spanu jest typu włączonego, span pozostaje
zamaskowany, etykieta z najwyższej wagi typu włączonego; (b) filtr
`enabledEntities` przesuwa się na koniec postprocessu (po dedupie),
`sourceFilterStep` filtruje odtąd wyłącznie autorytatywność źródeł.

Rozstrzygnięcie styku (trzy zdania, które muszą pozostać prawdziwe
niezależnie od kolejności wdrożeń):

1. `tierPartitionStep` siedzi dokładnie w miejscu, w które B6 przesunie
   filtr `enabledEntities` (koniec postprocessu, po dedupie i merge'u,
   przed tokenizacją). Docelowo to JEDEN krok decyzji maskowania,
   rozstrzygający po wszystkich nakładających się kandydatach spanu:
   **maskuj ⟺ istnieje kandydat spanu o (typ włączony ∧ warstwa `mask`)
   ∨ `forceTier:'mask'`**; etykieta = najwyższa waga (`TYPE_WEIGHTS`)
   spośród kandydatów kwalifikujących; **kosz ⟸ kandydaci (typ włączony
   ∧ warstwa `review`) niepokryci maskowanym spanem**; reszta → debug.
   Semantyka B6 jest szczególnym przypadkiem tej reguły dla wymiaru
   „włączony/wyłączony" – ST-2 jej nie zmienia, tylko dodaje wymiar warstwy.
2. Kolejność wdrożeń jest OBOJĘTNA dla kontraktów: jeżeli ST-2 wchodzi
   pierwszy (stan na dziś: B6 czeka jako R7), `sourceFilterStep` nadal
   filtruje `enabledEntities` na wejściu, a partycja robi wyłącznie wymiar
   warstw; B6, wchodząc, przenosi filtr włączoności do istniejącego już
   kroku partycji (i przejmuje jego testy niezmienności). Jeżeli B6
   wchodziłby pierwszy – symetrycznie.
3. Tryb pomiarowy konfiguracji okrojonej (B6 pkt 4: eval z profilem bez
   kategorii „Finanse") zyskuje drugi profil: `--tiers=all-mask`
   (niezmienność, kryterium 3.3.1) – oba profile żyją w tym samym
   mechanizmie przekazywania konfiguracji do eval (ST-7 pkt 4).

### 3.5 Test dowodzący

Jednostkowe: partycja trzech ujść; arbitraż par mask/pass, mask/review,
review/pass (H-1); dosiew przez span pass (H-2); usuwanie kandydatów
pokrytych. Korpusowe: `npm run eval` (tagowane) na obu korpusach
w profilu domyślnym (nowe warstwy) i `--tiers=all-mask` (niezmienność
bajt w bajt vs baseline). Golden JDG i golden kosza jak w 3.3.

**Koszt:** M. **Bramka Opusa:** nie (pipeline z twardym testem
niezmienności; dyscyplina eval z nagłówka RECALL-90 §2 obowiązuje).
Werdykt bezpieczeństwa całości i tak przechodzi przez GATE-SCOPE (§7),
która ogląda skutki ST-2 od strony produktu.

---

## §4. ST-3 / ST-4 – warstwa 2: kosz do przeglądu

Podział: **ST-3** = silnik (model danych, decyzje, pamięć, re-maskowanie) –
czyste funkcje + stan w `main.js`; **ST-4** = powierzchnia UI. Rozdzielone,
bo bramka Opusa ogląda inne rzeczy w każdym (silnik: przepływ danych;
UI: co widzi i klika radca).

### 4.1 ST-3 – kontrakt silnika

1. **Stan dokumentu** (`src/main.js:399-401`) rozszerza się o:
   ```
   s.candidates       // z workera: ctx.reviewCandidates (offsety, valueKey)
   s.reviewDecisions  // Map: valueKey → 'mask' | 'skip'
                      // (+ metadana źródła decyzji: 'user'|'bulk'|'dictionary')
   ```
   Stan przeglądu jest POCHODNĄ: `reviewComplete(s)` ⟺ każdy `valueKey`
   z `s.candidates` ma decyzję. Dokument bez kandydatów jest complete
   z definicji. Żadnych nowych pól persystowanych – wszystko żyje w RAM,
   jak cały stan dokumentów (zgodność z D2 THREAT-MODEL z konstrukcji).
   Protokół workera: komunikat `result` (`src/worker.js:460-467`) niesie
   dodatkowo `candidates: ctx.reviewCandidates` – lokalny postMessage
   w obrębie tej samej strony, żaden nowy kanał wyjścia; cache-orchestrator
   zwraca kandydatów z re-postprocessu tak samo jak encje.
2. **Granularność decyzji: per wartość w ramach typu** (`valueKey`),
   z dosiewem na wszystkie wystąpienia. Uzasadnienie:
   - to jest istniejąca granularność produktu – annotation-editor operuje
     per token („Z dokumentu zostanie usuniętych N wystąpień",
     `annotation-editor/index.js:362`), a token ≈ (typ, wartość kanoniczna);
     kosz nie może być drobniejszy niż narzędzie obok, bo użytkownik
     dostanie dwie sprzeczne mentalne mapy;
   - decyzja per wystąpienie jest merytorycznie pusta dla W2: jeżeli
     „wdowiec" jest wrażliwy w zdaniu 3, a jawny w zdaniu 7, to wartość
     i tak wychodzi z dokumentu – ochrona mozaikowa działa per dokument,
     nie per zdanie; maskowanie części wystąpień daje złudzenie ochrony;
   - per typ (hurt) istnieje jako akcja zbiorcza (ST-4), nie jako model
     danych.
   Rozszerzenie per wystąpienie pozostaje możliwe w przyszłości (schemat
   decyzji przyjmuje wtedy klucz `valueKey#occ`), ale poza v1 – O-ST-1.
3. **Aplikacja decyzji „maskuj":** kandydaci o danym `valueKey` przechodzą
   do `s.entities` (span, typ i source zachowane), po czym – jak w
   annotation-editorze – `postEdit` = `backfillOccurrencesStep`
   (`src/main.js:392-394`) dosiewa ewentualne pominięte wystąpienia,
   a `refreshLegend()` (`src/main.js:635-649`) przelicza globalną mapę
   tokenów. Wartość dostaje token i wpis w legendzie dokładnie tą samą
   ścieżką, co encje W1 – zero drugiego mechanizmu tokenizacji.
4. **Aplikacja decyzji „pomiń":** kandydat zostaje w `s.candidates`
   z decyzją `skip`; tekst pozostaje jawny. Cofnięcie decyzji „maskuj"
   = usunięcie encji z `s.entities` (ścieżka `removeToken`,
   `annotation-editor/operations.js:41-48`) + powrót kandydata do stanu
   nierozstrzygniętego.
5. **Pamięć decyzji – trzy poziomy:**
   - **dokument:** `s.reviewDecisions` (RAM, żyje z dokumentem);
   - **rerun tego samego dokumentu:** po ponownym `classify` (np. zmiana
     `enabledEntities`) świeże `s.candidates` są automatycznie
     rozstrzygane zapamiętanymi decyzjami po `valueKey` (decyzje
     przeżywają rerun, kosz nie pyta drugi raz o to samo);
   - **trwały słownik użytkownika (opcjonalny):** dwie listy per typ,
     `alwaysSkip` i `alwaysMask`, przechowywane w localStorage
     (`pii.review-dictionary`). Wpis powstaje WYŁĄCZNIE jawną akcją
     („zapamiętaj na stałe" przy decyzji), nigdy automatycznie. Frazy
     słownika (np. „wdowiec" przy PERSON_ATTRIBUTE) mają charakter
     konfiguracyjny – to ta sama klasa danych, co blocklisty fraz
     w repo (`entity-rules.js:74`), nie legenda i nie treść sprawy;
     dlatego NIE podpada pod zakaz D2 (trwałości legendy). Delta
     THREAT-MODEL z tym argumentem + widok/edycja/czyszczenie słownika
     w ustawieniach są częścią kontraktu; werdykt należy do GATE-SCOPE,
     a domyślna trwałość dla typów art. 9–10 do Alana (O-ST-2).
     Decyzje ze słownika są w koszu oznaczone („rozstrzygnięte słownikiem")
     i odwracalne per dokument.
6. **Legenda i deanonimizacja:** zamaskowana wartość W2 jest zwykłym
   wpisem legendy – deanonimizacja (S2, `deanonymizeText`), snapshoty
   wyników (`legendSnapshot`, `outcomes-coordinator.js:25-46`) i eksport
   działają bez JEDNEJ zmiany. Przenumerowanie tokenów przy przeliczeniu
   legendy jest istniejącym zachowaniem produktu (annotation-editor już
   dziś dodaje encje i przelicza `buildTokenMapMulti`); wyniki są
   chronione snapshotami – kontrakt niezmieniony, tylko przybity testem
   (ST-8).

### 4.2 ST-4 – kontrakt UI

1. **Miejsce:** sekcja „Do przeglądu (N)" w karcie dokumentu, obok
   istniejącego przełącznika annotation/preview (`sources-list/index.js:319-339`).
   Badge N = liczba NIEROZSTRZYGNIĘTYCH wartości (nie wystąpień).
2. **Struktura:** grupowanie po typie (etykiety z `ENTITY_LABELS`),
   **domyślnie zwinięte** do nagłówków „Typ (k wartości, m wystąpień)";
   rozwinięcie pokazuje wiersze wartości:
   - wartość + licznik wystąpień („«wdowiec» ×3");
   - kontekst pierwszego wystąpienia: segment zdaniowy z `s.text`
     (segmenty już istnieją w pipeline; UI wycina ±1 zdanie wokół
     wystąpienia, wartość podświetlona), z nawigacją do kolejnych
     wystąpień w podglądzie annotation-editora;
   - akcje: **Maskuj** / **Pomiń** (+ „zapamiętaj na stałe" jako
     rozwijana opcja przy obu, pkt 5 ST-3).
3. **Akcje zbiorcze:** per typ („Maskuj wszystkie role", „Pomiń wszystkie
   kwoty") i globalna **„Zakończ przegląd – pomiń pozostałe (N)"**.
   Wolumen W2 w realnym piśmie jest zdominowany przez FINANCIAL_AMOUNT
   i LOCATION (recall 99,2% / 88,8% – dziesiątki wystąpień na pozew);
   bez akcji zbiorczych kosz byłby karą, nie funkcją. Kolejność grup:
   malejąco po `TYPE_WEIGHTS` (art. 9–10 na górze, kwoty na dole) –
   najcięższe decyzje first, szum last.
4. **Stan „przegląd zakończony"** jest widoczny (znacznik na karcie
   dokumentu) i jest warunkiem czytelności źródła dla mostu (ST-6).
   Ponowna anonimizacja/edycja anotacji unieważnia complete tylko wtedy,
   gdy pojawiły się NOWE nierozstrzygnięte `valueKey`.
5. **Air-gap UI:** kandydaci i konteksty renderują się wyłącznie z lokalnego
   `s.text`; sekcja nie wprowadza żadnego nowego kanału wyjścia (bez
   „kopiuj listę kandydatów", bez eksportu kosza w v1 – nie dlatego, że
   groźne, tylko żeby powierzchnia bramki była minimalna; O-ST-8).
6. **Deanonimizacja/outcomes:** kosz nie ma własnej deanonimizacji –
   wartości pominięte są w tekście jawne, wartości zamaskowane wracają
   przez istniejące ujścia legendy. Nic do zrobienia poza spójnym
   komunikatem w UI („pominięte pozostają w tekście widoczne").

### 4.3 Kryterium akceptacji (wspólne ST-3/ST-4)

1. Dokument z kandydatami W2: decyzja „maskuj» dla `valueKey` maskuje
   WSZYSTKIE wystąpienia (w tym dosiane), wartość dostaje token i wpis
   legendy; „pomiń" zostawia wszystkie jawne; cofnięcie przywraca stan.
2. Rerun po zmianie `enabledEntities`: decyzje przeżywają (kosz nie pyta
   ponownie o rozstrzygnięte wartości), nowe wartości pojawiają się jako
   nierozstrzygnięte.
3. Trwały słownik: wpis `alwaysSkip: wdowiec@PERSON_ATTRIBUTE` rozstrzyga
   kandydata w KAŻDYM nowym dokumencie z oznaczeniem „słownik" i możliwością
   odwrócenia per dokument; usunięcie wpisu w ustawieniach działa od
   następnego przeglądu.
4. `reviewComplete`: dokument bez kandydatów – complete od razu; „Zakończ
   przegląd" rozstrzyga pozostałe jako `skip` (źródło decyzji `bulk`).
5. Zero regresji annotation-editora (jego testy bez modyfikacji).

### 4.4 Test dowodzący

Jednostkowe na czystych funkcjach silnika (partycja decyzji, `valueKey`,
scalanie słownika z decyzjami dokumentu); test DOM sekcji kosza (grupowanie,
zwinięcie, bulk, licznik) wzorem istniejących testów UI; golden przepływu:
kandydat → maskuj → token w `anonymizedTextFor` → cofnij → jawny; test
rerun-z-decyzjami na cache-orchestratorze.

**Koszt:** ST-3 M, ST-4 M. **Bramka Opusa: TAK – wspólna GATE-SCOPE (§7)**
(UI pokazuje PII i steruje decyzją maskowania; trwały słownik dotyka
polityki D2; to jest dokładnie materia bramkowa).

---

## §5. ST-5 – warstwa 3: allowlista sygnatur własnych i część osobowa nazw

### 5.1 Semantyka W3 (co znaczy „nie maskuj")

Encje `pass` nie są maskowane ani pokazywane w koszu – ale detekcja biegnie
dalej (źródła w `ENTITY_SOURCES` bez zmian), bo ma dwóch konsumentów:
podpowiedzi allowlisty (5.2) i statystykę/debug. Wyłączenie detekcji W3
(np. wyrzucenie `DOCUMENT_REFERENCE` z `enabledEntities`) pozostaje możliwe
i po B6 nie odsłania niczego (semantyka rodzin) – ale nie jest domyślne,
żeby podpowiedzi działały.

### 5.2 Allowlista sygnatur własnej sprawy – kontrakt

1. **Model danych:** lista wpisów `{ raw }` wpisywanych przez użytkownika
   (pole „Sygnatury mojej sprawy" w panelu dokumentów/ustawień sesji),
   wspólna dla wszystkich dokumentów sesji (sygnatury I i II instancji
   tej samej sprawy pojawiają się w wielu pismach). **Trwałość: RAM
   (sesja)** – sygnatura własnej sprawy identyfikuje sprawę, więc jej
   zapis na dysk podpada pod duch D2 (zero artefaktów o wartości akt);
   rekomendacja: bez persystencji w v1, decyzja Alana O-ST-3.
2. **Normalizacja i warianty** (rozstrzygnięcie formatu):
   - struktura sygnatury: `[wydział rzymski]? [repertorium] [numer]/[rok]
     [„upr"]?` (np. „I C 1552/23", „II Ca 210/24 upr", „KM 1552/25");
   - porównanie po normalizacji: NFC, collapse białych znaków (spacja,
     NBSP, tab, pojedyncze złamanie linii → jedna spacja), spacje wokół
     „/" usuwane, case-insensitive (OCR i style pisowni bywają niekonsekwentne;
     pełna struktura numer/rok czyni kolizję praktycznie niemożliwą);
   - **rok:** wpis 2-cyfrowy dopasowuje także wariant 4-cyfrowy z prefiksem
     „20" i odwrotnie („1552/23" ⟷ „1552/2023"); żadnej innej tolerancji
     na cyfry;
   - **„upr":** sufiks zawsze opcjonalny w dopasowaniu; maskowany jest
     span faktycznie występujący w tekście (z „upr", jeżeli tam stoi);
   - **cyfry rzymskie wydziału:** literalne (I, II, …, XVII); wpis bez
     wydziału dopasowuje też wystąpienie z wydziałem (span rozszerzony
     o prefiks rzymski, żeby w piśmie nie został „I C" przed tokenem);
     wpis z wydziałem NIE dopasowuje innego wydziału;
   - fold glifów OCR (l→I, O→0) świadomie poza v1 – sygnatura ze skanu
     to rzadkość względem nazwisk; odnotowane jako ograniczenie (R-ST-5).
3. **Mechanika:** krok w fazie `ner` (obok `createRegexStep`), aktywny
   tylko przy niepustej allowliście, przekazywanej jak `enabledEntities`
   (worker `configure` → opcje pipeline'u). Emituje encje
   `DOCUMENT_REFERENCE` ze `source: 'case-allowlist'`, `score: 1.0`
   i `forceTier: 'mask'` (§3.2 pkt 1). `ENTITY_SOURCES.DOCUMENT_REFERENCE`
   dostaje alias `case-allowlist` (inaczej `sourceFilterStep` wytnie
   kandydatów – ta sama pułapka, którą dokumentują wpisy B3/B4-lite
   w `entity-sources.js:68-102`).
4. **Podpowiedzi:** encje `DOCUMENT_REFERENCE` wykryte regexem
   (`DOCKET_RE`) i modelami, a przepuszczone jako `pass`, zasilają
   lokalną listę „wykryte sygnatury w dokumentach" z akcją „to moja
   sprawa → dodaj do allowlisty". Zero automatyki: żadna sygnatura nie
   jest maskowana bez jawnego wpisu użytkownika (kontrakt zadania: TYLKO
   wpisane, cała reszta nietykana).
5. **Część osobowa nazw organizacji (JDG/kancelaria):** rozstrzygnięta
   w ST-2 (H-1/H-2): część osobowa jest maskowana jako PERSON_NAME
   wtedy, gdy (a) model/leksykon wyemitował ją jako kandydata, albo
   (b) nazwisko jest znane skądinąd w dokumencie i dosiew je wstrzelił
   w span nazwy. **Trzecia linia obrony:** nazwa `pass` typu
   ORGANIZATION_NAME, wewnątrz której `NAME_CANDIDATE`
   (`src/pipeline/steps/backfill.js:4-5`) znajduje sekwencję dwóch+ słów
   wielką literą NIE pokrytą encją `mask`, generuje kandydata **W2**
   (typ ORGANIZATION_NAME, `valueKey` całej nazwy) z opisem „nazwa może
   zawierać dane osoby (JDG/kancelaria)" – radca decyduje o całej nazwie.
   To jest fallback świadomie szeroki (złapie też „Bank Spółdzielczy
   w Wielkiej Nieszawce"); szum ogranicza wymóg niepokrycia i to, że
   kandydat W2 niczego nie maskuje bez decyzji. Docelowe wzmocnienie:
   leksykon imion z projektu morfologii (`W1-W3-MORPHOLOGY-DESIGN.md`,
   słownik imion PESEL CC0) zawęzi heurystykę do sekwencji zawierających
   znane imię – po bramce tamtego projektu, poza v1.

### 5.3 Kryterium akceptacji

1. Golden allowlisty: wpis „I C 1552/23" maskuje w tekście „I C 1552/23",
   „I  C 1552/23" (NBSP), „I C 1552 / 23", „I C 1552/2023" oraz wariant
   złamany linią; NIE maskuje „II C 1552/23" ani „I C 1553/23"; sygnatura
   cytowanego wyroku SN w tym samym dokumencie pozostaje jawna.
2. Wpis „II Ca 210/24" maskuje „II Ca 210/24 upr" w całości (z sufiksem).
3. Golden JDG (z 3.3 pkt 2) + fallback: nazwa z nieznanym nazwiskiem
   (żadnego innego wystąpienia w dokumencie) ląduje w koszu W2 jako cała
   nazwa; po decyzji „maskuj" cała nazwa dostaje token ORGANIZATION_NAME.
4. Pusta allowlista = krok nieaktywny, wyniki bajt w bajt jak bez niego.

### 5.4 Test dowodzący

Jednostkowe: normalizacja (tabela wariantów spacje/NBSP/rok/upr/wydział,
pozytywy i negatywy); property-test „wpis nigdy nie dopasowuje innego
numeru/roku". Goldeny 5.3. Eval: tagowany przebieg z profilem allowlisty
na dokumentach klasy `sygnatury` (ST-7 pkt 5) – sygnatury własne maskowane,
cytowania nietknięte.

**Koszt:** M (normalizacja + krok + podpowiedzi; fallback JDG dzieli
mechanikę z ST-2). **Bramka Opusa:** decyzja o trwałości allowlisty
(O-ST-3) wchodzi do GATE-SCOPE; sama mechanika – nie (regex + konfiguracja,
dyscyplina eval).

---

## §6. ST-7 – rekalibracja benchmarku i korpusu 2.0

### 6.1 Zasada: GT jest stałe, warstwa jest funkcją konfiguracji

`.expected.json` NIE dostaje pola warstwy. Podział W1/W2/W3 wylicza scoring
z `TYPE_TIERS` (współdzielony import, jak `TYPE_WEIGHTS` w analyze) –
zmiana warstwy typu przez radcę automatycznie przelicza benchmark, bez
reanotacji korpusu. GT nadal anotuje typy W3 (ORGANIZATION_NAME,
DOCUMENT_REFERENCE własne): scoring je pomija, ale dane są potrzebne
klasom JDG/sygnatur i każdej przyszłej zmianie konfiguracji.

### 6.2 Kontrakt scoringu (`src/eval/score.js`, `run.js`, `analyze.js`)

1. **`run.js`:** obok `entities.json` zapisuje `candidates.json` per
   dokument (kandydaci W2 z partycji ST-2); `summary.json` dostaje
   `tiersConfig` (efektywna mapa typ→warstwa przebiegu) i `scoringVersion`.
2. **Sekcja W1 (liczba do obrony):** dokładnie dzisiejszy scoring ścisły
   (IoU ≥ 0,5, zgodność typu z klasami ekwiwalencji O-R90-3, TP tylko przy
   dokładnych granicach – `computeMetrics`, `src/eval/score.js:48-66`),
   zawężony do typów `mask`. Cel: **recall ≥ 95%** (ZAKRES §2). FP liczone
   jak dziś (precyzja W1 pilnuje podłóg G5).
3. **Sekcja W2 („pokrycie do przeglądu"):** per encja GT typu `review`:
   **trafienie ⟺ pokrycie znakowe spanu GT przez sumę (kandydatów W2
   ∪ encji maskowanych) ≥ 50%** (`charCoverage`, `src/eval/analyze.js:33-54`
   – reużyta, nie nowa). Bez kary za granice, bez wymogu zgodności typu
   wewnątrz W2 (kandydat HEALTH_DATA proponujący span, w którym GT widzi
   CRIMINAL_OFFENCE_DATA, spełnia cel „zaproponowano radcy"). Encja
   zamaskowana przez W1 liczy się jako pokryta (ukryta > pokazana).
   Metryka pomocnicza: **szum kosza** = średnia liczba kandydatów bez
   odpowiednika w GT na dokument (ergonomia, nie poprawność; bez progu
   bramkowego w v1, raportowana do obserwacji – O-ST-6).
4. **Sekcja W3:** poza metrykami; raport podaje wyłącznie liczbę encji GT
   pominiętych przez konfigurację (`dropped by tier`), żeby liczby między
   przebiegami o różnych konfiguracjach nie były porównywane w ciemno.
   Spurious typu `pass` nie istnieje z konstrukcji (nic nie maskujemy).
5. **Profile pomiarowe:** eval przyjmuje `--tiers=<profil>`
   (`default` | `all-mask`), spójnie z profilem konfiguracji okrojonej
   z B6 pkt 4 (R-4 z RECALL-90 §6.2 – to samo miejsce mechanizmu);
   `eval:compare` porównuje wyłącznie przebiegi o zgodnym `scoringVersion`
   i `tiersConfig` (staremu formatowi wypisuje jawne ostrzeżenie zamiast
   cichych liczb).
6. **`analyze.js` (rejestr przecieków):** przeciekiem jest wyłącznie
   niezamaskowany znak encji GT warstwy `mask` (+ encji z `forceTier`).
   Encje `review` dostają osobną sekcję ANALIZY: „niezaproponowane do
   przeglądu" (FN kosza – to jest odpowiednik przecieku dla W2, ale
   o innej wadze: brak propozycji ≠ wyciek, bo W2 z definicji nie
   identyfikuje samodzielnie). Encje `pass` znikają z rejestru. Macierz
   pomyłek pozostaje pełna (wszystkie typy) – to na niej widać H-3.

### 6.3 Delta polityki anotacji korpusu 2.0 (względem README adversarial i RECALL-90 §3.5)

1. **Span art. 9–10 = JĄDRO faktu** – nazwa choroby / związku / orientacji /
   czynu, np. w „leczy się z powodu nadciśnienia tętniczego" anotowane jest
   „nadciśnienia tętniczego", nie cała fraza, nie zdanie. **To jawnie
   NADPISUJE RECALL-90 §3.5 pkt 2** („minimalna fraza: kotwica +
   dopełnienie"). Uzasadnienie: przy scoringu W2-coverage granica nie jest
   karana, więc GT ma definiować MINIMALNĄ treść, której pokrycie liczymy;
   kotwica („leczy się z powodu") jest ramą bez treści – jej maskowanie
   niczego nie chroni, a jej anotowanie sztucznie zaniżało recall (ZAKRES
   §3, przypis o 45–94% maskowanych jąder przy recall granic 0%).
   Leksykon B3 (kotwica+dopełnienie, `special-category-lexicon`) pozostaje
   BEZ ZMIAN – jego szerszy span pokrywa jądro w całości, więc W2-coverage
   go premiuje; rozbieżność GT↔B3 przestaje istnieć w metryce zamiast być
   wiecznym sporem o znaki (zasada z RECALL-90 §3.5: GT z definicji faktu,
   nigdy pod wzorce).
2. **W3 nieanotowane jako „do-maskowania":** ORGANIZATION_NAME
   i DOCUMENT_REFERENCE pozostają w GT jako encje opisowe (6.1), ale żaden
   dokument nie jest konstruowany tak, by ich zamaskowanie było warunkiem
   szczelności; cytowania orzecznictwa dalej nieanotowane (pułapki FP jak
   dotąd).
3. **W2 anotowane osobno = po prostu swoim typem** (mechanicznie nic się
   nie zmienia w formacie; „osobność" realizuje podział scoringu).
   Kwoty per klasa z RECALL-90 §3.3 pozostają w mocy (role 100, art. 9–10
   90, kwoty 80…), bo sterują pracą nad detekcją niezależnie od warstwy
   ujścia.
4. **Dwie nowe klasy dokumentów** w generatorze (dev i holdout, przez
   manifest):
   - `jdg`: nazwy działalności/kancelarii z częścią osobową
     („Kancelaria Radcy Prawnego Jan Kowalski", „PHU MAREK NOWAK",
     wersaliki, odmiana); GT: część osobowa jako PERSON_NAME (W1),
     cała nazwa jako ORGANIZATION_NAME (opisowo); część nazwisk występuje
     TYLKO w nazwie (test trzeciej linii obrony 5.2 pkt 5);
   - `sygnatury`: sygnatura własna sprawy w wielu wariantach zapisu
     (spacje, „upr", rok 2/4-cyfrowy, złamanie linii) przemieszana
     z cytowaniami SN/TSUE; GT: wystąpienia sygnatury własnej jako
     DOCUMENT_REFERENCE. Harness eval dostaje per-dokumentowy plik opcji
     (`<nazwa>.options.json`, tu: allowlista) czytany przez `run.js` –
     minimalne rozszerzenie, potrzebne też przyszłym testom słownika.
5. **Regeneracja i zamrożenie:** delta anotacji zmienia definicję GT,
   więc holdout jest generowany NA NOWO (nowe seedy i szablony dla nowych
   klas; polityka O-R90-1 – dziennik pomiarów odnotowuje regenerację
   z przyczyną „zmiana polityki anotacji, nie strojenie"). Stary holdout
   zostaje w repo jako artefakt porównawczy pomiaru 76%.

### 6.4 Relacja do GATE-RECALL-90 (bez renegocjacji)

Warunki G1–G8 (RECALL-90 §4.2) pozostają zdefiniowane, jak są. Ten projekt
dodaje scoringowi możliwość policzenia ich na dwóch zakresach: pełnym
(dotychczasowy sens) i `mask`-only (sens po piwocie). Która liczba jest
bramkowa dla marketingu i czy próg G1 zmienia się na 95% W1 – to decyzja
Alana przy najbliższej bramce recall (O-ST-4); rekomendacja architekta:
bramka mierzy odtąd **W1 ścisły ≥ 95% punktowo, dolna granica 95% CI
≥ 92–93%** (Wilson/bootstrap jak G2, ta sama mechanika, nowy zakres),
z W2-coverage raportowanym obok jako liczba druga („każda dana wrażliwa
wykryta albo przedstawiona do przeglądu w X%"). Zero pełnych wycieków
wagi ≥ 4 (G3) pozostaje bez zmian – wszystkie typy wagi ≥ 4 są w `mask`.

### 6.5 Kryterium akceptacji / test dowodzący

Golden scoringu: spreparowany mini-przebieg (3 dokumenty, po jednej encji
mask/review/pass + kandydat) daje dokładnie przewidziane liczby w trzech
sekcjach; test nadpisania: encja review zamaskowana przez W1 liczona jako
pokryta; test ekwiwalencji {FINANCIAL_AMOUNT, INCOME_COMPENSATION}
dziedziczonej w W2; strażnik `ground-truth.test.js` obejmuje nowe klasy
automatycznie; test odmowy `eval:compare` przy niezgodnym `scoringVersion`.
Po wdrożeniu: przeliczenie OSTATNIEGO przebiegu holdout (bez nowej
inferencji, z zapisanych `entities.json`) w obu widokach – pierwsza
para liczb „76% ogółem / ~86% W1" z jednego źródła, do ROADMAP.

**Koszt:** M (scoring) + M–L (generator: dwie klasy, jądra art. 9–10,
regeneracja holdoutu). **Bramka Opusa:** nie dla scoringu; przegląd próbki
nowego holdoutu wchodzi do najbliższej bramki recall (jak R10), nie tu.

---

## §7. ST-6 – granica WebMCP i bramka GATE-SCOPE

### 7.1 Kontrakt granicy (moduł ST-6)

1. **Twardy warunek czytelności źródła:** `isReadableSource`
   (`src/mcp/listings.js:25-27`) dostaje trzeci warunek –
   `reviewComplete(source)` (ST-3 pkt 1). Źródło z nierozstrzygniętymi
   kandydatami W2: nie jest listowane w `list_sources`, a `read_source`
   odpowiada błędem „źródło w przeglądzie" (bez treści). Uzasadnienie
   więzu z zadania wprost: most widzi wyłącznie tekst stokenizowany PO
   decyzjach użytkownika. Tekst po decyzji „pomiń" zawiera jawną wartość
   W2 – i to JEST zgodne z więzem, bo decyzję podjął człowiek (W2 z
   definicji nie identyfikuje samodzielnie; wyjątek mozaikowy rozstrzyga
   właśnie radca).
   Wariant miękki (źródło czytelne od razu, kosz równoległy) odrzucony:
   otwiera dokładnie ten wyścig, którego zakazuje więz (LLM czyta tekst,
   ZANIM radca zdążył zamaskować rolę-quasi-identyfikator); wygoda nie
   równoważy utraty gwarancji konstrukcyjnej – decyzja do potwierdzenia
   jako O-ST-5.
2. **Kandydaci nie istnieją dla mostu:** żadne narzędzie MCP nie zwraca
   kandydatów, ich wartości, liczników ani kontekstów; `char_count`
   liczony jak dziś z `applyTokens` (`listings.js:33-41`). Kontrakt
   negatywny przybity testem przechwytującym WSZYSTKIE odpowiedzi
   narzędzi (wzorzec testów mostu) i grepującym wartości kandydatów
   goldena – zero trafień.
3. **Istniejące strażniki bez zmian:** `hasDetectedEntities` (źródło
   z zerem encji niečytelne – po piwocie oznacza to: zero encji `mask`;
   dokument czysto-W2 z samymi „pomiń" pozostaje nieczytelny dla mostu,
   co jest zachowaniem poprawnym i wartym utrwalenia w teście),
   `hasAnonymizationToken` dla outcomes, syntetyczne etykiety
   (`createLabelSequence`).
4. **Desktop:** te same czyste funkcje `listings.js` konsumuje most
   wariantu B (M1–M8) – kontrakt jest wspólny; żadnej rozbieżności web/desktop.

### 7.2 GATE-SCOPE – jawna bramka Opusa (werdykt przed merge'em ST-4/ST-6)

Zakres przeglądu (wszystko naraz, jeden werdykt):

| # | Przedmiot | Pytanie bramkowe |
|---|---|---|
| GS-1 | ST-6: warunek `reviewComplete` na granicy mostu | czy istnieje ścieżka (wyścig configure/classify, rerun, edycja anotacji, outcome pisany w trakcie przeglądu), którą tekst źródła wychodzi przez most PRZED zamknięciem przeglądu |
| GS-2 | ST-4: powierzchnia kosza | czy sekcja kosza nie tworzy nowego kanału wyjścia (schowek, eksport, logi konsoli wbrew D3) i czy komunikaty nie obiecują więcej, niż mechanika daje |
| GS-3 | ST-3 pkt 5: trwały słownik w localStorage | werdykt względem D2 THREAT-MODEL: czy frazy-decyzje są konfiguracją (jak blocklisty), czy artefaktem o wartości akt; czy wykluczyć typy art. 9–10 z trwałości (O-ST-2) |
| GS-4 | ST-5: allowlista sygnatur | trwałość (O-ST-3) i czy podpowiedzi z wykrytych sygnatur nie przenoszą treści W3 do żadnego payloadu poza UI |
| GS-5 | ST-2: partycja | czy test niezmienności `all-mask` i goldeny H-1/H-2 wystarczają jako dowód braku regresji szczelności W1 (w szczególności: dedup tier-aware nie może zredukować maskowania w żadnym scenariuszu jednowarstwowym) |
| GS-6 | delta THREAT-MODEL | wpisy: kosz W2 (nowa powierzchnia UI na aktywach A1/A2), słownik, allowlista – kompletne i uczciwe |

Werdykt bramki + wpis do `PRODUCT-DECISIONS.md` (kolejny numer decyzji).
Do zielonej bramki: ST-4/ST-6 nie wchodzą do main; ST-1/ST-2/ST-7 mogą
(nie zmieniają granic wyjścia, mają własne testy niezmienności).

**Koszt ST-6:** S. **Bramka Opusa: TAK (GATE-SCOPE, opisana wyżej).**

---

## §8. ST-8 – migracja i kompatybilność

### 8.1 Kontrakt

1. **Stan w RAM, nie ma formatu do migrowania:** dokumenty, legendy
   i wyniki nie są persystowane (jedyne klucze localStorage to ustawienia,
   `src/main.js:66-69`) – piwot zakresu nie wymaga migracji danych.
   Migracja dotyczy ŻYWEJ sesji i artefaktów pochodnych (wyniki, eksporty,
   przebiegi eval).
2. **Żywa sesja przy zmianie konfiguracji warstw:** zmiana `tierOverrides`
   idzie ścieżką `scheduleConfigure` → `configure` i JAK dziś zmiana
   `enabledEntities` NIE reanonimizuje niczego automatycznie
   (`src/main.js:1291-1296` – wykrycie `selectionChanged` przy przycisku);
   przycisk „Anonimizuj" dostaje ten sam mechanizm dla `tiersChanged`.
   Dokumenty zanonimizowane przed zmianą zachowują swoje `entities`
   i `candidates` do czasu rerun – karta dokumentu pokazuje stempel
   konfiguracji, jeżeli różni się od bieżącej (bez tego dwa dokumenty
   w sesji mogą cicho żyć w dwóch zakresach – R-ST-4).
3. **Stare wyniki (outcomes) po piwocie:** snapshoty legend zawierające
   tokeny typów dziś-`pass` (np. `[ORGANIZATION_NAME_2]` sprzed piwotu)
   deanonimizują się bez zmian – `effectiveOutcomeLegend` jest funkcją
   snapshotu, nie bieżącej konfiguracji (`src/substitution.js:111-113`).
   Nowe źródła po prostu nie generują takich tokenów. Kontrakt przybity
   testem, nie deklaracją.
4. **Stare przebiegi eval:** `scores.json` bez `scoringVersion` czytelne
   wyłącznie starym widokiem; `eval:compare` nowego z starym odmawia
   z komunikatem (§6.2 pkt 5). Baseline'y liczbowe sprzed piwotu żyją
   w ROADMAP jako historia, nie jako punkt odniesienia W1.
5. **Desktop/web:** identyczna logika (pipeline i listings współdzielone);
   wariant B mostu dziedziczy ST-6 przez `listings.js` bez osobnej pracy.

### 8.2 Kryterium akceptacji / test

Test snapshotu: outcome utworzony przy konfiguracji „ORG maskowane" +
zmiana ORG→`pass` + rerun źródła → deanonimizacja outcome'u bajt w bajt
jak przed zmianą. Test stempla konfiguracji na karcie. Test odmowy
`eval:compare`.

**Koszt:** S. **Bramka Opusa:** nie.

---

## §9. Kolejność, koszty, zależności, bramki

| Krok | Co | Koszt | Zależy od | Bramka |
|---|---|---|---|---|
| ST-7a | scoring trójdzielny + przeliczenie ostatniego holdoutu w dwóch widokach (liczby „76%/~86% W1" z jednego źródła) | M | – (nie dotyka `src/pipeline`) | nie |
| ST-1 | `TYPE_TIERS` + testy spójności | S | – | nie |
| ST-2 | partycja warstw + tier-aware dedup/backfill + profil `all-mask` | M | ST-1 | nie (dyscyplina eval + niezmienność) |
| ST-7b | generator: klasy `jdg`/`sygnatury`, jądra art. 9–10, regeneracja holdoutu | M–L | ST-7a (definicje) | przegląd próbki przy najbliższej bramce recall |
| ST-3 | silnik kosza (decyzje, pamięć, re-maskowanie, słownik) | M | ST-2 | wchodzi w GATE-SCOPE |
| ST-4 | UI kosza | M | ST-3 | **GATE-SCOPE** |
| ST-5 | allowlista sygnatur + fallback JDG | M | ST-2 | O-ST-3 w GATE-SCOPE |
| ST-6 | granica mostu (`reviewComplete`) | S | ST-3 | **GATE-SCOPE** |
| ST-8 | migracja/kompatybilność (testy snapshotów, stemple) | S | ST-2 | nie |
| GATE-SCOPE | werdykt Opusa GS-1…GS-6 + wpis PRODUCT-DECISIONS | S | ST-3…ST-6 | **TAK** |

Uwagi do sekwencji:

- **ST-7a najpierw** – rekalibracja liczb nie może czekać na UI; pierwsza
  para liczb W1/W2 z istniejącego przebiegu ustawia oczekiwania i ROADMAP
  bez żadnej inferencji (laptop-safe: zero modeli, czysty re-scoring).
- **ST-2 przed B6/R7** jest bezpieczne i przewidziane (§3.4 pkt 2);
  po wejściu B6 oba wymiary mieszkają w jednym kroku.
- Równoległość z torem recall: moduły B2/B3/B4 (scalone) podnoszą detekcję
  typów, które ST tylko inaczej UJŚCIUJE – żadnej kolizji plikowej poza
  `default.js` (kolejność kroków) i `dedup/backfill` (kontrakty H-1/H-2);
  te trzy pliki to jedyne miejsce koordynacji z Sonnetem.
- Cel liczbowy po całości: W1 ścisły ≥ 95% punktowo na nowym holdoucie
  (dziś ~86% → luki nazwiskowe z ZAKRES §5 pozostają głównym frontem toru
  recall: OCR-spacing C1, nazwiska pospolite, leksykon B3 – ten projekt
  ich NIE rozwiązuje i nie udaje, że rozwiązuje).

---

## §10. Rejestr decyzji otwartych i ryzyk

### 10.1 O-ST – decyzje dla Alana

| # | Decyzja | Propozycja projektu | Stan |
|---|---|---|---|
| O-ST-1 | Granularność decyzji W2 | per wartość (typ + wartość po foldzie), spójnie z annotation-editorem; per wystąpienie poza v1 (§4.1 pkt 2) | rekomendacja, czeka na akcept |
| O-ST-2 | Trwały słownik: czy typy art. 9–10 mogą być zapamiętywane na stałe | tak dla fraz generycznych (nazwa choroby bez osoby to konfiguracja przeglądu), z ostrzeżeniem w UI; werdykt ostateczny w GS-3 | otwarte |
| O-ST-3 | Trwałość allowlisty sygnatur | RAM/sesja w v1 (duch D2: sygnatura własna identyfikuje sprawę); ewentualny zapis dopiero z mechanizmem szyfrowania z D2 | rekomendacja |
| O-ST-4 | Bramka marketingowa po piwocie: czy GATE-RECALL-90 mierzy odtąd W1-only i z jakim progiem | W1 ścisły ≥ 95% punktowo, dolna granica CI ≥ 92–93%, W2-coverage obok; brzmienie deklaracji do aktualizacji względem RECALL-90 §4.3 | decyzja przy najbliższej bramce recall |
| O-ST-5 | Twarda blokada mostu do zamknięcia przeglądu (vs miękka) | twarda (§7.1 pkt 1); „Zakończ przegląd – pomiń pozostałe" trzyma koszt jednego kliknięcia | rekomendacja, werdykt w GS-1 |
| O-ST-6 | Czy szum kosza dostaje próg bramkowy | nie w v1 – raportowany i obserwowany; próg dopiero po pierwszych realnych pomiarach (inaczej zgadujemy liczbę) | rekomendacja |
| O-ST-7 | UI zmiany warstwy typu | v1: plik konfiguracyjny + `tierOverrides` w ustawieniach zaawansowanych (lista typów z trzema stanami); bez edytora „drag-and-drop" | rekomendacja |
| O-ST-8 | Eksport listy kandydatów/decyzji (raport przeglądu) | poza v1 (minimalna powierzchnia bramki GS-2); wraca jako feature razem z raportem weryfikatora | rekomendacja |

### 10.2 R-ST – ryzyka

| # | Ryzyko | Mitygacja |
|---|---|---|
| R-ST-1 | **Kosz przytłacza** (dziesiątki kwot/lokalizacji na pozew) → radca klika „pomiń wszystkie" na ślepo i W2 przestaje chronić przypadki mozaiki | sortowanie grup po wadze (art. 9–10 na górze), domyślne zwinięcie, licznik per typ; miara szumu w eval (§6.2 pkt 3); jeżeli szum realnie zabija funkcję – próg score dla kandydatów W2 (thresholdBySource już to umie) jako pokrętło strojone pomiarem |
| R-ST-2 | **„Pomiń" jako wyciek** – radca pomija wartość, która w TYM dokumencie identyfikuje (mała populacja) | to jest konstrukcja produktu (human-in-the-loop, ZAKRES §2: W2 = decyzja radcy); UI nie sugeruje „pomiń" jako default (dwa równorzędne przyciski); kontekst zdaniowy przy każdej wartości |
| R-ST-3 | **Tier-aware dedup zmienia arbitraż** w niewidoczny sposób i psuje precyzję W1 (podwójne maskowanie nakładek) | test niezmienności `all-mask` (bajt w bajt); goldeny nakładek; tagowany eval na obu korpusach przed merge'em ST-2 |
| R-ST-4 | **Dwa dokumenty w sesji w dwóch zakresach** po zmianie konfiguracji bez rerun | stempel konfiguracji na karcie + wyróżnienie „zanonimizowano starszą konfiguracją" (§8.1 pkt 2) |
| R-ST-5 | **OCR-owe warianty sygnatur** (l→I, rozstrzelenia) poza zasięgiem allowlisty v1 | odnotowane ograniczenie (analogia C1); weryfikator lokalny flaguje sekwencje sygnaturopodobne; fold glifów jako rozszerzenie po pomiarze |
| R-ST-6 | **H-3 przed wejściem B6:** pomyłka typu W1→W3 (PESEL jako DOCUMENT_REFERENCE) nie jest maskowana | okno ryzyka do R7; osłona częściowa: regexy A1 z sumami kontrolnymi emitują właściwy typ ze score 1,0 równolegle do modelu (kandydat `mask` żyje obok pomyłki `pass` i wygrywa maskowanie); pomiar kanału: macierz pomyłek per przebieg (§6.2 pkt 6); priorytet R7 rośnie |
| R-ST-7 | **Regeneracja holdoutu** czyni liczby przed/po piwocie nieporównywalnymi wprost | przeliczenie starego przebiegu nowym scoringiem (ST-7a) daje pomost; ROADMAP dostaje parę liczb z tego samego przebiegu; stary holdout zostaje w repo |
| R-ST-8 | **Słownik trwały rośnie w cień konfiguracji** (dziesiątki fraz, nikt nie pamięta dlaczego) | widok słownika w ustawieniach z datą dodania i typem; czyszczenie jednym kliknięciem; frazy stosowane zawsze z oznaczeniem w koszu (odwracalne per dokument) |

---

## §11. Co ten projekt zmienia w komunikacji produktu (delta do RECALL-90 §4.3)

Po GATE-SCOPE i zielonej bramce recall na nowym holdoucie Alan może
uczciwie mówić trzema zdaniami zamiast jednym procentem:

> „Dane osobowe w rozumieniu RODO (art. 4 pkt 1) narzędzie maskuje
> automatycznie – skuteczność [XX]% zmierzona na jawnym korpusie
> kontradyktoryjnym. Dane wrażliwe, które samodzielnie nikogo nie
> identyfikują (role, atrybuty, fakty z art. 9–10), narzędzie wykrywa
> i przedstawia radcy do decyzji jednym kliknięciem. Nazw sądów, banków
> i sygnatur cytowanych orzeczeń nie rusza – pismo pozostaje czytelne."

Obowiązkowe zastrzeżenia z RECALL-90 §4.3 pozostają w mocy bez zmian
(przegląd człowieka, OCR, kwoty słowne, C3/γ). Lista „czego pisać nie
wolno" – bez zmian.

---

*Koniec projektu. Następne kroki: (1) decyzje O-ST-1…O-ST-8 Alana –
w szczególności O-ST-4 (definicja liczby bramkowej po piwocie);
(2) ST-7a (re-scoring istniejącego holdoutu w dwóch widokach – zero
inferencji, można od zaraz na laptopie); (3) ST-1/ST-2 jako pierwsze
moduły kodowe (Sonnet), z koordynacją wyłącznie na `default.js` /
`dedup` / `backfill`; (4) GATE-SCOPE przed merge'em ST-4/ST-6.
Ten dokument nie zmienia żadnego przypisania z `ZAKRES-ANONIMIZACJI.md`
i żadnego kontraktu B1–B6.*
