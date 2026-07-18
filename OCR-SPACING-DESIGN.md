# OCR-SPACING-DESIGN.md – defekty odstępów OCR: rozstrzelenia i sklejenia (moduł OS)

Status: **wersja 2.0 – finalizacja implementacyjna** (zero kodu w tej sesji).
Autor: Fable (architekt). Data v1: 2026-07-15, data v2: 2026-07-18.
Wzorzec formatu: moduł B4 / SURNAME-GAZETTEER-DESIGN.md (diagnoza → kontrakt →
kryterium akceptacji → test dowodzący → koszt → bramka).

**Delta v1 → v2 (na zlecenie bramki jakości, po zamknięciu projektu H-3):**
1. **Zakres rozszerzony o sklejenia (moduł OS-S)** – rozstrzygnięcie rozjazdu
   z H-3 (Z-2 „KonradŻurawski"): §1.2. Moduł z v1 (rozstrzelenia) nazywa się
   odtąd **OS-G** (glue); wspólny silnik wariant+mapa pozostaje jeden.
2. **Prototyp OS-G istnieje** na `integration/sprint` (pliki §2.5) – v2
   traktuje go jako referencję implementacyjną i wchłania jego lekcje;
   docelowa implementacja idzie gałęzią bramkowaną nad `main` (O-OS-8).
3. **Decyzje O-OS-1…6 rozstrzygnięte** albo jawnie zostawione Alanowi (§8) –
   w tym korekta O-OS-2: emisja resztkowa `review` jest bramkowana
   AKTYWACJĄ warstwowości (`allMask:false`), nie samym istnieniem ST-2,
   bo pod `allMask` `forceTier:'review'` i tak jest maskowane
   (`effectiveTier`, `src/pipeline/configs/type-tiers.js:70-73`).
4. **Jawny podział laptop-safe vs PC-gated** (§5) i plan pomiaru na PC
   z tripwire'ami T1–T6 (§6).
5. **Bramka Opusa: TAK – GATE-OS** (§7); zmiana względem v1 („nie"),
   uzasadniona dyscypliną certyfikowanego `main` (każda gałąź funkcyjna
   przechodzi werdykt przed merge, precedens `feature/h3-hc2`).
6. Subtelność mapy dla kierunku split (monotoniczność przy wstawieniach
   bez luki w oryginale) nazwana i rozstrzygnięta w kontrakcie (§3.2 pkt 2)
   – żeby nie wyszła w połowie implementacji.
7. Konsekwencja snapa dla spanów śródtokenowych (GT sklejeń anotuje jądro
   wewnątrz tokenu) nazwana; metryka sukcesu OS-S jest pokryciowa, nie
   granicowa (§3.2 pkt 4, O-OS-9).

---

## §0. Werdykt tezy

**Teza v1 potwierdzona i rozszerzona: oba defekty odstępów OCR – rozstrzelenia
(„W r ó b l e w s k a") i sklejenia („KonradŻurawski") – to JEDEN wąski moduł
M+, nie duża sesja C1.** Uzasadnienie techniczne: (1) `normalizeWhitespace`
jest no-opem, pipeline nigdy nie przepisuje `ctx.text` – offsety encji zawsze
wskazują oryginał, więc mapa offsetów może być **przejściowa i lokalna**
(per segment, żyje wyłącznie wewnątrz jednego kroku fazy `ner`, wzorzec B2);
(2) mapa jest mechaniczna w OBU kierunkach: glue = usunięcie znanych spacji
(wariant krótszy), split = wstawienie znanych spacji (wariant dłuższy) –
inwariant wierności znakowej (`checkDespaceInvariant`,
`src/pipeline/despace.js` na `integration/sprint`) jest z konstrukcji
kierunko-agnostyczny: „każdy nie-wstawiony znak wariantu == znak oryginału
pod `origPos`"; różni się wyłącznie reżim monotoniczności dla pozycji
wstawionych (§3.2 pkt 2); (3) kandydat po zmapowaniu jest zwykłą encją –
segmentacja, dedup, warstwy, legenda i tokenizacja pozostają nietknięte.

**Co pozostaje dużą sesją (C1-ogólne, bez zmian):** dowolne
wstawki/usunięcia/PODMIANY glifów wymagają dokumentowej warstwy
tekst-znormalizowany ↔ oryginał przenikającej segmentację, backfill
i legendę – nic z tego dokumentu tego nie buduje. Tripwire'y odcięcia: §6.3.

## §1. Diagnoza i zakres

### 1.1 Zmierzony problem (dwie klasy, jedna rodzina)

**Rozstrzelenia** (holdout §4.1, klasa `hold_ocr_mega`): OCR oddaje nazwiska
jako litery rozdzielone spacjami – „W r ó b l e w s k a". Żaden matcher ani
model nie widzi takiego nazwiska → pełne wycieki wagi 4 (PERSON_NAME,
warstwa `mask`). Z ~135 braków rdzenia W1 **~40 to OCR** (ZAKRES §5, klasa
C1) – największa pojedyncza resztka po rekalibracji zakresu.

**Sklejenia** (dev `adw_25_ocr_sklejone`, część `hold_ocr_mega`): OCR gubi
spacje – „PowódKonradŻurawski zam. wToruniu przyul.Polnej3/5". Pomiar H-3
(H-3-CLOSURE-DESIGN.md §1.2, wyciek #8): model taguje „KonradŻurawski" jako
ORGANIZATION_NAME (warstwa `pass`) → po aktywacji warstwowości dana byłaby
JAWNA. GT `adw_25` anotuje 5 encji, wszystkie sklejone: 2× PERSON_NAME
(„KonradŻurawski" [5,19], „AnielaWilk" [91,101]), 2× POSTAL_ADDRESS
(„ul.Polnej3/5", „ul.Wodna11,86-200Chełmno"), 1× LOCATION („Toruniu" [26,33]
– jądro wewnątrz „wToruniu"). Uwaga anotacyjna o skutkach dalej (§3.2
pkt 4): **GT sklejeń anotuje jądro ŚRÓDTOKENOWO** („KonradŻurawski" zaczyna
się w środku tokenu „PowódKonradŻurawski").

### 1.2 Rozstrzygnięcie rozjazdu Z-2 (decyzja architektoniczna tej wersji)

Stan sporny: v1 tego dokumentu jawnie wyłączała sklejenia jako FN modułu
(§1 v1: „te pozostają FN"), a triage H-3 odesłał wyciek **Z-2 =
„KonradŻurawski"** właśnie „do OS-1/despace". W obecnym kształcie (prototyp
OS-G) moduł **NIE zamyka Z-2** – to fakt, nie niedopatrzenie prototypu.

**Decyzja: moduł OS rozszerza się o OS-S (resegmentacja sklejeń) i ZAMYKA
Z-2 w tym projekcie.** Uzasadnienie: z pięciu elementów modułu cztery są
współdzielone co do sztuki – (i) wariant per segment + przejściowa mapa
offsetów z tym samym inwariantem wierności, (ii) drugi przebieg NER przez
`createNerStep` z tymi samymi typami i progami źródła, (iii) brama
proweniencji OCR, (iv) źródło `despaced` w konfiguracji – a różni się
wyłącznie (v) generator wariantu (gramatyka detekcji: usuń spacje vs wstaw
spacje). Moduł-rodzeństwo dublowałby cztery piąte konstrukcji, drugi krok
pipeline'u i drugą bramę proweniencji. Koszt OS-S to jedna czysta funkcja
gramatyki + lustrzany tryb inwariantu + testy (§3.5).

**Warunek uczciwości:** jeżeli implementacja OS-S uderzy w tripwire T5
(§6.3 – split wymagałby zmiany segmentacji albo przepisania `ctx.text`),
OS-S zostaje zatrzymane werdyktem w GATE-OS, a rejestr H-3 dostaje jawny
wpis: „Z-2 OTWARTE, wraca jako moduł-rodzeństwo o własnym koszcie" – bez
papierowania.

### 1.3 Zakres (zamknięty) i poza zakresem (twarde)

**W zakresie:** OS-G – ciągi pojedynczych liter rozdzielonych pojedynczą
spacją (gramatyka §2.2 pkt 1, bez zmian od v1); OS-S – tokeny sklejone
z sygnałem granicy w postaci przejścia mała→WIELKA litera albo
litera↔cyfra (gramatyka §3.2 pkt 1).

**Poza zakresem (nazwane, mierzone, bez ukrywania):** przenoszenia
(„Wr-\nóblewską"), rozstrzelenia częściowe/mieszane („Wr ó blewska"),
sklejenia bez sygnału wielkości liter („SĄDREJONOWY" – caps-caps, brak
przejścia; wymaga słownika, nie gramatyki), kombinacje obu defektów
w jednym tokenie („B o ż e n aWróblewska"), podmiany glifów l↔1/O↔0
(A1/R-1), diakrytyki (B5), rozstrzelone ciągi CYFR (v1.1, O-OS-4),
tekst wklejony bez proweniencji (O-OS-5).

## §2. Moduł OS-G – rozstrzelenia (kontrakt v1, potwierdzony prototypem)

### 2.1 Zasada: normalizuj i pytaj model, nie zgaduj z wzorca

Bez zmian od v1 – mechanizm (a): sklej ciąg → NER na wariancie → zmapuj
offsety; typ i score nadaje MODEL na tekście, na którym jest kompetentny.
Po wdrożeniu modelu trójwarstwowego argument precyzji jest już mechaniczny,
nie deklaratywny: „W I E L K O P O L S K I U R Z Ą D" dostaje od modelu
ORGANIZATION_NAME → `tierFor` = `pass` → NIE jest maskowany; PERSON_NAME →
`mask`; LOCATION → `review`. Emisja wprost z wzorca (mechanizm (b))
pozostaje odrzucona z powodów typowania – resztka wzorca idzie do W2
(§2.2 pkt 5), ale dopiero po aktywacji (O-OS-2, §8).

### 2.2 Kontrakt (v1 §2.2 pozostaje w mocy; poniżej tylko zmiany/uściślenia)

Pełny kontrakt gramatyki, wariantu, mapy, folda klasy C, źródła `despaced`,
bramy proweniencji, postprocessu i więzów wykonawczych – jak w v1 (pkt 1–8
poprzedniej wersji, treść niezmieniona merytorycznie). Uściślenia z lekcji
prototypu:

1. **Strip pola `word` przy remapie** (lekcja fef2c72): surowy kandydat
   modelu niesie tekst WARIANTU w polu `word`, a po remapie offsety
   wskazują oryginał rozstrzelony – pole musi być usunięte przy emisji,
   inaczej debug/eval kłamią. Kontrakt: encja `despaced` nie ma żadnego
   pola tekstu powierzchniowego; wszystko w dole czyta `text.slice()`.
2. **Guard `coversWord`:** kandydat z wariantu, który w całości leży
   w przepisanej tożsamościowo reszcie segmentu, jest odrzucany – widział
   te same znaki co przebieg główny i tylko relitygowałby jego spany
   (hazard arbitrażu opisany przy B2).
3. **Próg źródła:** `DESPACED_THRESHOLD = 0,8`, ta sama wartość i to samo
   uzasadnienie co `CASE_FOLDED_THRESHOLD` (kontekst zdaniowy zaburzony);
   wpisy `thresholdBySource` dla pięciu typów B2. Finalna wartość z pomiaru
   dev na PC – nie strojona na holdoucie.
4. **Filtr typów:** reuse `ALLOWED_TYPES` z `case-folded-ner.js` oraz
   `isStructuralMarkerSpan` (te same wykluczenia znaczników).

### 2.3–2.4 Kryterium akceptacji i testy

Jak w v1 (§2.3/§2.4 poprzedniej wersji), z jedną korektą rozliczeniową:
pkt 4 kryterium („sklejenia i przenoszenia jawnie poza pomiarem sukcesu")
zwęża się do **przenoszeń i kombinacji** – sklejenia przechodzą do
kryterium OS-S (§3.3). Property-test mapy, jednostkowe gramatyki, golden
`hold_ocr_mega_00`, test izolacji bramy, testy warstwy, goldeny
snap/maxLength/dedup – bez zmian.

### 2.5 Stan prototypu (referencja implementacyjna, nie kanon)

Na `integration/sprint` istnieje kompletny, przetestowany prototyp OS-G –
zgodny z tym kontraktem, wart przeniesienia przez cherry-pick po przeglądzie
(O-OS-8):

| Plik (integration/sprint) | Zawartość |
|---|---|
| `src/pipeline/despace.js` (+`.test.js`) | gramatyka T/C, łańcuchy gołych liter, cięcia na przejściach wielkości, frazy 1–3, wariant + `origPos` + `insertedSpaces`, `checkDespaceInvariant`, fail-open null |
| `src/pipeline/steps/despaced-ner.js` (+`.test.js`) | krok wzorowany 1:1 na B2: twardy no-op bez `ctx.meta.ocrProvenance`, inner `createNerStep`, remap, strip `word`, guard `coversWord`, `DESPACED_SOURCE` |
| `src/pipeline/despaced-goldens.test.js` | goldeny dokumentowe z mockiem `loadModel` (wzorzec laptop-safe) |
| `src/pipeline/configs/entity-sources.js` | alias `despaced` w `SOURCES` + wpisy w `ENTITY_SOURCES` (5 typów B2) |
| `src/pipeline/configs/entity-rules.js` | `DESPACED_THRESHOLD = 0,8` w `thresholdBySource` |
| `src/pipeline/configs/default.js` | wpięcie kroku: `ner → caseFolded → despaced → regex → …` |
| `src/pipeline/cache-orchestrator.js` | osobny bucket `cache.despaced`, standalone raz-na-tekst (jak B2), brama `despacedNeeded = needed && meta.ocrProvenance` |
| `src/worker.js` / `src/main.js` | przewód proweniencji: `sourceHasOcrProvenance(source)` → pole `ocrProvenance` w `classify` → `ctx.meta` |
| `src/eval/run.js` | proweniencja w eval po nazwie pliku (`*ocr*`) |

**Czego prototyp świadomie nie ma (zgodnie z v1):** emisji resztkowej W2
(sekwencja §10), gramatyki sklejeń (OS-S – nowość v2), klasyfikatora
podzbiorów GT w analyze (§6.2 pkt 3).

## §3. Moduł OS-S – sklejenia (resegmentacja; NOWY, zamyka Z-2)

### 3.1 Zasada

Ten sam mechanizm (a), kierunek odwrotny: **wstaw separatory w punktach
cięcia → NER na wariancie rozdzielonym → zmapuj offsety na oryginał.**
Model widzi „Powód Konrad Żurawski zam. w Toruniu przy ul.Polnej 3/5"
i taguje PERSON_NAME tam, gdzie na sklejonym tekście widział organizację.
Decyzja o typie należy do modelu; gramatyka tylko przywraca odstępy,
których istnienie jest pewne z ortografii (polszczyzna nie ma wielkich
liter wewnątrz wyrazu) albo z klasy znaków (litera↔cyfra).

### 3.2 Kontrakt

1. **Gramatyka detektora (czysta funkcja, per segment).**
   - *Token docelowy:* maksymalny ciąg znaków `[\p{L}\p{N}]` (bez
     separatorów), długość ≥ 5, zawierający ≥ 1 punkt cięcia i ≥ 1 literę.
   - *Punkty cięcia (lista zamknięta):*
     **R1** `\p{Ll}` → `\p{Lu}` (mała→WIELKA między literami; „PowódKonrad",
     „KonradŻurawski", „AnielaWilk", „wToruniu");
     **R2** `\p{L}` → `\p{Nd}` (litera→cyfra dziesiętna; „Polnej3",
     „Wodna11");
     **R3** `\p{Nd}` → `\p{L}` (cyfra→litera; „200Chełmno").
   - *Czego się NIE tnie (a co jest pułapką):* `\p{Lu}` → `\p{Ll}` – to
     normalne wnętrze wyrazu Title Case („Konrad") ORAZ fleksja skrótowców
     („NIPem", „VATowiec", „PESELu") – reguły odwrotnej nie ma i nie
     wolno jej dodać bez nowego pomiaru; `\p{Lu}` → `\p{Lu}` („PESEL",
     „SĄDREJONOWY" – caps-sklejenia zostają FN, §1.3); przejścia z udziałem
     `\p{No}` (superskrypty: „385¹" nie jest cięte – R2/R3 używają wąskiej
     klasy `\p{Nd}`).
   - *Guardy szumu:* > 8 punktów cięcia w tokenie → token pomijany (szum
     OCR, nie tekst); token bez liter → pomijany (ciągi cyfr to domena
     A1/HC-2); segment kwalifikowany ⟺ ≥ 1 token z ≥ 1 cięciem.
2. **Wariant + mapa: lustrzany tryb inwariantu (subtelność nazwana).**
   Wariant = kopia segmentu ze spacją wstawioną w każdym punkcie cięcia
   kwalifikowanych tokenów; pozycje wstawień rejestrowane w
   `insertedSpaces` (dokładnie istniejąca struktura). Różnica względem
   OS-G, której nie widać z daleka: w glue wstawiona spacja frazy mapuje
   na pierwszy znak 1–3-znakowej przerwy oryginału – wolny indeks ISTNIEJE
   i `origPos` może być ściśle rosnąca globalnie. W split między sąsiednimi
   znakami oryginału NIE MA wolnego indeksu – wstawiona spacja nie ma
   własnej pozycji. Kontrakt mapy split:
   - `origPos` **ściśle rosnąca po pozycjach nie-wstawionych**;
   - dla wstawionej pozycji `i` (konwencja: `origPos[i]` = pozycja znaku
     PO cięciu): `origPos[i-1] ≤ origPos[i] ≤ origPos[i+1]`;
   - wspólny checker inwariantu dostaje TRYB (`strict` dla glue – dzisiejsze
     zachowanie bajt w bajt; `insert` dla split – złagodzenie wyłącznie na
     pozycjach wstawionych); wierność znakowa nie-wstawionych pozycji jest
     identyczna w obu trybach;
   - **remap spanu:** przed mapowaniem przytnij brzegi spanu do najbliższej
     nie-wstawionej pozycji wewnątrz (kandydat NER nie powinien zaczynać
     się ani kończyć spacją, ale kontrakt nie może na tym wisieć); span
     pusty po przycięciu → drop (fail-open). Dalej dokładnie formuła kroku:
     `[origPos[s'], origPos[e'-1] + 1)`.
   - Naruszenie inwariantu ⇒ segment pomijany (null, fail-open, wzór OS-G).
3. **Krok i źródło: te same.** OS-S żyje w tym samym kroku `despacedNerStep`
   jako druga rodzina wariantów: `buildResegmentedSegments(segments)` obok
   `buildDespacedSegments(segments)`; inner NER dostaje sumę wariantów
   (osobne wpisy `{text, offset}`, wariant glue i split tego samego segmentu
   są NIEZALEŻNE – kombinacje defektów poza zakresem, §1.3). Alias źródła
   wspólny: `despaced` (zero nowych wpisów konfiguracyjnych; rozdział
   pomiaru robi klasyfikator podzbiorów GT, §6.2 pkt 3, nie per-source).
   Guard emisji: lustro `coversWord` – kandydat musi pokrywać ≥ 1 punkt
   cięcia (`coversSplitPoint`); filtr `ALLOWED_TYPES`, strip `word`, próg
   0,8 – wspólne.
4. **Konsekwencja snapa (nazwana, zaakceptowana w v1 modułu).** GT sklejeń
   anotuje jądro śródtokenowo („KonradŻurawski" = [5,19] wewnątrz
   „PowódKonradŻurawski"). Zmapowany kandydat [5,19] przechodzi przez
   `snapStep`, który ROZSZERZA do granic słów (`snapToWordBoundaries`,
   `src/anonymizer.js:616-631`, `MAX_SNAP = 6`): span staje się [0,19]
   („PowódKonradŻurawski" w całości). Skutki: **pokrycie GT = 100%**
   (wyciek zamknięty, eval:h3 czysty), nadmiar maskowania = przedrostek
   ≤ 6 znaków (odwracalny, tani – spójnie z „nadmiar odwracalny, przeciek
   nie"), ale **scoring ścisły liczy partial** (granice ≠ GT). Dlatego
   kryterium sukcesu OS-S jest POKRYCIOWE (§3.3), nie granicowe. Wyłączenie
   snapa per źródło = zmiana kontraktu snapa (okolica tripwire'a T4) –
   zarejestrowane jako O-OS-9, nie w v1.
5. **Brama proweniencji, cache, fail-open, air-gap:** wspólne z OS-G bez
   wyjątków. Uwaga cache: bucket `cache.despaced` musi mieć w kluczu
   **wersję gramatyki** (np. stały `DESPACE_GRAMMAR_VERSION` w kluczu
   bucketu) – dołożenie OS-S zmienia wynik kroku dla tego samego tekstu,
   stary wpis cache nie może przeżyć aktualizacji (R-OS-8).

### 3.3 Kryterium akceptacji (OS-S)

Podzbiór pomiarowy mechaniczny z GT (klasyfikator §6.2 pkt 3): encje,
których `text` albo bezpośrednie otoczenie w dokumencie zawiera przejście
R1/R2/R3 bez spacji (definicja operacyjna w analyze, nie nowa anotacja).

1. **Zero wycieków H-3 na klasie sklejonej:** `eval:h3` (tryb tiered,
   H-3-CLOSURE §3) na dev+holdout nie raportuje żadnej encji GT `mask`
   klasy sklejonej pokrytej wyłącznie predykcją `pass` – w szczególności
   **Z-2 „KonradŻurawski" znika**.
2. **Pokrycie znakowe (mask) sklejonych PERSON_NAME: 100%** na dev
   (`adw_25`: „KonradŻurawski", „AnielaWilk"), **≥ 90%** na holdoucie
   (instancje niewidziane); POSTAL_ADDRESS/LOCATION sklejone: pokrycie
   (mask ∪ review) raportowane, próg nie blokuje (typy review/mask
   z niższą wagą ryzyka niż nazwiska).
3. **Zero nowych FP mask poza tokenami z punktem cięcia** – kandydaci OS-S
   nie istnieją poza nimi z konstrukcji (guard `coversSplitPoint`);
   na tokenach z cięciem: precyzja W1 per typ bez regresji poza szumem
   (pomiar PC).
4. **Pułapki gramatyki nie generują kandydatów:** „NIPem", „VATowiec",
   „PESELu", „S.A.", „art. 385¹", „SĄDREJONOWY" → zero punktów cięcia
   (jednostkowe, laptop); „TO1T/00012345/6" (KW) → wariant powstaje, ale
   przez pełny pipeline nie wychodzi żadna encja `mask` źródła `despaced`
   na spanie KW (golden z mockiem; potwierdzenie realnym modelem na PC).
5. **Izolacja:** dokument bez flagi OCR – bajt w bajt jak baseline
   (wspólne kryterium z OS-G).

### 3.4 Test dowodzący

- **Property-test wspólnego checkera w trybie `insert`:** fuzz na tekstach
  z wstrzykniętymi sklejeniami (pary imię+nazwisko, przedrostki ról,
  adresy z cyframi): wierność znakowa nie-wstawionych, reżim monotoniczności
  z pkt 2, roundtrip (wariant z usuniętymi wstawkami == oryginał), zero
  wyjątków – tylko null (fail-open) na wejściach zdegenerowanych;
  **wspólnie z trybem `strict`:** te same własności na dotychczasowych
  fuzzach OS-G (dowód, że refaktor checkera niczego nie zmienił).
- **Jednostkowe gramatyki split:** pozytywy z `adw_25` (wszystkie 5 encji
  GT dostaje punkty cięcia we właściwych miejscach), negatywy z pkt 3.3.4.
- **Golden dokumentowy `adw_25_ocr_sklejone`** przez pełny pipeline z flagą
  OCR i mockiem modelu zwracającym PERSON_NAME na „Konrad Żurawski"
  w wariancie: encja końcowa pokrywa GT [5,19] (asercja POKRYCIA, nie
  równości granic – snap, pkt 3.2.4); bez flagi – bajt w bajt baseline.
- **Goldeny arbitrażu:** kandydat OS-S (PERSON_NAME, mask) nakładający się
  z modelowym ORGANIZATION_NAME (pass) na sklejonym tokenie → oba
  przeżywają dedup (frontier per warstwa), partycja maskuje – dokładnie
  wzorzec goldenów HC-1 (H-3-CLOSURE §4.1); to jest test domykający Z-2
  na poziomie mechaniki, zanim PC potwierdzi na modelach.

### 3.5 Koszt

**S–M:** gramatyka split + tryb `insert` checkera (S; jedyna chirurgia to
reżim monotoniczności – stąd property-test PRZED integracją), druga rodzina
wariantów w istniejącym kroku (S), goldeny i negatywy (S), wersjonowanie
klucza cache (S). Zero nowych danych, zero nowych artefaktów modelowych,
zero zmian kontraktów postprocessu.

## §4. Styk z istniejącą architekturą (stan na 2026-07-18, `main`)

| Element | Stan na main | Relacja OS | Zmiana? |
|---|---|---|---|
| ST-1/ST-2 (`type-tiers.js`, partycja, tier-aware dedup/backfill/merge) | **scalone, śpią pod `allMask:true`** | typ z modelu → warstwa z `tierFor`; frontier per warstwa wynosi kandydatów OS na wierzch obok pomyłek `pass` modelu (mechanika Z-2) | nie |
| `tier-partition-invariance.test.js` | na main | OS nie dotyka arbitrażu ani partycji – test pozostaje zielony bez zmian; niezmienność KORPUSOWA all-mask obowiązuje tylko dokumenty BEZ flagi OCR (na flagowanych OS celowo dodaje kandydatów w OBU trybach – niezmiennik N2 z H-3-CLOSURE §4.3) | nie |
| B2 case-folded | na main | rozłączne triggery; OS-G reużywa `foldWord`, `ALLOWED_TYPES`, `isStructuralMarkerSpan` | nie |
| proweniencja OCR | substrat CZĘŚCIOWO na main: `src/file-import/pdf.js` stempluje strony `source:'ocr'`; `image.js` ma blok `meta` | kontrakt O-OS-6 (§8): `sourceHasOcrProvenance` = `meta.ocr ∨ pages[].source==='ocr'`; worker → `ctx.meta.ocrProvenance`; eval: nazwa `*ocr*` | tak (przewód, wg prototypu) |
| B5a diakrytyki (RECALL-90 §2.5) | niewdrożone | wspólne pole proweniencji – OS wchodzi pierwszy i DEFINIUJE kontrakt, B5a reużyje | kontrakt wspólny |
| SG-lite gazeter | **tylko integration/sprint**, nie na main | ścieżka 3-literowa (O-OS-1) i upgrade slotowy (etap E3) czekają na SG na main; OS bez SG działa z N=4 | nie |
| `feature/h3-hc2` (HC-1/HC-2, tier-safety) | gałąź nad main, niescalona | rozłączne plikowo; jeżeli OS wymaga korekty `maxLength`, lint `findMaskTypesDroppableByMaxLength` (tier-safety) waliduje ją – gdy h3-hc2 jeszcze niescalone, GATE-OS pyta o to ręcznie (GO-3) | nie |
| `feature/eval-tiered-run` (`--allMask=false`, `candidates.json`) + `eval:h3` (HC-0) | gałąź + projekt H-3 | narzędzia POMIARU bramki OS (§6); bez nich kryterium 3.3.1 nie jest policzalne → zależność sekwencyjna | nie |
| dedup/backfill/merge (H-1/H-2) | tier-aware na main | zwykłe gałęzie; dosiew zwarte↔rozstrzelone/sklejone tylko mierzony (obietnic brak) | nie |
| maxLength | PERSON_NAME 50, POSTAL_ADDRESS/LOCATION 100, ORG 120 | rozstrzelone spany ~2× długości zwykłych – goldeny; korekta limitu TYLKO przez lint tier-safety albo pytanie GO-3 | golden, ew. korekta |
| eval / score-tiers / analyze | na main | klasyfikator podzbiorów „rozstrzelone"/„sklejone" w analyze (czysty tekst, S) + proweniencja w run.js | tak (eval-side, S) |

## §5. Podział laptop-safe vs PC-gated (etapowanie dla Sonneta)

Twarda reguła maszyn (pamięć projektu): laptop 16 GB = podłoga, ZERO
przebiegów `npm run eval` z modelami; PC = każda inferencja, porcjami
po ~30 dokumentów.

**Laptop – „to buduj teraz, test-first":**

| Co | Dowód |
|---|---|
| gramatyka OS-G (port prototypu) + gramatyka OS-S (nowa) | jednostkowe pozytywy/negatywy §2.4/§3.4 |
| wariant + mapa + wspólny checker (tryby `strict`/`insert`) | property-testy wierności, monotoniczności, roundtrip, fail-open rate |
| krok `despacedNerStep` z dwiema rodzinami wariantów | goldeny z MOCKIEM `loadModel` (wzorzec `despaced-goldens.test.js` z prototypu – zero prawdziwych modeli) |
| przewód proweniencji (main.js/worker/run.js) + brama twardego no-opa | test izolacji: bez flagi bajt w bajt |
| wpisy konfiguracyjne (SOURCES/ENTITY_SOURCES/entity-rules/default.js/cache) | istniejące testy konfiguracyjne + nowe asercje |
| goldeny arbitrażu OS-S×pass (wzorzec HC-1) | jednostkowe na ogonie postprocessu z `allMask:false` |
| klasyfikator podzbiorów GT w analyze | jednostkowe na tekstach korpusu (czysty odczyt) |
| pełny `npm test` | zielony przed jakimkolwiek pomiarem |

**PC – „to czeka na pomiar":** każdy przebieg z prawdziwymi modelami:
tagowany eval dev 38 (`--label=os-gs-dev`), holdout 206 w 7 porcjach
(dyscyplina TIERED-RUN-NOTES: jawna lista plików PRZED flagami, podwójny
`tasklist` na node.exe), profile all-mask i tiered, `eval:score`,
`eval:score:tiers`, `eval:h3`, liczby per podzbiór, szum, ocena
tripwire'ów, liczby bramkowe GO-4.

## §6. Plan pomiaru na PC i tripwire'y

### 6.1 Sekwencja pomiarowa

1. **Baseline:** istnieje (all-mask `holdout-206-merged`, tiered
   `tiered-206-merged` na PC; dev `recall-b2-baseline-adv`). Nowy baseline
   nie jest potrzebny, dopóki nic innego nie weszło na main między
   pomiarami – dziennik przebiegów rozstrzyga.
2. **Po wdrożeniu OS (gałąź bramkowa):** dev 38 jedną porcją; holdout 206
   w 7 porcjach; oba profile (`all-mask` dla regresji ogólnej i dowodu
   izolacji na skalę korpusu: dokumenty bez flagi OCR bajt w bajt;
   `--allMask=false` dla `candidates.json`/`pass-dropped.json`).
3. **Scoring:** `eval:score` + `eval:score:tiers` (regresje W1/W2)
   + `eval:h3` (kanał H-3, w tym Z-2) + klasyfikator podzbiorów
   (rozstrzelone/sklejone) per dokument.
4. **Liczby do bramki:** recall mask podzbioru rozstrzelonych (cel ≥ 80%,
   pokrycie klasy T 100%); pokrycie sklejonych PERSON_NAME (dev 100%,
   holdout ≥ 90%); `eval:h3`: zero wycieków klasy OCR wagi ≥ 4; precyzja
   W1 bez regresji poza szumem; fail-open rate mapy (z logów kroku,
   §6.3 T6); szum kosza dopiero po E2.
5. **Artefakty:** gitignorowane, zostają na PC; do repo notatka liczb
   (wzorzec `SCOPE-TIERS-TIERED-RUN-NOTES.md`).

### 6.2 Rozliczenie klasy OCR (~40 + sklejenia)

1. ~40 rozstrzelonych braków W1 (ZAKRES §5) – cel: większość zamyka OS-G;
   każda resztka nazwana per przypadek (klasa C bez potwierdzenia NER,
   3-literowe bez SG, kombinacje).
2. Sklejenia: instancje z `adw_25` + wystąpienia w `hold_ocr_mega_*`
   liczone klasyfikatorem (dokładna liczba wychodzi z pomiaru, nie
   z ręcznego liczenia – klasyfikator jest częścią wdrożenia).
3. Raport bramki rozdziela: zamknięte przez OS-G / przez OS-S / rezyduum
   nazwane (przenoszenia, caps-sklejenia, kombinacje, wklejki) – żeby
   „recall OCR" nigdy nie sugerował pokrycia całej klasy C1.

### 6.3 Tripwire'y odcięcia („to jednak duża sesja" – każdy zatrzymuje moduł
i zwraca temat do statusu C1-L werdyktem w GATE-OS, nie obejściem w kodzie)

- **T1:** mapa musiałaby przeżyć krok (widoczna dla dedup/backfill/legendy/UI).
- **T2:** potrzebne przepisanie `ctx.text` albo zmiana offsetów segmentów.
- **T3:** gramatyka wymaga obsługi wstawek/usunięć/podmian ZNAKÓW (nie
  samych spacji), żeby przejść kryteria.
- **T4:** konieczna zmiana kontraktu snap/dedup/merge zamiast goldenów
  (uwaga: O-OS-9 świadomie ociera się o T4 – dlatego nie wchodzi w v1).
- **T5 (nowy, dla OS-S):** domknięcie sklejeń wymagałoby resegmentacji
  zdaniowej (zmiany granic segmentów) albo wariantu przekraczającego
  granice segmentu – stop; Z-2 wraca do rejestru H-3 jako otwarte (§1.2).
- **T6 (nowy, próg dojrzałości mapy):** fail-open rate > 1% segmentów
  z detekcją na korpusach OCR – mapa niedojrzała, stop i diagnoza zamiast
  „działa w 99%".

## §7. GATE-OS – bramka Opusa (werdykt przed merge do main)

Zmiana względem v1 (było: „bramka Opusa NIE"): `main` jest produktem
certyfikowanym, każda gałąź funkcyjna przechodzi werdykt (precedens
`feature/h3-hc2`). Zakres przeglądu, jeden werdykt:

| # | Przedmiot | Pytanie bramkowe |
|---|---|---|
| GO-1 | mapa | czy property-testy obu trybów (`strict`/`insert`) dowodzą wierności znakowej i reżimu monotoniczności; czy fail-open jest jedyną reakcją na naruszenie (nigdy złe offsety); jaki fail-open rate wyszedł na korpusach (T6) |
| GO-2 | izolacja | dokumenty bez flagi OCR bajt w bajt na obu korpusach i obu profilach; `tier-partition-invariance.test.js` nietknięty; zero zmian kontraktów postprocessu (T4 nie wystąpił) |
| GO-3 | precyzja | negatywy gramatyk (fleksja skrótowców, S.A., 385¹, KW, caps-sklejenia) bez kandydatów; precyzja W1 na PC bez regresji poza szumem; każda korekta `maxLength` przeszła lint tier-safety albo jawny przegląd tutaj |
| GO-4 | liczby | recall/pokrycie podzbiorów z §6.1 pkt 4 osiągnięte; `eval:h3`: zero wycieków klasy OCR wagi ≥ 4, **Z-2 zamknięte**; rozliczenie ~40+sklejenia per przypadek (§6.2 pkt 3) |
| GO-5 | rezyduum i sekwencja | rezyduum nazwane z licznikami; emisja resztkowa W2 potwierdzona jako WYŁĄCZONA pod `allMask:true` (O-OS-2); zależności (SG-lite, h3-hc2, eval-tiered-run) rozliczone wg faktycznego stanu main |
| GO-6 | dyscyplina pomiaru | dziennik przebiegów kompletny, artefakty poza gitem, notatka liczb w repo, dokumenty triage/strojenia wymienione |

Werdykt + wpis do `PRODUCT-DECISIONS.md`. Zielona GATE-OS = OS-G+OS-S
gotowe do merge; domknięcie Z-2 raportowane do rejestru H-3 (warunek GH-5
tamtej bramki przestaje wisieć na OS).

## §8. Rejestr decyzji (rozstrzygnięcia v2)

| Nr | Decyzja | Rozstrzygnięcie v2 | Status |
|---|---|---|---|
| O-OS-1 | próg N i 3-literowe słowa | **ZAMKNIĘTA (architekt):** N=4 twarde w v1; ścieżka 3-literowa (potwierdzenie gazeterem/imionami) aktywuje się automatycznie, gdy SG-lite wejdzie na main – zero osobnej decyzji, zero renegocjacji | zamknięta |
| O-OS-2 | kiedy emisja resztkowa `review` | **ZAMKNIĘTA (architekt, korekta v1):** bramkowana AKTYWACJĄ (`allMask:false` w produkcie), nie istnieniem ST-2 – pod `allMask` `effectiveTier` bije `forceTier:'review'` i resztka byłaby MASKOWANA score'em 0,95 (zmiana zachowania certyfikowanego produktu tylnymi drzwiami). Kontrakt: ścieżka resztkowa emituje wyłącznie przy `allMask:false` | zamknięta |
| O-OS-3 | próg szumu kosza | rekomendacja bez zmian (≤ 3 kandydatów OS/dok. średnio, bez progu bramkowego w v1, rodzina O-SG-3/O-ST-6); rozstrzyga pomiar po E2, nie Alan teraz | zamknięta (pomiarem) |
| O-OS-4 | rozstrzelone ciągi CYFR | odłożona v1.1 bez zmian; nowy hak: regexy HC-2/A1 (sumy kontrolne) na wariancie glue = gotowe typowanie bez NER, gdy pomiar pokaże klasę | odłożona |
| O-OS-5 | aktywacja na tekście wklejonym | **OTWARTA – decyzja Alana** (produktowa): rekomendacja bez zmian – v1 nie; v2 heurystyka gęstości defektów jako PROPOZYCJA w UI („wygląda na tekst z OCR – włączyć tryb OCR?"), nigdy cicha aktywacja | **czeka na Alana** |
| O-OS-6 | pole proweniencji | **ZAMKNIĘTA:** kontrakt z prototypu: przeglądarka `sourceHasOcrProvenance(source)` = `source.meta.ocr` (obrazy) ∨ `source.meta.pages[].source === 'ocr'` (PDF; substrat już na main w `file-import/pdf.js`) → `classify.ocrProvenance` → `ctx.meta.ocrProvenance`; eval: nazwa `*ocr*` (docelowo manifest klasy); B5a reużywa pole bez zmian | zamknięta |
| O-OS-7 | pakietowanie OS-S | **NOWA – rekomendacja: OS-G i OS-S w JEDNEJ gałęzi bramkowej** (wspólny silnik, jeden pomiar PC, jedna bramka); wariant ostrożny (najpierw OS-G, OS-S po pomiarze) możliwy, ale podwaja noce pomiarowe na PC | czeka na Alana (rekomendacja: razem) |
| O-OS-8 | los prototypu z integration/sprint | **NOWA – rekomendacja:** cherry-pick plików §2.5 na gałąź bramkową nad main, każdy plik przechodzi przez czerwony test najpierw (lekcja „zielone testy ≠ poprawny kod" z pamięci projektu); re-implementacja od zera dopuszczalna, jeżeli cherry-pick konfliktuje | czeka na Alana |
| O-OS-9 | snap-exempt dla źródła `despaced` (kredyt ścisły granic sklejonych) | **NOWA – NIE w v1** (dotyka kontraktu snapa, okolica T4; pokrycie wystarcza dla szczelności); wraca z pomiarem, jeżeli strict W1 klasy OCR realnie blokuje bramkę recall | odłożona |

## §9. Ryzyka

| Nr | Ryzyko | Mitygacja |
|---|---|---|
| R-OS-1 | błąd mapy → maska na złych znakach (wyciek + zniszczenie treści naraz) | inwariant + property-testy obu trybów PRZED integracją; fail-open (null) jako jedyna reakcja; T6 mierzy skalę fail-open |
| R-OS-2 | FP mask na rozstrzelonych/sklejonych nie-nazwiskach | typowanie przez NER + model trójwarstwowy (ORG→pass po aktywacji); guardy `coversWord`/`coversSplitPoint`; klasa C bez NER milczy; kryteria 2.3/3.3 |
| R-OS-3 | kosz W2 zalany na gęstych skanach | emisja resztkowa dopiero po aktywacji (O-OS-2) i z progiem O-OS-3 |
| R-OS-4 | brama proweniencji nie obejmuje wklejek → klasa wraca bokiem | jawna decyzja O-OS-5 (propozycja w UI), nie cicha heurystyka |
| R-OS-5 | fraza wielowyrazowa sklejona źle (brak sygnału przerwy) → „SĄDREJONOWY" | poza zakresem z konstrukcji (caps-caps bez przejścia); golden negatywny; rezyduum nazwane w GO-5 |
| R-OS-6 | regres arbitrażu z fragmentami modelu na wariancie | score 0,8+/0,95 w oknie epsilon + szerszy span wygrywa (istniejące gałęzie); goldeny nakładek; frontier per warstwa dla par mask/pass |
| R-OS-7 | split tnie fleksję skrótowców („NIPem" → „NIP em") | reguły odwrotnej (Lu→Ll) NIE MA w gramatyce i jej dodanie wymaga nowego pomiaru; negatywy w testach jednostkowych |
| R-OS-8 | stary cache `despaced` przeżywa zmianę gramatyki → stare wyniki przy nowym kodzie | wersja gramatyki w kluczu bucketu cache (§3.2 pkt 5) |
| R-OS-9 | podwójna inferencja na segmentach z oboma defektami (koszt, nie poprawność) | warianty budowane tylko dla segmentów z detekcją; pomiar czasu w bench, bez obietnic optymalizacji w v1 |

## §10. Sekwencjonowanie (etapy wdrożenia)

1. **E1 – rdzeń (jedna gałąź bramkowa nad main, rekomendacja O-OS-7):**
   OS-G (port prototypu, O-OS-8) + OS-S (nowy) + przewód proweniencji +
   klasyfikator podzbiorów w analyze; wszystko laptop-safe test-first
   (§5); pomiar PC (§6); GATE-OS (§7). Emisja resztkowa W2 NIE wchodzi.
2. **E2 – siatka W2:** po AKTYWACJI warstwowości w produkcie
   (`allMask:false` jako stan docelowy po GATE-H3): emisja resztkowa
   `review` + próg O-OS-3; delta `forceTier:'review'` wspólna z SG (GS-5).
3. **E3 – upgrade slotowy:** po wejściu SG-lite na main (formy, sloty,
   imiona): część resztówki awansuje do `mask`; decyzja o N=3 wraca
   z pomiarem.
4. **E4 – v1.1 cyfry rozstrzelone (O-OS-4):** jeżeli pomiar po E1 pokaże
   klasę; typowanie regexami HC-2/A1 na wariancie glue zamiast NER.

Deferred (poza modułem, bez zmian): przenoszenia, rozstrzelenia
częściowe, kombinacje defektów, caps-sklejenia, podmiany glifów, ogólna
warstwa mapowania offsetów (C1-ogólne – duża sesja, jeżeli rezyduum po E1
nadal blokuje GATE-RECALL-90).

---

*Koniec v2. Następne kroki: (1) decyzje Alana: O-OS-5 (wklejki – może
czekać), O-OS-7 (pakietowanie – rekomendacja: razem), O-OS-8 (cherry-pick
prototypu – rekomendacja: tak); (2) Sonnet: E1 test-first na laptopie wg
§5, prototyp z `integration/sprint` jako referencja; (3) pomiar PC wg §6;
(4) GATE-OS. Dokument nie zmienia żadnego kontraktu B1–B6, ST-1…ST-8,
HC-0…HC-2 ani żadnej bramki; Z-2 przechodzi z rejestru H-3 do kryterium
GO-4 tej bramki.*
