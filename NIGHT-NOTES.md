# NIGHT-NOTES.md – przebieg nocny, Faza 0 (fundament wspólny)

**Data:** 2026-07-11/12, praca autonomiczna (Sonnet), bez pytań w trakcie.
**Branch:** `feature/foundation-phase0`, 10 commitów, `main` nietknięty.
**Wynik:** wszystkie moduły z listy „start natychmiast" (§7.2 SHARED-FOUNDATION)
ukończone: S1, S2, S3, S4, MD1, MD2, W5. `npm test`: 66/713 → 83/899,
zero regresji, weryfikowane po KAŻDYM z 10 commitów, nie tylko na końcu.

Kolejność czytania tego pliku dla bramki Opusa: §1 (co gotowe), §2 (decyzje
do potwierdzenia – to jest sedno bramki), §3 (odkrycie: eval:score zepsuty),
§4 (czego nie da się zweryfikować bez sprzętu), §5 (obserwacja poboczna).

---

## §1. Ukończone moduły (moduł → commit → status)

| Moduł | Commit | Testy | Bramka wymagana |
|---|---|---|---|
| **M-S4** crc32 | `8e8e758` | 9 nowych, `export/zip.test.js` + `export/deanon.test.js` strażnicy zielone | z MD2 (zrobione) |
| **M-S1** gramatyka tokenów | `fafdd51` (moduł) + `a98ea83`/`d944e64`/`9bf48a8` (3 migracje) | 29 + 2 nowe (deanon-workspace) | **[G] tak – patrz §2.1, §2.2** |
| **M-S2** substytucja | `6af0c9a` | 26 nowych, w tym golden 7 dokumentów syntetycznych | **[G] tak – patrz §2.3, §2.4** |
| **M-S3** test tożsamości | `668237f` | 15 nowych | nie (kod testowy) |
| **M-MD1** zip-reader | `ebd3945` | 25 nowych (21 + 4 z extractRaw dodanym w MD2) | **[G] tak – patrz §2.5** |
| **M-MD2** zip-writer | `9050fca` | 10 nowych, w tym mammoth cross-check | **[G] tak – patrz §2.6** |
| **M-W5** checkery weryfikatora | `bc69486` | 70 nowych (10 plików + agregator) | nie (wg projektu) |

Wszystkie testy przechodzące po każdym commitcie z osobna (nie tylko na końcu
nocy) – w każdym commit message jest zanotowana dokładna liczba plików/testów
w tamtym momencie.

### Co NIE zostało ruszone (zgodnie z poleceniem)

- **W1** (dane morfologiczne): wymaga decyzji o licencjach SGJP/PoliMorf –
  nie moja decyzja do podjęcia w nocy. Zero kodu.
- **MD3, MD4, MD5**: czekają na potwierdzenia P-DOCX i na bramkę S1/S2 (którą
  ta noc dopiero przygotowuje do zatwierdzenia).
