# RECALL-B-NOTES.md – paczka recall B: B4-lite + A7 + regeneracja PESEL, gałąź feature/recall-b

**Data:** 2026-07-12/13, sesja autonomiczna (Sonnet, `feature/recall-b`, z `main` @ `5030c2c`).
**Branch:** `feature/recall-b`, **niescalona** – zostawiona do bramki Opusa zgodnie z poleceniem.
**Rodzice:** `RECALL-90-DESIGN.md` §2.4 (B4), §5 (kolejność), R-6; `GATE-RECALL-REMEDIATION.md`
(rozstrzygnięcia Opusa); `RECALL-REMEDIATION-NOTES.md` (stan po planie A); `W1-W3-MORPHOLOGY-DESIGN.md`
§1.8 (wzór listy ról).
**Zakres:** PRIORYTET 1 (B4-lite), PRIORYTET 2 (dokończenie A7), PRIORYTET 3 (regeneracja PESEL
w `test-data/synthetic`). `src/verifier/legal-refs` i verifier-daemon nietknięte, zgodnie z poleceniem.

Komity (3, po jednym per moduł): `495ef66` (B4-lite), `3c43a3b` (A7), `93ee3f2` (regeneracja PESEL).
Worktree osobny (`recall-b-worktree`, własny `npm ci`, bez junction node_modules) – główna kopia
robocza nietknięta.

---

## §1. Wynik końcowy

| Korpus | Metryka | Baseline (main, zmierzony w tej sesji) | Po recall-b | Δ |
|---|---|---|---|---|
| Kontradyktoryjny | P / R / F1 (ogółem) | 79,9 / 84,2 / 82,0 | **82,3 / 86,7 / 84,5** | +2,4 / +2,5 / +2,5 p.p. |
| Kontradyktoryjny | przecieki (rejestr) | 26 | **19** | **−27%** |
| Kontradyktoryjny | PERSON_ROLE_OR_TITLE P/R/F1 | 26,3 / 29,4 / 27,8 | **63,2 / 70,6 / 66,7** | **+36,9 / +41,2 / +38,9 p.p.** |
| Kontradyktoryjny | PERSON_ROLE_OR_TITLE TP/FP/FN | 5 / 14 / 12 | **12 / 7 / 5** | TP ×2,4; FN −58% |
| Syntetyczny | P / R / F1 (ogółem) | 85,0 / 86,7 / 85,9 | **90,2 / 91,1 / 90,7** | +5,2 / +4,4 / +4,8 p.p. |
| Syntetyczny | PERSON_ROLE_OR_TITLE P/R/F1 | 84,4 / 96,4 / 90,0 | **100 / 100 / 100** | pełne pokrycie |
| Syntetyczny | przecieki (rejestr) | 4 | 4 (te same, nieporuszone) | bez zmian |

**Ważne zastrzeżenie metodologiczne:** RECALL-90-DESIGN.md §2.4 zakładał baseline syntetyczny
PERSON_ROLE „P pozostaje 100%” – to była nieaktualna liczba. Prawdziwy baseline zmierzony w tej
sesji na nietkniętym `main` (nie z pamięci dokumentu) to **P=84,4%, R=96,4%**; recall-b go nie tylko
utrzymał, ale doprowadził do 100/100 (efekt uboczny modułu A7, patrz §3).

**Cel Alana (GATE-EVAL-RECALL §6): recall 90%+ na korpusie kontradyktoryjnym przed materiałami
marketingowymi.** Wynik ogólny tej gałęzi: **86,7%** recall (z 84,2%), **+2,5 p.p.** Nie osiągnięto
90% ogółem – to zgodne z RECALL-90-DESIGN.md §1.4 („+B4 ~1,5–2,5 p.p., +B2 ~0,7–1 p.p., +B1 ~0,7–1,5,
+B3 ~0,7–1” – ta gałąź dowozi tylko B4 + A7, moduły B1/B2/B3/B5/B6 pozostają nietknięte, jak
zaplanowano w R2 przed R3/R6 z §5 tamtego dokumentu). **Marketing pozostaje wstrzymany.**

Reprodukcja: `npm test` (1398/87, zielone), `npm run eval -- --label=<slug>` /
`--dir=test-data/adversarial --label=<slug>-adv`, `eval:score`, `eval:analyze`. Numery przebiegów
finalnych cytowane w tym dokumencie: syntetyczny `2026-07-13T01-30-01`, kontradyktoryjny
`2026-07-13T01-34-56`.

