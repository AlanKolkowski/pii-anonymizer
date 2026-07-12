# W1-W3-MORPHOLOGY-DESIGN.md – warstwa morfologiczna weryfikatora (W1, W2, W3)

**Wersja:** 1.0 (specyfikacja wykonawcza dla Sonneta)
**Data:** 2026-07-12
**Autor:** Fable (architekt), sesja 2 projektu weryfikatora
**Status:** PROJEKT. Zero kodu implementacji. W1 czeka na bramkę Opusa (O-3);
W2/W3 bez bramki jako warunku merge (czyste funkcje, bez PII w spoczynku),
wchodzą w przegląd zbiorczy fazy jak W5.
**Rodzic:** `LOCAL-VERIFIER-DESIGN.md` – ten dokument rozwija §3 (fleksja
bez LLM), wiersze W1/W2/W3 z §11 i pozycje O-3/O-9 z §12 do poziomu
wykonywalnego. Niczego z rodzica nie unieważnia.
**Rozstrzygnięcia zamknięte:** `GATE-PHASE0.md` §2 – w szczególności
decyzja 17 (token kanoniczny + opcjonalna anotacja przypadka, zaimplementowana
w `src/tokens.js`) oraz zapowiedź z 2.3, że okno kontekstu „±40" zostanie
potwierdzone albo skorygowane przy pierwszym module czytającym kontekst –
tym modułem jest W3, rozstrzygnięcie w §3.4.
**Dowody wejściowe:** `EVAL-RECALL-AUDIT.md` (gałąź `feature/eval-recall-audit`):
§5.2 (FP na odmienionych rolach), §7.5 (blocklista ról zna tylko mianownik),
moduł A9 planu naprawczego; korpus `test-data/adversarial/` (zdania goldenowe
dla W2/W3 wskazane w §2.8 i §3.6).

**Konwencja:** każdy moduł = kontrakt → kryterium akceptacji → test dowodzący.
Fragmenty JSON to schematy danych i przykłady, nie kod.

---

## §0. Zakres, niezmienniki, granice sesji

### 0.1 Co projektujemy

| Moduł | Rola w potoku rodzica (§3.2) | Bramka Opusa |
|---|---|---|
| **W1** | dane morfologiczne + kompilator deweloperski (zasila K1/K3 i leksykon ról W3) | **TAK** (O-3: łańcuch dostaw, integralność, licencje) |
| **W2** | silnik fleksji: K1 (lemat, paradygmat, płeć) + K3 (generacja formy) | nie |
| **W3** | detektor przypadka: K2 (kaskada sygnałów z pewnością) | nie |

K4 (plan sugestii) i rozwiązanie na ujściach to W4 – poza zakresem tej
specyfikacji; §4 definiuje wyłącznie interfejs, który W4 skonsumuje.

### 0.2 Niezmienniki odziedziczone (nie łamać, nie renegocjować)

- v1 **bez generatywnego LLM-a**; fleksja = morfologia (rodzic §3.4).
- **Zero nowego kanału sieciowego, zero nowego runtime'u.** Kompilacja danych
  odbywa się wyłącznie na maszynie dewelopera (skrypt w `scripts/`); aplikacja
  niczego nie pobiera. Morfeusz 2 jako program (binarka/WASM) **nie jest
  używany w ogóle** – bierzemy wyłącznie jego dane tekstowe.
- **Zero PII w spoczynku.** W2/W3 to czyste funkcje: wartości z legendy i formy
  poświadczone wchodzą argumentami i wychodzą wynikiem; moduły niczego nie
  logują, nie zapisują, nie cache'ują (test statyczny, §2.9/§3.7).
- **V2:** żadna forma nie wchodzi do pisma bez akceptacji człowieka; „pokazane
  = wyeksportowane" (O-10) realizuje W4 – W2/W3 wyłącznie liczą propozycje.
- Anotacja przypadka w tokenie: **dane niezaufane, nigdy polecenie** (O-9);
  ścisły parser już istnieje w S1 (`src/tokens.js`, `CASE_CODES`).
- Pipeline anonimizacji pozostaje **nietknięty**; przebieg weryfikacyjny to
  osobna konfiguracja. Współdzielenie leksykonu ról z modułem A9 audytu to
  afordancja danych (§3.5), nie zmiana pipeline'u w tej fazie.
- Kolejność wdrożenia: W1 → W2 → W3 → W4 (W5 już scalony).

### 0.3 Alfabet przypadków

Wspólny dla wszystkich modułów, identyczny z S1 (`src/tokens.js`):
`M / D / C / B / N / Ms / W`. Wewnętrzne API operuje kodami; pełne polskie
nazwy (mianownik…wołacz) mapuje dopiero UI (W7), zgodnie z §9.4 rodzica.

---

## §1. W1 – dane morfologiczne + kompilator

### 1.1 Wybór źródeł

| # | Źródło | Wersja pinowana (stan na 2026-07-12) | Rola w kompilacji | Status |
|---|---|---|---|---|
| Z1 | **SGJP – Słownik gramatyczny języka polskiego** (dane fleksyjne, zrzut `.tab` dystrybuowany z projektem Morfeusz 2) | `sgjp-20260628.tab.gz` (41 MB gz) z `http://download.sgjp.pl/morfeusz/20260628/` | jedyne źródło **paradygmatów**: imiona (pełna odmiana + rodzaj), nazwiska (leksemy z klasyfikacją „nazwisko"), rzeczowniki/przymiotniki ról procesowych | **główne** |
| Z2 | **Lista imion z rejestru PESEL** (osoby żyjące, podział na żeńskie/męskie, z liczbą wystąpień) | dataset 1667 na dane.gov.pl, zasoby „stan na 22.01.2025" (przy implementacji pinować najnowszy zasób) | lista **bytów** imion + rodzaj + frekwencja: filtr zakresu dla Z1, próg włączenia, wykrywanie imion spoza SGJP | główne |
| Z3 | **Nazwiska z rejestru PESEL** (osoby żyjące, z liczbą wystąpień) | dataset 1681 na dane.gov.pl | frekwencja nazwisk: wybór top-N do słownika wyjątków, sygnał pewności klasyfikacji | pomocnicze |
| Z4 | **PoliMorf** | 0.6.7 (`zil.ipipan.waw.pl/PoliMorf`) albo `polimorf-20260628.tab.gz` z serwera SGJP | **rezerwa**: wyłącznie jeśli pomiar pokrycia (1.7 G-W1-3) wykaże, że nazwiska w SGJP nie wystarczają | nieużywane w v1, dopóki pomiar nie wymusi |

Uzasadnienie „SGJP zamiast PoliMorf" jako źródła pierwszego wyboru: SGJP jest
słownikiem kuratorowanym leksykograficznie (PoliMorf to szersza fuzja o
większym szumie), a **jedno** źródło paradygmatów to najmniejszy łańcuch
dostaw pod O-3. Morfeusz 2 (program) odpada z definicji – potrzebujemy danych,
nie analizatora, a niezmiennik 0.2 zakazuje nowego runtime'u.

Format `.tab` (kolumny: forma, lemat, tag, klasyfikacja nazwy, kwalifikatory)
jest udokumentowany w `Morfeusz2.pdf` na serwerze pobrań; **dokładną semantykę
kolumn i etykiet klasyfikacji („imię", „nazwisko") kompilator przybija testem
na nagłówku pobranego pliku** przy implementacji – nie zakładamy jej z pamięci.

### 1.2 Licencje – WARUNEK WEJŚCIA modułu

Dyscyplina: każde twierdzenie niżej pochodzi z **treści strony/pliku licencji
źródła** (odczyt 2026-07-12), z linkiem. Czego nie potwierdza tekst źródła –
oznaczone `[DO POTWIERDZENIA – LICENCJA ŹRÓDŁA]`. Ostateczna wykładnia
prawna: **Alan** (1.2.5). To nie jest kwestia do Legalisu.

#### 1.2.1 SGJP / dane fleksyjne Morfeusza (Z1) – oraz PoliMorf (Z4)

- **Deklaracja źródła:** strona „Licencja" projektu Morfeusz 2,
  <http://morfeusz.sgjp.pl/doc/license/>. Stwierdza, że program i zawarte
  w nim dane fleksyjne są udostępnione „na tzw. dwuklauzulowej licencji BSD",
  i wymienia właścicieli praw:
  - dane fleksyjne **SGJP**: Zygmunt Saloni, Włodzimierz Gruszczyński,
    Marcin Woliński, Robert Wołosz, Danuta Skowrońska;
  - dane fleksyjne **PoliMorf**: Instytut Podstaw Informatyki PAN;
  - program Morfeusz 2 (nieużywany przez nas): IPI PAN.
- **Potwierdzenie niezależne dla PoliMorf:** strona projektu
  <http://zil.ipipan.waw.pl/PoliMorf> deklaruje dane źródłowe i zasób wynikowy
  na licencji „2-clause BSD".
- **Skutki dla zamkniętego, komercyjnego instalatora:** BSD dwuklauzulowe
  zezwala na redystrybucję w formie binarnej, także odpłatnej i bez otwierania
  kodu, pod warunkiem zachowania noty copyright, listy warunków i wyłączenia
  odpowiedzialności „w dokumentacji lub materiałach towarzyszących".
  Nośnik w naszym artefakcie już istnieje: `THIRD_PARTY_NOTICES.md` jest
  kopiowany do zasobów aplikacji (`electron-builder.yml`, sekcja
  `extraResources`) – wpis z 1.2.4 spełnia warunek noty.
- **Zastrzeżenia:**
  1. `[DO POTWIERDZENIA – LICENCJA ŹRÓDŁA]` Deklaracja mówi o danych
     „zawartych w" dystrybucji Morfeusza; zrzuty `sgjp-*.tab.gz` /
     `polimorf-*.tab.gz` leżą na tym samym serwerze pobrań tego samego
     projektu, więc zachowawczo przyjmujemy, że deklaracja je obejmuje –
     kompilator **wypakowuje plik/nagłówek licencyjny z wnętrza pobranego
     archiwum** i commit'uje go do `scripts/morph/licenses/`; rozbieżność
     treści z powyższą deklaracją = bloker bramki W1.
  2. Strona `sgjp.pl` (interfejs słownika, wyd. IV online, Warszawa 2020)
     sama nie publikuje warunków licencji – kanonicznym miejscem deklaracji
     jest strona Morfeusza wskazana wyżej (sprawdzone 2026-07-12).

#### 1.2.2 Listy imion i nazwisk z rejestru PESEL (Z2, Z3)

- **Deklaracja źródła:** metadane obu zbiorów w portalu otwartych danych,
  pole `license_name`: **„CC0 1.0"**; dostawca: Ministerstwo Cyfryzacji;
  aktualizacja roczna. Strony zbiorów:
  <https://dane.gov.pl/pl/dataset/1667> (imiona, osoby żyjące),
  <https://dane.gov.pl/pl/dataset/1681> (nazwiska, osoby żyjące);
  metadane maszynowe (źródło odczytu):
  <https://api.dane.gov.pl/1.4/datasets/1667> i
  <https://api.dane.gov.pl/1.4/datasets/1681> (pozostałe pola warunków
  licencyjnych puste/null – brak dodatkowych warunków deklarowanych).