- **W2, W3** (fleksja): czekają na W1.
- **electron/**, most (Faza 3), `SECURITY-CHECKLIST.md`, żaden dokument
  projektowy: nietknięte.
- `main`: nietknięty, 9 commitów do przodu względem `origin/main` sprzed
  nocy (niezwiązane z tą pracą, już tak było na starcie).

---

## §2. Decyzje i założenia do potwierdzenia przy bramce

Żadna z poniższych nie zablokowała pracy – każda ma uzasadnienie w kodzie/
testach, ale **wymaga świadomego potwierdzenia**, bo dotyka tokenów, legendy
albo niezaufanego wejścia (S1/S2/MD1/MD2 są [G] z definicji SHARED-FOUNDATION).

### 2.1 S1: `token` w `findTokens`/`splitTokenParts` to forma kanoniczna, nie literał

Kontrakt SHARED-FOUNDATION §3.2 nie rozstrzyga jednoznacznie, czy pole
`token` zwracane przez `findTokens`/`splitTokenParts` ma być: (a) dokładnym
napisem dopasowanym w tekście (z adnotacją przypadka, jeśli występuje), czy
(b) formą kanoniczną `[${tokenId}]` (bez adnotacji, zawsze). Wybrałam **(b)**,
bo:
- S2 (`resolveOccurrences`) i cztery ujścia UI (`legend[token]`) muszą móc
  bezpośrednio indeksować legendę tym polem – legenda nigdy nie zawiera
  adnotowanych kluczy;
- dzisiejszy kod (`deanon-workspace/index.js`, sprzed refaktoru) już
  rekonstruował `token` z `tokenId` (`` `[${tokenId}]` ``), a nie z surowego
  dopasowania regexu – (b) jest zgodne z istniejącym wzorcem.

Konsekwencja: informacja o adnotacji przypadka jest dostępna WYŁĄCZNIE przez
osobne pole `case` (obecne tylko gdy adnotacja była poprawna), nigdy przez
`token`. Uznałam to za bezpieczniejsze (jedna, spójna definicja „token" dla
wszystkich konsumentów) niż alternatywę. **Do potwierdzenia: czy ta
interpretacja jest zgodna z intencją projektu.**

### 2.2 S1 migracja krok 2 (`mcp/listings.js`): poszerzenie uznane za „zero ryzyka" przez SHARED-FOUNDATION jest w istocie zmianą zachowania

SHARED-FOUNDATION-DESIGN.md §3.3 (tabela) opisuje migrację `listings.js` jako
„zero – identyczna gramatyka". To prawda WZGLĘDEM przed-decyzją-17 wersji
projektu, ale dokument PRODUCT-DECISIONS.md (decyzja 17) rozszerzył S1 o
adnotację przypadka DOPIERO PO napisaniu tamtej tabeli. Skutek: `containsToken`
teraz rozpoznaje `[PERSON_NAME_1|D]` jako token, czego stary `TOKEN_PATTERN`
(bez „|" w gramatyce) nigdy nie robił. To wpływa na `hasAnonymizationToken` →
`buildOutcomeListing`/`buildReadOutcomeContent` (MCP): tekst wyniku zawierający
WYŁĄCZNIE token z adnotacją (bez żadnego zwykłego tokenu) był dotąd
niesłusznie traktowany jako „brak tokenów" (odrzucany z MCP), teraz jest
poprawnie rozpoznawany. Uznaję to za **zamierzoną, wąską konsekwencję decyzji
17** (cały sens decyzji to spójne rozpoznawanie adnotowanych tokenów
wszędzie, natychmiast, zanim W3 zacznie z nich korzystać) – ale ponieważ
SHARED-FOUNDATION's własna tabela mówi „zero ryzyka", **wymaga jawnego
potwierdzenia na bramce, że ta rozbieżność jest akceptowana**, a nie
przeoczonym efektem ubocznym. Test dokumentujący: brak dedykowanego testu na
ten DOKŁADNY scenariusz (token z adnotacją jako JEDYNY token w outcome) –
`mcp/listings.test.js` nie było modyfikowane (zgodnie z poleceniem
„istniejące bez modyfikacji"), więc scenariusz nie jest dziś pokryty testem.
Jeśli bramka uzna to za realne ryzyko, dopisanie testu to 10 minut pracy.

### 2.3 S2: okno kontekstu `resolveReplacement` (±40 znaków) to założenie, nie liczba z dokumentu

Ani SHARED-FOUNDATION §4.2, ani DOCX-REBUILD §8 nie podają konkretnej
wartości `N` dla `contextBefore`/`contextAfter`. Wybrałam **40 znaków**, żeby
dopasować się do rozmiaru kontekstu już używanego w raporcie rezyduów DOCX
(§6.2: „kontekst ±40 znaków"), dla spójności między modułami. W v1 nie ma to
znaczenia funkcjonalnego (resolver jest tożsamościowy, nigdy nie czyta
kontekstu), ale W3/MD4 (przyszłe moduły) odziedziczą tę stałą, jeśli nikt jej
nie zmieni. **Do potwierdzenia lub skorygowania przy pierwszym module, który
faktycznie konsumuje kontekst.**

### 2.4 S2: rezygnacja z kaskady sekwencyjnego `replaceAll` to zamierzona zmiana zachowania (już oznaczona w kodzie jako O-SF-4)

Opisana w design docu (§4.4 pkt 2) i w kodzie/testach
(`substitution.test.js`, sekcja „single-pass rendering"). Powtarzam tu tylko
dla kompletności listy bramkowej: legenda zbudowana ręcznie w teście, gdzie
jedna wartość zawiera literał innego tokenu, **nie kaskaduje już** tak jak
stary `deanonymizeText`. Potwierdzone jako nieosiągalne produktowo (mechanizm
rezerwacji w `collectReservedTokens`), ale to wciąż obserwowalna zmiana
zachowania na spreparowanym wejściu – stąd osobny wpis tutaj mimo że już
udokumentowana w kodzie.

### 2.5 MD1: `extractRaw` to rozszerzenie kontraktu MD1 dodane w trakcie pracy nad MD2

Oryginalny opis MD1 (DOCX-REBUILD §12) nie wspomina wprost o potrzebie
zwrotu SUROWYCH (skompresowanych) bajtów wpisu bez dekompresji. Odkryłam tę
potrzebę dopiero implementując MD2 (niezmiennik „nietknięte = bajt-w-bajt"
wymaga kopiowania oryginalnych skompresowanych bajtów, nie zdekompresowanej
treści). Dodałam `extractRaw(name)` do już-scommitowanego `zip-reader.js`
jako część commitu MD2 (z własnymi testami), świadomie pomijając limity
dekompresji i weryfikację CRC (nie ma czego dekompresować/weryfikować –
to czysty odczyt bajtów już wczytanego bufora, bez nowego ryzyka bomby
dekompresyjnej). **Do potwierdzenia: czy ten podział (MD1 zyskuje capability
w trakcie MD2, nie jako osobny commit) jest akceptowalny, czy wymaga
retroaktywnego dopisania do MD1 jako osobnej pozycji.**

### 2.6 MD2: metoda kompresji zmodyfikowanego wpisu = metoda oryginału

Gdy MD4 (przyszły moduł, nieistniejący dziś) podmieni treść `word/document.xml`,
mój `composeZip` kompresuje NOWĄ treść TĄ SAMĄ metodą, jaką miał oryginalny
wpis (store zostaje store, deflate zostaje deflate). Design doc nie
rozstrzyga tego wprost („nowe wpisy deflate/store z CRC" – nie mówi które
wybrać kiedy). Wybrałam zachowanie metody oryginału jako najbardziej
zachowawcze (zero niespodziewanej zmiany formatu), ale alternatywa („zawsze
deflate dla lepszej kompresji") jest równie uzasadniona. **Do potwierdzenia
przy MD4, gdy pojawi się pierwszy realny konsument.**

### 2.7 W5: heurystyki checkerów – zakresy i progi wybrane bez precyzyjnej specyfikacji

Design doc opisuje KATALOG checkerów (nazwy, przykłady), ale nie podaje
dokładnych progów/leksykonów. Wybory poczynione dziś (wszystkie
udokumentowane komentarzem w kodzie źródłowym, powtarzam tu dla widoczności):
- **N-3/N-4**: mały leksykon ról procesowych (powód/pozwany/wnioskodawca/
  uczestnik/dłużnik/wierzyciel/kredytobiorca/pełnomocnik/świadek) – katalog
  otwarty, łatwo rozszerzalny, ale dziś NIEPEŁNY względem realnych pism
  (brakuje np. „komornik", „biegły" celowo pominiętych jako niejednoznaczne
  rodzajowo).
- **N-3**: zgadywanie płci imienia to reguła „końcówka -a = żeńskie" plus
  krótka lista wyjątków męskich (Kuba, Kosma, Barnaba, Bonawentura, Jarema,
  Boryna, Aleksa) – **nie jest to słownik W1** (który nie istnieje), więc
  pokrycie jest przybliżone z założenia.
- **N-5**: parsuje słowa → liczbę (nie liczbę → słowa), zakres do 999 999.
  Sprawdzone na rzeczywistym przykładzie z `pismo_01` (patrz commit) –
  poprawnie obsługuje formy dopełniaczowe rodzone przez rekcję „złotych"
  (np. „ośmiuset dziewięćdziesięciu"). Nie obsługuje kwot ponad milion ani
  wariantów zapisu spoza zaobserwowanego wzorca.
- **N-6**: „niespójność" dat to jedna, wąska heurystyka (termin przed datą
  pisma) – nie próbowałam rozpoznawać innych rodzajów niespójności.
- **N-7**: próg wariantu sygnatury = odległość edycyjna ≤ 2 znaki – liczba
  arbitralna, nieuzasadniona danymi (nie miałam korpusu błędnych sygnatur do
  kalibracji).
- **N-8**: wykrywanie „fragmentów po angielsku" to lista 14 angielskich
  stopwords + wymóg 3+ kolejnych słów ASCII – najsłabszy heurystycznie z
  checkerów, prawdopodobnie ma dziury (fałszywe negatywy na krótszych
  fragmentach) i może dawać fałszywe pozytywy na cytatach łacińskich/
  nazwach własnych.

Żadna z tych heurystyk nie blokuje niczego (V2: findings wspierają przegląd,
nie zastępują go) – ryzyko złej kalibracji jest niskie, ale **katalog
zasługuje na przegląd merytoryczny przy W6/W7**, kiedy powstanie prawdziwy
UI i realne przypadki użycia zaczną kalibrować progi.

---

## §3. Odkrycie: `npm run eval:score` jest dziś bezużyteczny dla WSZYSTKICH zmian, nie tylko dzisiejszych

Uruchomiłam `npm run eval -- --label=s1-token-grammar` i `--label=
s2-substitution` (oba w `test-data/results/`) + `npm run eval:score` zgodnie
z dyscypliną z CLAUDE.md. Wynik: **0% precyzji/recall/F1 na każdym typie i
każdym dokumencie, dla obu przebiegów.**

Zdiagnozowałam przyczynę (nie jest to regresja S1/S2): offsety `start`/`end`
w `test-data/synthetic/*.expected.json` **nie odpowiadają realnym pozycjom**
w odpowiadających plikach `.txt` (wszystkie mają CRLF). Potwierdzone
niezależnie od jakiejkolwiek zmiany kodu:

```
node -e "const fs=require('fs');
const t=fs.readFileSync('test-data/synthetic/pismo_05_wypowiedzenie_umowy_o_prace.txt','utf8');
const e=JSON.parse(fs.readFileSync('test-data/synthetic/pismo_05_wypowiedzenie_umowy_o_prace.expected.json','utf8'));
console.log(e.filter(x=>t.slice(x.start,x.end)!==x.text).length, '/', e.length, 'mismatched');"
```
→ **100% mismatched, we wszystkich 7 dokumentach** (nie tylko pismo_05).
Rozjazd rośnie z pozycją w dokumencie (np. w pismo_05 przy offsecie ~6350
rozjazd wynosi już ~150 znaków) – wygląda na klasyczny błąd liczenia offsetów
względem tekstu znormalizowanego do LF, podczas gdy plik na dysku jest CRLF.
`src/pipeline/steps/preprocess.js` (`normalizeWhitespace`) to dziś no-op,
więc pipeline też nigdy nie dotyka offsetów – wykluczone jako przyczyna.

**Skutek praktyczny:** `eval:score` da 0% dla DOWOLNEJ przyszłej zmiany,
dopóki ktoś albo (a) zregeneruje `.expected.json` z poprawnymi offsetami
względem aktualnych plików `.txt`, albo (b) zmieni `src/eval/score.js`/
`matching.js`, żeby był tolerancyjny na ten rozjazd (np. dopasowanie po
`entity.text` zamiast surowych offsetów – dokładnie to zrobiłam w
`substitution.test.js`, żeby zbudować sensowny golden test mimo tej wady).

**Co zrobiłam zamiast polegać na eval:score:** golden test w
`src/substitution.test.js` porównujący STARĄ (referencyjną kopię w pliku
testowym, sekwencyjny `replaceAll`) i NOWĄ implementację `deanonymizeText`
bajt-w-bajt na wszystkich 7 dokumentach syntetycznych, z encjami
przywróconymi do poprawnych pozycji przez wyszukanie `entity.text` w pliku
(a nie zaufanie zepsutym offsetom). To bezpośrednio dowodzi „stary ≡ nowy",
co było prawdziwym celem wymogu eval z §4.4 – silniejszy dowód niż
przypadkowo działający `eval:score`, który i tak nie mierzy zachowania
substytucji, tylko jakość detekcji NER (a S1/S2 nie dotykają detekcji wcale).

**Rekomendacja:** osobne zadanie (nie dziś, nie w zakresie Fazy 0) do
zregenerowania `test-data/synthetic/*.expected.json` albo naprawienia
`score.js`/`matching.js`. Zostawiam to Alanowi/Opusowi do decyzji o
priorytecie – nie blokuje żadnego z modułów dziś ukończonych.

---

## §4. Czego nie dało się zweryfikować bez dodatkowego sprzętu/oprogramowania

- **MD2, „wynik otwiera się w Word/LibreOffice"** (kryterium akceptacji z
  DOCX-REBUILD §12): brak Worda/LibreOffice w tym środowisku. Zamiast tego
  użyłam **mammoth** (niezależny parser OOXML, już zależność repo, używany
  w `src/file-import/docx.js`) jako najsilniejszego dostępnego automatycznego
  substytutu: zbudowałam ręcznie minimalny, poprawny .docx (realne
  `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` z prawdziwymi
  namespace'ami WordprocessingML), przepuściłam przez `composeZip` (bez
  modyfikacji i z modyfikacją `word/document.xml`) i sprawdziłam, że mammoth
  poprawnie odczytuje tekst w obu przypadkach. To mocny sygnał (mammoth jest
  dość rygorystyczny co do poprawności OOXML), ale **nie zastępuje
  rzeczywistego testu w Wordzie/LibreOffice** – ten krok wymaga człowieka z
  dostępem do tego oprogramowania, zgodnie z kryterium akceptacji MD2.
- **MD1, dokładny przebieg pamięciowy podczas przerywania bomby deflate**:
  test na prawdziwej bombie 60 MiB zer przerywa się poprawnie i szybko
  (~1,2 s), co dowodzi POPRAWNOŚCI LOGICZNEJ licznika (nie czeka na pełne
  rozpakowanie), ale nie jest to pomiar pamięci szczytowej – ufam
  wewnętrznemu buforowaniu `DecompressionStream` platformy (ta sama granica
  zaufania, którą design doc już akceptuje dla samego algorytmu deflate).
  Jeśli bramka chce twardego dowodu pamięciowego, potrzebny byłby profiler
  (poza zakresem nocnej pracy).

---

## §5. Obserwacja poboczna (informacyjna, nie wymaga akcji)

W trakcie nocy w katalogu głównym repo pojawił się nieśledzony (untracked)
plik `MACOS-BUILD-DESIGN.md` (sygnowany „Fable", ten sam architekt co
pozostałe projekty), którego nie tworzyłam – wygląda na pracę równoległej
sesji nad projektem builda macOS. Nie dotknęłam go (wszystkie moje
`git add` były zawężone do konkretnych ścieżek, nigdy `-A`/`.`), zostawiam
bez zmian. Odnotowuję wyłącznie, żeby nie było niespodzianką przy
przeglądzie `git status` rano.

---

## §6. Stan testów na koniec nocy

```
npm test: 83 files / 899 tests passing, zero regresji
```
(dla porównania: `main` sprzed nocy → 66 files / 713 tests).

Brak nowych błędów `ERR_REQUIRE_ESM` (baseline dziś: zero takich błędów w
tym środowisku – 12 wspomniane w poleceniu jako „znane środowiskowe"
prawdopodobnie dotyczy innej konfiguracji Node niż ta, na której pracowałam
dziś, `v24.18.0`).

---

*Koniec notatek. `main` nietknięty. Branch `feature/foundation-phase0`
gotowy do bramki Opusa nad S1/S2/MD1/MD2 (wszystkie [G] w SHARED-FOUNDATION/
DOCX-REBUILD) i do zwykłego przeglądu nad S3/S4/W5 (bez wymogu bramki wg
projektów źródłowych). Żaden dokument projektowy ani SECURITY-CHECKLIST.md
nie był modyfikowany – zgodnie z poleceniem, to zadanie zostawiam na bramkę.*
