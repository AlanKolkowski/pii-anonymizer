# EVAL-RECALL-AUDIT.md – audyt toru pomiarowego i recall detekcji PII

**Data:** 2026-07-12, sesja autonomiczna (Fable, architekt i adwersarz jakości).
**Branch:** `feature/eval-recall-audit` (worktree `../eval-audit-worktree`), `main` nietknięty.
**Optyka:** fałszywy negatyw (PII, które przeszło przez sito) jest nieporównanie groźniejszy
niż fałszywy pozytyw, bo odbiorcą narzędzia jest radca prawny chroniący tajemnicę zawodową.

Każda liczba w tym raporcie pochodzi z przebiegu, który da się powtórzyć podaną komendą
(§10). Zero liczb z pamięci.

---

## §1. Streszczenie wykonawcze

1. **Tor pomiarowy był zepsuty i jest naprawiony.** `eval:score` zwracał 0% na wszystkim,
   bo czytał pliki korpusu z dysku Windows (CRLF po `core.autocrlf=true`), a ground truth
   liczy offsety względem kanonicznej treści repo (LF). Dowód pomiarem: 406/406 encji
   pasuje do tekstu LF, 0/406 do CRLF, rozjazd równa się dokładnie liczbie `\n` przed
   pozycją. Ground truth **nigdy nie był zepsuty**, zepsute było czytanie. Naprawa:
   kanoniczny czytelnik LF+UTF-16, twarda walidacja przed liczeniem, stempel konwencji
   w każdym przebiegu, 100 testów strażniczych.
2. **Baseline na naprawionym torze (korpus syntetyczny): P 93,0%, R 92,1%, F1 92,6%.**
3. **Korpus kontradyktoryjny (38 dokumentów, 279 encji, 100% fikcyjnych) obniża wynik do
   P 77,9%, R 78,1%, F1 78,0%** i ujawnia 42 przecieki treści, w tym paszport, dane
   o karalności i rejestrację pojazdu przepuszczone w całości.
4. **Największe pojedyncze ryzyka nie leżą w modelu, tylko w post-processingu i konfiguracji:**
   progi pewności odrzucają PII, które model widział (8 przecieków), filtr źródeł wyrzuca
   trafienia o pewności 0,98 (6 przecieków), `maxLengthStep` skasował w całości nazwisko
   wykryte ze score 1,00, a **domyślna konfiguracja aplikacji w ogóle nie maskuje danych
   o zdrowiu i kategorii szczególnych** (art. 9 RODO), bo kategorie te nie są w
   `DEFAULT_ENABLED_CATEGORIES`.
5. **Import DOCX po cichu gubi przypisy, nagłówki i stopki stron** (przybite testem).
   Dziś to „tylko" złudzenie kompletności, ale dla planowanej rekonstrukcji DOCX
   (kopiowanie verbatim) to gotowy kanał wycieku, jeżeli MD4 nie obejdzie tych części.
6. Plan naprawczy w §8: 12 modułów bez zmiany modelu (A1–A12), 3 wymagające
   modelu/ensemble (B1–B3), 5 ograniczeń produktu do komunikowania (C1–C5).

---

## §2. Metoda i zakres pomiaru

- **Środowisko:** Node v24.18.0, Windows 10, `@huggingface/transformers` + onnxruntime
  (CPU). Modele: `wjarka/eu-pii-anonimization-multilang` (fp32) i `…-pl` (fp16), zgodnie
  z `SOURCES` w `src/pipeline/configs/entity-sources.js`.
- **Co jest mierzone:** pełny pipeline `createDefaultPipeline` z WSZYSTKIMI 35 typami
  encji włączonymi (domyślne zachowanie `npm run eval`).
- **Dwa świadome rozjazdy między pomiarem a produktem** (oba są ustaleniami audytu,
  §7.9–7.10): (a) desktop dystrybuuje warianty **q8/INT8** (`models/manifest.json`),
  a eval mierzy fp32/fp16, bo w Node `import.meta.env` nie istnieje i override
  `VITE_MODEL_DTYPE` nie działa; (b) aplikacja startuje z `defaultEnabledEntities()`
  (`src/main.js:305`), które NIE obejmuje kategorii „Zdrowie i biometria" ani „Kategorie
  szczególne", więc produkt w ustawieniu domyślnym maskuje mniej, niż mierzy eval.
- **Scoring ścisły** (`src/eval/score.js`): TP tylko przy dokładnych granicach; trafienie
  częściowe liczy się jako FP+FN. Dopasowanie: IoU ≥ 0,5, zgodność typu wymagana.
- **Analiza przecieków** (`src/eval/analyze.js`, nowe): pokrycie ZNAKOWE każdej encji
  oczekiwanej przez dowolne spany przewidziane, **agnostycznie względem typu** (PESEL
  zamaskowany jako telefon jest ukryty; pomyłka typu trafia do macierzy pomyłek, nie do
  rejestru przecieków). Dotkliwość przecieku = waga typu (1–5, §6) × niepokryta część.
  Warstwa powstania odtwarzana z `debug.json` (diffy per krok zapisywane przez runner).

---

## §3. Część A: diagnoza i naprawa toru pomiarowego

### 3.1 Ustalona przyczyna (dowód pomiarem, nie hipoteza)

Skrypt diagnostyczny (§10, D1) na wszystkich 7 dokumentach syntetycznych:

| Dokument | Encji | zgodnych z plikiem CRLF | zgodnych z tekstem LF | zgodnych przy offsetach code-point |
|---|---|---|---|---|
| pismo_01…pismo_06 | 403 | **0** | **403** | 403 |
| pismo_07_emoji_astral | 3 | 0 | **3** | **0** |
| **Razem** | **406** | **0** | **406** | 403 |

Dodatkowo: rozjazd deklarowanego offsetu względem realnej pozycji w pliku CRLF równa się
liczbie `\n` przed tą pozycją (np. pismo_01: delta=1 przy 1 nowej linii, delta=3 przy 3);
`.expected-segments.json` ma tę samą własność (348/348 zgodnych z LF). Stan gita:
`git ls-files --eol` → `i/lf w/crlf` dla całego korpusu, `core.autocrlf=true`, brak
`.gitattributes`.