---

## §2. Moduły – co zrobiono

### B4-lite – leksykon ról i tytułów (commit `495ef66`)

Nowe źródło `lexicon` w fazie `ner` (`src/pipeline/lexicon.js` + `steps/lexicon.js` +
`data/role-lexicon.json`), wpięte obok `regex` w `createNerSteps`. 38 wpisów encji (tytuły
zawodowe/funkcje korporacyjne: adwokat, radca prawny, notariusz, prezes/członek zarządu,
dyrektor, kierownik, księgowa/-y, sekretarz sądowy…) z formami fleksyjnymi lp + skrótami
(adw., r.pr./r. pr., not., mec., prok., sekr. sąd., st. sekr. sąd., SSR/SSO/SSA/SSN), plus 49
wpisów `nonEntity` (role procesowe: powód, pozwany, kredytobiorca, świadek…) jako dokumentacja +
cel testu spójności (rozłączność dowiedziona testem, nie tylko deklaracją).

**Kluczowe ustalenie i naprawa (poza pierwotnym kontraktem, wymuszone pomiarem):**
`deduplicateEntities` (`src/anonymizer.js`) traktuje KAŻDĄ encję o `score === 1.0` jako
bezwzględnie precyzyjną – wygrywa z nakładającym się kandydatem niezależnie od szerokości spanu.
To poprawne dla A1/A2/A4 (sumy kontrolne nie mają „szerszej poprawnej wersji”), ale fałszywe dla
gołego lematu z leksykonu zagnieżdżonego w szerszym, poprawnym spanie modelu („kierownik” wewnątrz
poprawnie wykrytego „Kierownik ds. Marketingu”). Pierwszy pomiar: 4 wcześniej poprawne detekcje
modelu stały się FN. Naprawa lokalna, bez dotykania współdzielonej logiki dedup: `LEXICON_SCORE =
0.95` (nie 1.0) w `lexicon.js` – kieruje kolizję przez istniejącą gałąź „bliskie score → szerszy
span wygrywa" zamiast przez gałąź „idealny score wygrywa zawsze”. Test regresyjny na to w
`lexicon.test.js` (4 przypadki, w tym sanity że A1/A2/A4 nietknięte).

Dwie luki znalezione empirycznie na korpusie kontradyktoryjnym (nie w testach jednostkowych):
`trimTrailingPunctuationStep` rozpoznaje tylko OSTATNI token dopasowanego spanu jako chroniony
skrót – „r. pr.”/„sekr. sąd.” tracą kropkę na końcu zdania, bo „pr.”/„sąd.” nie były w `CAT_A`
(`polish-abbreviations.js`). Naprawione (`pr.`, `sąd.`, `radc.` dodane do `CAT_A`) + dwa brakujące
skróty złożone dodane do leksykonu (`apl. radc.`, `st. sekr. sąd.`).

**Wynik:** patrz §1. `adw_34_role_generyczne` (pułapka 12 słów-ról generycznych) – **zero FP z
leksykonu**, dowiedzione dedykowanym testem czytającym prawdziwy plik korpusu wprost. 2 rezydualne
FP na poziomie CAŁEGO pipeline'u na tym dokumencie są **potwierdzone bit-identyczne z nietkniętym
`main`** – wcześniejsze, niezwiązane z tym modułem zachowanie modelu.

### A7 – dokończenie krzywej progów (commit `3c43a3b`)

`scripts/cache-ner-for-thresholds.mjs` padał na „bad allocation” onnxruntime-node **nawet
uruchomiony osobno, sekwencyjnie** na tej maszynie (potwierdzone bezpośrednią obserwacją: dwa
równoległe przebiegi ewaluacji ORAZ jeden sam padły z tym samym błędem). Przyczyna źródłowa: skrypt
nigdy nie wołał `.dispose()` na sesjach modeli między dokumentami w swojej własnej pętli – dodane.
To NIE eliminuje w pełni awarii na tej maszynie (proces nadal czasem kończy się „heap out of
memory” na samym końcu, PO zapisaniu pliku cache) – ale plik wynikowy jest wtedy kompletny i
poprawny (zweryfikowane za każdym razem przed użyciem).

Pełna krzywa (0,3–0,9 co 0,1, oba korpusy, `test-data/results/threshold-sweep.json`, poza gitem):