- **Skutki:** CC0 1.0 to zrzeczenie się praw w najszerszym możliwym zakresie –
  redystrybucja w produkcie zamkniętym i płatnym bez obowiązku atrybucji.
  Wpis do notices robimy mimo braku obowiązku (identyfikowalność źródeł danych
  wpływających na treść pisma to wymóg O-3, nie licencji).
- **Zastrzeżenia:**
  1. Pliki CSV zasobów nie niosą w sobie tekstu licencji; deklaracja żyje
     w metadanych portalu. Kompilator **archiwizuje zrzut odpowiedzi API**
     (JSON) obok sum kontrolnych w `scripts/morph/licenses/`, żeby stan
     deklaracji z dnia kotwiczenia był odtwarzalny z repo.

#### 1.2.3 Kwestie wykładni zbiorcze

`[DO POTWIERDZENIA – WYKŁADNIA ALANA]` Obie licencje adresują prawo autorskie;
osobną kwestią jest ewentualne prawo sui generis do baz danych po stronie
producentów. CC0 obejmuje je wprost w swojej treści; przy BSD kwestia jest
nieuregulowana literalnie. Do rozstrzygnięcia przez Alana przy bramce W1 –
projekt niczego tu nie przesądza.

#### 1.2.4 Wpisy do `THIRD_PARTY_NOTICES.md` (gotowe wiersze, wchodzą z W1)

Do sekcji nowej „Dane morfologiczne weryfikatora (`src/verifier/morph/data/`)":

| Komponent | Licencja | Pochodzenie |
|---|---|---|
| SGJP – dane fleksyjne (zrzut `sgjp-20260628.tab`), © Zygmunt Saloni, Włodzimierz Gruszczyński, Marcin Woliński, Robert Wołosz, Danuta Skowrońska | BSD-2-Clause | projekt Morfeusz 2, <http://morfeusz.sgjp.pl/doc/license/>; skompilowany podzbiór (imiona, nazwiska, role procesowe) |
| Lista imion występujących w rejestrze PESEL (osoby żyjące) | CC0 1.0 | Ministerstwo Cyfryzacji, <https://dane.gov.pl/pl/dataset/1667> |
| Nazwiska występujące w rejestrze PESEL (osoby żyjące) | CC0 1.0 | Ministerstwo Cyfryzacji, <https://dane.gov.pl/pl/dataset/1681> |
| *(warunkowo, jeśli pomiar 1.7 włączy Z4)* PoliMorf 0.6.7, © IPI PAN | BSD-2-Clause | <http://zil.ipipan.waw.pl/PoliMorf> |

Plus aktualizacja pozycji checklisty **C-PKG-9** (notices obejmują dane
morfologiczne) – zgodnie z rodzicem §10.2.

#### 1.2.5 Checklista decyzji licencyjnych dla Alana (bramka W1)

1. Akceptacja odczytu BSD-2 dla zrzutów `.tab` (1.2.1, zastrzeżenie 1) po
   obejrzeniu wypakowanego pliku licencji z archiwum.
2. Kwestia sui generis (1.2.3).
3. Potwierdzenie, że wpisy 1.2.4 wyczerpują wymóg noty w „materiałach
   towarzyszących" (nośnik: `THIRD_PARTY_NOTICES.md` w `extraResources`).

### 1.3 Łańcuch dostaw i integralność (rdzeń O-3)

Dyscyplina TOFU jak przy B1/C-INT-7/8: **pierwsze** zaufanie jest jawnym,
przeglądanym na bramce aktem kotwiczenia; potem wszystko jest weryfikowalne
offline z repo.

- **Kotwica źródeł:** `scripts/morph-sources.lock.json` – dla każdego źródła:
  nazwa, wersja, dokładny URL, `sha256` pobranego pliku, licencja, link do
  deklaracji licencji, data kotwiczenia. Commit tego pliku = moment przeglądu
  ludzkiego (bramka W1 ogląda go razem z raportem 1.4.4).
- **Pobranie:** `scripts/fetch-morph-sources.mjs` (wzorzec
  `fetch-models.mjs`): pobiera do `scripts/.cache/morph/` (gitignore),
  liczy sumę, **fail-closed przy niezgodności z lockiem**; bez locka odmawia
  (tryb `--anchor` do pierwszego kotwiczenia wypisuje sumy do ręcznego
  przejrzenia i wklejenia). Serwer pobrań SGJP bywa dostępny po zwykłym HTTP –
  transportu **nie** traktujemy jako zaufanego; zaufanie pochodzi z sumy
  zakotwiczonej w repo i przeglądu danych po kompilacji, nie z kanału.
- **Artefakt skompilowany jest commitowany do repo**
  (`src/verifier/morph/data/morph-pl.json`): buduje się deterministycznie
  (1.4.3), więc jego suma jest stabilna; runtime i CI nigdy nie potrzebują
  sieci ani plików źródłowych. Regeneracja to świadomy akt deweloperski
  (fetch + compile + diff raportu w PR).
