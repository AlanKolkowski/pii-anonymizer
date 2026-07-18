# H-3-CLOSURE-DESIGN.md – zamknięcie kanału wycieku H-3 (droga do zera)

**Wersja:** 1.0 (projekt, zero kodu)
**Data:** 2026-07-18
**Autor:** Fable (architekt), sesja na `integration/sprint`
**Cel nadrzędny:** odblokowanie AKTYWACJI modelu trójwarstwowego
(`allMask:false`) przez konstrukcyjne zamknięcie H-3: przypadków, w których
model taguje realną daną osobową (warstwa `mask`) typem warstwy `pass`
(DOCUMENT_REFERENCE / ORGANIZATION_NAME). Przed piwotem taka dana była
maskowana pod złym tokenem; po piwocie byłaby jawna – to regresja
łamiąca ducha warunku G3 (RECALL-90 §4.2: zero pełnych wycieków typów
wagi ≥ 4 na holdoucie).
**Źródła prawdy:** `RECALL-90-DESIGN.md` §2.6 (kontrakt B6),
`SCOPE-TIERS-DESIGN.md` §3.2/§3.4 (partycja ST-2 i styk z B6),
`ZAKRES-ANONIMIZACJI.md` §3 (macierz typ→warstwa),
`src/pipeline/configs/type-tiers.js` + `type-weights.js` (dane),
`SCOPE-TIERS-TIERED-RUN-NOTES.md` (gałąź `origin/feature/eval-tiered-run`
– pierwszy pełny przebieg tiered 206 dok.).
**Granice tej sesji:** zero zmian w `src/**`. Nie renegocjuję B1–B6, stosu
ST-1…ST-8 ani GATE-SCOPE. Produktem sesji jest wyłącznie ten plik.

**Konwencja:** moduł → kontrakt → kryterium akceptacji → test dowodzący →
koszt (S ≤ pół dnia, M 1–2 dni, L projekt) → bramka Opusa (tak/nie).
Rejestr decyzji otwartych dla Alana: **O-HC-n** (§9.1); ryzyka: **R-HC-n**
(§9.2). Fragmenty wzorców i JSON to SPECYFIKACJA kontraktów, nie kod.

---

## §0. Teza i mapa projektu

1. **H-3 to dwa różne defekty pod jedną nazwą** i każdy ma inne zamknięcie:
   - przypadek **(b)** – kandydat `mask` ISTNIAŁ, ale przegrał arbitraż
     z szerszym spanem `pass`: zamyka go **arbitraż świadomy warstw**,
     który – wbrew założeniu zadania – JUŻ JEST zaimplementowany
     i scalony na `integration/sprint` (frontier per warstwa w
     `deduplicateEntities`, `src/anonymizer.js:748-794`; analogiczne
     osłony w trim, merge i backfill). Śpi pod `allMask:true`. Moduł
     HC-1 go nie buduje – DOWODZI go i przybija testami na wyciekach;
   - przypadek **(a)** – kandydata `mask` nie wygenerowało ŻADNE źródło:
     arbitraż nie ma czego wynieść na wierzch. Zamyka go **pakiet
     precyzyjnych regexów identyfikatorów** (moduł HC-2), bo wszystkie
     zmierzone wycieki (a) to zamknięte formaty urzędowe (dowód osobisty,
     prawo jazdy, tablica rejestracyjna) plus jedna luka klasy znaków
     (e-mail IDN).
2. **Triage wykonany w tej sesji (§1.3) rozstrzygnął empirycznie:** 6 z 8
   zmierzonych wycieków to czysty przypadek (a) po stronie regexów –
   dzisiejsze `findRegexEntities` nie emituje NIC dla żadnego z nich
   (w tym dla e-maila: regex jest ASCII-owy i „przedsiębior.pl" z „ę"
   nie łapie – korekta względem założenia zadania, §1.4). Pozostałe 2
   (nazwiska) zamykają moduły SG-lite i OS-1 – poza zakresem tego
   projektu, ale NA ŚCIEŻCE bramki (§6: zależności Z-1/Z-2, w tym
   brakujący dziś wpis „Kogut" w gazeterze).
3. **Pomiar przed konstrukcją.** Formalna metryka kanału H-3 nie istnieje
   w repo (pomiar Opusa był ad hoc). Moduł HC-0 czyni ją artefaktem
   pierwszej klasy (`eval:h3`), z jawną semantyką na przebiegach tiered
   i (pesymistycznie, tylko do triage) all-mask. Bez tego „zero" nie jest
   liczbą, tylko deklaracją.
4. **Niezmienność all-mask zostaje w mocy przez rozdzielenie dwóch
   niezmienników (§4.3):** N1 – mechanika arbitrażu przy tym samym zbiorze
   kandydatów jest bajt w bajt dzisiejsza (już przybite
   `tier-partition-invariance.test.js`; ten projekt arbitrażu NIE dotyka);
   N2 – nowe regexy celowo zmieniają zbiór kandydatów w OBU trybach, jak
   każdy moduł detekcyjny toru recall (B3/B4) – to mierzy tagowany eval,
   nie test niezmienności.
5. **Kryterium sukcesu całości:** pomiar `eval:h3` na dev (38) i pełnym
   holdoucie (206) po wdrożeniu HC-0…HC-2 i domknięciu Z-1/Z-2:
   **zero wycieków kanału H-3 wagi ≥ 4**. Werdykt GATE-H3 (§8) jest
   ostatnim warunkiem konstrukcyjnym aktywacji `allMask:false`.

Mapa: HC-0 (pomiar) → HC-1 (dowód arbitrażu) ∥ HC-2 (regexy) →
Z-1/Z-2 (zależności zewnętrzne) → pomiar PC → GATE-H3.

---

## §1. Stan i dowody

### 1.1 Metoda pomiaru (za zadaniem bramki, doprecyzowana)

Wyciek H-3 = encja GT o efektywnej warstwie `mask`, której **nie pokrywa
żadna predykcja warstwy `mask`** (pokrycie znakowe 0%, spójnie z G3),
**ale pokrywa ją predykcja warstwy `pass`** (przecięcie > 0 znaków).
Pomiar Opusa (2026-07): na `entities.json` PO dedupie, na 49 lokalnych
przebiegach = pełny dev adversarial (38 dok.) + wycinka holdout (11 dok.)
– te same dwa przebiegi, które ST-7a przeliczał w
`SCOPE-TIERS-RESCORE-NOTES.md` §1. Wynik: **8 wycieków wagi ≥ 4, w tym
4 wagi 5**.

Konsekwencja metody, ważna dla interpretacji: przebiegi były **all-mask**
(sprzed aktywacji), więc „brak predykcji mask" może znaczyć (a) żadne
źródło nie wyemitowało etykiety `mask`, ALBO (b) etykieta istniała, ale
przegrała w jednokoszykowym dedupie z szerszym spanem `pass`. Post-hoc,
z samego `entities.json`, tych przypadków NIE da się rozróżnić po stronie
modelu – da się po stronie regexów (deterministyczne, §1.3).

### 1.2 Osiem zmierzonych wycieków – inwentarz z lokalizacją w korpusie

Wszystkie wartości pochodzą z syntetycznych korpusów w repo (zero danych
klienckich – wolno je cytować w testach i fixturach):

| # | GT (waga) | Wartość | Dokument korpusu | Model otagował |
|---|---|---|---|---|
| 1 | PERSON_IDENTIFIER (5) | `92712/00/2780` | `hold_identyfikatory_12` | DOCUMENT_REFERENCE |
| 2 | PERSON_IDENTIFIER (5) | `00123/22/0611` | `adw_14_dokumenty_tozsamosci` | DOCUMENT_REFERENCE |
| 3 | PERSON_IDENTIFIER (5) | `DKR 744829` | `adw_14_dokumenty_tozsamosci` | DOCUMENT_REFERENCE |
| 4 | PERSON_IDENTIFIER (5) | `DKR744829` (sklejone) | `adw_14_dokumenty_tozsamosci` | DOCUMENT_REFERENCE |
| 5 | VEHICLE_IDENTIFIER (4) | `CTR 88812` | `adw_31_komornik` | DOCUMENT_REFERENCE |
| 6 | EMAIL_ADDRESS (4) | `kontakt@przedsiębior.pl` | `hold_dane_osobowe_09/11/16` | ORGANIZATION_NAME |
| 7 | PERSON_NAME (4) | `Wacław Kogut` | `hold_pospolite_00` i in. | ORGANIZATION_NAME |
| 8 | PERSON_NAME (4) | `KonradŻurawski` (sklejone OCR) | `adw_25_ocr_sklejone` | ORGANIZATION_NAME |

Semantyka formatów #1–5 (istotna dla precyzji wzorców): #1–2 to numery
prawa jazdy (`NNNNN/NN/RRRR`), #3–4 to numer dowodu osobistego (3 litery
+ 6 cyfr, z cyfrą kontrolną), #5 to tablica rejestracyjna (prefiks
powiatowy + 4–5 znaków). Konteksty w korpusie zawierają wprost kotwice:
„dowodu osobistego seria i nr …", „prawa jazdy nr …", „nr rej. …".