- **PERSON_IDENTIFIER (0,5), VEHICLE_IDENTIFIER (0,5), LOCATION (0,75): już optymalne** – płaskie
  P/R w całym zakresie 0,3–0,8 na obu korpusach, podniesienie do 0,9 kosztowałoby recall bez
  żadnej rekompensaty. Bez zmian.
- **DEVICE_IDENTIFIER: potwierdzona czysta luka detekcji** (0% recall przy KAŻDYM progu na
  syntetycznym, zero przykładów na kontradyktoryjnym) – żaden próg tego nie naprawi, zgodne z
  wcześniejszą decyzją „bez zmian po pomiarze”.
- **PERSON_ROLE_OR_TITLE: jedyny realny ruch.** 0,75 leży w płaskiej strefie (0,3–0,8 identyczne:
  syntetyczny 84,4%P/96,4%R, kontradyktoryjny recall przybity na 64,7% przy samym szumie FP
  zależnym od progu). **0,9 to dominująca wygrana, nie kompromis**: syntetyczny 100%/100% (28/0/0),
  kontradyktoryjny poprawa na OBU osiach (P 41–52%→63,2%, R 64,7%→70,6%). Mechanizm: leksykon B4
  ocenia 0,95 (przechodzi 0,9 z zapasem), a próg odcina właśnie te niżej ocenione kandydaty modelu,
  które wcześniej wygrywały arbitraż dedup „bliskie score → szerszy span” z poprawnym, węższym
  dopasowaniem leksykonu – więc podniesienie progu naprawia efektywnie tę samą klasę problemu co
  §2.5 B4-lite (napięcie dedup), tyle że od strony progu, bez dotykania dedup wprost. **Efekt
  uboczny:** rozstrzyga też kolizję międzytypową „SSR” (leksykon PERSON_ROLE_OR_TITLE vs model
  ORGANIZATION_NAME) – ta pozycja zniknęła z rejestru przecieków bez osobnej interwencji.

Zweryfikowane na prawdziwym pipeline (nie tylko symulacji postprocessu) na obu korpusach – liczby
zgadzają się z krzywą co do jednego wpisu.

### Regeneracja PESEL w `test-data/synthetic` (commit `93ee3f2`)

Zatwierdzone przez Opusa w `GATE-RECALL-REMEDIATION.md` §3. 17 wystąpień (13 różnych wartości, w
`pismo_01/02/03/04/06`) 11-cyfrowych `PERSON_IDENTIFIER` bez poprawnej sumy kontrolnej PESEL – A1
słusznie odmawiał im dopasowania regexem (prawdziwe PESEle zawsze mają poprawną sumę), więc
spadały do wzorca `PHONE_NUMBER` (11 cyfr, bez sumy). Nie przeciek (wszystkie 17 nadal maskowane),
ale realny artefakt pomiaru, karzący jednocześnie `PERSON_IDENTIFIER` i `PHONE_NUMBER`.

Naprawiona WYŁĄCZNIE ostatnia cyfra (kontrolna) na wartość przeliczoną z dokładnie tego samego
algorytmu co `src/anonymizer.js` – niezależnie zweryfikowana przed zapisem (zgodna co do bitu z
propozycją z wcześniejszego etapu badawczego sesji). Żaden offset się nie zmienia. `.txt`,
`.expected.json`, `.expected-segments.json` zaktualizowane przez podstawienie tekstowe (NIE
`JSON.stringify` – te pliki są CRLF na dysku, ponowna serializacja zamieniłaby każdą linię na LF i
zagrzebałaby 13-znakową zmianę w szumie). `pismo_05`/`pismo_07` nietknięte (poprawne sumy
przypadkiem; `pismo_07` to kanarek CRLF/astralny – nie ruszony w ogóle).

**Wynik:** syntetyczny F1 86,5%→90,7% (dokładając do B4-lite+A7); `PERSON_IDENTIFIER` samodzielnie
P=80,8%, R=95,5%, F1=87,5% (wcześniej częściowo liczony jako zła etykieta). `ground-truth.test.js`
(100 testów, kanarki CRLF/astralne/offsety) zielony.

---

## §3. Rejestr przecieków – co zostało (oba korpusy, po recall-b)

### Syntetyczny (4 pozycje, bez zmian względem baseline)

