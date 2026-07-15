# SURNAME-GAZETTEER-DESIGN.md – gazeter nazwisk pospolitych (moduł SG)

Status: projekt (zero kodu). Autor: Fable (architekt). Data: 2026-07-15.
Wzorzec formatu: moduł B4, RECALL-90-DESIGN.md §2.4 (diagnoza → kontrakt →
kryterium akceptacji → test dowodzący → koszt → bramka).

## §1. Diagnoza i zakres

**Zmierzony problem (holdout):** pełne wycieki wagi 4 to nazwiska będące
wyrazami pospolitymi – „Osioł", „Wrona", „Pszczoła", „Dzięcioł", „Głowacka".
Model (multilang-fp32, jedyne modelowe źródło PERSON_NAME w
`entity-sources.js`) bierze je za rzeczownik i milczy. To luka nr 2
z ZAKRES-ANONIMIZACJI.md §5 (~10 FN z ~135 braków W1); tamże wskazani
kandydaci: gazeter nazwisk, heurystyka slotu składniowego, B1.

**Poza zakresem tego dokumentu:** luka nr 1 z ZAKRES §5 – rozstrzelony OCR
(„W r ó b l e w s k a"), klasa C1. To osobny, DUŻY projekt companion
(warstwa mapowania offsetów: tekst znormalizowany ↔ oryginał, bo żaden
matcher tokenowy nie zobaczy nazwiska rozciętego spacjami co znak; dotyka
segmentacji, spanów i legendy naraz). Świadomie odłożony – nie mieści się
w budżecie i nie dzieli mechaniki z SG. Holdout mierzy go uczciwie dalej
(podklasa OCR 40 encji, RECALL-90 §3.3).

**Niecel:** SG nie jest ogólnym detektorem nazwisk. Nazwiska „nazwiskowate"
(Kowalski, Brzozowski) model łapie – holdout nie wykazał tam luki. SG domyka
wyłącznie klasę kolizyjną: nazwisko ∩ wyraz pospolity (plus derywaty
przymiotnikowe od pospolitych rdzeni typu „Głowacka", które model gubi
z tego samego powodu). Stąd lista kolizyjna, nie pełna lista PESEL – patrz
§2.2 pkt 1 (uzasadnienie kosztem).

## §2. Moduł SG – gazeter nazwisk jako źródło detekcji PERSON_NAME

### 2.1 Zasada: gazeter bez warstw to albo nadmaskowanie, albo nic

Force-mask każdego „Wrona" nadmaskowuje (ptak, ulica, początek zdania);
ignorowanie dwuznacznych wraca do status quo (pełny wyciek). Model
trójwarstwowy (`type-tiers.js`, SCOPE-TIERS-DESIGN.md) daje trzecie ujście:

- match **jednoznaczny** (slot składniowy §2.3) → PERSON_NAME, warstwa
  efektywna `mask` (W1) – jak każda encja tego typu;
- match **dwuznaczny** (forma kolizyjna z wielkiej litery, bez slotu)
  → PERSON_NAME z per-encyjną flagą `forceTier: 'review'` → kosz W2,
  decyzja radcy zamiast decyzji maszyny;
- forma pisana małą literą → **nigdy nie emitowana** (to rzeczownik).

Mechanizm per-encyjny już istnieje w kontrakcie ST-2 (§3.2 pkt 1
SCOPE-TIERS-DESIGN.md): allowlista sygnatur ST-5 nadaje `forceTier: 'mask'`.
SG używa tej samej flagi w drugą stronę. Jedyna delta kontraktu ST-2:
efektywna warstwa = `entity.forceTier ?? tierFor(entity_group)`, a dziedzina
flagi rośnie o wartość `'review'`. Delta wchodzi do GS-5 (bramka GATE-SCOPE
oceniająca ST-2) – oba dokumenty aktualizowane razem, dyscyplina jak
TYPE_TIERS ↔ ZAKRES.

### 2.2 Kontrakt

1. **Dane – lista kolizyjna, nie pełna lista PESEL.** Plik
   `src/pipeline/data/surname-gazetteer.json` (dane w pliku, nie w kodzie –
   wzór `role-lexicon.json`). Zawartość: ~300–500 lematów nazwisk
   kolizyjnych z wyrazami pospolitymi (fauna, flora, przedmioty, zawody,
   kalendarz, derywaty przymiotnikowe od pospolitych rdzeni). Uzasadnienie
   kosztem przeciw pełnej liście (rząd setek tysięcy form × odmiana):
   dziesiątki–setki MB struktur w runtime na podłodze sprzętowej 16 GB RAM
   obok dwóch modeli ONNX, zalew kosza W2 kandydatami-śmieciami (każde
   wielkoliterowe słowo bywa czyimś nazwiskiem), a zmierzona luka leży
   w całości w przecięciu kolizyjnym. Schemat wpisu (kontrakt danych):
   ```
   { lemma: 'Wrona',
     forms: ['Wrona','Wrony','Wronie','Wronę','Wroną'],   // ręcznie, z wariantami (Kozioł: Kozioła/Kozła)
     freq: 4,            // kubełek log10 nosicieli wg PESEL (Z3) – dowód, że wpis JEST nazwiskiem
     slotOnly: false }   // true = hiperkolizyjne, patrz pkt 5
   ```
2. **Źródło danych i licencja (lite).** Wpisy spisywane ręcznie; obecność
   i frekwencja nazwiska weryfikowane w datasecie 1681 dane.gov.pl
   („Nazwiska występujące w rejestrze PESEL osób żyjących", Ministerstwo
   Cyfryzacji, **CC0 1.0** – licencja potwierdzona u źródła w
   W1-W3-MORPHOLOGY-DESIGN.md §1.2.2, wpis do THIRD_PARTY_NOTICES.md jak
   tam zaprojektowano). Formy fleksyjne układa człowiek (nie kopiuje
   z SGJP), więc lite nie dotyka licencji BSD-2 ani łańcucha dostaw:
   dane ręczne w repo, zero pobierania w build i runtime – dokładnie
   sytuacja B3/B4-lite („bez bramki Opusa").
3. **Dwustopniowość (wzór B4-lite/B4-full).**
   - **SG-lite (od razu):** ręczna lista z pkt 1. Rozszerzana z rejestru
     przecieków (jak blocklisty A9): każdy nowy przeciek nazwiska
     pospolitego = nowy wpis + test.
   - **SG-full (po bramce O-3 morfologii):** lista kompilowana w build-time:
     pełny PESEL (Z3, CC0) × sito pospolitości z SGJP (leksem istnieje jako
     nie-nazwisko) → wpisy kolizyjne; formy fleksyjne z paradygmatów
     `morph-pl.json` (sekcja `nazwiska`, jeden słownik prawdy – trzeci
     konsument po B4-full i A9, zapowiedziany wzorzec). Do tego czasu
     duplikacja ręczna jest świadoma i mała.
4. **Rejestracja źródła.** `SOURCES` dostaje alias
   `'gazetteer': { kind: 'gazetteer' }`;
   `ENTITY_SOURCES.PERSON_NAME` = `['multilang-fp32', 'case-folded',
   'gazetteer']`. Bez wpisu `sourceFilterStep` wycina każdego kandydata
   niezależnie od score (ta sama racja, co komentarze B3/B4 w
   `entity-sources.js`); nie polegamy na siatce A8, wpis jest jawny.
   Osobny alias (nie współdzielony `'lexicon'`) – bo inna semantyka
   (case-sensitive, warstwowość) i osobny pomiar per źródło w eval;
   `resolveActiveSources` dostaje gałąź `kind: 'gazetteer'` analogiczną
   do `lexicon`. `thresholdBySource` bez zmian (score 0,95 > próg 0,5
   PERSON_NAME; per-źródłowy próg zbędny).
5. **Matching (krok `gazetteerStep`, faza `ner`, po modelach, obok
   `lexiconStep`).**
   - Dopasowanie **pełnotokenowe** po formach z pliku, granice `\p{L}`
     lookaround jak `lexicon.js` (nie `\b`, diakrytyki). Zalecenie
     wykonawcze (nie kontrakt): lookup `Map<forma, wpis>` po tokenach
     zamiast tysięcy regexów – budżet wydajności pkt 9.
   - **Case-SENSITIVE w dół:** emisja wyłącznie dla form title-case
     („Wrona") i all-caps („WRONA", komparycje – terytorium wspólne z B2,
     dedup same-type rozstrzyga zwykłą ścieżką). Małe litery: nigdy.
     To odwrotność decyzji case-insensitive z `lexicon.js` – tam literalny
     match roli nie traci znaczenia po zmianie wielkości liter, tu wielka
     litera JEST sygnałem onimiczności.
   - **Początek zdania bez slotu: brak emisji** (v1). Wielka litera na
     starcie zdania nic nie mówi („Wrona siedziała na płocie."), a granice
     zdań są znane z fazy segment. Koszt tej decyzji (FN typu „Wrona wniósł
     apelację.") mierzony na holdoucie, domykany w SG-full (morfologia da
     tańsze sygnały). Świadome FN zamiast szumu kosza.
   - **Wpisy `slotOnly: true`** (hiperkolizyjne: Maj, Sobota, Środa,
     Listopad… – kolizje kalendarzowo-uliczne typu „ul. 3 Maja") emitują
     wyłącznie ze slotem; solo nawet nie proponują review.
   - **Nazwiska dwuczłonowe:** match członu przylegający do dywizu
     rozszerza span na drugi wielkoliterowy człon (także spoza listy);
     jeden kandydat, całość spanu (wzór B4 pkt 4: całe tytuły wielowyrazowe).
6. **Slot składniowy – zamknięta lista wzorców (dane w pliku, sekcja
   `slots`).** Slot = bezpośrednie sąsiedztwo (separator ≤ 3 znaki
   biało-interpunkcyjne, bez przekraczania granicy zdania):
   - **S1 imię** przed lub po („Anna Wrona", „WRONA Jan"): lista imion
     z rejestru PESEL (dataset 1667, CC0, ten sam tryb co pkt 2), top ~1500
     mianowników wg frekwencji, skompilowana do repo (dziesiątki KB) –
     decyzja O-SG-2; span emisji obejmuje imię i nazwisko (szerszy span
     wygrywa arbitraż dedupu przy zbliżonym score, co naturalnie skleja
     granice zamiast konkurować z modelem);
   - **S2 inicjał** przed („J. Wrona"); span obejmuje inicjał;
   - **S3 tytuł/rola zawodowa** przed: Pan/Pani + odmiana, skróty i role
     wykryte przez B4 (sąsiedztwo encji PERSON_ROLE_OR_TITLE zakończonej
     tuż przed kandydatem – reuse, nie druga lista); span: samo nazwisko
     (rola zostaje osobną encją, rozłączność spanów);
   - **S4 rola procesowa** przed, z sekcji `nonEntity` `role-lexicon.json`
     („Pozwany:", „Powód", „wnioskodawca…") – reuse blocklisty A9 jako
     sygnału pozytywnego dla SĄSIADA, sama rola dalej nie-encją;
   - **S5 frazy funkcyjne:** „reprezentowany/-a przez", „w imieniu",
     „przeciwko", „z powództwa" (lista zamknięta w pliku).
   Slot → emisja bez `forceTier` (efektywna warstwa `mask` z
   `tierFor('PERSON_NAME')`). Brak slotu → `forceTier: 'review'`.
   Slot działa wyłącznie nad formami z listy – NIE emituje dla słów spoza
   gazetera (v1; „Pozwany Bank Millennium" zostaje nietknięty; ogólna
   detekcja slotowa spoza listy = rozszerzenie odłożone, O-SG-5).
7. **Score i dedup.** `score: 0.95` – dokładnie racje `LEXICON_SCORE`
   z `lexicon.js`: nie 1,0 (regex-tier wygrywa nakładki bez względu na
   szerokość spanu i eksmituje szersze, poprawne spany modelu – zmierzona
   regresja B4), w oknie `DEDUP_SCORE_EPSILON` względem 0,85–0,999 modelu,
   więc nakładki idą gałęzią „bliskie score → szerszy span". Skutki
   w warstwach (H-1, ST-2 §3.2 pkt 3): kandydat `review` nakładający się
   z modelową encją `mask` przechodzi dedup nietknięty i jest usuwany
   z kosza w partycji (znaki już ukryte – zero szumu); kandydat `mask`
   ze slotu arbitrażuje z modelem normalnie (same-tier, same-type).
8. **Backfill i koreferencja.** Encja SG (mask) jest zwykłą PERSON_NAME:
   `fuzzyBackfill: true` dosiewa wystąpienia. Jednego NIE obiecujemy:
   że `couldBeSamePerson` dosieje formy odmienione nazwisk
   rzeczownikowych (rdzenie porównywane ściśle) – dlatego formy fleksyjne
   są w pliku danych (pkt 1), a skuteczność dosiewu tylko MIERZYMY.
   Kandydaci `review` nie są seedem backfillu (dosiew z niezatwierdzonej
   hipotezy mnożyłby szum; agregację wystąpień robi `valueKey` w koszu).
9. **Więzy wykonawcze.** Air-gap: dane w repo, zero sieci w build
   i runtime. Budżet czasu kroku: nieodróżnialny w bench (< ~50 ms/dok
   na podłodze sprzętowej). Krok samowyłączalny flagą `active` jak
   `createLexiconStep(active)` – do czasu wejścia ST-2 do main emisja
   `review` jest wyłączona (kandydat bez kosza nie ma ujścia), emisja
   slotowa `mask` może wejść wcześniej; kolejność jest obojętna dla
   kontraktów, jak ST-2 §3.4.

### 2.3 Kryterium akceptacji

1. Holdout, podklasa **pospolite-pułapki** (40 encji PERSON_NAME,
   RECALL-90 §3.3): recall podklasy **≥ 75%** w SG-lite licząc wyłącznie
   warstwę `mask` (slot), oraz **≥ 90%** licząc `mask` + kandydaci `review`
   trafiający do kosza (scorer trójdrożny ST-7a już umie liczyć W1/W2
   osobno). Reszta do 100% ma nazwane przyczyny (alternacje form, start
   zdania bez slotu) z odesłaniem do SG-full.
2. Zmierzone przecieki holdoutu („Osioł", „Wrona", „Pszczoła", „Dzięcioł",
   „Głowacka") – pokrycie 100% (mask albo review, zero pełnych wycieków).
3. **Precyzja W1 bez regresu:** na pułapkach FP korpusu (cytowania, nazwy
   pospolite jako rzeczowniki, ~12% objętości) – **zero nowych FP
   w warstwie `mask`**; golden „ul. 3 Maja" i zdanie z ptakiem („Wrona
   siedziała na płocie.") nie emitują nic do maski.
4. **Szum kosza ograniczony:** średnio ≤ 3 kandydatów `review` z SG na
   dokument korpusu syntetycznego (próg do zatwierdzenia, O-SG-3);
   przekroczenie = rozszerzanie `slotOnly`, nie akceptacja szumu.
5. Syntetyczny i adversarial: PERSON_NAME P/R bez regresu poza pkt 3;
   eval tagowany przed/po na obu korpusach (dyscyplina repo).

### 2.4 Test dowodzący

- Jednostkowy **per wpis** leksykonu, iterujący po danych (wzór B4): każda
  forma × {title-case: emisja, ALL-CAPS: emisja, lowercase: cisza}.
- **Per wzorzec slotu** S1–S5: pozytyw (→ mask, właściwy span, w tym
  imię+nazwisko dla S1/S2) i negatyw (sąsiad spoza listy → cisza).
- **Testy spójności danych** (wzór `role-lexicon.consistency.test.js`):
  formy rozłączne między lematami; `slotOnly` ⊆ wpisy; każdy wpis ma
  `freq` (dowód weryfikacji w PESEL); żadna forma nie występuje
  w `nonEntity` roli-leksykonu ani blocklistach A9 (wpis nie może być
  jednocześnie encją i blocklistą – to samo prawo co B4 pkt 3).
- **Testy warstwy:** bez slotu → `forceTier: 'review'`; ze slotem → brak
  flagi; kandydat review zagnieżdżony w modelowym mask znika z kosza
  (golden na kontrakcie partycji ST-2).
- Goldeny negatywne całodokumentowe: dokument-pułapka z ptakami/ulicami
  (analog adw_34 dla B4) – zero encji `mask` z SG.

### 2.5 Koszt

**S–M (SG-lite):** kod to wariant `lexicon.js` + matcher slotów + testy
(S); głównym kosztem są dane – ręczne spisanie ~300–500 wpisów z formami
i weryfikacją frekwencji w PESEL (M, praca redakcyjna jak B3/B4, dzielona
na porcje per commit). **M (SG-full):** kompilator przecięcia + formy
z paradygmatów, po bramce O-3 morfologii; zmiana czysto danowa (plik
podmienia zawartość, kontrakt kroku bez zmian).

### 2.6 Bramki

- **SG-lite: bez bramki Opusa** – dane ręczne w repo (CC0 u źródła,
  potwierdzone w W1-W3 §1.2.2), zero łańcucha dostaw; identyczna sytuacja
  jak B3/B4-lite.
- **Delta `forceTier: 'review'`** w kontrakcie ST-2: materia GS-5
  (GATE-SCOPE) – do tamtejszej bramki dopisać pytanie, czy per-encyjne
  obniżenie warstwy typu `mask` nie osłabia dowodu niezmienności
  `all-mask` (nie powinno: profil `all-mask` wymusza warstwę per TYP,
  flaga per-encyjna musi być w nim ignorowana – to jest warunek, nie
  nadzieja; test niezmienności łapie naruszenie).
- **SG-full: bramka Opusa TAK** (materia licencyjna): (a) dziedziczy O-3
  morfologii (SGJP/łańcuch dostaw), (b) nowy werdykt: czy artefakt
  „podzbiór listy PESEL wyznaczony sitem SGJP" jest wolny od treści SGJP
  (sito wybiera, nie kopiuje – do potwierdzenia u źródła licencji, nie
  z pamięci), (c) import pełnego datasetu PESEL do build-time.

## §3. Styk z istniejącą architekturą (nic nie renegocjujemy)

| Element | Relacja SG | Zmiana? |
|---|---|---|
| `type-tiers.js` (ST-1) | `PERSON_NAME: 'mask'` bez zmian; SG obniża per-encję flagą | nie |
| ST-2 partycja | konsumuje `forceTier` (dziś `'mask'` z ST-5); dziedzina +`'review'` | delta w GS-5 |
| B1 ensemble | SG poza głosowaniem modeli (jak `lexicon`/`regex`) | nie |
| B2 case-folded | wersaliki łapane przez oba źródła; dedup same-type zwykły | nie |
| B3/B4 `lexicon` | osobny alias źródła; reuse `nonEntity` (S4) i encji ról (S3) jako sygnałów slotu | nie |
| A9 blocklisty | test rozłączności form; role procesowe pozostają nie-encją | nie |
| dedup/backfill (H-1/H-2) | score 0,95 + istniejące gałęzie; review nie seeduje backfillu | nie |
| eval / score-tiers (ST-7a) | kandydaci W2 już liczeni osobno; per-źródłowy odczyt dla `gazetteer` | nie |
| korpus (RECALL-90 §3.3) | podklasa pospolite-pułapki 40 + pułapki FP ~12% = gotowy pomiar | nie |

## §4. Rejestr decyzji otwartych (dla Alana)

| Nr | Decyzja | Rekomendacja | Status |
|---|---|---|---|
| O-SG-1 | Czy emisja `review` wchodzi razem z ST-2, czy SG startuje mask-only (slot) i kosz dostaje później | razem z ST-2 (kosz i tak powstaje; mask-only wcześniej jako etap, §2.2 pkt 9) | otwarta |
| O-SG-2 | Import skompilowanej listy imion PESEL (top ~1500) do repo – pierwszy plik pochodny z zewnętrznego datasetu (dotąd dane czysto ręczne) | tak: CC0 potwierdzone, wpis w THIRD_PARTY_NOTICES, pochodzenie i data zasobu w nagłówku pliku | otwarta |
| O-SG-3 | Próg szumu kosza (kryterium 2.3 pkt 4) | ≤ 3 kandydatów SG/dokument średnio; ponad próg → `slotOnly`, nie tolerancja | otwarta |
| O-SG-4 | Początkowa zawartość `slotOnly` (kalendarz, dni tygodnia, kolizje uliczne) | zatwierdzić listę przy PR z danymi (przegląd redakcyjny Alana) | otwarta |
| O-SG-5 | Czy slot ma kiedyś emitować dla słów SPOZA listy (ogólna heurystyka „Pozwany [X]") | nie w v1 (ryzyko FP na organizacjach); wrócić po pomiarze SG-full | odłożona |

## §5. Ryzyka

| Nr | Ryzyko | Mitygacja |
|---|---|---|
| R-SG-1 | Kosz W2 zalany kandydatami → radca przestaje przeglądać (analogia R-ST-2) | lista kolizyjna zamiast pełnej, `slotOnly`, brak emisji na starcie zdania, próg O-SG-3 mierzony w eval |
| R-SG-2 | Świadome FN lite: alternacje tematu (Kozioł/Kozła) spoza form ręcznych, start zdania bez slotu | formy wariantowe wpisywane ręcznie przy wpisie; reszta zmierzona na holdoucie i nazwana w 2.3 pkt 1; domyka SG-full |
| R-SG-3 | Odbiór „review to nie ochrona" – kandydat w koszu nie maskuje | komunikacja produktowa: dziś ta klasa wycieka W CAŁOŚCI; kosz to podniesienie z 0 do decyzji człowieka, slot podnosi do maski automatycznie |
| R-SG-4 | Regres arbitrażu: SG-mask eksmituje lepszy span modelu | score 0,95 (nie 1,0) + spany slotowe obejmujące imię (szersze wygrywają zgodnie z regułą dedupu); goldeny nakładek |
| R-SG-5 | Pełzanie zakresu: „dodajmy pełną listę, skoro działa" | niecel §1; wejście pełnej listy wymaga nowego pomiaru luki, nie apetytu |

## §6. Sekwencjonowanie

1. **SG-lite mask-only** (slot → mask; bez `forceTier`): niezależne od
   ST-2, może wejść od razu po B-modułach; eval tagowany.
2. **SG-lite review**: po wejściu ST-2 do main (kosz istnieje) i dopisku
   GS-5; eval trójdrożny (ST-7a) przed/po.
3. **SG-full**: po bramce O-3 morfologii; czysta podmiana danych.

Deferred (poza projektem): companion OCR-spacing (klasa C1, §1);
ogólna heurystyka slotowa spoza listy (O-SG-5); odmiana imion w slocie S1
(mianowniki wystarczają do czasu morfologii – formy zależne łapie forma
nazwiska, nie imienia).
