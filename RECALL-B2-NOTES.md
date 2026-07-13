# RECALL-B2-NOTES.md – drugi przebieg NER na tekście znormalizowanym z wersalików, gałąź feature/recall-b2

**Data:** 2026-07-13, sesja Sonnet, `feature/recall-b2`, z `main` @ `96101f1` (po recall-b3: adversarial 87,5%, trzy pełne wycieki wagi 5 zamknięte).
**Branch:** `feature/recall-b2`, **niescalona** – zostawiona do przeglądu Opusa zgodnie z poleceniem (RECALL-90-DESIGN.md §2.2 nie żąda bramki formalnej dla B2, ale gałąź dotyka arbitrażu dedup i cache-orchestrator.js — warto, żeby ktoś inny przejrzał zanim wejdzie do main).
**Rodzice:** `RECALL-90-DESIGN.md` §2.2 (B2, pełny kontrakt); `GATE-RECALL-REMEDIATION.md`; `RECALL-B-NOTES.md` + `RECALL-B3-NOTES.md` (wzorzec plumbingu, `LEXICON_SCORE`/dedup-tension, dyscyplina pomiaru).
**Zakres:** drugi przebieg NER (oba modele) na segmentach ze znaczącym udziałem wersalików, po case-foldzie do Title Case; alias źródła `case-folded`; zamknięta lista typów (PERSON_NAME, ORGANIZATION_NAME, POSTAL_ADDRESS, LOCATION, PERSON_ROLE_OR_TITLE); trzy strażniki FP odkryte i domknięte w toku pomiaru (nie tylko ten przewidziany kontraktem).

Worktree osobny (`recall-b2-worktree`, sibling `kopia repo pii`, własny `npm ci`, bez junction node_modules) – główna kopia robocza nietknięta. 8 komitów:

| Commit | Co |
|---|---|
| `5032d9e` | `case-fold.js` – folder/detektor wersalików, property-test |
| `80f4ca4` | `createCaseFoldedNerStep` – krok, strażnik nagłówków (lista lematów) |
| `4cb2576` | `entity-sources.js`/`entity-rules.js` – rejestracja źródła `case-folded`, progi |
| `8cbc5d3` | wpięcie do `configs/default.js` **i** `cache-orchestrator.js` (patrz §2.2) |
| `d2bda96` | 4 goldeny mockowe (ZUS, adw_18, adw_29, adw_24) |
| `2a28b13` | **fix**: strażnik luki (gap-filling) po zmierzonej regresji LOCATION/POSTAL_ADDRESS |
| `e550954` | **fix**: rozszerzenie strażnika nagłówków + nowy strażnik znaczników sekcji |
| `bd533b0` | **fix**: strażnik gołych akronimów-etykiet identyfikatorów (PESEL i in.) |

---

## §1. Wynik końcowy

| Korpus | Metryka | Baseline (main @ 96101f1, zmierzony ponownie w tej sesji) | Po recall-b2 | Δ |
|---|---|---|---|---|
| Syntetyczny | P / R / F1 (ogółem) | 90,2 / 91,1 / 90,7 | **89,9 / 91,9 / 90,9** | −0,3 / **+0,8** / +0,2 p.p. |
| Syntetyczny | TP / FP / FN | 370 / 40 / 36 | **373 / 42 / 33** | +3 TP, +2 FP, −3 FN |
| Syntetyczny | przecieki (rejestr) | 4 | **1** | **−75%** (zamyka ZUS ×3, `SB/00234/PN` pozostaje – poza zakresem, patrz RECALL-B-NOTES §3) |
| Kontradyktoryjny | P / R / F1 (ogółem) | 82,4 / 87,5 / 84,9 | **82,4 / 87,5 / 84,9** | **bitowo identyczne** |
| Kontradyktoryjny | TP / FP / FN | 244 / 52 / 35 | **244 / 52 / 35** | **bitowo identyczne** |
| Kontradyktoryjny | przecieki (rejestr) | 16 | **16** | bitowo identyczne (te same 16 pozycji, patrz §3) |