Wszystkie cztery **poza zakresem tej gałęzi, już skatalogowane**: `SB/00234/PN`
(ACCOUNT_IDENTIFIER, otwarte dla bramki Opusa od czasu Track 1 – kandydat score 0,68 poniżej
siatki A8 nawet po podniesieniu do 0,95, świadomie nie naciągnięte), „ZAKŁADU UBEZPIECZEŃ
SPOŁECZNYCH” wersalikami ×3 (ORGANIZATION_NAME, B2 – żadna warstwa nie widzi wersalików, poza
zakresem modułów tej gałęzi).

### Kontradyktoryjny (19 pozycji, było 26) – grupowanie wg przyczyny

- **PERSON_ROLE_OR_TITLE: 9 pozycji → 1.** Jedyna pozostała: „ produkcji” w „kierownika
  produkcji” (adw_27, waga 1×50% niepokrycia) – **znane, opisane ograniczenie architektoniczne**:
  leksykon zamknięty nie może enumerować otwartych kwalifikatorów działu/obszaru („ds.
  Marketingu”, „produkcji”, „HR”…). To ta sama klasa co „Kierownik ds. Marketingu”/„Dyrektor HR”
  z pomiarów syntetycznych – tam model sam łapie pełną frazę (leksykon nie psuje, dzięki naprawie
  §2 B4-lite), tu model nie łapie NIC, więc leksykon łapie tylko część. Naprawa wymagałaby albo
  B4-full (paradygmaty z W1 nie rozwiążą kwalifikatorów otwartych same z siebie), albo rozszerzenia
  architektury o wzorce regexowe jak B3 (zmiana zakresu modułu, nie „lite”) – świadomie odłożone.
- **Poza zakresem tej gałęzi, niezmienione (12 pozycji):** CRIMINAL_OFFENCE_DATA opisowe (B3),
  PERSON_NAME rozstrzelone OCR ×2 (C1), FINANCIAL_AMOUNT słowne/złożone ×2 (C2), HEALTH_DATA
  częściowe (B3), TRADE_UNION_MEMBERSHIP częściowe (B3), LOCATION „Chełmża”/„Torunia" (kolizja z
  kandydatem PERSON_ROLE_OR_TITLE innego dokumentu w sourceFilterStep/thresholdStep – nieporuszony
  mechanizm, nie B4), VEHICLE_IDENTIFIER granice (B1), ORGANIZATION_NAME rozstrzelone OCR (C1) +
  drobne resztki `snapStep` ×2.
- **Nowe od Track 1, ale NIE spowodowane recall-b:** żadne – każda z 19 pozycji albo była już w
  rejestrze Track 1, albo jest bezpośrednią konsekwencją świadomie nieporuszonego zakresu (moduły
  B poza B4, ograniczenia C1/C2).

**Wniosek:** recall-b nie wprowadza żadnej nowej regresji względem stanu po Track 1 – usuwa 9 z 10
pozycji PERSON_ROLE_OR_TITLE (w tym przez efekt uboczny A7 rozstrzyga też kolizję „SSR” z
ORGANIZATION_NAME, nieopisaną wcześniej jako osobna pozycja rejestru, ale zaobserwowaną w trakcie
tej sesji), reszta rejestru – nietknięta, bo poza mandatem tej gałęzi.

---

## §4. Odłożone / opisane, nie naprawiane w tej gałęzi

1. **„kierownika produkcji” i klasa otwartych kwalifikatorów działu/obszaru** (§3) – jedyny
   pozostały cel B4 poniżej progu 75% recall z RECALL-90-DESIGN.md §2.4. Wymaga B4-full (W1) albo
   rozszerzenia architektury B4 o wzorce regexowe (zmiana zakresu).
2. **Napięcie arbitrażu dedup „bliskie score → szerszy span”** gdy szerszy kandydat modelu jest
   sam w sobie błędny (nie tylko niekompletny) – może nadal ujawnić się dla innych typów/źródeł w
   przyszłości. Nie dotknięto współdzielonej `deduplicateEntities` (ryzyko dla A1/A2/A4); A7
   złagodził większość obserwowanych przypadków od strony progu, ale to nie jest strukturalna
   naprawa mechanizmu.