**Wniosek:** konwencja ground truth to **offsety w jednostkach UTF-16 względem treści
z końcami linii LF** (kanoniczna zawartość repo). pismo_07 rozstrzyga jednostki: 3 emoji
astralne (😀, po 2 jednostki UTF-16) dają zgodność wyłącznie przy UTF-16, nie przy code
pointach. Plik roboczy na Windows dostaje CRLF od `autocrlf` i offsety przestają pasować,
narastająco o +1 na każdą wcześniejszą nową linię. `preprocess` (no-op) wykluczony jako
przyczyna już w NIGHT-NOTES §3, co pomiar potwierdza.

### 3.2 Rozstrzygnięcie: (b) uodpornienie czytelników, bez regeneracji GT

Wybrano wariant **(b) plus strażnicy**, przeciw regeneracji `.expected.json`:

- ground truth jest **poprawny** względem kanonicznej treści repo, regenerowanie go
  do offsetów CRLF zepsułoby każdy checkout LF (Linux/CI) i uzależniło dane od
  ustawień gita konkretnej maszyny;
- naprawa czytania działa na KAŻDYM checkoucie (CRLF i LF), czyli spełnia kryterium
  „przyszła zmiana nie może po cichu zepsuć pomiaru" niezależnie od maszyny.

Wdrożone (commit `8ee63f9`):

1. `src/eval/eval-text.js`: `normalizeEol`, `readEvalText`, `validateExpectedOffsets`,
   stała `EVAL_TEXT_CONVENTION='lf-utf16-v1'`;
2. `run.js` czyta korpus wyłącznie przez `readEvalText` i **stempluje** `summary.json`
   konwencją; `score.js` **odmawia** liczenia przebiegu bez zgodnego stempla (stare
   przebiegi nie mogą udawać porównywalnych) i **odmawia** liczenia, gdy jakakolwiek
   encja oczekiwana nie zgadza się z tekstem na swoich offsetach (pomiar nie może
   po cichu kłamać); `report.js`, `viewer.js`, `scripts/snapshot-segments.js` używają
   tego samego czytelnika;
3. `score.js`: `main()` za strażnikiem wykonania (import z testu nie odpala scoringu).

### 3.3 Testy strażnicze (commit `8ee63f9`, plik `src/eval/ground-truth.test.js`)

100 testów (24 na korpusie syntetycznym, reszta dochodzi automatycznie z korpusem
kontradyktoryjnym), w tym:

- zgodność offsetów każdej encji i każdego segmentu z tekstem LF (UTF-16),
- **kanarek CRLF**: walidator MUSI wykryć offsety przyłożone do tekstu CRLF, na każdym
  dokumencie, w którym jakakolwiek encja leży za pierwszą nową linią (pęka, gdy strażnik
  przestanie strzec),
- **kanarek astralny** (pismo_07): tekst musi zawierać znaki astralne, offsety muszą
  pasować w UTF-16 i NIE pasować przy interpretacji code-point (przybija konwencję),
- higiena: granice w zakresie, `start<end`, typy ze słownika pipeline'u, brak nakładań.

### 3.4 Baseline na naprawionym torze (A4)

Przebieg `2026-07-12T09-15-23`, etykieta `baseline-tor-naprawiony` (§10, K2–K3):

**Ogółem: P 93,0%, R 92,1%, F1 92,6%** (TP 374, FP 28, FN 32, 5 częściowych liczonych
jako FP+FN). Segmentacja: P 98,8%, R 96,8%, F1 97,8%.

| Typ | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| ACCOUNT_IDENTIFIER | 0,0% | 0,0% | 0,0% | 0 | 1 | 6 |
| BANK_ACCOUNT_IDENTIFIER | 100% | 100% | 100% | 7 | 0 | 0 |
| DATE_OF_BIRTH | 100% | 100% | 100% | 2 | 0 | 0 |
| DEVICE_IDENTIFIER | 0,0% | 0,0% | 0,0% | 0 | 1 | 3 |
| DOCUMENT_REFERENCE | 69,0% | 87,0% | 76,9% | 20 | 9 | 3 |
| EMAIL_ADDRESS | 100% | 100% | 100% | 16 | 0 | 0 |
| FINANCIAL_AMOUNT | 100% | 100% | 100% | 41 | 0 | 0 |
| HEALTH_DATA | 100% | 100% | 100% | 9 | 0 | 0 |
| INCOME_COMPENSATION | 0,0% | – | 0,0% | 0 | 1 | 0 |
| LOCATION | 100% | 88,2% | 93,8% | 15 | 0 | 2 |
| ORGANIZATION_IDENTIFIER | 100% | 100% | 100% | 17 | 0 | 0 |
| ORGANIZATION_NAME | 76,8% | 77,9% | 77,4% | 53 | 16 | 15 |
| PERSON_IDENTIFIER | 100% | 95,5% | 97,7% | 21 | 0 | 1 |
| PERSON_NAME | 100% | 98,6% | 99,3% | 70 | 0 | 1 |
| PERSON_ROLE_OR_TITLE | 100% | 96,4% | 98,2% | 27 | 0 | 1 |
| PHONE_NUMBER | 100% | 100% | 100% | 27 | 0 | 0 |
| POSTAL_ADDRESS | 100% | 100% | 100% | 49 | 0 | 0 |

Przecieki treści na korpusie syntetycznym (analiza znakowa): **8**, w tym trzy o wadze 4:
`SB/00234/PN` (ACCOUNT_IDENTIFIER, warstwa: filtr źródeł), **„Sebastian Grabowski"
(PERSON_NAME, warstwa: `maxLengthStep` – model dał score 1,00 na spanie 68 znaków,
limit 50 znaków wyrzucił encję W CAŁOŚCI)**, `5CD3001XYZ` (DEVICE_IDENTIFIER, warstwa:
próg). Do tego „ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH" pisane wersalikami – trzykrotnie
niewykryte przez żaden model (warstwa: detekcja).