**Cel Alana (GATE-EVAL-RECALL §6): recall 90%+ na korpusie kontradyktoryjnym przed materiałami marketingowymi.** Ten wynik: **87,5%, bez zmiany.** B2 na korpusie kontradyktoryjnym nie dowozi ANI JEDNEJ nowej trafionej encji — jedyny przetrwały kandydat ze źródła `case-folded` na całym korpusie 38 dokumentów był fałszywym trafieniem (patrz §2.3), zdjętym ostatnią poprawką. To zgodne z diagnozą uczciwie policzoną w §2.4 niżej: korpus kontradyktoryjny, mimo że to on zainspirował moduł (nagłówki adw_18/24/29), **nie ma w GT ani jednej encji typu B2 ukrytej akurat w segmencie kwalifikującym się do folda** — okazja do zysku recall leży w syntetycznym (ZUS ×3), nie tutaj. **Marketing pozostaje wstrzymany** – moduły B1/B3(scalone)/B4(scalone)/B5/B6 z RECALL-90-DESIGN.md §5 poza tym B4/B3 już zmergowane; do 90%+ nadal brakuje modułów B1 (ensemble na inicjały) i B5 (diakrytyki OCR), plus korpus 2.0.

**Uwaga o precyzji na syntetycznym:** spadek 90,2→89,9 p.p. (−0,3) to koszt zaakceptowany, nie przeoczony – rozbity w §2.2/§2.3 na: ORGANIZATION_NAME zyskuje więcej niż traci (+3 TP/+1 FP netto, F1 77,9→80,6), PERSON_NAME traci 2 p.p. precyzji wyłącznie przez nieudomkniętą klasę „MRI” (§4), reszta typów bit-identyczna z baseline. Kryterium kontraktu „czyste FP rosną <10%” liczone na CAŁYM korpusie: (42−40)/40 = **5%** syntetyczny, **0%** kontradyktoryjny – oba pod progiem.

---

## §2. Moduły – co zrobiono

### §2.1 Fundament: `case-fold.js` (commit `5032d9e`)

`hasUppercaseSignal` (bramka detekcji: segment kwalifikuje się, gdy zawiera ≥1 słowo ≥3 liter w pełnych wersalikach) i `foldUppercaseSegmentText` (fold: KAŻDY ciąg wersalikowy w kwalifikującym się segmencie → Title Case, pierwsza litera bez zmian, reszta `toLowerCase` per znak/code-point, nie per string) to dwie oddzielne bramki z celowo różnym progiem długości – kontrakt (§2.2 pkt 1) mówi „≥3 litery” tylko dla DETEKCJI segmentu; **pierwsza wersja tej gałęzi błędnie zastosowała ten sam próg do foldowania**, co dawało niespójne wyjście typu „Odwołanie OD Decyzji” (dwuliterowe „OD” zostawione wersalikami w środku frazy) – wyłapane i naprawione we własnym teście przed pierwszym commitem, nie po pomiarze.

Twarda asercja `folded.length === original.length` na poziomie całego segmentu jest **dowiedziona z konstrukcji** (fold per-code-point, z osobną weryfikacją długości dla KAŻDEGO znaku przed użyciem), nie tylko sprawdzona na końcu – podwójna warstwa bezpieczeństwa, zgodna z duchem kontraktu „fail-open, zero szkody”. Property-test: fuzz 2000 losowych słów (pełny alfabet polski, ziarno stałe – reprodukowalny) + 500 losowych segmentów mieszanych.

### §2.2 Krok: `createCaseFoldedNerStep` (commit `80f4ca4`)

Ponownie wykorzystuje `createNerStep` jako silnik inferencji (te same chunking/agregacja/dispose co główny przebieg) zamiast duplikować logikę – jedyna różnica to wejściowe segmenty (foldowane warianty kwalifikujących się) i przepisanie `source` na wyjściu.