3. **Bare „biegły”/„komornik”/„sędzia”/„prokurator”/„referendarz”/„przewodniczący”** – świadomie
   POZA zakresem entity B4-lite (patrz `role-lexicon.json` `nonEntity`, wpisy oznaczone
   „DUAL-USE”): `adw_34_role_generyczne` dowodzi, że te słowa gołe są też rolami procesowymi
   generycznymi, a RECALL-90-DESIGN.md §2.4 jednocześnie wymienia „komornik”/„biegły” jako
   przykłady encji – sprzeczność rozstrzygnięta na korzyść zera FP (zgodnie z „w razie
   niejednoznacznej decyzji – odłóż, opisz”). Tylko formy jednoznaczne (skróty, „sędzia SR/SO/SA/
   SN”) są w zakresie. Domknięcie właściwe: B4-full z sygnałem kontekstowym W3 (apozycja do
   nazwiska), per R-6.
4. **LOCATION „Torunia”/„Chełmża”** – kolizja z kandydatem PERSON_ROLE_OR_TITLE innego typu w
   sourceFilterStep/thresholdStep, nieporuszona (nie B4, nie A7 w wąskim sensie – dotyczy LOCATION,
   nie PERSON_ROLE_OR_TITLE, próg LOCATION jest już optymalny per §2 A7).
5. **B1/B2/B3/B5/B6** (RECALL-90-DESIGN.md) – nietknięte, jak zaplanowano (R2 przed R3/R6 w §5
   tamtego dokumentu; ta gałąź to wyłącznie R2 + dokończenie A7 + PRIORYTET 3 zlecone wprost).

---

## §5. Artefakty pomiaru – ostrożnie

- **Maszyna ma realny sufit pamięci dla ewaluacji korpusu kontradyktoryjnego (38 dok., 2 modele).**
  Potwierdzone bezpośrednio wielokrotnie w tej sesji: dwa równoległe przebiegi zawsze padają;
  nawet POJEDYNCZY, sekwencyjny przebieg czasem kończy się „heap out of memory” PO zapisaniu
  `summary.json` (czyli dane są kompletne, awaria jest w jakimś końcowym kroku procesu Node/V8).
  **Zasada robocza przyjęta w tej sesji: nigdy nie uruchamiać dwóch cięższych procesów ewaluacji
  jednocześnie; po każdym przebiegu na korpusie kontradyktoryjnym sprawdzić czy `summary.json`
  istnieje i jest poprawnym JSON-em przed użyciem, niezależnie od kodu wyjścia procesu.**
- **Baseline cytowany w tym dokumencie zmierzony wprost na nietkniętym `main`** (nie przepisany z
  wcześniejszych notatek) – dwa niezależne przebiegi (syntetyczny `2026-07-12T21-41-02`,
  kontradyktoryjny `2026-07-12T22-23-26`), oba w głównej kopii roboczej, osobno od pracy na gałęzi.

---

## §6. Reprodukcja

| Co | Komenda |
|---|---|
| Testy | `npm test` (1398 testów, 87 plików) |
| Eval syntetyczny (finalny) | `npm run eval -- --label=recall-b-final` → run `2026-07-13T01-30-01` |
| Eval kontradyktoryjny (finalny) | `npm run eval -- --dir=test-data/adversarial --label=recall-b-final-adv` → run `2026-07-13T01-34-56` |
| Scoring / rejestr | `npm run eval:score <run>` / `npm run eval:analyze <run>` |
| Krzywa progów (dokończona) | `node scripts/cache-ner-for-thresholds.mjs --dir=test-data/synthetic --out=synthetic` (i analogicznie `--dir=test-data/adversarial --out=adversarial`, **osobno, sekwencyjnie**), potem `node scripts/measure-thresholds.mjs` |

Katalogi przebiegów (`test-data/results/…`) i `threshold-sweep.json` są poza gitem, jak w
oryginalnym audycie.

---

*Notatka sporządzona w ramach gałęzi `feature/recall-b`, sesja Sonnet, 2026-07-12/13. Gałąź
NIEZMERGOWANA – zostawiona do bramki Opusa. Główne artefakty: `src/pipeline/lexicon.js` +
`steps/lexicon.js` + `data/role-lexicon.json` (nowe), `entity-rules.js` (próg PERSON_ROLE_OR_TITLE
0,75→0,9), `polish-abbreviations.js` (+3 wpisy), `test-data/synthetic/pismo_0{1,2,3,4,6}*`
(regeneracja PESEL), `scripts/cache-ner-for-thresholds.mjs` (dispose fix).*