---

## §4. Część B: korpus kontradyktoryjny

`test-data/adversarial/`: **38 dokumentów, 279 encji oczekiwanych, 100% fikcyjnych**
(PESEL/NIP/REGON/IBAN z poprawnymi sumami kontrolnymi, ale nienależące do nikogo;
sygnatury syntetyczne). Generowany deterministycznie przez
`scripts/generate-adversarial-corpus.mjs` (offsety liczone, nigdy ręczne; samokontrola
przy generacji; strażnik `ground-truth.test.js` obejmuje korpus automatycznie).
Katalog wektorów ataku, po jednym zdaniu na dokument: `test-data/adversarial/README.md`.
Polityka anotacji (sądy/banki jako ORGANIZATION_NAME, sygnatury własnych spraw jako
DOCUMENT_REFERENCE, cytowania orzecznictwa i przepisów NIEanotowane jako pułapki FP,
wynagrodzenia jako FINANCIAL_AMOUNT, PII zniekształcone przez OCR anotowane prawdziwym
typem): tamże, z uzasadnieniem.

Dodatkowo **2 fixtury DOCX** (`test-data/adversarial/docx/`, buildery w
`src/docx-rebuild/test-helpers/docx-fixture.js`) z PII w tabeli, przypisie, nagłówku
i stopce strony, pod ścieżkę importu `src/file-import/` – wynik w §7.8.

Kuracja po pierwszym przebiegu (commit `867f33d`): pięć luk anotacyjnych MOJEGO ground
truth wykrytych przez model (m.in. imiona rodziców „syn Marka i Grażyny" – to są dane
osobowe; metajęzykowe „Wilk to nazwisko pozwanej" – ujawnia nazwisko) plus jedna
dwuznaczna pułapka przeredagowana. Odnotowane, bo to miara uczciwości korpusu: GT
poprawiano wyłącznie tam, gdzie racja była po stronie modelu.

---

## §5. Część C: wyniki na korpusie kontradyktoryjnym

Przebieg `2026-07-12T09-42-09`, etykieta `adversarial-final` (§10, K4–K6).

**Ogółem: P 77,9%, R 78,1%, F1 78,0%** (TP 218, FP 62, FN 61, 18 częściowych liczonych
jako FP+FN). Spadek F1 względem korpusu syntetycznego: **–14,6 p.p.** – korpus atakuje
skutecznie.

| Typ | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| BANK_ACCOUNT_IDENTIFIER | 87,5% | 77,8% | 82,4% | 7 | 1 | 2 |
| CRIMINAL_OFFENCE_DATA | 0,0% | 0,0% | 0,0% | 0 | 0 | 1 |
| DATE_OF_BIRTH | 100% | 100% | 100% | 3 | 0 | 0 |
| DOCUMENT_REFERENCE | 36,4% | 57,1% | 44,4% | 8 | 14 | 6 |
| EMAIL_ADDRESS | 85,7% | 85,7% | 85,7% | 6 | 1 | 1 |
| FINANCIAL_AMOUNT | 85,7% | 90,9% | 88,2% | 30 | 5 | 3 |
| HEALTH_DATA | 50,0% | 50,0% | 50,0% | 1 | 1 | 1 |
| INCOME_COMPENSATION | 0,0% | – | 0,0% | 0 | 2 | 0 |
| LOCATION | 85,7% | 75,0% | 80,0% | 12 | 2 | 4 |
| ORGANIZATION_IDENTIFIER | 87,5% | 77,8% | 82,4% | 14 | 2 | 4 |
| ORGANIZATION_NAME | 65,0% | 76,5% | 70,3% | 13 | 7 | 4 |
| PAYMENT_CARD | 0,0% | – | 0,0% | 0 | 1 | 0 |
| PERSON_ATTRIBUTE | 100% | 100% | 100% | 3 | 0 | 0 |
| PERSON_IDENTIFIER | 92,9% | 68,4% | 78,8% | 13 | 1 | 6 |
| PERSON_NAME | 85,2% | 88,2% | 86,7% | 75 | 13 | 10 |
| PERSON_ROLE_OR_TITLE | 30,8% | 23,5% | 26,7% | 4 | 9 | 13 |
| PHONE_NUMBER | 100% | 100% | 100% | 7 | 0 | 0 |
| POSTAL_ADDRESS | 88,0% | 91,7% | 89,8% | 22 | 3 | 2 |
| TRADE_UNION_MEMBERSHIP | 0,0% | 0,0% | 0,0% | 0 | 0 | 1 |
| VEHICLE_IDENTIFIER | 0,0% | 0,0% | 0,0% | 0 | 0 | 3 |

Uwaga interpretacyjna: scoring ścisły karze podwójnie trafienia częściowe. Rejestr
przecieków (§6) mierzy to, co naprawdę wychodzi, na poziomie znaków.

### 5.1 Macierz pomyłek (parowanie po IoU ≥ 0,5 bez wymogu typu, elementy niediagonalne)

| Oczekiwane | Przewidziane | n | Znaczenie dla tajemnicy |
|---|---|---|---|
| PERSON_IDENTIFIER | DOCUMENT_REFERENCE | 4 | treść ukryta, typ błędny: groźne przy wyłączaniu kategorii i dla semantyki legendy |
| VEHICLE_IDENTIFIER | DOCUMENT_REFERENCE | 2 | jw. (VIN‑y maskowane jako numery dokumentów) |
| ORGANIZATION_IDENTIFIER | DOCUMENT_REFERENCE | 1 | jw. |
| BANK_ACCOUNT_IDENTIFIER | DOCUMENT_REFERENCE | 1 | jw. |
| TRADE_UNION_MEMBERSHIP | ORGANIZATION_NAME | 1 | dane art. 9 ukryte jako „organizacja": znika status kategorii szczególnej |
| PERSON_NAME | ORGANIZATION_NAME | 1 | nazwisko ukryte jako organizacja |
| PERSON_ROLE_OR_TITLE | ORGANIZATION_NAME | 1 | – |
| POSTAL_ADDRESS | PERSON_NAME | 1 | – |

Wiersz „(brak)" (niewykryte w ogóle, per typ): PERSON_ROLE_OR_TITLE 10, PERSON_NAME 6,
FINANCIAL_AMOUNT 3, LOCATION 3, DOCUMENT_REFERENCE 3, po 1: PERSON_IDENTIFIER,
EMAIL_ADDRESS, ORGANIZATION_NAME, ORGANIZATION_IDENTIFIER, VEHICLE_IDENTIFIER,
CRIMINAL_OFFENCE_DATA. Kolumna „(brak)" (czyste FP): PERSON_NAME 9,
PERSON_ROLE_OR_TITLE 7, FINANCIAL_AMOUNT 5, DOCUMENT_REFERENCE 3, INCOME_COMPENSATION 2,
POSTAL_ADDRESS 2, po 1: PAYMENT_CARD, ORGANIZATION_NAME, LOCATION, EMAIL_ADDRESS.

**Wniosek z macierzy:** pomyłki typów wewnątrz rodziny „identyfikatorów" (PESEL/VIN/NIP/
IBAN → DOCUMENT_REFERENCE) są częste. Dopóki wszystkie kategorie są włączone, treść
pozostaje ukryta; przy selektywnym wyłączaniu kategorii przez użytkownika pomyłka typu
staje się kanałem wycieku (użytkownik wyłącza „Numer faktury", a odsłania PESEL-e
zamaskowane pod tym typem).