- **Przegląd danych po kompilacji** (wymóg §6.3 rodzica, wiersz „zatruty
  źródłowy słownik"): kompilator emituje raport czytelny dla człowieka
  (1.4.4), commitowany obok artefaktu; PR z regeneracją danych pokazuje
  diff raportu, nie tylko binarną zmianę JSON-a.
- **Integralność w produkcie:** rozstrzygnięcie miejsca bytowania w 1.5;
  obie gałęzie realizują C-VER-2 (fuse asara albo `manifest.json` +
  istniejący `electron/model-integrity.mjs`, fail-closed).

### 1.4 Kompilacja

#### 1.4.1 Wejścia → filtry → sekcje artefaktu

`scripts/compile-morph-data.mjs` czyta wyłącznie z `scripts/.cache/morph/`
(po pozytywnej weryfikacji sum) i buduje **jeden plik**
`src/verifier/morph/data/morph-pl.json` o sekcjach:

| Sekcja | Z czego | Zawartość | Szacunek rozmiaru (do pomiaru) |
|---|---|---|---|
| `meta` | – | wersja formatu (`morph-pl/1`), wersje źródeł, liczności sekcji, atrybucja | <1 KB |
| `imiona` | Z1 ∩ Z2 | imię → rodzaj(e) + pełny paradygmat lp (7 przypadków); imiona z Z2 nieobecne w Z1 → wpis „byt bez paradygmatu" (rodzaj + frekwencja, K1 flaguje) | rząd setek KB |
| `nazwiska` | Z1 (+ Z3 frekwencja) | **wyłącznie delty względem silnika reguł W2** (1.4.2): leksemy „nazwisko", których paradygmat różni się od przewidywania reguł, w tym warianty (Kozioł: `Kozioła/Kozła`) i alternacje ó:o, ą:ę; wpis = lemat → formy odbiegające | rząd setek KB |
| `role` | Z1 + lista lematów z `src/verifier/case-detector/role-lemmas.js` | pełne paradygmaty lp słów ról procesowych (powód, pozwany, wnioskodawczyni, kredytobiorca…), skompilowane z SGJP – **nie ręcznie** | dziesiątki KB |
| `frekwencja` | Z2, Z3 | kubełkowana (log) częstość imion i top-N nazwisk – sygnał pewności K1 | dziesiątki–setki KB |

Progi włączenia (frekwencja minimalna imienia, N dla nazwisk) są parametrami
kompilatora z wartościami startowymi zapisanymi w locku; kalibruje je pomiar
rozmiaru (1.5) i goldeny pokrycia (1.7) – nie dobieramy ich „na oko" w kodzie.

#### 1.4.2 Kompilator jako poligon reguł: słownik odejmujący

Kluczowa decyzja konstrukcyjna: silnik reguł W2 (`paradigms.js`) jest
importowany przez kompilator i **przepuszczany przez 100% leksemów
nazwiskowych SGJP**. Dla każdego leksemu: reguły przewidują paradygmat,
kompilator porównuje z paradygmatem słownikowym.

- zgodność → leksem **nie wchodzi** do artefaktu (reguły go odtworzą w runtime);
- rozbieżność → leksem wchodzi do sekcji `nazwiska` jako wyjątek;
- wynik zbiorczy → **tabela zgodności per klasa paradygmatu** w raporcie
  (1.4.4). Klasa poniżej progu zgodności (start: 98%) zostaje **zdegradowana
  do „tylko słownik"** w konfiguracji W2 (§2.4) – reguła, która często się
  myli, nie ma prawa generować bez poświadczenia słownikowego.

To jednocześnie: mechanizm minimalizacji rozmiaru, empiryczna walidacja
klas z §2.4 (zamiast mojej deklaracji „ta klasa jest bezpieczna") i test
regresji danych przy każdej regeneracji.

#### 1.4.3 Determinizm i format

- Sortowanie wszystkich kluczy i list, zero znaczników czasu w treści
  (wersje źródeł tak, data kompilacji nie) → **dwukrotna kompilacja z tych
  samych wejść daje plik identyczny bajt w bajt** (test).
- JSON z wbudowanym `JSON.parse` – zero własnych parserów i zero nowych
  zależności runtime; zwartość osiągamy selekcją danych (1.4.2), nie
  formatem binarnym. Jeśli pomiar 1.5 przekroczy próg, najpierw tniemy
  zakres (progi frekwencji), dopiero potem rozważamy zmianę formatu.
- Suma artefaktu zapisana w locku; test CI: suma pliku w repo == lock
  (wykrywa ręczne grzebanie w artefakcie bez regeneracji).

#### 1.4.4 Raport kompilacji (`src/verifier/morph/data/COMPILE-REPORT.md`)

Commitowany, czytelny dla człowieka; sekcje: liczności per sekcja artefaktu;
tabela zgodności reguł per klasa (1.4.2); próbki top-20 wpisów per sekcja;
anomalie (wpisy ze znakami spoza liter polskich, długości skrajne, duplikaty
lematów o sprzecznych rodzajach); rozmiary (surowy/gzip). To jest materiał
przeglądowy bramki i każdego przyszłego PR-a regenerującego dane.

### 1.5 Rozmiar i miejsce bytowania (decyzja pomiarowa zapowiedziana w §7.2 rodzica)

Reguła decyzyjna (mierzy kompilator, zapisuje w raporcie):

| Pomiar `morph-pl.json` (surowy) | Miejsce | Integralność |
|---|---|---|
| ≤ 5 MB (oczekiwane) | bundle renderera/workera (import statyczny) → `app.asar` | fuse `EnableEmbeddedAsarIntegrityValidation` – zero nowych mechanizmów (C-VER-2 wariant a) |
| > 5 MB | `resources/morph/` + wpis w `models/manifest.json` | istniejący `electron/model-integrity.mjs`, fail-closed jak B1 (C-VER-2 wariant b) |
| > 10 MB | STOP: wracamy do cięcia zakresu (progi frekwencji), nie powiększamy artefaktu bez jawnej decyzji | – |

Dodatkowo, niezależnie od miejsca: jeśli surowy rozmiar ≤ 3 MB, dopuszczalne
jest liczenie fleksji na wątku głównym (uproszczenie z §2.3 rodzica);
w przeciwnym razie dane ładuje wyłącznie worker. Web Lock bez zmian.

### 1.6 Kontrakt loadera (`src/verifier/morph/load.js`)

```js
loadMorphData(json) → {
  imiona: Map,            // imię (lower) → { rodzaj: 'm'|'f'|'m/f', paradygmat|null, frek }
  nazwiskaWyjatki: Map,   // lemat → { formy: {D:[…],…}, warianty: bool }
  formaDoLematu: Map,     // indeks odwrotny form (imiona + wyjątki + role) – budowany w pamięci, nie w artefakcie
  role: Map,              // lemat roli → paradygmat lp
  meta: { wersjaFormatu, zrodla }
}
```

- Walidacja twarda na wejściu: zła `wersjaFormatu`, brak sekcji, typ inny niż
  oczekiwany → wyjątek (fail-closed; moduł fleksji zgłasza „dane
  niedostępne", nie zgaduje bez danych).
- Czysta funkcja JSON → struktury; zero I/O w module (import artefaktu robi
  bundler albo – w wariancie `resources/` – istniejąca ścieżka zasobów).
- Indeksy odwrotne liczone przy ładowaniu (koszt pamięci zamiast rozmiaru
  artefaktu).

### 1.7 Kryteria akceptacji i testy dowodzące (W1)

| ID | Kryterium | Test dowodzący |
|---|---|---|
| G-W1-1 | lock istnieje; fetch fail-closed przy złej sumie; bez locka odmawia | test skryptu na spreparowanym pliku o złej sumie |
| G-W1-2 | pliki licencji źródeł wypakowane i commitowane; notices uzupełnione wierszami 1.2.4 | asercja obecności plików w `scripts/morph/licenses/` + przegląd na bramce |
| G-W1-3 | **goldeny pokrycia:** każde imię i nazwisko z listy §1.8 rozwiązuje się w skompilowanych danych: imię → rodzaj + paradygmat; nazwisko → wyjątek słownikowy ALBO klasa regułowa o zgodności ≥ progu ALBO jawna flaga (obce) – nigdy cicha dziura | `morph-data.coverage.test.js` na artefakcie z repo (bez sieci) |
| G-W1-4 | determinizm: podwójna kompilacja bajt w bajt; suma artefaktu == lock | test podwójnej kompilacji (lokalnie, z cache) + test sumy (CI) |
| G-W1-5 | tabela zgodności reguł per klasa w raporcie; klasy poniżej progu wylistowane i zdegradowane w konfiguracji W2 | asercja spójności raport ↔ konfiguracja klas |
| G-W1-6 | pomiar rozmiaru + decyzja bytowania zapisane w raporcie; realizacja C-VER-2 zgodna z tabelą 1.5 | przegląd na bramce; po implementacji test podmiany bajtu (fail-closed) w wariancie wybranym |
| G-W1-7 | zero nowych zależności runtime; loader działa offline z artefaktu w repo | `package.json` diff pusty w `dependencies`; test loadera |
| G-W1-8 | raport kompilacji commitowany i aktualny względem artefaktu | test: hash artefaktu wpisany w raporcie == plik |

### 1.8 Lista goldenowa pokrycia (do G-W1-3)

Z korpusów (syntetyczny + adversarial; wartości w 100% fikcyjne, wolno je
wpisać do testu wprost, z komentarzem wskazującym dokument źródłowy):

- **Imiona:** Konrad, Bartłomiej, Halina, Michalina, Zdzisław, Aniela,
  Barbara, Dobrosława, Marceli, Seweryn, Sebastian, Jan, Anna, Maja.
- **Nazwiska (leksemy i człony):** Żurawski, Grabowski, Kowalski, Czyż,
  Mroczek, Sowińska/Sowiński, Krzemień, Zawadzka/Zawadzki, Odrowąż,
  Pietraszek, Wilk, Kos, Zamek, Baran, Kowal, Lis, Sad, Szczygieł.
- **Role (sekcja `role`, pełny paradygmat):** powód, powódka, pozwany,
  pozwana, wnioskodawca, wnioskodawczyni, uczestnik, uczestniczka, dłużnik,
  dłużniczka, wierzyciel, kredytobiorca, kredytobiorczyni, pożyczkobiorca,
  pełnomocnik, świadek, biegły, komornik, spadkobierca, najemca, wynajmujący,
  zamawiający, wykonawca, oskarżony, pokrzywdzony, podejrzany, obwiniony,
  upadły, sędzia, referendarz, prokurator, notariusz, radca, adwokat, mecenas,
  przewodniczący, ubezpieczyciel, ubezpieczony, poręczyciel, zleceniodawca,
  zleceniobiorca, kredytodawca, pożyczkodawca.

Lista ról jest jednocześnie zawartością startową
`src/verifier/case-detector/role-lemmas.js` (katalog otwarty; §3.2).

### 1.9 Bramka W1 (O-3) – pakiet do przeglądu

`scripts/morph-sources.lock.json` + `scripts/morph/licenses/*` +
`COMPILE-REPORT.md` + diff `THIRD_PARTY_NOTICES.md` + decyzja 1.5 +
checklista 1.2.5. Werdykt bramki obejmuje: łańcuch dostaw (TOFU, transport
HTTP vs kotwica), licencje, miejsce bytowania, jakość danych (raport).

---

## §2. W2 – silnik fleksji (lematyzacja + generacja)

### 2.1 Kontrakt

Katalog `src/verifier/morph/`; wyłącznie czyste funkcje; dane przez parametr
(DI jak `loadModel` w pipeline). Nazwy funkcji nazwane (konwencja debug repo).

```js
// K1 – analiza wartości tokenu
analyzePersonName(value, attestedForms, morph) →
  { status: 'ok',
    slowa: [ { tekst, typ: 'imię'|'inicjał'|'nazwisko'|'człon-nazwiska', … } ],
    rodzaj: 'm'|'f',
    lematM: 'Jan Kowalski',            // pełna wartość sprowadzona do M
    paradygmat: { M:'…', D:'…', C:'…', B:'…', N:'…', Ms:'…', W:'…' } | częściowy,
    wariantywnosc: false|{ przypadek: ['Kozioła','Kozła'] },
    poswiadczoneWgPrzypadka: { D: 'Jana Kowalskiego', … },   // z attestedForms
    zrodloRodzaju: 'imię-słownik'|'nazwisko-przymiotnikowe'|'poświadczone' }
| { status: 'flaga',
    powod: 'obce'|'struktura'|'imię-nieznane'|'rodzaj-niejednoznaczny'
          |'dane-niedostępne',
    szczegol: '…' }

// K3 – generacja formy dla zbioru przypadków z W3
generateForm(analiza, zbiorPrzypadkow /* np. ['D','B'] */) →
  { status: 'ok', forma, przypadek, zrodlo: 'poświadczona'|'słownik'|'reguła',
    regula?: 'przymiotnikowe -ski'|'e-ruchome -ek'|… }
| { status: 'flaga',
    powod: 'przypadek-nieustalony'      // zbiór pusty/null od W3
          |'formy-rozbieżne'            // zbiór >1 przypadka i formy różne
          |'wariantywne'                // źródła dają >1 formę tego przypadka
          |'nie-umiem-odmienić',
    alternatywy: ['…'] }                // zawsze wypełnione przy fladze, jeśli znane

// alternatywy do K4 (menu „wybierz inną formę")
fullParadigm(analiza) → { M:'…', …, W:'…' }   // tylko formy pewne; luki jawne
```

Zasady twarde:

- **Zbiór przypadków, nie pojedynczy przypadek**, jest wejściem `generateForm`:
  jeśli wszystkie przypadki zbioru dają tę samą formę powierzchniową
  (własność D=B męskich z §3.2 rodzica) → jedna propozycja; różne formy →
  flaga `formy-rozbieżne` z alternatywami. To zdejmuje z W3 obowiązek
  sztucznego rozstrzygania nieszkodliwych niejednoznaczności.
- **Zero propozycji przy niepewności** (K1.4 rodzica): każda ścieżka, która
  nie kończy się jednoznaczną formą z audytowalnym źródłem, kończy się flagą
  z `powod` – nigdy „najlepszym strzałem".
- Determinizm: te same argumenty → ten sam wynik (test podwójnego wywołania).

### 2.2 K1: struktura wartości i lematyzacja

Parsowanie `value` (po trim, pojedyncze spacje – wartości legendy są już
znormalizowane przez pipeline):

1. podział na słowa; słowo `X.` (jedna wielka litera + kropka) = inicjał;
   słowo z dywizem = kandydat na nazwisko dwuczłonowe (człony analizowane
   osobno, §2.5);
2. dopuszczalne struktury v1: `[imię]+ [nazwisko]`, `[inicjał]+ [nazwisko]`,
   `[imię]+`, `[nazwisko]` (jednowyrazowa wartość: rozstrzyga słownik imion,
   inaczej traktowana jak nazwisko), `[inicjał]+` (→ flaga `struktura`,
   nieodmienialne automatycznie). Cokolwiek innego (spójniki, ukośniki,
   cyfry, >4 słowa) → flaga `struktura`;
3. **lemat i paradygmat per słowo:**
   - imię: wyłącznie słownik (`imiona`); forma odmieniona → lemat przez
     indeks odwrotny; imię spoza słownika → flaga `imię-nieznane`
     (wpis „byt bez paradygmatu" z Z2 daje rodzaj i pozwala odmienić
     nazwisko, ale imię zostaje nieodmienne + flaga informacyjna);
   - nazwisko: najpierw wyjątki słownikowe (`nazwiskaWyjatki`, przez indeks
     odwrotny), potem klasy regułowe (§2.4, z inwersją reguł dla lematyzacji),
     na końcu flaga;
4. **formy poświadczone pinują lemat** (K1.1 rodzica): każda pozycja
   `attestedForms` jest analizowana tym samym aparatem; jeśli zbiór
   poświadczeń zawiera mianownik – lemat bez zgadywania; poświadczenia
   nieparsowalne (śmieci OCR) są pomijane w pinowaniu (nie blokują analizy,
   trafiają do `poswiadczoneWgPrzypadka` tylko gdy parsowalne);
5. wartość legendy bywa formą zależną („Jana Kowalskiego" jako pierwsze
   wystąpienie) – `lematM` jest wtedy RÓŻNY od wartości legendy i propozycja
   dla kontekstu mianownikowego zastępuje wartość legendy (rdzeń problemu 1
   z §1.1 rodzica; golden 2.8/G12).

### 2.3 Rodzaj (płeć)

Porządek źródeł, pierwszy rozstrzygający wygrywa:

1. słownik imion (wyjątki typu Kuba/Kosma/Barnaba są w danych, nie w regule
   „-a = żeńskie"); przy wielu imionach rozstrzyga **pierwsze**; imię obecne
   w obu listach PESEL (np. Maria jako drugie imię męskie) → patrz p. 2–3;
2. forma nazwiska przymiotnikowego (-ski/-cka/… niesie rodzaj sama w sobie) –
   jedyna ścieżka rodzaju dla struktury `[inicjał]+ [nazwisko]`;
3. jednoznaczne rodzajowo formy poświadczone (np. poświadczone „Halinie
   Mroczek-Sowińskiej" wyklucza męski);
4. brak rozstrzygnięcia albo sygnały sprzeczne → flaga
   `rodzaj-niejednoznaczny`, zero propozycji.

Rodzaj z kontekstu roli („biegły K. Wilk") to informacja W3/W4, celowo
**nieużywana** w v1 (sprzężenie międzymodułowe; odnotowane jako kandydat
v1.1 w §4).

### 2.4 Klasy paradygmatów nazwisk

Klasyfikacja a priori niżej; ostatecznego podziału „reguła vs tylko-słownik"
dokonuje pomiar zgodności kompilatora (1.4.2) – tabela w raporcie W1 ma
pierwszeństwo przed poniższą hipotezą.

| Klasa | Przykład (M → D) | Rodzaj | Status a priori |
|---|---|---|---|
| przymiotnikowe -ski/-cki/-dzki (+ żeńskie -ska/-cka/-dzka) | Żurawski → Żurawskiego; Zawadzka → Zawadzkiej | m/f | **regułowa** (w pełni produktywna) |
| przymiotnikowe pozostałe (-ny/-na, -y/-a, -owy/-owa, męskie -i/-y, -e) | Biegły*; Lange → Langego | m/f | regułowa dla -ny/-owy; -e/-i/-y **preferuj słownik**, reguła z pewnością niską |
| rzeczownikowe męskie twardotematowe | Baran → Barana; Kowal → Kowala; Czyż → Czyża | m | **regułowa** (D/C/B/N); Ms/W przez tabelę palatalizacji (2.4.1) |
| e ruchome -ek | Pietraszek → Pietraszka | m | **regułowa** (produktywna) |
| e ruchome -el/-eł/-ec i alternacje ó:o, ą:ę | Wróbel → Wróbla, ale Kisiel → Kisiela; Kozioł, Gołąb | m | **tylko słownik / wariantywność** – reguła zakazana (niestabilna) |
| męskie na -a / -o | Kozera → Kozery; Matejko → Matejki | m | odmiana rzeczownikowa żeńskopodobna w lp; preferuj słownik, reguła z pewnością niską |
| żeńskie na -a rzeczownikowe | Kozera → Kozerze | f | regułowa z tabelą palatalizacji (2.4.1) |
| **żeńskie nieodmienne** (nazwisko nie na -a, nosicielka kobieta) | Wilk → Wilk; Mroczek → Mroczek | f | **regułowa: tożsamość** (odmienia się tylko imię) |
| obce / niesklasyfikowane | Smith, Müller, Nguyen | – | **flaga, nigdy generacja** (2.6) |

*„Biegły" jako nazwisko odmienia się przymiotnikowo; kolizję nazwisko/rola
rozstrzyga W3 po swojej stronie (span nazwiska jest tokenem, rola stoi POZA
tokenem) – W2 nie zgaduje.

#### 2.4.1 Tabele alternacji (kod, nie dane)

Małe, zamknięte tabele w `paradigms.js`: palatalizacja Ms/W męskich
(twarde → -e z wymianą r→rz, t→ci, d→dzi, ł→l, st→ści…; tylnojęzykowe
k/g/ch → -u; miękkie i historycznie miękkie cz/sz/ż/rz/dż/l/j → -u),
C/Ms żeńskich -a (k→c, g→dz, r→rz, ł→l, t→ci, d→dzi, ch→sze…), N męski
-em/-iem po k/g. Wyłącznie transformacje o stabilnym wyniku; wszystko
poza tabelą → słownik albo flaga. Zgodność tabel mierzy 1.4.2.

### 2.5 Dwuczłonowe, inicjały, imiona wielokrotne

- **Dwuczłonowe z dywizem:** człony analizowane niezależnie, **oba wg płci
  nosiciela**, sklejane dywizem bez spacji. Kobieta: człon rzeczownikowy
  bez -a → nieodmienny, człon -ska → przymiotnikowo („Halinie
  Mroczek-Sowińskiej"); mężczyzna: oba człony odmienne („Zdzisława
  Odrowąża-Pietraszka"). Flaga któregokolwiek członu = flaga całości.
- **Inicjały:** nigdy nie są odmieniane; struktura `[inicjał]+ [nazwisko]`
  odmienia wyłącznie nazwisko i wymaga rodzaju ze źródła 2.3 p. 2–3
  („K. Żurawskiemu" tak; „K. Wilk" bez rodzaju → flaga).
- **Imiona wielokrotne:** każde imię odmienia się wg własnego paradygmatu
  słownikowego („Jana Marii Rokity"); rodzaj osoby z pierwszego imienia.

### 2.6 Nazwiska obce i niesklasyfikowane

Heurystyka ortograficzna (litery spoza alfabetu polskiego: q/v/x i obce
diakrytyki; digrafy nietypowe dla polszczyzny: th/sch/ck/oo/ee…) → od razu
flaga `obce`. W przeciwnym razie: brak w słowniku wyjątków ∧ brak dopasowanej
klasy regułowej → flaga `nie-umiem-odmienić`. Obecność nazwiska na liście
PESEL (Z3) **nie** dowodzi polskiej odmiany (listę noszą też nazwiska obce) –
frekwencja podnosi pewność klasyfikacji, nigdy jej nie zastępuje.

### 2.7 Kolejność źródeł formy (K3) i wariantywność

1. **forma poświadczona całej wartości** dla wymaganego przypadka
   (`poswiadczoneWgPrzypadka`) – użyta dosłownie, `zrodlo: 'poświadczona'`;
   poświadczenia częściowe (samo nazwisko) pinują paradygmat w K1, ale
   w v1 nie są sklejane w formę pełną (kandydat v1.1, odnotowany w §4);
2. **słownik** (paradygmat imienia / wyjątek nazwiskowy);
3. **reguła** klasy o zgodności ≥ progu z 1.4.2;
4. flaga `nie-umiem-odmienić` – nigdy zgadywanie.

Wariantywność (słownik daje >1 formę przypadka – Kozioł→Kozioła/Kozła,
Gołąb→Gołąba/Gołębia): jeśli któraś forma jest poświadczona → ona wygrywa
(dokument źródłowy jest autorytetem, jak każe K3.1 rodzica); bez
poświadczenia → flaga `wariantywne` z oboma kandydatami w `alternatywy`
(pewność w K4 nigdy „wysoka" – zgodnie z definicją pewności rodzica §3.2).

### 2.8 Goldeny W2 (test dowodzący `morph.golden.test.js`)

Zdania i formy z korpusu adversarial (fikcyjne, wpisywane do testu wprost
z komentarzem `// adw_XX`); tabela obowiązkowa, katalog otwarty:

| G | Wejście (value; attested) | Wywołanie | Oczekiwanie |
|---|---|---|---|
| G1 | „Konrad Żurawski"; att. z adw_01: +„Żurawskiego", „Żurawskiemu" | N | „Konradem Żurawskim", źródło reguła/słownik |
| G2 | „Halina Mroczek-Sowińska"; att. z adw_02: +„Haliny Mroczek-Sowińskiej", „Halinie Mroczek-Sowińskiej" | D | „Haliny Mroczek-Sowińskiej", **źródło 'poświadczona'** (pierwszeństwo przed generacją) |
| G3 | jw. | C | „Halinie Mroczek-Sowińskiej", 'poświadczona' |
| G4 | „Michalina Krzemień-Zawadzka"; att. z adw_03: +„Michalinę Krzemień-Zawadzką", „Krzemień-Zawadzkiej" | B | „Michalinę Krzemień-Zawadzką", 'poświadczona' |
| G5 | „Zdzisław Odrowąż-Pietraszek"; bez att. formy D | D | „Zdzisława Odrowąża-Pietraszka", 'reguła' (twardotematowe + e ruchome -ek) |
| G6 | jw. | W | „Zdzisławie Odrowążu-Pietraszku" (por. wołacz poświadczony członu w adw_07) |
| G7 | „Aniela Wilk" (adw_04) | C | „Anieli Wilk" – imię słownik, nazwisko żeńskie nieodmienne |
| G8 | „Barbara Kos" (adw_04) | D | „Barbary Kos" (alternacje imienia r→rz poza D: golden dodatkowy C=„Barbarze Kos") |
| G9 | „Dobrosława Zamek" (adw_07) | N | „Dobrosławą Zamek" – nazwisko-rzeczownik pospolity, żeńskie → nieodmienne |
| G10 | „Seweryn Kowal" (adw_07, att. „Sewerynowi Kowalowi") | C | „Sewerynowi Kowalowi", 'poświadczona' |
| G11 | „Marceli Baran" (adw_07) | D | „Marcelego Barana" – imię męskie -i przymiotnikowo (słownik), nazwisko twardotematowe |
| G12 | value legendy = forma zależna: „Jana Kowalskiego" (por. §1.1 rodzica) | M | „Jan Kowalski" – lematyzacja z indeksu odwrotnego; propozycja ZASTĘPUJE wartość legendy |
| G13 | „K. Żurawski" (adw_06) | C | „K. Żurawskiemu" – inicjał nieodmienny, rodzaj z formy przymiotnikowej |
| G14 | „J. M." (adw_06) | dowolny | flaga `struktura` (nieodmienialne automatycznie), zero propozycji |
| G15 | „K. Wilk" | C | flaga `rodzaj-niejednoznaczny` (inicjał + nazwisko rzeczownikowe) |
| G16 | „John Smith" / „Hans Müller" | C | flaga `obce`, zero propozycji |
| G17 | „Jakub Kozioł", bez poświadczeń | D | flaga `wariantywne`, alternatywy zawierają obie formy słownikowe; z poświadczonym „Kozła" → 'poświadczona' |
| G18 | zbiór przypadków {D,B}, „Konrad Żurawski" | {D,B} | jedna forma „Konrada Żurawskiego" (kolaps D=B męskich) |
| G19 | zbiór {D,C} | {D,C} | flaga `formy-rozbieżne`, alternatywy: obie formy |
| G20 | `fullParadigm` dla G1 | – | komplet 7 przypadków, luki jawne (np. brak W przy klasie bez reguły W) |

### 2.9 Kryteria akceptacji i testy (W2)

| ID | Kryterium | Test |
|---|---|---|
| G-W2-1 | goldeny 2.8 zielone | `morph.golden.test.js` |
| G-W2-2 | zero propozycji przy niepewności: każda flaga z §2.1 osiągalna i pokryta testem; żadna ścieżka nie zwraca formy bez `zrodlo` | testy jednostkowe per flaga |
| G-W2-3 | determinizm: podwójne wywołanie identyczne | test |
| G-W2-4 | czystość: moduły `src/verifier/morph/*.js` bez `console.*`, bez importów sieci/storage/DOM, bez efektów ubocznych | test statyczny nad źródłami (wzorzec C-PERS-7/C-VER-6) |
| G-W2-5 | klasy zdegradowane przez 1.4.2 rzeczywiście nie generują (zwracają flagę) | test konfiguracyjny sprzężony z raportem W1 |
| G-W2-6 | wydajność: pełna analiza + generacja dla 1000 wartości < 100 ms (rząd wielkości; fleksja ma być „milisekundowa" jak w §9.1 rodzica) | test orientacyjny (bez twardego progu CI, log czasu) |

Bez bramki Opusa: moduł nie dotyka kanału, PII w spoczynku ani kontraktu
tokenów; konsumuje go dopiero W4, który bramkę **ma** (O-10) – tam
weryfikowane jest, że propozycje W2 nie omijają decyzji człowieka.

---

## §3. W3 – detektor przypadka

### 3.1 Kontrakt

Katalog `src/verifier/case-detector/`. Wejściem jest **tekst tokenizowany**
(wynik LLM przed substytucją) – W3 z konstrukcji nie widzi żadnego PII
(wartości legendy nie są argumentem żadnej funkcji modułu).

```js
detectCase(text, occurrence, deps) →
  { przypadki: ['C'],                  // zbiór wynikowy (≥1) albo null
    pewnosc: 'wysoka'|'niska',
    sygnaly: [ { rodzaj: 'apozycja-rola'|'przyimek'|'rekcja-czasownika'
                        |'pozycja-podmiotu'|'anotacja-llm',
                 dopasowanie: 'pozwanemu', przypadki: ['C'], offset } ],
    uzasadnienie: 'apozycja: „pozwanemu" (celownik)' }
| { przypadki: null, pewnosc: 'brak',
    flaga: 'nieustalony',              // brak sygnału ALBO sygnały sprzeczne
    sygnaly: [ …zebrane mimo braku rozstrzygnięcia… ] }

// occurrence: { index, rawLength, case? }  – ze skanu W4 po findTokens
//   (S1); case = anotacja z tokenu, jeśli była (pole `case` z findTokens).
// deps: { role: Map z W1 (sekcja `role`), … } – DI, zero własnego I/O.
```

`uzasadnienie` jest gotowym tekstem dla K4/UI (format jak przykład K4
rodzica). Wynik dla tokenów typów nieosobowych jest liczony tak samo
(czysta funkcja); politykę „które typy dostają propozycje" (P-1) egzekwuje
W4, nie W3.

### 3.2 Sygnały kaskady

#### S-A: apozycja do roli procesowej (sygnał mocny)

- Leksykon: `role-lemmas.js` (lista z §1.8) + paradygmaty z sekcji `role`
  artefaktu W1 → **indeks form odmienionych** budowany przy ładowaniu:
  forma → zbiór przypadków (liczba pojedyncza; mnoga poza v1, odnotowane
  w §4). Audyt (§7.5, moduł A9) dowiódł, że mianownik nie wystarcza –
  indeks zawiera WSZYSTKIE formy lp: „kredytobiorcą" → {N},
  „wnioskodawczyni" → {M,D,C,Ms}, „powódce" → {C}.
- Dopasowanie: słowo bezpośrednio przed wystąpieniem tokenu (dozwolone
  wielkie/małe litery; bez przecinka między rolą a tokenem), **wyłącznie
  całe słowo** na granicach słów.
- **Odporność na ucięcia** (dowód „Wniosko" z §5.2 audytu): pomocnicza
  funkcja `isTruncatedRolePrefix(słowo)` – prawda, gdy słowo (≥4 znaki) jest
  właściwym prefiksem którejś formy roli, nie będąc żadną pełną formą.
  Takie słowo NIE jest sygnałem apozycji (i jest eksportowane dla A9,
  §3.5). Przypadek roli = zbiór przypadków dopasowanej formy.

#### S-P: rząd przyimka (sygnał mocny)

Tabela w `prepositions.js`, rozdzielona na jednoznaczne i wieloznaczne:

| Przyimek (w tym wielowyrazowe) | Zbiór |
|---|---|
| dla, do, od, u, bez, wobec, według, oprócz, zamiast, obok, wskutek, na rzecz, w imieniu, ze strony, na podstawie, przy udziale | {D} |
| przeciwko, przeciw, ku, dzięki, wbrew, naprzeciwko | {C} |
| przez | {B} |
| przy | {Ms} |
| z | {D, N} |
| za | {B, N} |
| pod, nad, przed, między, poza | {B, N} |
| o, po, na, w | {B, Ms} |

Dopasowanie: przyimek bezpośrednio przed tokenem ALBO przed łańcuchem
apozycyjnym zakończonym tokenem („od powódki [X]": rekcja {D} nakłada się
na zbiór formy roli). Przyimki wieloznaczne dają zbiór – rozstrzyga
przecięcie z innymi sygnałami albo kolaps form w W2; same nie wystarczają
do pewności wysokiej.

#### S-R: rekcja czasownika prawniczego (sygnał mocny przy przyleganiu, słaby z dystansu)

Leksykon `verbs.js` (katalog otwarty, seed ~30 pozycji): doręczyć+C,
przysługiwać+C, wypowiedzieć+C, zarzucić+C, zaprzeczyć+C, przekazać+C(komu),
pozwać+B, wezwać+B, zawiadomić+B, reprezentować+B, obciążyć+B, zobowiązać+B,
przesłuchać+B, upoważnić+B, zasądzić-od+D, na-rzecz+D… Dopasowanie po
lemacie form czasownikowych **z tego samego leksykonu form** (kompilowane
z SGJP jak role – bez stemowania zgadywanego); odległość ≤ 3 słowa w lewo
w obrębie zdania, bez przyimka po drodze. Przy przyleganiu (odległość ≤1) –
sygnał mocny; dalej – słaby.

#### S-M: pozycja podmiotu (sygnał słaby)

Token na początku zdania + forma osobowa czasownika w ≤3 słowach po tokenie →
{M}. Wyłącznie słaby (za dużo wyjątków w prozie prawniczej).

#### S-T: anotacja przypadka z tokenu (sygnał niezaufany, O-9)

- Parsowanie wyłącznie przez S1 (`findTokens` → pole `case`); śmieciowa
  anotacja nie jest tokenem w ogóle – gwarancja gramatyki, nie W3.
- Semantyka głosu (dokładnie §3.6 rodzica):
  - **zgodna** z sygnałami strukturalnymi (należy do ich przecięcia) →
    zawęża zbiór i **podnosi pewność** (może współtworzyć „wysoką");
  - **sprzeczna** (przecięcie z sygnałami strukturalnymi puste) →
    `nieustalony`; W4 z tego zbuduje flagę pokazującą obie formy
    (strukturalną i anotowaną) do decyzji człowieka;
  - **samotna** (żadnego sygnału strukturalnego) → zbiór {anotowany},
    pewność co najwyżej **'niska'** – anotacja nigdy samodzielnie nie
    wytwarza pewności wysokiej (dane niezaufane nie wchodzą do akceptacji
    zbiorczej, która obejmuje wyłącznie „wysokie" – §9.2 rodzica).

### 3.3 Algebra łączenia i definicja pewności

1. Zbierz sygnały w oknie (3.4); każdy ma zbiór przypadków.
2. **Przecięcie sygnałów mocnych** (S-A, S-P, S-R przyległe). Puste
   przecięcie → `nieustalony` (sprzeczność strukturalna).
3. Sygnały słabe (S-R z dystansu, S-M) i S-T zawężają wynik kroku 2;
   jeśli zawężenie daje zbiór pusty → traktuj jak sprzeczność →
   `nieustalony` (nigdy „mocny wygrywa po cichu": konflikt = człowiek).
4. Brak jakiegokolwiek sygnału → `nieustalony` (flaga „przypadek
   nieustalony", zachowanie jak dziś – ostatni wiersz kaskady rodzica).
5. **Pewność `wysoka`** ⟺ w wyniku uczestniczy ≥1 sygnał mocny ∧ zbiór
   wynikowy jest jednoelementowy ∧ zero konfliktów po drodze.
   Wszystko inne z niepustym zbiorem → `niska`. (Kolaps form przy zbiorze
   wieloelementowym pozostaje w W2/W4: W3 raportuje zbiór uczciwie.)

### 3.4 Okno kontekstu (rozstrzygnięcie zapowiedziane w GATE-PHASE0 §2 poz. 2.3)

W3 jest „pierwszym modułem czytającym kontekst", więc niniejszym
doprecyzowuję: okno W3 = **bieżące zdanie** wystąpienia, wyznaczane
heurystyką interpunkcyjną (kropka/średnik/dwukropek przed cudzysłowem
otwierającym/nowa linia), **przycięte do 200 znaków w lewo i 80 w prawo**
od granic wystąpienia (sygnały przypadka w polszczyźnie stoją niemal
wyłącznie w lewo; prawa strona służy S-M). Inne tokeny wewnątrz okna są
nieprzezroczyste: nie są słowami, nie niosą sygnałów (rola ukryta w tokenie
`[PERSON_ROLE_OR_TITLE_n]` nie jest sygnałem – uczciwy `nieustalony`
zamiast zgadywania). Okno ±40 z `resolveReplacement` pozostaje bez zmian
(inny mechanizm: inwalidacja decyzji, nie detekcja) – zapis do §2.3 GATE
przy najbliższej aktualizacji dokumentów: „potwierdzone dla substytucji,
W3 używa własnego okna zdaniowego".

Zero zależności od `sentencex` (segmenter pipeline'u): heurystyka
interpunkcyjna wystarcza dla sygnałów przyległych, a W3 nie może dołożyć
wagi runtime do wątku, na którym postawi go W4.

### 3.5 Dowody z audytu rozwiązane wprost + afordancja dla A9

| Dowód (EVAL-RECALL-AUDIT §5.2/§7.5) | Rozwiązanie w tym projekcie |
|---|---|
| „Kredytobiorcą" (narzędnik) niewidoczne dla logiki znającej mianownik | indeks form ról kompilowany z paradygmatów SGJP: „kredytobiorcą"→{N}; golden 3.6/H8 („zawarta z Kredytobiorcą [X]" → N wysoka) |
| „Wnioskodawczyni" (forma wieloznaczna M/D/C/Ms) | zbiory przypadków zamiast pojedynczego przypadka; rozstrzyga przecięcie z innym sygnałem albo kolaps form (H9) |
| ucięte „Wniosko" | `isTruncatedRolePrefix`: prefiks właściwy formy roli nie jest sygnałem (H10); funkcja eksportowana |
| blocklista ról pipeline'u zna tylko mianownik (moduł A9 audytu) | **afordancja, nie zmiana pipeline'u:** `role-lemmas.js` + indeks form + `isTruncatedRolePrefix` są tak umiejscowione (czyste moduły bez zależności od weryfikatora), żeby A9 – wdrażany na gałęzi audytu – mógł je zaimportować zamiast dublować dane; sam import wykona A9, nie W3 |

### 3.6 Goldeny W3 (test dowodzący `case-detector.golden.test.js`)

Zdania z adw_02 i syntetyczne, z tokenami w miejscach nazwisk (teksty
fikcyjne, wpisane wprost z komentarzem źródłowym):

| H | Tekst (fragment) | Oczekiwanie |
|---|---|---|
| H1 | „…wezwanie doręczone pozwanemu [PERSON_NAME_1] w dniu…" (adw_02) | {C}, wysoka; sygnały: apozycja „pozwanemu" + rekcja „doręczone" |
| H2 | „…roszczenie powódki [PERSON_NAME_2] uległo przedawnieniu." (adw_02) | {D}, wysoka (apozycja „powódki", lp) |
| H3 | „Powódce [PERSON_NAME_2] doręczono odpis sprzeciwu." (adw_02) | {C}, wysoka |
| H4 | „Pozwany [PERSON_NAME_1] wnosi o oddalenie powództwa…" (adw_02) | {M}, wysoka (apozycja {M} + podmiot) |
| H5 | „przeciwko [PERSON_NAME_1]" | {C}, wysoka (przyimek jednoznaczny) |
| H6 | „na rzecz [PERSON_NAME_3]" | {D}, wysoka (przyimek wielowyrazowy) |
| H7 | „z [PERSON_NAME_1]" (bez innych sygnałów) | {D,N}, niska (zbiór uczciwie wieloelementowy) |
| H8 | „umowa zawarta z Kredytobiorcą [PERSON_NAME_3]" | {N}, wysoka (przecięcie z{D,N} ∩ rola{N}) – **dowód A9** |
| H9 | „Wnioskodawczyni [PERSON_NAME_4] nabyła spadek…" (por. adw_03) | {M}, wysoka (rola{M,D,C,Ms} ∩ podmiot{M}) |
| H10 | „Wniosko [PERSON_NAME_4]" (ucięcie) | nieustalony (prefiks roli odrzucony, brak sygnału) |
| H11 | „przeciwko [PERSON_NAME_1\|D]" | **nieustalony** (struktura C vs anotacja D; obie w `sygnaly`) |
| H12 | „doręczyć [PERSON_NAME_1\|C]" | {C}, wysoka (anotacja zgodna podnosi pewność rekcji) |
| H13 | „[PERSON_NAME_1\|D] …" (anotacja bez żadnego sygnału strukturalnego) | {D}, **niska** (niezaufany głos nigdy sam nie daje wysokiej) |
| H14 | „[PERSON_NAME_1] wnosi o zasądzenie…" | {M}, niska (sam podmiot) |
| H15 | „zgodnie z art. 385 k.c. [PERSON_NAME_1]" | nieustalony (przyimek nie przylega do tokenu; szum prawny nie jest sygnałem) |
| H16 | „pełnomocnikowi powoda [PERSON_NAME_5]" | {D}? NIE: apozycja przylegająca „powoda"{D,B} ∩ … → {D,B}, niska (kolaps D=B męskich wykona W2; test przybija, że W3 nie zgaduje) |
| H17 | tekst bez tokenu / occurrence poza tokenem | wyjątek kontraktowy (błąd wywołania, nie cichy wynik) |
| H18 | „…Zamek [PERSON_NAME_6]…" (rzeczownik pospolity niebędący rolą przed tokenem) | brak sygnału apozycji (leksykon ról zamknięty; nie każdy rzeczownik to rola) |

Plus test integracyjny z S1: goldeny H11–H13 konstruowane przez
`findTokens` (anotacja przechodzi ścisłym parserem; `[PERSON_NAME_1|X]`
w ogóle nie jest tokenem – test dziedziczony z S1, tu tylko przywołany).

### 3.7 Kryteria akceptacji i testy (W3)

| ID | Kryterium | Test |
|---|---|---|
| G-W3-1 | goldeny 3.6 zielone | `case-detector.golden.test.js` |
| G-W3-2 | sprzeczność ⇒ zawsze `nieustalony` (property: dla każdej pary sygnałów o pustym przecięciu wynik ma flagę) | test tabelaryczny nad kombinacjami sygnałów |
| G-W3-3 | anotacja: nigdy `wysoka` bez sygnału strukturalnego; sprzeczna nigdy nie wygrywa | testy H11–H13 + property |
| G-W3-4 | czystość i brak PII: moduł nie importuje legendy/substytucji (poza `tokens.js`), zero `console.*`, zero I/O | test statyczny nad źródłami |
| G-W3-5 | leksykon ról: każda forma lp każdego lematu z `role-lemmas.js` obecna w indeksie (spójność z sekcją `role` artefaktu W1); `isTruncatedRolePrefix` odrzuca prefiksy, akceptuje pełne formy | test spójności danych |
| G-W3-6 | okno: sygnał spoza okna nie wpływa na wynik (test z rolą za granicą zdania) | test jednostkowy |
| G-W3-7 | determinizm | test podwójnego wywołania |

Bez bramki Opusa: czysta funkcja na tekście tokenizowanym; jedyny punkt
styku z materią bramkową (anotacja O-9) jest skonsumowany zgodnie
z semantyką zatwierdzoną w rodzicu §3.6 i zweryfikowany zostanie przy
bramce W4 (plan substytucji, O-10) – patrz §5.

---

## §4. Interfejs do W4 i granice zakresu

Co W4 dostaje od tej warstwy (i nic więcej):

```
analiza  = analyzePersonName(legend[token], attested[token], morph)
wykrycie = detectCase(outcomeText, occurrence, { role })
forma    = generateForm(analiza, wykrycie.przypadki)
plan[wystąpienie] = { current, proposed: forma.forma, case, confidence,
                      rationale: wykrycie.uzasadnienie, alternatives: fullParadigm(analiza) }
```

Reguły składania (własność W4, zapisane tu dla jednoznaczności granicy):
pewność „wysoka" planu wymaga `wykrycie.pewnosc === 'wysoka'` **i**
`forma.zrodlo ∈ {poświadczona, słownik, reguła}` bez flag `wariantywne` –
dokładnie definicja K4 rodzica. Flagi W2/W3 mapują się na sugestie „niskie"
albo czyste flagi informacyjne bez propozycji.

**Poza zakresem v1 tej warstwy** (kandydaci v1.1, świadomie odłożeni):
sklejanie form pełnych z poświadczeń częściowych (2.7 p. 1), rodzaj
z kontekstu roli (2.3), liczba mnoga ról (S-A), miejscowości (`LOCATION`,
P-1 rodzica), użycie frekwencji do rankingu alternatyw w UI.

---

## §5. Wpływ na rejestr §12 rodzica i pozostałe dokumenty

Zmiany wprowadzane **tą sesją** do `LOCAL-VERIFIER-DESIGN.md` §11/§12
(dopiski, zero zmian werdyktów):

- **§11, wiersze W1/W2/W3:** odsyłacz „specyfikacja wykonawcza:
  `W1-W3-MORPHOLOGY-DESIGN.md`".
- **§12, O-3:** doprecyzowanie propozycji projektu: źródła wybrane
  (SGJP + listy PESEL; PoliMorf rezerwowo), licencje ustalone z treści
  źródeł (§1.2 tego dokumentu, z markerami do potwierdzenia na bramce),
  mechanizm: lock + fail-closed fetch + artefakt commitowany + raport
  przeglądowy. Werdykt pozostaje przy bramce W1.
- **§12, O-9:** adnotacja o stanie: część „ścisły parser" zamknięta
  w fazie 0 (decyzja 17, `GATE-PHASE0.md` §2 poz. 2.1–2.2, `src/tokens.js`);
  część „tylko głos w kaskadzie, nigdy polecenie" – skonkretyzowana w §3.2
  S-T/§3.3 tego dokumentu, do weryfikacji razem z bramką W4 (via O-10).

Bez zmian w: SECURITY-CHECKLIST (C-VER-2 realizowany przez 1.5, treść
pozycji bez zmian), THREAT-MODEL (A10 opisany, mitygacje zgodne),
`THIRD_PARTY_NOTICES.md` (wiersze wchodzą dopiero z implementacją W1 –
gotowiec w 1.2.4). Rekomendacja R3 audytu (checkery) nie dotyczy tej
warstwy.

## §6. Kolejność implementacji i definicja ukończenia

1. **W1a:** `role-lemmas.js` + lock + fetch + kompilator + artefakt + raport
   + goldeny pokrycia → **bramka Opusa (O-3)** na pakiecie 1.9.
2. **W1b (po bramce):** wpisy notices, realizacja wariantu bytowania z 1.5.
3. **W2:** `paradigms.js` (użyty już przez kompilator w W1a – implementowane
   razem, testowane osobno) → `analyze.js` → `generate.js` + goldeny 2.8.
4. **W3:** `prepositions.js`, `verbs.js`, indeks ról, `detect.js` + goldeny 3.6.
5. Merge W2/W3 bez bramki jako warunku, w przeglądzie zbiorczym fazy
   (jak W5 w fazie 0); `npm test` w całości zielony; **zero zmian**
   w `src/pipeline/**` (eval nie jest wymagany, bo pipeline nietknięty –
   asercja w PR).

Ukończona warstwa = W4 może budować plan substytucji wyłącznie z kontraktów
§2.1/§3.1/§4, bez sięgania do wnętrz modułów.

---

*Koniec specyfikacji. Następny krok: bramka Opusa nad pakietem W1 (1.9,
z checklistą licencyjną 1.2.5 dla Alana), potem implementacja wg §6.*