### 1.3 Triage (a)/(b) – wykonany w tej sesji, deterministycznie

Metoda: `findRegexEntities` (`src/anonymizer.js:584`) uruchomione wprost
na zdaniach korpusu zawierających wartości #1–6 (czysty JS, zero modeli,
laptop; skrypt jednorazowy w scratchpadzie sesji, wyniki poniżej
odtwarzalne jedną komendą – wchodzi do testów HC-2 jako fixtury):

| # | Czy DZIŚ istnieje kandydat regex `mask`? | Klasyfikacja | Zamyka |
|---|---|---|---|
| 1 | **NIE** (brak wzorca prawa jazdy; klaster cyfr pęka na `/`, bo `/` nie jest w `ID_SEPARATOR`, `src/anonymizer.js:375`) | (a) | HC-2 / R-PJ |
| 2 | **NIE** (jw.) | (a) | HC-2 / R-PJ |
| 3 | **NIE** (brak wzorca dowodu; `findNumericIdentifierEntities` widzi tylko czyste ciągi cyfr) | (a) | HC-2 / R-DOW |
| 4 | **NIE** (jw., sklejenie nie ma znaczenia – wzorca brak w ogóle) | (a) | HC-2 / R-DOW |
| 5 | **NIE** (jedyny wzorzec pojazdów to 17-znakowy VIN, `src/anonymizer.js:521`) | (a) | HC-2 / R-TR |
| 6 | **NIE** – regex e-maila jest ASCII-owy (`[\w.-]`, `src/anonymizer.js:287-289`); ekspansja domeny zatrzymuje się na „ę" i kandydat odpada. Kontrola pozytywna: `kontakt@bankwielkopo.pl` (ASCII) łapany poprawnie | (a) po stronie regexu; (b) po stronie MODELU nierozstrzygalne post-hoc (§1.1) | HC-2 / R-EM + arbitraż (HC-1) |
| 7 | nie dotyczy (nazwisko; gazeter SG-lite NIE zawiera „Kogut" – sprawdzone w `src/pipeline/data/surname-gazetteer.json`) | (a) modelu | Z-1 (SG-lite) |
| 8 | nie dotyczy (sklejenie OCR) | (a) modelu | Z-2 (OS-1) |

Dodatkowy wynik kontrolny triage: PESEL z `hold_identyfikatory_12`
(`57020976679`) jest łapany przez regex A1 (PERSON_IDENTIFIER, suma
kontrolna) – rodzina A1 działa; luka dotyczy formatów, których A1 nigdy
nie obejmowało.

Suma kontrolna dowodu osobistego zweryfikowana na danych korpusu
(algorytm: litery A=10…Z=35, wagi 7-3-1 dla liter i 7-3-1-7-3 dla cyfr
2–6, cyfra kontrolna = pierwsza cyfra): **`DKR 744829` – suma WAŻNA;
`BMA 733701` (ten sam korpus, dokument #1) – suma NIEWAŻNA.** Wniosek
konstrukcyjny: korpus (i realny świat po OCR) zawiera numery dowodów
z niepoprawną sumą, więc wzorzec wyłącznie-z-sumą NIE wystarczy – R-DOW
musi mieć dwie ścieżki (§5.2).

### 1.4 Korekta względem zlecenia (jawna)

Zadanie zakładało, że e-mail #6 to potwierdzony przypadek (b) („regex
e-mail GO WYKRYŁ, ale szerszy ORGANIZATION_NAME połknął przy dedupie").
Triage §1.3 pokazuje, że **regex go nie wykrywa** (klasy ASCII). Jeżeli
jakikolwiek kandydat `mask` istniał i przegrał, mógł pochodzić wyłącznie
z modelu `polish-fp16` – czego z post-dedupowego `entities.json` nie
widać. Projekt zamyka OBA warianty naraz: R-EM daje deterministycznego
kandydata `mask` (score 1,0), a istniejący arbitraż ST-2 wynosi go na
wierzch niezależnie od tego, co zrobi model. Czystego, potwierdzonego
przypadku (b) nie ma dziś wśród ośmiu wycieków – ale mechanizm (b) jest
realny i zmierzony na pełnym holdoucie: pierwszy przebieg tiered
(`SCOPE-TIERS-TIERED-RUN-NOTES.md` §3) różni się od all-mask WYŁĄCZNIE
na EMAIL_ADDRESS i PERSON_NAME (m.in. +3 TP PERSON_NAME) – dokładnie tam,
gdzie frontier per warstwa wypuszcza kandydatów, których jednokoszykowy
dedup zjadał.

### 1.5 Co już stoi na `integration/sprint` (zastane, reużywane)

| Mechanizm | Miejsce | Rola w tym projekcie |
|---|---|---|
| frontier per warstwa w dedupie (nakładki rozstrzygane TYLKO w obrębie tej samej efektywnej warstwy; para mask/pass przeżywa w całości) | `src/anonymizer.js:748-794` | jądro zamknięcia przypadku (b); HC-1 dowodzi |
| osłona trim: precyzyjny regex przycina/wyrzuca wyłącznie encje tego samego typu I tej samej warstwy | `src/anonymizer.js:700-735` | DOCKET_RE (`pass`) nie może zjeść identyfikatora `mask` |
| merge tylko w obrębie jednej warstwy | `src/pipeline/steps/merge.js:52-55` | sąsiedni span `pass` nie wchłania `mask` |
| backfill: span `pass` nie blokuje dosiewu | `src/pipeline/steps/backfill.js:32-38` | komplet wystąpień `mask` mimo nakładek z W3 |
| partycja = jedyna decyzja maskowania | `src/pipeline/steps/tier-partition.js` | ujście; realizacja „jednego kroku decyzji" z §3.4 (patrz §4.2) |
| `effectiveTier` (allMask > forceTier > override > TYPE_TIERS) | `src/pipeline/configs/type-tiers.js:70-73` | jedno źródło prawdy warstwy dla wszystkich kroków |
| test niezmienności all-mask | `src/pipeline/steps/tier-partition-invariance.test.js` | niezmiennik N1 (§4.3) |
| `--allMask=false` w eval + zapis `candidates.json` | gałąź `origin/feature/eval-tiered-run` (NIEscalona) | baza HC-0; decyzja O-HC-5 |
| scoring trójdzielny post-hoc | `src/eval/score-tiers.js` | wzorzec ładowania/agregacji dla `eval:h3` |

Luka jest więc wąska i konkretna: (i) brak formalnej metryki H-3
z artefaktami, (ii) brak kandydatów `mask` dla czterech zamkniętych
formatów urzędowych i e-maili IDN, (iii) dwa wycieki nazwiskowe należą
do innych modułów, z czego jeden (Kogut) ma dziś DZIURĘ w danych.

---

## §2. Architektura zamknięcia – jawny podział odpowiedzialności

Wymóg zadania: podział „B6 zamyka / regex zamyka / rezyduum / poza
zakresem". Stan po tym projekcie:

1. **Arbitraż warstw (mechanika B6-w-wymiarze-warstw, już scalona)
   zamyka:** całą klasę (b) – każdy przypadek, w którym JAKIEKOLWIEK
   źródło wyemitowało kandydata `mask` nakładającego się na zwycięski
   span `pass`. Dotyczy to także wszystkich PRZYSZŁYCH pomyłek typu
   modelu, o ile istnieje równoległy kandydat `mask` (np. z regexów A1
   i HC-2). Warunek działania: kandydat musi dożyć dedupu (progi
   jakości są świadomie POZA arbitrażem – §4.4).
2. **Regexy HC-2 zamykają:** wycieki #1–6, przez wyprodukowanie
   brakującego kandydata `mask` (przypadek (a)): R-PJ (#1–2), R-DOW
   (#3–4), R-TR (#5), R-EM (#6). Precyzja gwarantowana kotwicami
   kontekstowymi, sumą kontrolną i pułapkownikiem (§5).
3. **Rezyduum (świadome, mierzone, nie projektowane tutaj):**
   - formaty identyfikatorów spoza listy (paszport bez kotwicy
     kontekstowej, legitymacje, mDowód, formaty zagraniczne) – zamknięta
     lista formatów NIE generalizuje; dyscyplina jak w SG-lite: nowy
     zmierzony wyciek → nowy wpis wzorca + test;
   - tablice rejestracyjne wzmiankowane BEZ kotwicy kontekstowej
     (R-TR v1 jest kotwiczone; wariant bare z whitelistą powiatową to
     O-HC-1);
   - kandydaci `mask` zabici progami jakości przed dedupem (§4.4) –
     kanał toru recall (B1/A7), nie arbitrażu;
   - numeryczne 5/2/4 bez kotwicy (ryzyko FP numeracji faktur – §5.3);
   każdą pozycję rezyduum widzi pomiar GH-4 i klasyfikuje ręcznie
   (analogia przeglądu G4).
4. **Poza zakresem tego projektu (jawnie):** wycieki #7 i #8. „Wacław
   Kogut" (nazwisko-wyraz pospolity) zamyka moduł SG-lite –
   `SURNAME-GAZETTEER-DESIGN.md`, dyscyplina „one entry + test per new
   leak"; **wpisu „Kogut" DZIŚ w gazeterze nie ma** (sprawdzone, §1.3),
   więc bez Z-1 bramka nie zejdzie do zera na holdoucie
   (`hold_pospolite_00`, `hold_art910_*`, `hold_dane_osobowe_04`,
   `hold_finanse_umowa_05`). „KonradŻurawski" (sklejenie OCR) zamyka
   scalony już moduł OS-1 (`OCR-SPACING-DESIGN.md`); w eval brama
   proweniencji działa po nazwie pliku (`run.js:103` – `adw_25_ocr_*`
   ją przechodzi), więc domknięcie potwierdzi sam pomiar. **Zamknięcie
   H-3 nie udaje, że rozwiązuje te dwa wycieki – wymaga ich jako
   zależności Z-1/Z-2 na bramce (§6).**

---

## §3. HC-0 – pomiar: `eval:h3` i artefakty kanału

### 3.1 Kontrakt

1. **Nowy skrypt `src/eval/h3.js`** (npm: `eval:h3`), konstrukcyjnie
   bliźniak `score-tiers.js` (reużywa `matching.js`/`charCoverage`,
   `type-tiers.js`, `type-weights.js`; ładowanie przebiegu i strażnicy
   – `textConvention`, „PUŁAPKA 0/0/0", `--dir` override – identyczne).
2. **Definicja formalna** (na dokument, dla encji GT `e` o efektywnej
   warstwie `mask`):
   - `covMask(e)` = pokrycie znakowe `e` sumą predykcji warstwy `mask`;
   - `passHit(e)` = istnieje predykcja warstwy `pass` o przecięciu
     z `e` > 0 znaków;
   - **wyciek H-3** ⟺ `covMask(e) = 0 ∧ passHit(e)`;
   - **czysty FN** (tor recall, poza tym projektem) ⟺ `covMask(e) = 0
     ∧ ¬passHit(e)`;
   - **częściowy** ⟺ `0 < covMask(e) < 1` – raport informacyjny
     (przegląd ręczny dla wagi 5, analogia G4).
   Raport per dokument i agregat: liczby w podziale na wagi (≥4 osobno),
   pełna lista wycieków {dokument, typ GT, waga, span, typ predykcji
   `pass`} oraz macierz pomyłek typów (realizacja obietnicy
   SCOPE-TIERS §6.2 pkt 6 – „na niej widać H-3"). Zapis
   `h3-report.json` do katalogu przebiegu, ze `scoringVersion`
   i `tiersConfig` jak w `tiers-scores.json`.
3. **Dwa tryby wejścia, jawnie stemplowane w raporcie:**
   - **`tiered`** (autorytatywny, bramkowy): przebieg z `--allMask=false`.
     Wymaga domknięcia artefaktów: `entities.json` zawiera po partycji
     wyłącznie encje `mask`, a predykcje `pass` znikają z kontekstu –
     dlatego `run.js` (rozszerzenie gałęzi `eval-tiered-run`) przy
     `!allMask` zapisuje dodatkowo **`pass-dropped.json`** per dokument:
     encje usunięte przez `tierPartitionStep` (dokładnie diff `removed`,
     który runner i tak liczy). Bez tego pliku pomiar kanału na
     przebiegu tiered jest ślepy – to jedyna zmiana kontraktu artefaktów;
   - **`all-mask-sim`** (pesymistyczny, wyłącznie triage/laptop):
     przebieg all-mask, predykcje klasyfikowane post-hoc przez
     `tierFor(entity_group)`. Tryb ZAWYŻA liczbę wycieków (b), bo
     jednokoszykowy dedup mógł zjeść kandydata `mask`, którego aktywacja
     by zachowała – raport drukuje to zastrzeżenie w nagłówku.
     **Zakaz konstrukcyjny: tryb symulacji nie może być podstawą
     werdyktu bramki** (fałszywe czerwone; R-HC-8).
4. **Air-gap:** zero nowych zależności, zero sieci; czysty odczyt
   artefaktów lokalnych.

### 3.2 Kryterium akceptacji

Na 49 lokalnych przebiegach (tryb `all-mask-sim`) `eval:h3` odtwarza
pomiar Opusa: dokładnie 8 wycieków wagi ≥ 4 z §1.2 (te same dokumenty,
typy i wartości spanów). Na przebiegu tiered ze smoke-testu (3 dok.,
TIERED-RUN-NOTES §1 pkt 3) tryb `tiered` czyta `pass-dropped.json`
i liczy bez fallbacku.

### 3.3 Test dowodzący

Jednostkowy golden na spreparowanym mini-przebiegu (2 dokumenty: jeden
wyciek H-3, jeden czysty FN, jeden częściowy) – wszystkie trzy klasy
rozróżnione; test odtworzenia „8/8" na fixturach zbudowanych z realnych
`entities.json` (skopiowane fragmenty do `src/eval/fixtures/`, nie
zależność od gitignorowanych przebiegów); test odmowy trybu `tiered`
bez `pass-dropped.json` (jasny komunikat zamiast cichych zer).

**Koszt:** S (zapis `pass-dropped.json` w `run.js`) + M (skrypt
z goldenami). **Bramka Opusa:** nie (czysty pomiar; werdykt i tak
przechodzi przez GATE-H3, która ogląda jego wyniki).

---

## §4. HC-1 – arbitraż: dowód, nie budowa

### 4.1 Kontrakt (co przybijamy, skoro mechanika już jest)

1. **Goldeny arbitrażu na wyciekach.** Dla każdego z wycieków #1–6 test
   jednostkowy przez ogon postprocessu (dedup → backfill → merge →
   partycja, dokładnie w kolejności `default.js:124-143`): wejście =
   syntetyczny zestaw kandydatów odtwarzający zmierzoną sytuację
   (szeroki span `pass` z modelu + kandydat `mask` z regexu HC-2);
   asercja = span GT wychodzi w `ctx.entities` (maskowany), span `pass`
   znika w partycji, `reviewCandidates` bez zmian. To jest test KLASY
   (b) – dowodzi, że gdy kandydat `mask` istnieje, żaden krok ogona nie
   jest w stanie go zgubić.
2. **Golden „pass nie zjada przez merge":** para spanów `pass`+`mask`
   w odległości ≤ MAX_GAP z regułą mergowalności typów – asercja braku
   scalenia (przybicie osłony `merge.js:52-55` scenariuszem H-3, nie
   tylko scenariuszem ST-5, na którym ją odkryto).
3. **Semantyka „jednego kroku decyzji" (§3.4 SCOPE-TIERS) – opis do
   dokumentacji, zero zmian:** dedup rozstrzyga REPREZENTACJĘ w obrębie
   warstwy (który span/etykieta reprezentuje nakładającą się rodzinę
   kandydatów TEJ SAMEJ warstwy), a `tierPartitionStep` podejmuje JEDYNĄ
   decyzję maskowania. Reguła B6 „którykolwiek kandydat mask → maskuj"
   jest w wymiarze warstw zrealizowana przez konstrukcję: kandydat
   `mask` nigdy nie konkuruje z `pass`, więc dociera do partycji zawsze,
   gdy istnieje. Etykieta maskowanego spanu = etykieta zwycięzcy
   koszyka `mask` (arbitraż wewnątrz-warstwowy bez zmian, w tym reguła
   score-1,0 i epsilon – `src/anonymizer.js:762-781`). Wymiar
   „włączoności" typów (B6 pkt 2, przesunięcie filtra `enabledEntities`)
   pozostaje w R7/B6 toru recall – ten projekt go NIE rusza i nie
   przesuwa żadnego kroku.
4. **Brak nowego stanu:** żadnego „rejestru kandydatów" ani side-channelu
   – frontier per warstwa JEST mechanizmem zatrzymania kandydatów,
   którego żądało zadanie; dublowanie go osobnym ledgerem byłoby drugim
   źródłem prawdy (odrzucone).

### 4.2 Kryterium akceptacji

Wszystkie goldeny 4.1 zielone na `integration/sprint` z kandydatami
w kształcie emitowanym przez HC-2 (typy, score 1,0, source `regex`);
przypadek e-maila: golden odtwarza zdanie z `hold_dane_osobowe_09`
(span ORGANIZATION_NAME obejmujący adres) i dowodzi maskowania
`[EMAIL_ADDRESS_n]` przy jawnej reszcie tekstu.

### 4.3 Niezmienność all-mask – dwa niezmienniki, jawnie

- **N1 (mechanika):** przy `allMask:true` każda encja ma jedną warstwę,
  frontier degeneruje do jednego koszyka i arbitraż jest bajt w bajt
  dzisiejszy – przybite istniejącym
  `tier-partition-invariance.test.js` i konstrukcją
  (`SINGLE_TIER_BUCKET`, `src/anonymizer.js:636-639`). HC-1 niczego
  w arbitrażu nie zmienia, więc N1 pozostaje zielony bez nowej pracy.
  To jest dokładnie warunek twardy zadania („w all-mask wszystko jest
  mask → trywialnie wszystko maskowane = dziś").
- **N2 (zbiór kandydatów):** regexy HC-2 dodają kandydatów w OBU
  trybach – all-mask też zacznie maskować `DKR 744829` (dziś: wyciek
  pełny LUB maska pod złym tokenem, zależnie od modelu). To celowa
  poprawa detekcji, mierzona tagowanym evalem jak B3/B4, a NIE
  naruszenie niezmienności: test N1 porównuje mechanikę arbitrażu przy
  stałym zbiorze kandydatów, nie zamraża detekcji (inaczej żaden moduł
  recall nigdy nie mógłby wejść). Rozdzielenie N1/N2 wpisać do
  dokumentacji testu przy wdrożeniu.

### 4.4 Granica kontraktu (świadoma, nie luka)

Arbitraż widzi kandydatów, którzy dożyli dedupu. Kandydat `mask` zabity
progiem score / blocklistą / maxLength GINIE przed decyzją – zgodnie
z B6 ust. 1 („sprzed rozstrzygnięcia TYPU", nie „sprzed progów
jakości"). Jeżeli pomiar GH-4 pokaże wyciek tej klasy, adresuje go
strojenie progów (B1/A7, tor recall), nie ten projekt – rezyduum §2.3.
Regexów HC-2 to nie dotyczy: score 1,0 przechodzi każdy próg,
`sourceFilterStep` wymaga tylko wpisu źródła w `ENTITY_SOURCES`
(PERSON_IDENTIFIER, VEHICLE_IDENTIFIER i EMAIL_ADDRESS już listują
`regex` – `entity-sources.js:88,97,119` – zero zmian konfiguracji).

**Koszt:** S (same testy + akapit dokumentacji). **Bramka Opusa:** nie.

---

## §5. HC-2 – pakiet regexów identyfikatorów (przypadek (a))

### 5.1 Zasady wspólne pakietu

1. **Dane w plikach, nie w kodzie:** kotwice kontekstowe, blocklisty
   prefiksów i (ewentualna, O-HC-1) whitelista prefiksów powiatowych
   żyją w `src/pipeline/data/identifier-patterns.json` (dyscyplina jak
   `surname-gazetteer.json`: komentarz z pochodzeniem, wersjonowane
   w repo, air-gap – zero pobierania). Kod trzyma wyłącznie szkielety
   wzorców i walidatory arytmetyczne (jak dziś PESEL/NIP/IBAN
   w `anonymizer.js` – to jest dom rodziny A1 i tam mieszka HC-2).
2. **Emisja w stylu domu:** `{ entity_group, start, end, score: 1.0,
   source: 'regex' }`; granice słowa lookaroundami
   `(?<![\p{L}\p{N}_]) … (?![\p{L}\p{N}_])` (styl backfill.js:19);
   separator wewnętrzny pojedynczy `[  -]` (podzbiór
   `ID_SEPARATOR` bez `\n` – złamanie linii wewnątrz 9-znakowego numeru
   to rezyduum v1, spójnie z ograniczeniem R-ST-5).
3. **Kotwica kontekstowa** = wzorzec leksykalny w oknie WSTECZ od
   początku dopasowania (długość okna per wzorzec, poniżej); okno nie
   przekracza granicy akapitu (`\n\n`). Kotwice są ZAMKNIĘTĄ listą
   w pliku danych – rozszerzenia wyłącznie przez rejestr wycieków.
4. **Zero nowych FP na pułapkach – konstrukcyjnie:** każdy wzorzec ma
   w pułapkowniku (§5.6) klasę kolizji, która go najmocniej atakuje;
   test asercji „0 trafień" jest warunkiem merge'a, nie życzeniem.

### 5.2 R-DOW – dowód osobisty (typ: PERSON_IDENTIFIER, waga 5)

**Format:** `[A-Z]{3}` + separator? + `[0-9lO]{6}` (fold OCR l→1, O→0
w cyfrach, jak w rodzinie A1 – `src/anonymizer.js:376-383`).

**Dwie ścieżki (obie emitują ten sam typ):**
- **Ścieżka A – arytmetyczna, bez kotwicy:** suma kontrolna dowodu
  ważna (algorytm §1.3; wagi 7-3-1/7-3-1-7-3, kontrolna = pierwsza
  cyfra) → emit. Precyzja z arytmetyki (dom: „precision comes from the
  arithmetic", `anonymizer.js:320-331`), redukcja kolizji ~10×
  względem samego formatu. Defense-in-depth: blocklista prefiksów
  z pliku danych (`KRS`, `NIP`, `VAT`, `REG`, `PKO`, `BIK`, `KIO`, …)
  – O-HC-3.
- **Ścieżka B – kotwiczona, bez sumy:** w oknie ≤ 40 znaków wstecz
  kotwica `dowod\p{L}* osobist\p{L}*` | `dow\.\s*os\.` | `seri[ai]
  (i|oraz)? ?nr` → emit niezależnie od sumy. Zamyka klasę
  „syntetyczny/OCR-owy numer z zepsutą sumą" – dowód konieczności:
  `BMA 733701` z korpusu (suma nieważna, §1.3) oraz każdy przyszły skan
  z podmienioną cyfrą.

**Wektory testowe (z korpusu, oba warianty zapisu):** `DKR 744829` ✓A✓B,
`DKR744829` ✓A✓B (sklejenie = separator opcjonalny), `BMA 733701` ✗A✓B.
**Kolizje przemyślane:** paszport `EJ 1234567` (2 litery + 7 cyfr) jest
rozłączny kształtem – asercja negatywna w pułapkowniku; akronim + 6 cyfr
(np. skrócony zapis numeru sprawy) – łapany tylko przy 1:10 trafie sumy
I braku na blockliście; wersaliki z polskimi znakami (`ŁÓD 123456`) poza
`[A-Z]` – świadomie (serie dowodów nie zawierają diakrytyków).

### 5.3 R-PJ – prawo jazdy (typ: PERSON_IDENTIFIER, waga 5)

**Format:** `[0-9lO]{5}/[0-9lO]{2}/[0-9lO]{4}` (5/2/4). **WYŁĄCZNIE
z kotwicą** w oknie ≤ 40 znaków wstecz: `praw\p{L}* jazdy` (obejmuje
„prawo/prawa/prawem jazdy"; opcjonalne `nr|numer|seria` między kotwicą
a numerem).

**Dlaczego nie bare, mimo że 5/2/4 wygląda dystynktywnie:** numeracja
faktur i dokumentów księgowych `NNNNN/MM/RRRR` („Faktura VAT nr
12345/07/2024") ma IDENTYCZNY kształt – bare wzorzec maskowałby numery
faktur jako PERSON_IDENTIFIER w każdym piśmie gospodarczym (nowa klasa
FP dokładnie tam, gdzie piwot miał przywrócić czytelność). Daty
(`12/05/2024` – 2/2/4) i sygnatury (`123/22` – jeden ukośnik) odpadają
kształtem, ale faktury NIE. Bare 5/2/4 idzie do rezyduum §2.3 – wraca
tylko, jeżeli pomiar pokaże wycieki bez kotwicy w oknie.
**Wektory:** `92712/00/2780` (kotwica „prawo jazdy nr" w korpusie ✓),
`00123/22/0611` („prawa jazdy nr" ✓). Klaster cyfr NIE koliduje
z PESEL-scanem (ukośnik rozcina klastry – §1.3 triage, wynik kontrolny).

### 5.4 R-TR – tablice rejestracyjne (typ: VEHICLE_IDENTIFIER, waga 4)

**Format:** `[A-Z]{2,3}` + separator? + `[0-9A-Z]{4,5}` z wymogiem
≥ 1 cyfry w sufiksie. **WYŁĄCZNIE z kotwicą** w oknie ≤ 30 znaków
wstecz: `nr\.? rej\.?` | `numer rejestracyjn\p{L}*` | `tablic\p{L}*
rejestracyjn\p{L}*` | `rejestracj\p{L}*`.

**Dlaczego nie bare + whitelista powiatowa (jeszcze):** bez kotwicy
kształt `LLL NNNNN` koliduje frontalnie z kwotami walutowymi
(`CHF 250 000` po zbiciu spacji, `USD 88812`, `PLN 12345`) – w korpusie
frankowym Alana to pułapka o maksymalnej ekspozycji. Whitelista
rzeczywistych prefiksów powiatowych (zamknięta lista publiczna, ~400
pozycji, commit jako dane – air-gap OK) eliminuje `USD`/`PLN`/`CHF`
(brak takich powiatów), ale wymaga: (i) wprowadzenia i utrzymania
listy, (ii) property-testu „whitelista ∩ kody walut ISO-4217 = ∅",
(iii) analizy near-missów (`ELI`, `KRS`…). To realny, mierzalny moduł –
ale dopiero gdy pomiar pokaże wystąpienia tablic BEZ kotwic (O-HC-1).
V1 kotwiczone zamyka zmierzony wyciek (`nr rej. CTR 88812` ✓)
z marginesem bezpieczeństwa zero-FP.

### 5.5 R-EM – e-mail IDN (typ: EMAIL_ADDRESS, waga 4)

**Zmiana klas znaków w `findEmailEntities`** (mechanika expand-around-@
bez zmian, `anonymizer.js:291-318`): część lokalna `[\p{L}\p{N}._+-]`,
domena `[\p{L}\p{N}.-]`, TLD `\p{L}{2,}`, flaga `u`. Pokrywa
`kontakt@przedsiębior.pl` i `bożena.wróblewska@poczta-testowa.pl`
(korpus) bez zmiany zachowania na ASCII (kontrola §1.3). Ryzyko FP:
rozszerzenie WYŁĄCZNIE dodaje dopasowania z literami spoza ASCII wokół
`@` z kropkowym TLD – w polskim tekście prawnym samotne `@` poza
adresami praktycznie nie występuje; pułapkownik bez zmian (brak `@`).

### 5.6 Pułapkownik – korpus pułapek precyzji (dane + test, laptop)

Nowy plik `test-data/traps/h3-pulapki.txt` (dane, nie kod; wartości
syntetyczne lub już obecne w korpusie) + test jednostkowy czysto
regexowy (zero modeli): **asercja 0 trafień R-DOW/R-PJ/R-TR** na:

- sygnatury cytowanych orzeczeń: `II CSKP 975/22`, `III CZP 6/21`,
  `C-260/18`, `I ACa 155/21`, `I C 123/22`, `Km 1234/22`, `KIO 2345/21`;
- daty: `12/05/2024`, `1/2/2024`, `01.02.2023`;
- kwoty: `CHF 250 000,00`, `EUR 5000`, `PLN 12345`, `USD 88812`,
  `88 812,00 zł`;
- numeracja faktur: `Faktura VAT nr 98765/12/2023`, `FV 54321/01/2023`
  (bez kotwicy PJ w oknie) ORAZ wariant złośliwy: zdanie zawierające
  „prawa jazdy" dalej niż 40 znaków przed `12345/07/2024` (test
  długości okna);
- księga wieczysta `TO1T/00012345/6`, `KRS 0000123456`, NIP z korpusu
  `3215669833`, kod pocztowy `60-663`, telefon `+48 566 519 403`,
  adres `ul. Polna 3/5`, `art. 385¹ § 1`, `poz. 1270`;
- paszport `EJ 1234567` bez słowa „paszport" w oknie (asercja: R-DOW
  nie łapie 2L+7D; R-PASZ – jeżeli O-HC-2 na tak – łapie TYLKO
  z kotwicą);
- akronim + 6 cyfr z poprawną sumą dowodu (wektor wyliczony przy
  implementacji) na blockliście – dowód działania blocklisty ścieżki A.

Pułapkownik jest żywym rejestrem: każdy przyszły FP wzorców HC-2
najpierw dostaje linię tutaj (czerwony test), potem poprawkę wzorca.

### 5.7 Kryterium akceptacji HC-2

1. Sześć wartości #1–6 dostaje kandydata `mask` z regexu (test na
   PEŁNYCH zdaniach korpusu, nie na gołych wartościach – kotwice muszą
   zadziałać na realnym kontekście).
2. Pułapkownik: 0 trafień nowych wzorców.
3. Tagowany eval syntetyczny (`npm run eval -- --label=hc2-regex-pack`
   + `eval:score`): recall nie spada, precyzja bez regresji poza
   szumem (podłogi G5 bez zmian); PERSON_IDENTIFIER recall rośnie
   (dev: 4 z 5 FN z §1.2 to formaty HC-2).
4. `npm test` zielone (w tym N1 – dowód, że pakiet nie dotknął
   arbitrażu).

### 5.8 Test dowodzący

Jednostkowe per wzorzec (wektory + pułapkownik + property test sumy
kontrolnej na znanych numerach, w tym oba z korpusu); goldeny HC-1
konsumują kandydatów HC-2 (integracja ogona); eval tagowany jak wyżej.
**Uwaga wykonawcza:** suma kontrolna dowodu – algorytm potwierdzony
w tej sesji na dwóch wektorach korpusu (§1.3); implementacja MUSI
dodać property test na szerszym zbiorze znanych numerów (wektory
z publicznej specyfikacji wzorów dokumentów; jeżeli niedostępne
offline – wystarczą wygenerowane pary poprawna/zepsuta cyfra).

**Koszt:** M (cztery wzorce + dane + pułapkownik + eval).
**Bramka Opusa:** nie jako moduł (dyscyplina eval z nagłówka RECALL-90
§2 obowiązuje); skutki ogląda GATE-H3.

---

## §6. Zależności zewnętrzne na ścieżce bramki (poza zakresem, jawnie)

| # | Zależność | Stan dziś | Co musi się stać | Czyj moduł |
|---|---|---|---|---|
| Z-1 | wpis „Kogut" (+ formy fleksyjne: Koguta, Kogutowi, Kogutem, Kogucie) w `surname-gazetteer.json` | **BRAK wpisu** (sprawdzone §1.3) | jedna pozycja + test, zgodnie z dyscypliną SG-lite „one entry + test per new leak"; edytorska zgoda w trybie O-SG-4 nie blokuje pojedynczego wpisu z rejestru wycieków (rekomendacja O-HC-6) | SG-lite |
| Z-2 | domknięcie `KonradŻurawski` przez OS-1 (despace) | OS-1 scalony; brama proweniencji w eval przechodzi dla `adw_25_ocr_*` (`run.js:103`) | tylko POTWIERDZENIE pomiarem GH-4; jeżeli wyciek przetrwa – wpis do rejestru wycieków OS-1, nie tutaj | OS-1 |

Bez Z-1 zero na holdoucie jest niemożliwe (dokumenty z „Wacław Kogut"
są w korpusie 206). GATE-H3 traktuje Z-1/Z-2 jako warunki wejścia
pomiaru końcowego, nie jako pracę tego projektu.

---

## §7. Plan weryfikacji: laptop-build vs PC-verify

**Laptop (16 GB = podłoga specyfikacji; ZAKAZ pełnego evalu z modelami
– zasada maszyny):**
1. cała budowa HC-0/HC-1/HC-2 + `npm test` (jednostkowe, goldeny,
   pułapkownik, N1 – zero inferencji);
2. `eval:h3 --mode=all-mask-sim` na 49 lokalnych przebiegach
   (2026-07-13…) – reprodukcja „8/8" (kryterium HC-0) i szybki podgląd
   „ile zamyka sam pakiet" (symulacja doszywa kandydatów regex? NIE –
   symulacja czyta gotowe artefakty; podgląd skutków HC-2 na laptopie
   dają wyłącznie testy jednostkowe na zdaniach korpusu – uczciwe
   ograniczenie trybu, wpisane w raport).
3. ŻADNYCH przebiegów `npm run eval` na korpusach adversarial na tej
   maszynie bez uzgodnienia z Alanem.

**PC (RTX 4080S, 32 GB; dyscyplina proces-na-porcję po ~30 dok.,
`bad_alloc` wraca nawet przy 32 GB):**
1. merge HC-* + Z-1 do gałęzi pomiarowej;
2. dev 38: `--allMask=false`, jedna porcja; holdout 206: 7 porcji
   (wzorzec run-idów i higieny z TIERED-RUN-NOTES §2, w tym pułapka
   „jawna lista plików PRZED flagami" i podwójny `tasklist` na
   node.exe);
3. `eval:score`/`eval:score:tiers` (regresje W1/W2) +
   **`eval:h3 --mode=tiered`** na obu korpusach → liczby bramkowe;
4. artefakty gitignorowane zostają na PC; do repo idzie notatka liczb
   (wzorzec TIERED-RUN-NOTES), na jej podstawie werdykt GATE-H3.

**Skażenie strojeniem (jawne):** 8 wycieków pochodzi z dev 38 + wycinki
11 dok. holdoutu; wzorce HC-2 są projektowane pod te FORMATY. Obrona
uczciwości pomiaru: (i) formaty są zamkniętymi wzorami urzędowymi –
generalizacja wynika z definicji formatu, nie z przykładu; (ii) holdout
206 zawiera ~195 dokumentów nieoglądanych podczas projektowania,
z niezależnymi instancjami klas (`hold_identyfikatory_*`); (iii) raport
bramki wymienia dokumenty użyte w triage. Holdoutu NIE regenerujemy
(to robota ST-7b, osobny tor).

---

## §8. GATE-H3 – bramka Opusa (werdykt przed aktywacją)

Zakres przeglądu (jeden werdykt, wszystko naraz):

| # | Przedmiot | Pytanie bramkowe |
|---|---|---|
| GH-1 | HC-0 | czy definicja wycieku (covMask=0 ∧ passHit) i artefakt `pass-dropped.json` domykają pomiar bez dziury (nic z warstwy `pass` nie znika z pola widzenia metryki); czy tryb symulacji jest skutecznie zablokowany jako podstawa werdyktu |
| GH-2 | HC-2 | czy pułapkownik dowodzi zera nowych FP na klasach: sygnatury cytowane, daty, kwoty (CHF/EUR/PLN/USD), numeracja faktur 5/2/4, KW-podróbki (rok-z-przodu, nie realne kody sądów), paszport-bez-kotwicy; czy eval syntetyczny trzyma podłogi G5. **AKTUALIZACJA 2026-07-18 (decyzja Alana „KW nigdy W3"):** realny numer KW jest teraz ŁAPANY przez R-KW jako `LAND_REGISTER_IDENTIFIER` (W1, bare-shape) — pułapkownik dowodzi zera FP na KW-PODRÓBKACH, a nie na realnym KW (to pozytyw, nie FP); stara pułapka `TO1T/00012345/6` przeniesiona do testów pozytywnych R-KW |
| GH-3 | HC-1 | czy goldeny arbitrażu pokrywają wszystkie 6 przypadków regexowych + merge-hazard; czy N1 zielony i czy rozdzielenie N1/N2 jest zapisane w testach |
| GH-4 | pomiar końcowy | dev 38 + holdout 206, tryb tiered: **wycieki H-3 wagi ≥ 4 = ZERO**; wycieki wagi 3 i częściowe wagi 5 przejrzane ręcznie z wpisem do raportu (analogia G4); czysto-FN-y odnotowane jako tor recall (nie blokują TEJ bramki, blokują GATE-RECALL-90) |
| GH-5 | Z-1/Z-2 | czy wpis „Kogut" wszedł ze swoim testem (SG-lite) i czy `KonradŻurawski` znika w pomiarze (OS-1); jeżeli którakolwiek zależność nie domyka – jawna decyzja Alana: bramka warunkowa albo czerwona |
| GH-6 | uczciwość | czy raport wymienia dokumenty triage (skażenie strojeniem §7) i czy liczby przeniesiono notatką z PC zgodnie z konwencją (artefakty poza gitem) |

Werdykt + wpis do `PRODUCT-DECISIONS.md`. **Zielona GATE-H3 = zdjęty
ostatni bloker konstrukcyjny aktywacji `allMask:false`.** Sama decyzja
aktywacji (default produktu, komunikacja) pozostaje decyzją produktową
Alana i tak czy inaczej przechodzi przez warunki GATE-SCOPE (GS-1…GS-6)
dla powierzchni UI/mostu – ten dokument niczego tam nie zmienia.

**Koszt bramki:** S (przegląd + werdykt). **Bramka Opusa: TAK (to ona).**

---

## §9. Rejestry

### 9.1 O-HC – decyzje otwarte dla Alana

| # | Decyzja | Propozycja projektu | Stan |
|---|---|---|---|
| O-HC-1 | R-TR v2: wariant bare + whitelista prefiksów powiatowych (dane w repo) | NIE teraz; wraca wyłącznie, jeżeli GH-4/rejestr wycieków pokaże tablice bez kotwicy kontekstowej; warunkiem property-test „whitelista ∩ ISO-4217 = ∅" | rekomendacja |
| O-HC-2 | R-PASZ: paszport (2 litery + 7 cyfr) kotwiczony `paszport\p{L}*`, bez sumy w v1 | TAK – koszt ~zero przy okazji pakietu, symetryczny do ścieżki B R-DOW; suma kontrolna paszportu dopiero po potwierdzeniu algorytmu (nie zmyślamy arytmetyki) | rekomendacja, czeka na akcept |
| O-HC-3 | blocklista prefiksów dla ścieżki A R-DOW (akronimy: KRS, NIP, VAT, REG, PKO, BIK, KIO…) | TAK, jako dane w `identifier-patterns.json` z komentarzem pochodzenia | rekomendacja |
| O-HC-4 | siatka rezyduum: DOCUMENT_REFERENCE o wysokiej gęstości cyfr kierowany do W2 (kosz) zamiast W3 | NIE w v1 – zmienia semantykę ZAKRES §3 (W3→W2 dla podzbioru) i obciąża kosz; wraca TYLKO przy niezerowym rezyduum po HC-2, jako osobna propozycja zmiany ZAKRES | rekomendacja |
| O-HC-5 | los gałęzi `feature/eval-tiered-run` | scalić po przeglądzie jako bazę HC-0 (flaga `--allMask=false` + `candidates.json` już tam są; `run.js` to ścieżka inferencji – przegląd obowiązkowy, zmiany minimalne); notatkę TIERED-RUN-NOTES przenieść do main | rekomendacja |
| O-HC-6 | wpis „Kogut" od ręki, bez czekania na edytorski przegląd O-SG-4 całej listy | TAK – dyscyplina SG-lite („one entry + test per new leak") istnieje dokładnie po to; O-SG-4 dotyczy masowej rozbudowy, nie wpisu z rejestru | rekomendacja |

### 9.2 R-HC – ryzyka

| # | Ryzyko | Mitygacja |
|---|---|---|
| R-HC-1 | **FP numeracji faktur** (5/2/4) przy przyszłym poluzowaniu R-PJ | kotwica obowiązkowa w kontrakcie; wiersz pułapkownika z fakturą; bare-5/2/4 wolno wprowadzić wyłącznie nową decyzją z nowym pomiarem |
| R-HC-2 | **kolizja walutowa tablic** (CHF/USD/PLN + kwota) | v1 wyłącznie kotwiczone; przy O-HC-1 property-test whitelisty przeciwko ISO-4217 i near-missom |
| R-HC-3 | **ścieżka A R-DOW: losowe 3L+6C przechodzi sumę (~10%)** | blocklista prefiksów (O-HC-3), granice słowa, rzadkość kształtu w pismach; wektor kolizyjny w pułapkowniku |
| R-HC-4 | **OCR: złamanie linii wewnątrz numeru, diakrytyk w serii** | poza v1 (spójnie z R-ST-5); fold l/O w cyfrach jest w kontrakcie; rejestr wycieków łapie resztę |
| R-HC-5 | **pomiar bramkowy tylko na PC, artefakty poza gitem** | procedura §7 (porcje, higiena, notatka liczb do repo); `eval:h3` odmawia trybu tiered bez kompletnych artefaktów |
| R-HC-6 | **skażenie strojeniem zawyża pewność zera** | §7: argument formatu urzędowego + ~195 nieoglądanych dokumentów + jawna lista dokumentów triage w raporcie bramki (GH-6) |
| R-HC-7 | **kandydat mask ginie na progach jakości przed arbitrażem** | poza kontraktem (B6 ust. 1); regexy score 1,0 nieczułe; klasa widoczna w `eval:h3` jako wyciek → kierowana do toru recall (B1/A7) z wpisem w raporcie |
| R-HC-8 | **tryb symulacji użyty jako werdykt** (fałszywe czerwone/zielone) | stempel trybu w `h3-report.json` + twarde ostrzeżenie w nagłówku raportu + pytanie GH-1 |
| R-HC-9 | **merge tier-guard zmniejsza maskowanie względem all-mask** (dawny cross-tier over-mask znika po aktywacji) | dokładnie to mierzy `eval:h3` na przebiegu tiered (kanał = pass-span nad GT-mask); goldeny HC-1 pkt 2; przy niezerowym wyniku – wpis do rejestru i osobna decyzja |

---

## §10. Kolejność, koszty, zależności, bramki

| Krok | Co | Koszt | Zależy od | Bramka |
|---|---|---|---|---|
| HC-0a | `pass-dropped.json` w `run.js` (na bazie eval-tiered-run, O-HC-5) | S | przegląd gałęzi | nie |
| HC-0b | `eval:h3` + goldeny + reprodukcja 8/8 na 49 lokalnych | M | HC-0a (dla trybu tiered) | nie |
| HC-2 | pakiet R-DOW/R-PJ/R-TR/R-EM (+R-PASZ przy O-HC-2) + dane + pułapkownik + eval tagowany | M | – (równolegle z HC-0) | nie |
| HC-1 | goldeny arbitrażu + merge-hazard + zapis N1/N2 | S | HC-2 (kształt kandydatów) | nie |
| Z-1 | wpis „Kogut" + test (moduł SG-lite) | S | O-HC-6 | nie |
| POMIAR | dev 38 + holdout 206 tiered na PC + `eval:h3` + notatka | S (proceduralny) + noc PC | wszystko wyżej | nie |
| GATE-H3 | werdykt GH-1…GH-6 + wpis PRODUCT-DECISIONS | S | POMIAR | **TAK** |

Suma pracy Sonneta: ~2–3 dni robocze + jedna noc pomiarowa na PC.
Kolejność HC-2 ∥ HC-0 jest bezpieczna (rozłączne plikowo: `anonymizer.js`
+ dane vs `src/eval/*`); HC-1 domyka po obu.

---

*Koniec projektu. Następne kroki: (1) decyzje O-HC-1…O-HC-6 Alana –
w szczególności O-HC-5 (los gałęzi eval-tiered-run) i O-HC-6 (wpis
„Kogut"); (2) HC-0 + HC-2 jako pierwsze moduły kodowe (Sonnet, laptop);
(3) pomiar na PC wg §7; (4) GATE-H3. Ten dokument nie zmienia żadnego
przypisania z `ZAKRES-ANONIMIZACJI.md` §3, żadnego kontraktu B1–B6 ani
żadnego warunku GATE-SCOPE – projektuje wyłącznie drogę kanału H-3
do zera.*