**Nieprzewidziana przez kontrakt komplikacja, znaleziona podczas audytu integracji (przed jakimkolwiek pomiarem):** `createNerSteps` (configs/default.js) jest wołane **per-źródło** przez `cache-orchestrator.js` (prawdziwa ścieżka klasyfikacji w przeglądarce, obsługuje przyrostowe cache'owanie „dolicz tylko brakujące modele"). Naiwne dopisanie nowego kroku do zwracanej tablicy fragmentowałoby go – raz na model zamiast raz na parę modeli, i myliło atrybucję w `bySource`. Naprawione (commit `8cbc5d3`): nowa opcja `options.caseFoldedActive` (domyślnie `true`) tłumiona jawnie w pętli per-źródło; `cache-orchestrator.js` dostał osobny, jednorazowy blok (`caseFoldedNeeded`) analogiczny do `regexNeeded`/`lexiconNeeded`, z własnym polem cache `cache.caseFolded`. Ten fragment gałęzi nie jest wspomniany w RECALL-90-DESIGN.md §2.2 wprost – dokument zakładał prostszą ścieżkę `createDefaultPipeline` (tor eval), nie audytował cache-orchestratora. Bez tej poprawki funkcja działałaby poprawnie w `npm run eval`, ale źle w prawdziwej przeglądarce.

**Strażnik nagłówków (kontrakt §2.2 pkt 5), finalna wersja po dwóch rundach pomiaru – `isStructuralMarkerSpan`, trzy tryby:**
1. **Lemat dokumentu** (span *zaczyna się* od słowa z zamkniętej listy `data/document-header-lemmas.json`, ~24 wpisy: UMOWA, POZEW, WYROK, POSTANOWIENIE, PEŁNOMOCNICTWO…) – pierwotny kontrakt, przykład motywujący „UMOWA KREDYTU GOTÓWKOWEGO”. Rozszerzony w commit `e550954` z zakresu wyłącznie ORGANIZATION_NAME na WSZYSTKIE pięć typów, po zmierzeniu „PEŁNOMOCNICTWO PROCESOWE” ocenionego jako PERSON_ROLE_OR_TITLE (lemat już był na liście, ale strażnik go nie sprawdzał dla tego typu).
2. **Znacznik numeracji sekcji** (span zaczyna się od cyfry rzymskiej I–XX + kropka) – NOWY strażnik, commit `e550954`, po zmierzeniu „IV. ŻĄDANIE” / „I. PRZYCZYNA” ocenionych jako PERSON_NAME (po foldzie „Iv. Żądanie” ma dokładnie kształt „Inicjał. Nazwisko”).
3. **Goły akronim-etykieta identyfikatora** (CAŁY span, nie tylko pierwsze słowo, dokładnie równy jednemu z: PESEL, NIP, REGON, KRS, IBAN, NRB, SWIFT, BIC) – NOWY strażnik, commit `bd533b0`, po zmierzeniu „PESEL” ocenionego jako ORGANIZATION_NAME i skaskadowanego przez `caseInsensitiveBackfill` na 3 dalsze wystąpienia w tym samym dokumencie (adw_09, patrz §2.3).

Zasada wspólna dla wszystkich trzech: zamknięta lista, nie heurystyka „wygląda podejrzanie” – lista 3 jest w szczególności *zasadowa* (akronimy, dla których TEN system ma już własny, dedykowany typ encji), nie rosnącym rejestrem „słowa, które akurat zawiodły”.

### §2.3 Strażnik luki (gap-filling), commit `2a28b13` – naprawa regresji, nie część pierwotnego kontraktu

Zmierzone na pierwszym pełnym przebiegu syntetycznym (przed jakąkolwiek poprawką): `LOCATION` P spadło ze 100% do 65,2% (8 nowych FP), `POSTAL_ADDRESS` R spadło ze 100% do 83,7% (8 TP zniknęło), `PERSON_ROLE_OR_TITLE` zeszło z idealnych 100/100/100. Zdiagnozowane **konkretnie**, nie przez zgadywanie: uruchomiony obcięty pipeline zatrzymany tuż przed `dedupStep`, dumping pełnej listy kandydatów w okolicy zgubionego adresu. Mechanizm: segment zawierający „ZUS Oddział w Łodzi” (adres w tym samym zdaniu co bliski, niezwiązany akronim „ZUS”) kwalifikuje się do folda przez „ZUS”; oba modele, widząc PRAWIE niezmieniony segment (tylko „ZUS”→„Zus”), dały DLA TEGO SAMEGO adresu dwa sprzeczne typy – LOCATION i POSTAL_ADDRESS – bo lokalna zmiana kontekstu przesunęła reprezentację modelu dla odległego, niezmienionego fragmentu tekstu. `deduplicateEntities` (src/anonymizer.js, WSPÓLNA, nietknięta) jest agnostyczna względem typu i zależna od kolejności sortowania: LOCATION o wyższym score wygrało remis „bliskie score → szerszy span” przeciw już-poprawnemu POSTAL_ADDRESS z głównego przebiegu, a przybywający poprawny kandydat POSTAL_ADDRESS ze źródła `case-folded` przegrał z kolei remis *równej* szerokości przeciw temu złemu zwycięzcy LOCATION.

Naprawa: kandydat case-folded jest odrzucany, jeśli JAKAKOLWIEK encja z głównego przebiegu (dowolnego typu, dowolnego score) nakłada się na jego span. Nie łatka na jeden przypadek – to dosłowne czytanie własnej diagnozy modułu (RECALL-90-DESIGN.md §2.2: oba modele „GUBIĄ SYGNAŁ” na kwalifikujących się segmentach) – case-folded ma wypełniać luki, których główny przebieg NIE WIDZI WCALE, nie relitygować spany, które już pokrył, choćby niedoskonale. Po tej poprawce: LOCATION i POSTAL_ADDRESS wracają do bitowej identyczności z baseline; PERSON_ROLE_OR_TITLE prawie (patrz §2.2 pkt 1 wyżej, to inny mechanizm).

**Ten sam mechanizm domknął też przeciek PESEL na kontradyktoryjnym** (adw_09_pesel_formaty): zmierzone przez porównanie DOKŁADNYCH liczb TP/FP/FN między świeżym przebiegiem main a tą gałęzią na tym samym dniu, tej samej maszynie – TP i FN bitowo identyczne (244/35), CAŁA różnica FP (52→56 przed poprawką §2.2 pkt 3) w jednym dokumencie: fold zdania z etykietą „PESEL:” ocenił goły akronim ORGANIZATION_NAME (0,91), a `caseInsensitiveBackfill` (właściwość PERSON_IDENTIFIER, WSPÓLNA, nietknięta, działająca zgodnie z przeznaczeniem) skaskadował JEDNĄ pomyłkę na 3 dalsze litералne wystąpienia „PESEL” w tym samym dokumencie przez źródło `rescan`. Strażnik #3 z §2.2 domyka to u źródła (0 kandydatów zamiast 1+3).

### §2.4 Dlaczego korpus kontradyktoryjny nie zyskuje ani jednej encji

Sprawdzone wprost, nie założone: na całym przebiegu 38 dokumentów źródło `case-folded` przetrwało do finalnego wyjścia dokładnie **1 raz** na całym korpusie (przed poprawką §2.2 pkt 3) – i był to fałszywy PESEL. Powód: `adw_18_naglowek_pisma` (nazwa dokumentu dosłownie mówi „nagłówek pisma”) ma dokładnie jeden kwalifikujący się segment, „POZEW O ZAPŁATĘ” – ale to WYŁĄCZNIE deklaracja typu pisma, GT nie anotuje tam żadnej encji (strażnik #1 poprawnie nie tworzy tam kandydata, ale nawet gdyby tworzył, nie byłoby czego zyskać). `adw_29_umowa_kredytu` ma nagłówek „UMOWA KREDYTU GOTÓWKOWEGO NR KG/2025/02/00871” – jedyna encja GT w tej linii to `DOCUMENT_REFERENCE` (poza zamkniętą listą typów B2, i tak już wykrywana przez regex, odporny na wielkość liter). `adw_24_ocr_rozstrzelone` jest świadomie poza zakresem (rozstrzelenie liter, C1) – i naturalnie nigdy nie uruchamia case-folded, bo pojedyncze rozstrzelone litery nie osiągają progu 3 znaków (dowiedzione testem `hasUppercaseSignal`, nie tylko zaobserwowane). **Wniosek:** trzy dokumenty, które zainspirowały moduł, testują poprawność negatywną (brak nowych FP) znakomicie, ale żaden z nich – z konstrukcji GT tego konkretnego korpusu – nie niesie okazji do zysku recall dla B2. Okazja (ZUS ×3) siedzi w korpusie syntetycznym.

---

## §3. Rejestr przecieków – porównanie

### Syntetyczny (main→b2: 4→1 pozycji)

Zamknięte: „ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH” wersalikami ×3 (pismo_03, ORGANIZATION_NAME, jedyny cel B2 z tego korpusu w RECALL-90-DESIGN.md §1.3 L2) – **pokrycie 100%, potwierdzone wprost w `anonymized.txt`** (zero wystąpień tekstu jawnego), nie tylko w macierzy score'ów. Pozostała: `SB/00234/PN` (ACCOUNT_IDENTIFIER, score 0,68, poniżej siatki A8 nawet po podniesieniu do 0,95) – udokumentowany od Track 1 (GATE-RECALL-REMEDIATION §3), poza zakresem tej gałęzi, nietknięty.

### Kontradyktoryjny (16→16 pozycji, bitowo identyczne)

Zweryfikowane wiersz po wierszu (nie tylko licznik): wszystkie 16 pozycji z tej gałęzi to DOKŁADNIE te same, wcześniej skatalogowane przecieki z RECALL-B3-NOTES.md §3 (rozstrzelenie OCR PERSON_NAME/ORGANIZATION_NAME ×2 – adw_24, poza zakresem C1; granice inicjałów ×3 – adw_06; kwoty opisowe ×2 – C2; LOCATION Torunia/Chełmża – kolizja źródeł nieporuszona; VEHICLE_IDENTIFIER granice; PERSON_ROLE_OR_TITLE „ produkcji” – znane ograniczenie B4; drobne resztki `snapStep`/`lexiconStep` ×3). **Zero nowych pozycji, zero zniknięć.** `adw_18`/`adw_29` (cele B2 dla tego korpusu) mają zero wpisów w rejestrze – potwierdzone `grep`-em na surowym pliku ANALIZA.md, nie interpretacją.

---

## §4. Odłożone / opisane, nie naprawiane w tej gałęzi

1. **Kaskada „MRI”** (PERSON_NAME, pismo_03, syntetyczny): fold zdania „wyniki badań MRI kręgosłupa…” ocenił goły akronim medyczny jako PERSON_NAME (0,88), `fuzzyBackfill`/`caseInsensitiveBackfill` skaskadował na drugie wystąpienie w tym samym dokumencie. **Ten sam mechanizm co PESEL (§2.3), świadomie NIE domknięty tą samą listą** – „MRI” nie jest etykietą identyfikatora w taksonomii TEGO systemu (w przeciwieństwie do PESEL/NIP/REGON/KRS/IBAN, które są), więc dodanie go do `IDENTIFIER_LABEL_ACRONYMS` rozciągnęłoby zasadową listę w rejestr „akronimy, które akurat zawiodły” – dokładnie to, czego ta gałąź świadomie unika (patrz §2.2). Koszt: 2 FP na całym syntetycznym (PERSON_NAME P 94,5%→92,0%, F1 wciąż wyżej niż stracone R by uzasadniało naprawę tej wielkości). Kandydat do domknięcia dopiero, gdy pojawi się DRUGI, niezależny przykład tej samej klasy (akronim spoza etykiet identyfikatorów mistagowany po foldzie) – jeden punkt danych nie uzasadnia jeszcze osobnego mechanizmu.
2. **B1/B5/B6** (RECALL-90-DESIGN.md) – nietknięte, jak zaplanowano w §5 tamtego dokumentu (R3 przed R6, B1 warunkowe od pomiaru inicjałów).
3. **Korpus 2.0** – nie istnieje jeszcze; pełne kryterium akceptacji B2 z §2.2 kontraktu („czyste FP rosną <10%”) zmierzone tutaj wyłącznie na dev, nie na docelowym holdoucie.
4. **Cache-orchestrator.js jako powierzchnia dotknięta przez tę gałąź** (§2.2) – testy jednostkowe dodane (3 nowe w `cache-orchestrator.test.js`), ale brak testu integracyjnego z prawdziwą przeglądarką/workerem; ryzyko rezydualne niskie (mechanizm lustrza już istniejący wzorzec regex/lexicon), ale nieprzetestowane end-to-end w tej sesji.

---

## §5. Artefakty pomiaru – ostrożnie (WAŻNE, incydent w tej sesji)

**Potwierdzony ponownie i DOTKLIWIE wzorzec z RECALL-B/B3-NOTES §5, tym razem z realnym kosztem:** sprawdzenie `summary.json` (istnieje + poprawny JSON) potwierdza wyłącznie kompletność DANYCH – nie potwierdza, że proces `node.exe` faktycznie się zakończył. W tej sesji jeden przebieg adversarial (start ~15:03) utknął ~2 godziny w oczekiwaniu na zasoby PRZED rozpoczęciem realnego przetwarzania (dokumenty realnie przetworzone dopiero 17:03–17:12), a `TaskStop` na zadaniu w tle (poziom harnessu) **nie ubił** leżącego pod spodem procesu – wisiał dalej, zaobserwowany bezpośrednio przez `Get-Process`: ~11 000 sekund CPU, 800 MB RAM, żywy DŁUGO po tym, jak `summary.json` był już kompletny i użyty do scoringu. Drugi, równoległy przebieg (uruchomiony przeze mnie zaraz po pierwszym „completed”, w dobrej wierze) osiągnął w międzyczasie 2,8 GB RAM – najpewniej właśnie przez konkurencję o zasoby z pierwszym, wciąż żywym procesem. Alan zgłosił to SAM w trakcie sesji, obserwując menedżer zadań – nie było to widoczne z mojej strony bez jawnego sprawdzenia procesów systemowych. Oba ubite ręcznie (`Stop-Process -Force`, dla jednego dodatkowo `taskkill /F /T` – `Stop-Process` bywał niewidoczny w bezpośrednio następującym odczycie `Get-Process`, wymagał potwierdzenia drugim, osobnym odczytem). Zasada zapisana do pamięci trwałej (`eval-adversarial-ostroznosc.md`): po KAŻDYM ciężkim evalu, niezależnie od `summary.json`, jawnie sprawdzić i ubić proces `node.exe` w systemie – nie ufać `TaskStop`owi ani kodowi wyjścia zadania w tle.

**Baseline w tym dokumencie zmierzony DWUKROTNIE świeżo w tej sesji** (nie przepisany z RECALL-B3-NOTES.md), na nietkniętym `main` w głównej kopii roboczej, osobno od pracy na gałęzi: syntetyczny (`2026-07-13T13-44-55`) i kontradyktoryjny (`2026-07-13T17-18-37`, po incydencie wyżej – TEN przebieg jest tym, który utknął na starcie). Oba bitowo zgodne z liczbami cytowanymi w RECALL-B-NOTES.md/RECALL-B3-NOTES.md – niezależne potwierdzenie reprodukowalności toru pomiarowego, nie założenie.

**Regresja LOCATION/POSTAL_ADDRESS (§2.3) i przeciek PESEL (§2.3) zdiagnozowane narzędziowo, nie przez inspekcję wzrokową** – skrypt jednorazowy uruchamiający pipeline obcięty tuż przed `dedupStep` (import bezpośrednio z `src/pipeline/configs/default.js`, budowa własnej tablicy faz), zrzucający pełną listę kandydatów w oknie wokół zgubionej encji. Bez tego kroku poprawka §2.3 byłaby zgadywaniem, nie pomiarem.

---

## §6. Reprodukcja

| Co | Komenda | Run ID |
|---|---|---|
| Testy | `npm test` (1524 testów, 90 plików) | – |
| Baseline syntetyczny (main, świeży) | `npm run eval -- --label=recall-b2-baseline-main` | `2026-07-13T13-44-55` |
| Baseline kontradyktoryjny (main, świeży) | `npm run eval -- --dir=test-data/adversarial --label=recall-b2-baseline-adv` | `2026-07-13T17-18-37` |
| Eval syntetyczny (finalny) | `npm run eval -- --label=recall-b2-final` | `2026-07-13T17-30-26` |
| Eval kontradyktoryjny (finalny) | `npm run eval -- --dir=test-data/adversarial --label=recall-b2-final` | `2026-07-13T17-43-22` |
| Scoring / rejestr | `npm run eval:score <run>` / `npm run eval:analyze <run>` | – |

Katalogi przebiegów (`test-data/results/…`) są poza gitem, jak w poprzednich audytach. **Po każdym `npm run eval` na maszynie tej sesji: sprawdzić `Get-Process -Name node` i ubić ręcznie, niezależnie od stanu `summary.json` (patrz §5).**

---

*Notatka sporządzona w ramach gałęzi `feature/recall-b2`, sesja Sonnet, 2026-07-13. Gałąź NIEZMERGOWANA – zostawiona do przeglądu. Główne artefakty: `src/pipeline/case-fold.js` + `case-fold.test.js` (nowe), `src/pipeline/steps/case-folded-ner.js` + testy w `steps.test.js` (nowe), `src/pipeline/data/document-header-lemmas.json` (nowe), `src/pipeline/case-folded-goldens.test.js` (nowe, 4 goldeny), `entity-sources.js`/`entity-rules.js` (+źródło `case-folded`, progi), `configs/default.js` (wpięcie + `caseFoldedActive`), `cache-orchestrator.js` (+blok `caseFoldedNeeded`, `cache.caseFolded`) + testy.*