### 5.2 Fałszywe pozytywy (pułapki: 20 czystych FP na finalnym przebiegu)

Pułapki zadziałały – nic z tej listy nie jest danymi klienta:

- **cytowania orzecznictwa**: „CZP 87/22", „CSKP 12/21" maskowane jako DOCUMENT_REFERENCE
  (uszkodzi cytowania w piśmie przekazanym AI);
- **przepisy i liczby prawne**: „działce nr 112/4" jako POSTAL_ADDRESS, „ulicy
  Rzemieślniczej" (sama nazwa ulicy) jako POSTAL_ADDRESS, „Wisłą" jako LOCATION;
- **wersaliki nagłówka**: „UMOWA KREDYTU GOTÓWKOWEGO" jako ORGANIZATION_NAME (score 1,00!);
- **parametry finansowe**: „11,45%", „4,20 p.p.", „WIRON 1M" jako FINANCIAL_AMOUNT,
  „netto" ×2 jako INCOME_COMPENSATION – zaszumią każdy dokument kredytowy;
- **role i słowa gramatyczne**: „Biegły" i „Kowal" (rzeczownik pospolity w funkcji
  definicyjnej) jako PERSON_NAME, „Kredytobiorcą" (narzędnik! blocklista zna tylko
  mianownik), „Wnioskodawczyni", „Przewodniczący", ucięte „Wniosko", „Sz"+„P." z koperty,
  „B" z „kat. B" jako PERSON_NAME.

---

## §6. Rejestr przecieków (dotkliwość = waga typu × niepokryta część)

Wagi typów (1–5) zakotwiczone w szkodzie dla tajemnicy zawodowej, nie w taksonomii
modelu: 5 = identyfikatory osoby i kategorie art. 9–10 RODO; 4 = bezpośrednie namiary
(nazwisko, adres, kontakt, konto, pojazd); 3 = pośrednio identyfikujące (sygnatury,
daty urodzenia, kwoty, atrybuty); 2 = podmioty gospodarcze i miejscowości; 1 = role.
Pełna lista: `TYPE_WEIGHTS` w `src/eval/analyze.js`. Pokrycie liczone znakowo,
agnostycznie względem typu.

**Korpus kontradyktoryjny: 42 przecieki. Suma score wg typu:** PERSON_NAME 15,8 (6),
PERSON_ROLE_OR_TITLE 8,3 (11), DOCUMENT_REFERENCE 7,0 (4), LOCATION 6,0 (3),
VEHICLE_IDENTIFIER 5,8 (2), FINANCIAL_AMOUNT 5,5 (2), PERSON_IDENTIFIER 5,5 (2),
CRIMINAL_OFFENCE_DATA 5,0 (1), ORGANIZATION_NAME 2,7 (4), ORGANIZATION_IDENTIFIER 2,5 (2),
HEALTH_DATA 2,1 (1), BANK_ACCOUNT_IDENTIFIER 1,9 (2), TRADE_UNION_MEMBERSHIP 0,8 (1),
POSTAL_ADDRESS 0,2 (1).

**Wg warstwy powstania:** granice 22, próg pewności 8, filtr źródeł 6, detekcja
(model+regex ślepe) 5, dedup 1.

Czołówka rejestru (pełny rejestr: `ANALIZA.md` w katalogu przebiegu, §10 K6; kolumna
„koszt" odsyła do modułów planu z §8):

| # | Score | Dokument | Typ | Pokrycie | Rezyduum (co wychodzi) | Warstwa | Hipoteza przyczyny | Naprawa (koszt) |
|---|---|---|---|---|---|---|---|---|
| 1 | 5,0 | adw_14 | PERSON_IDENTIFIER | 0% | `EJ 1234567` (paszport) | próg | model dał 0,78, próg typu 0,9 odrzucił | A7 (S) |
| 2 | 5,0 | adw_38 | CRIMINAL_OFFENCE_DATA | 0% | `skazany prawomocnym wyrokiem za przywłaszczenie mienia` | detekcja | fraza opisowa poza zasięgiem obu modeli | B3 (L) + A12 (natychmiast: kategoria wyłączona domyślnie!) |
| 3 | 4,0 | adw_05 | PERSON_NAME | 0% | `Sad` (nazwisko-pułapka) | filtr źródeł | polish-fp16 wykrył ze score 0,98, ale nie jest autorytatywny dla PERSON_NAME | A8 (M) |
| 4 | 4,0 | adw_24 | PERSON_NAME | 0% | `K o n r a d   Ż u r a w s k i` | detekcja | rozstrzelenie OCR rozbija tokenizację | C1 (ograniczenie + ostrzeżenie) |
| 5 | 4,0 | adw_31 | VEHICLE_IDENTIFIER | 0% | `CT 4567K` (rejestracja) | próg | model dał 0,67, próg 0,7 odrzucił (0,03!) | A7 (S) |
| 6 | 3,2 | adw_06 | PERSON_NAME | 20% | `. M.` z „J. M." | granice | inicjały tnie tokenizacja modelu (znany przeciek z RESULTS-ensemble) | A2/B1 (M) |
| 7 | 3,2 | adw_28 | PERSON_NAME | 20% | `J. ….` | granice | jw. | A2/B1 (M) |
| 8 | 3,0 | adw_17 | FINANCIAL_AMOUNT | 0% | `dwukrotności wynagrodzenia zasadniczego` | detekcja | kwota opisowa bez cyfr | C2 (ograniczenie, weryfikator flaguje) |
| 9 | 3,0 | adw_37 | DOCUMENT_REFERENCE | 0% | `KM 1552/25` | filtr źródeł | polish-fp16 dał kandydata złego typu, multilang milczał | A2 (S) |
| 10 | 2,5 | adw_15 | FINANCIAL_AMOUNT | 17% | `0,5% wartości kontraktu…` | granice | kara umowna opisowa | C2 |
| 11 | 2,1 | adw_38 | HEALTH_DATA | 58% | `choruje na ` | granice | model łapie nazwę choroby, gubi kontekst | B3; A12 domyślnie wyłączone! |
| 12 | 2,0 | adw_11 | ORGANIZATION_IDENTIFIER | 0% | `381245999` (REGON) | dedup | szeroki span modelu (score 0,95) skasowany, bo nakładał się z precyzyjnym regexem tego samego typu | A6 (M) |
| 13 | 2,0 | adw_14 | LOCATION | 0% | `Torunia` | filtr źródeł | kandydat złego typu odfiltrowany, multilang milczał | A7/A8 |
| 14 | 2,0 | adw_24 | ORGANIZATION_NAME | 0% | `Z A K Ł A D   U B E Z P I E C Z E Ń …` | detekcja | rozstrzelone wersaliki | C1 |
| 15–16 | 2,0 | adw_30, adw_38 | LOCATION | 0% | `Chełmża`, `Toruniu` | próg | score 0,85–0,87 < próg 0,9 | A7 (S) |
| 17 | 1,8 | adw_31 | VEHICLE_IDENTIFIER | 56% | `CTR ` | granice | rejestracja przyczepy przecięta | A1/A7 |
| 18 | 1,8 | adw_23 | BANK_ACCOUNT_IDENTIFIER | 56% | ` 0001 9876 5432` | granice | OCR `lO9O` rozbija regex IBAN, model łapie połowę | A1 (S) |
| 19–21 | 1,1–1,5 | adw_30/37 | DOCUMENT_REFERENCE | 50–64% | `II K `, `I Co `, `I C ` | granice | model gubi repertorium, zostaje sam numer | A2 (S) |
| 22–29 | 1,0 | różne | PERSON_ROLE_OR_TITLE | 0% | `r. pr.`, `adw.`, `prezes zarządu`, `księgowa`, `kierownika produkcji`, `sekr. sąd.` | próg ×4, filtr źródeł ×3, detekcja ×1 | próg 0,9 + wyłączność multilang dla ról | A7/A8 (S) |
| 30 | 0,8 | adw_38 | TRADE_UNION_MEMBERSHIP | 83% | `członkinią ` | granice | nazwa związku złapana jako ORG, przynależność nie | B3 |
| 31–42 | ≤0,7 | różne | różne | 69–98% | pojedyncze znaki i końcówki (`. `, `PL `, `”`, `o`) | granice | drobne niedociągnięcia granic (cudzysłowy, prefiks PL, sklejki) | A1/A5 (S) |

Rejestr syntetyczny (8 przecieków, §3.4) potwierdza te same klasy: filtr źródeł
(`SB/00234/PN`), **maxLength** („Sebastian Grabowski", jedyny przypadek tej warstwy,
ale o wadze 4 i ze score 1,00 – A5), próg (`5CD3001XYZ`, „notariusz"), detekcja
(wersaliki ZUS ×3).

---

## §7. Ustalenia systemowe (poza tabelą przecieków)

1. **Progi pewności są dziś kalibrowane pod precyzję, nie pod tajemnicę.**
   PERSON_IDENTIFIER 0,9, LOCATION 0,9, PERSON_ROLE 0,9, VEHICLE 0,7
   (`src/pipeline/configs/entity-rules.js`). Paszport odrzucony przy 0,78, rejestracja
   przy 0,67. Dla typów wagi 4–5 każdy odrzucony kandydat to potencjalny wyciek.
2. **Filtr źródeł wyrzuca trafienia, których nikt inny nie ma.** `sourceFilterStep`
   honoruje wyłącznie źródła z `ENTITY_SOURCES[typ]`; kandydat PERSON_NAME „Sad"
   z polish-fp16 ze score 0,98 został odrzucony, bo dla PERSON_NAME autorytatywny jest
   tylko multilang (decyzja z eksperymentu ensemble, chroniąca przed fragmentacją nazwisk
   PL-modelu, ale bez siatki bezpieczeństwa dla wysokich score).
3. **`maxLengthStep` odrzuca encje w całości zamiast je przycinać** – dowód: PERSON_NAME
   score 1,00, span 68 znaków > limit 50, skutek: pełny wyciek nazwiska. Dla sita
   nadmiar maskowania jest tańszy niż dziura.
4. **Dedup potrafi skasować pokrycie, które model już dał**: precyzyjny regex tego samego
   typu nakładający się CZĘŚCIOWO na szeroki span modelu usuwa cały span (REGON w adw_11).
5. **Blocklista ról zna tylko formy mianownikowe** (`/(?:awca|biorca)$/`): „Kredytobiorcą"
   (narzędnik) i ucięte „Wniosko" przechodzą.
6. **Wersaliki oślepiają oba modele** (ZUS ×3 na korpusie syntetycznym, nagłówek umowy
   jako FP): tekst prawniczy jest pełen wersalików (komparycje, nagłówki, oznaczenia stron).
7. **Domyślna konfiguracja aplikacji nie maskuje zdrowia ani kategorii szczególnych.**
   `DEFAULT_ENABLED_CATEGORIES` (`entity-sources.js`) nie zawiera `health-biometric`
   ani `special-categories`; `src/main.js:305` startuje z tego domyślnego zbioru.
   W aktach ZUS-owych, karnych czy pracowniczych najcięższe dane przechodzą wtedy
   w 100%, niezależnie od jakości modelu. Eval (wszystkie typy) tego nie widzi –
   to rozjazd konfiguracji, nie detekcji.
8. **Import DOCX po cichu gubi przypisy, nagłówki i stopki** (mammoth.extractRawText;
   przybite testami `src/file-import/docx-adversarial.test.js` na fixturach z §4):
   tabele są spłaszczane poprawnie, przypis/nagłówek/stopka znikają bez żadnego
   ostrzeżenia. Dziś: użytkownik może sądzić, że „całe pismo" zostało przefiltrowane.
   Jutro (DOCX-REBUILD, kopiowanie verbatim nietkniętych części): surowe PII z tych
   części przejdzie do wyeksportowanego pliku, jeżeli MD4 ich nie obejdzie.
9. **Eval mierzy inny artefakt niż dystrybuuje desktop**: fp32/fp16 vs q8
   (`models/manifest.json`), a RESULTS-ensemble odnotowuje, że int8 daje więcej
   fragmentacji. Jakość desktopu jest dziś niezmierzona (A10).
10. **Import .txt nie normalizuje końców linii** (`src/file-import/txt.js`): produkt
    może dostać CRLF, eval zawsze mierzy LF. Różnica dotąd nieobserwowana w danych,
    ale to niekontrolowana zmienna (A11).

---

## §8. Część D: plan naprawczy

Konwencja jak w projektach repo: moduł → kontrakt → kryterium akceptacji → test
dowodzący. Wykonywalne przez Sonneta bez nadzoru; każda zmiana w `src/pipeline/**`
kończy się tagowanym `npm run eval` (oba korpusy) + `eval:score` + `eval:analyze`,
porównanym z baseline'ami z §3.4 i §5. Koszty: S (≤ pół dnia), M (1–2 dni), L (projekt).

### 8.1 Kategoria 1: naprawy bez zmiany modelu

**A1 – identyfikatory odporne na separatory i sumy kontrolne** (koszt: S–M)
Kontrakt: `findRegexEntities` rozpoznaje PESEL/NIP/REGON(9/14)/KRS/NRB-IBAN w zapisach
ze spacjami, dywizami i pojedynczym łamaniem wiersza; kandydaci z poprawną sumą
kontrolną (PESEL wagi 1-3-7-9…, NIP mod 11, REGON mod 11, IBAN mod 97) dostają score
1,0, bez sumy nie powstają (precyzja z matematyki, nie z kontekstu); NRB bez prefiksu
PL wchodzi po pozytywnym mod 97 dla `PL`+cyfry.
Dowód wykonalności (zmierzony, §10 D2): PESEL z separatorami + suma kontrolna na obu
korpusach: TP 16, FP 3, przy czym wszystkie 3 FP to telefony (nadal maskowane jako PII,
strata semantyki typu, nie tajemnicy) i znikają po wykluczeniu kontekstu `+48`/`tel.`.
Kryterium akceptacji: adw_09–12 i adw_23 bez przecieków tych typów; korpus syntetyczny
bez regresji (P/R identyfikatorów = 100%).
Test: jednostkowe wzorce + oba korpusy.

**A2 – regex sygnatur repertoriów sądowych i komorniczych** (koszt: S)
Kontrakt: wzorzec `[rzymska]? + repertorium (C, K, Ns, Co, GC, KM, Nc, ACa, …) +
nr/rok (+ „upr")` → DOCUMENT_REFERENCE score 1,0.
Dowód wykonalności (zmierzony): TP 9, FP 0 na korpusie kontradyktoryjnym, 0 FP na
syntetycznym. Kryterium: przecieki #9, #19–21 znikają; cytowania „CZP 87/22" pozostają
kwestią B1/C5 (wzorzec bez kontekstu „sygn. akt" NIE obejmuje repertoriów SN: CZP,
CSKP – celowo, żeby nie pogarszać FP na orzecznictwie).
Test: jednostkowy na formatach z adw_37 + pułapki z adw_32 jako negatywy.

**A3 – telefony: nawiasy, formy lokalne, zero wiodące** (koszt: S)
Kontrakt: `(56) 622-33-44`, `622 33 44` (7 cyfr z kontekstem `tel.`), `0 501 234 567`
wykrywane; bez kontekstu telefonicznego 7-cyfrowe ciągi NIE wchodzą (ochrona precyzji).
Kryterium: adw_13 bez FN; zero nowych FP na obu korpusach. Test: jednostkowy + korpusy.

**A4 – kwoty: kropka tysięcy, brak groszy, waluta przed liczbą, EUR** (koszt: S)
Kontrakt: rozszerzenie wzorca kwot o `15.000,00 zł`, `1500 zł`, `PLN 4.200`,
`2 500 000,00 EUR`; procenty i `p.p.` jawnie wykluczone (redukcja FP z adw_29).
Kryterium: adw_15 pokrycie 100%, adw_29 bez FP na stopach procentowych. Test: jw.

**A5 – `maxLengthStep` nie wyrzuca, tylko oznacza** (koszt: S)
Kontrakt: encja dłuższa niż `maxLength` typu wagi ≥ 3 nie znika; zostaje zamaskowana
w całości (over-masking preferowany), opcjonalnie z flagą `oversized` dla UI.
Kryterium: „Sebastian Grabowski" (pismo_04) przestaje wyciekać; liczba FP na obu
korpusach nie rośnie o więcej niż liczba oznaczonych encji. Test: jednostkowy + korpusy.

**A6 – dedup nie kasuje pokrycia** (koszt: M)
Kontrakt: `removeEntitiesCoveredByPreciseRegex` usuwa encję modelu tylko, gdy regex
pokrywa ją W CAŁOŚCI; przy pokryciu częściowym span modelu jest przycinany do różnicy,
nie usuwany. Kryterium: REGON z adw_11 przestaje wyciekać; korpus syntetyczny bez
regresji. Test: jednostkowy przypadek adw_11 + korpusy.

**A7 – progi typów wagi ≥ 3 pod tajemnicę, nie pod estetykę** (koszt: S kod, M pomiar)
Kontrakt: `entity-rules.js` dostaje nowe progi wyprowadzone Z POMIARU (krzywa P/R na
obu korpusach dla progów 0,3–0,9 co 0,1): punkt startowy do weryfikacji:
PERSON_IDENTIFIER 0,9→0,5, VEHICLE 0,7→0,5, LOCATION 0,9→0,75, PERSON_ROLE 0,9→0,75,
DEVICE bez zmian po pomiarze. Kryterium: przecieki #1, #5, #15–16, #22–29 znikają,
a łączna liczba FP na korpusie syntetycznym nie rośnie więcej niż o 20% (do jawnej
akceptacji przy bramce). Test: skrypt pomiarowy progów + oba korpusy przed/po.

**A8 – siatka bezpieczeństwa w filtrze źródeł** (koszt: M)
Kontrakt: kandydat typu wagi ≥ 4 z nieautorytatywnego źródła NIE jest odrzucany, jeżeli
score ≥ 0,9; zamiast tego przechodzi z flagą źródła (dedup i tak rozstrzyga nakładki).
Kryterium: „Sad" (adw_05) i `SB/00234/PN` (pismo_03) przestają wyciekać; fragmentacja
nazwisk PL-modelu (znana z RESULTS-ensemble) nie podnosi FP PERSON_NAME na korpusie
syntetycznym o więcej niż 10% (inaczej: podnieść próg siatki do 0,95).
Test: oba korpusy przed/po, przypadki z rejestru jako asercje.

**A9 – blocklista ról odporna na fleksję i ucięcia** (koszt: S)
Kontrakt: wzorce `-awca/-biorca` rozszerzone o formy przypadków zależnych
(`-awcy/-awcą/-awcom/-biorcy/-biorcą/…`); dodatkowo odrzucenie spanów będących
uciętym prefiksem słowa roli („Wniosko" + granica w środku słowa). Kryterium:
FP „Kredytobiorcą", „Wniosko" znikają; role rzeczywiste (adw., r. pr.) nieuszczuplone.
Test: jednostkowy.

**A10 – eval mierzy artefakt desktopu (q8)** (koszt: S)
Kontrakt: `entity-sources.js` honoruje `process.env.VITE_MODEL_DTYPE` obok
`import.meta.env` (Node); nowy przebieg `--label=q8-parity` na obu korpusach; tabela
fp32/fp16 vs q8 dołączona do tego raportu aneksem. Kryterium: różnice per typ znane
i opisane; jeżeli q8 pogarsza typy wagi ≥ 4, jawna decyzja produktowa (C4).
Test: przebiegi porównawcze.

**A11 – normalizacja EOL na imporcie tekstu** (koszt: XS)
Kontrakt: `extractTxt` (i inne ekstraktory zwracające tekst) normalizują `\r\n?` → `\n`.
Kryterium: pipeline w produkcie i w evalu widzi ten sam tekst; testy importu przechodzą.
Test: jednostkowy z plikiem CRLF.

**A12 – kategorie szczególne w konfiguracji domyślnej** (koszt: XS kod, decyzja Alana)
Kontrakt (wariant rekomendowany): `DEFAULT_ENABLED_CATEGORIES` obejmuje także
`health-biometric` i `special-categories`; wariant minimalny: przy starcie z domyślną
konfiguracją UI pokazuje trwałe ostrzeżenie „dane o zdrowiu i karalności NIE są
maskowane". Kryterium: świadoma decyzja zamiast cichego zera recall na art. 9–10.
Test: jednostkowy na `defaultEnabledEntities()` + smoke UI. **Wymaga decyzji
produktowej** (zapisano w §9 i w notatce końcowej).

### 8.2 Kategoria 2: wymagają zmiany modelu lub ensemble

**B1 – współautorytatywność polish-fp16 dla PERSON_NAME/PERSON_ROLE (pełny ensemble)**
(koszt: M–L) Rozszerzenie `ENTITY_SOURCES`, dedup jako arbiter fragmentacji; wymaga
pełnej krzywej P/R na obu korpusach (ryzyko znane z RESULTS-ensemble: „Joan"+„na
Kwiatkowska"). A8 jest tanim podzbiorem tej zmiany; B1 wchodzi tylko, jeżeli A8
nie wystarczy na inicjały i role.

**B2 – drugi przebieg NER na tekście znormalizowanym z wersalików** (koszt: M)
Case-folding zachowuje długości w polszczyźnie dla tych transformacji (Title Case na
tokenach wersalikowych), więc offsety mapują się 1:1 bez warstwy transformacji;
kandydaci z przebiegu znormalizowanego wchodzą jako osobne źródło z własnym progiem.
Kryterium: ZUS ×3 (pismo_03) i nagłówki adw_24/29 przestają być ślepą plamką bez
wzrostu FP > 10% na korpusach. Uwaga: koszt inferencji ×2 na segmentach z wersalikami.

**B3 – kategorie szczególne: leksykon wysokiej precyzji albo lepszy model** (koszt: L)
Frazy opisowe („skazany wyrokiem za…", „choruje na…", „członkini związku…") są poza
zasięgiem obu modeli. Opcja tania: leksykalne wzorce kontekstowe (czasownik+kategoria)
o wysokiej precyzji, flagowane jako źródło `lexicon`; opcja docelowa: fine-tuning na
polskich tekstach procesowych (poza zakresem tej iteracji). Do czasu wdrożenia
obowiązuje C-kategoria komunikacji ograniczeń + A12.

### 8.3 Kategoria 3: ograniczenia produktu (dokumentować i komunikować, nie obiecywać)

**C1 – OCR: rozstrzelone litery i zbite sekwencje.** Bez warstwy transformacji tekstu
z mapowaniem offsetów (dziś nieistniejącej: `preprocess` jest no-op WŁAŚNIE dlatego,
że offsety muszą wskazywać oryginał) pipeline nie zobaczy „K o n r a d". Komunikat:
przy imporcie z OCR wynik wymaga przeglądu człowieka; weryfikator (W5) powinien
flagować sekwencje pojedynczych liter. Decyzja o budowie warstwy mapowania offsetów
to osobny projekt (nietrywialny, dotyka całego pipeline'u).

**C2 – kwoty opisowe** („dwukrotność wynagrodzenia", „0,5% wartości kontraktu"):
nie są maskowane; N-5 weryfikatora flaguje kwoty słowne. Komunikować w dokumentacji.

**C3 – DOCX poza korpusem tekstu**: przypisy, nagłówki i stopki nie przechodzą przez
sito (import ich nie widzi). Komunikat w UI przy imporcie DOCX. Dla DOCX-REBUILD:
rekomendacja R2 (§9).

**C4 – jakość wariantu q8** nieznana do czasu A10; jeżeli pomiar potwierdzi regresję
na typach wagi ≥ 4: decyzja instalator większy (fp16) albo jawne ograniczenie.

**C5 – nadmaskowanie referencji prawnych** (cytowania orzecznictwa, Dz.U., stopy
procentowe): świadomy koszt strojenia pod recall; częściowo ograniczą go A2/A4/A9.
Dokument przekazywany AI może mieć zamaskowane cytowania – użytkownik musi o tym
wiedzieć (wpływ na jakość odpowiedzi AI, nie na tajemnicę).

---

## §9. Rekomendacje do dokumentów projektowych (bez modyfikowania ich w tej sesji)

- **R1 (SHARED-FOUNDATION §7.6, dyscyplina dowodowa):** dopisać, że tagowany eval
  obejmuje OBA korpusy (`--dir=test-data/adversarial`) oraz `eval:analyze`, a bramka
  patrzy na rejestr przecieków, nie tylko na F1.
- **R2 (DOCX-REBUILD, MD4):** silnik tokenów MUSI przechodzić także `word/header*.xml`,
  `word/footer*.xml`, `word/footnotes.xml`, `word/endnotes.xml` (i komentarze zgodnie
  z decyzją 8 – raport-only), inaczej kopiowanie verbatim wyniesie surowe PII;
  fixtury z `src/docx-rebuild/test-helpers/docx-fixture.js` nadają się na goldeny.
- **R3 (LOCAL-VERIFIER, W5/N-2):** po A1 checker N-2 zyskuje separator-tolerancyjne
  wzorce za darmo (wspólne `findRegexEntities`); dopisać do katalogu checkerów
  flagowanie sekwencji pojedynczych liter (C1) i kwot słownych (C2, już częściowo w N-5).
- **R4 (PRODUCT-DECISIONS):** decyzja A12 (kategorie szczególne w domyślnej konfiguracji)
  wymaga wpisu po rozstrzygnięciu przez Alana.

---

## §10. Reprodukcja (wszystkie komendy z katalogu głównego repo)

| # | Co | Komenda |
|---|---|---|
| D1 | dowód przyczyny rozjazdu offsetów | skrypt z §3.1 (zachowany w scratchpadzie sesji; równoważnik: `node -e` z NIGHT-NOTES §3 + porównanie po `replace(/\r\n/g,'\n')`) – po naprawie zastąpiony na stałe strażnikiem `npx vitest run src/eval/ground-truth.test.js` |
| K1 | testy strażnicze + całość | `npm test` (86 plików / 1024 testy na koniec sesji) |
| K2 | baseline syntetyczny | `npm run eval -- --label=baseline-tor-naprawiony` → run `2026-07-12T09-15-23` |
| K3 | scoring baseline'u | `npm run eval:score 2026-07-12T09-15-23` |
| K4 | przebieg kontradyktoryjny | `npm run eval -- --dir=test-data/adversarial --label=adversarial-final` → run `2026-07-12T09-42-09` |
| K5 | scoring | `npm run eval:score 2026-07-12T09-42-09` |
| K6 | rejestr przecieków + macierz | `npm run eval:analyze 2026-07-12T09-42-09` → `ANALIZA.md`, `analysis.json` w katalogu przebiegu |
| D2 | dry-testy wykonalności A1/A2 | skrypt w scratchpadzie sesji (regex sygnatur: TP 9/FP 0; PESEL-sep+suma: TP 16/FP 3 – wszystkie FP to telefony) – do powtórzenia jako testy modułów A1/A2 |
| K7 | regeneracja korpusu | `node scripts/generate-adversarial-corpus.mjs` (deterministyczna, bajt w bajt) |
| K8 | fixtury DOCX | `node scripts/generate-adversarial-docx.mjs`; pin: `npx vitest run src/file-import/docx-adversarial.test.js` |

Katalogi przebiegów (`test-data/results/…`) są poza gitem; liczby w raporcie odtwarza
każdorazowo K2–K6 (modele są deterministyczne na CPU dla stałego wejścia).

---

*Raport sporządzony w ramach sesji `feature/eval-recall-audit`. Główne artefakty:
`src/eval/eval-text.js`, `src/eval/ground-truth.test.js`, `src/eval/analyze.js`,
`test-data/adversarial/**`, `scripts/generate-adversarial-*.mjs`,
`src/file-import/docx-adversarial.test.js`. Notatka nocna: `EVAL-AUDIT-NOTES.md`.*
