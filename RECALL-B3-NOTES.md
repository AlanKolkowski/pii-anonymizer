# RECALL-B3-NOTES.md – leksykon kontekstowy art. 9-10 RODO, gałąź feature/recall-b3

**Data:** 2026-07-13, sesja Sonnet, `feature/recall-b3`, z `main` @ `cf8fdaa` (po recall-b: adversarial 86,7%).
**Branch:** `feature/recall-b3`, **niescalona** – zostawiona do lekkiej bramki Opusa/Alana zgodnie z poleceniem
(przegląd treści leksykonu + polityki granic spanu, per RECALL-90-DESIGN.md §2.3).
**Rodzice:** `RECALL-90-DESIGN.md` §2.3 (B3, pełny kontrakt); `GATE-RECALL-REMEDIATION.md`; `RECALL-B-NOTES.md`
(wzorzec plumbingu z B4-lite, w tym `LEXICON_SCORE` i jego uzasadnienie); `EVAL-RECALL-AUDIT.md` §6 (rejestr
przecieków, w tym #2/#11/#30).
**Zakres:** trzy kategorie z udowodnionymi pełnymi wyciekami (CRIMINAL_OFFENCE_DATA, HEALTH_DATA,
TRADE_UNION_MEMBERSHIP) + minimalna lista dla pozostałych czterech kategorii art. 9 (RELIGION_OR_BELIEF,
POLITICAL_OPINION, SEXUAL_ORIENTATION, ETHNIC_ORIGIN).

Komity (4, po jednym per kategoria): `c158969` (infrastruktura + CRIMINAL_OFFENCE_DATA), `e6febbf`
(HEALTH_DATA), `7fc0427` (TRADE_UNION_MEMBERSHIP), `1d02f8d` (pozostałe cztery kategorie). Worktree osobny
(`recall-b3-worktree`, własny `npm ci`, bez junction node_modules) – główna kopia robocza nietknięta.

---

## §1. Wynik końcowy

| Korpus | Metryka | Baseline (main @ cf8fdaa, z RECALL-B-NOTES.md §1) | Po recall-b3 | Δ |
|---|---|---|---|---|
| Syntetyczny | P / R / F1 (ogółem) | 90,2 / 91,1 / 90,7 | **90,2 / 91,1 / 90,7** | bez zmian |
| Syntetyczny | przecieki (rejestr) | 4 | **4** | bez zmian (te same 4, nieporuszone) |
| Kontradyktoryjny | P / R / F1 (ogółem) | 82,3 / 86,7 / 84,5 | **82,4 / 87,5 / 84,9** | +0,1 / +0,8 / +0,4 p.p. |
| Kontradyktoryjny | przecieki (rejestr) | 19 | **16** | **−16%** (dokładnie #2, #11, #30 zamknięte, zero nowych) |
| Kontradyktoryjny | CRIMINAL_OFFENCE_DATA P/R/F1 | nieznane (0 encji GT wcześniej niewykryte) | **50,0 / 100,0 / 66,7** (TP 1, FP 1, FN 0) | recall pełny; jedyny FP to zamierzona detekcja adw_30 (§3) |
| Kontradyktoryjny | HEALTH_DATA P/R/F1 | n/d (0 przecieków tego typu w rejestrze bazowym z innego powodu, patrz niżej) | **50,0 / 50,0 / 50,0** (TP 1, FP 1, FN 1, **tpPartial 1**) | pokrycie 100% mimo słabego wyniku P/R — patrz §1.1 |
| Kontradyktoryjny | TRADE_UNION_MEMBERSHIP P/R/F1 | n/d | **100,0 / 100,0 / 100,0** (TP 1, FP 0, FN 0) | pełne, dokładne trafienie |
| Kontradyktoryjny | PERSON_ROLE_OR_TITLE P/R/F1 | 63,2 / 70,6 / 66,7 | **63,2 / 70,6 / 66,7** | **bitowo identyczne** (TP/FP/FN 12/7/5 → 12/7/5) |

Uwaga o baseline: RECALL-B-NOTES.md §1 cytuje baseline zmierzony bezpośrednio na `main` przed scaleniem
recall-b; ponieważ recall-b3 startuje z `main` PO scaleniu recall-b (`cf8fdaa`), a ten branch nie dotyka
niczego poza `HEALTH_DATA`/`CRIMINAL_OFFENCE_DATA`/`TRADE_UNION_MEMBERSHIP`/pozostałymi czterema typami
art. 9, liczby „Po recall-b” z tamtej notatki są tożsame z baseline tej gałęzi — nie przepisane z pamięci,
tylko potwierdzone identycznością PERSON_ROLE_OR_TITLE (bitowo) i P/R ogółem syntetycznego (bitowo) w
przebiegu tej sesji.

**Cel Alana (GATE-EVAL-RECALL §6): recall 90%+ na korpusie kontradyktoryjnym przed materiałami
marketingowymi.** Wynik tej gałęzi: **87,5%** (z 86,7%), **+0,8 p.p.** Nie osiągnięto 90% — zgodne z
RECALL-90-DESIGN.md §1.4 („+B3 ~0,7–1 p.p.”, w górnym paśmie trafione co do liczby uwolnionych przecieków,
ale ta klasa przecieków była mała liczebnie — 3 z 19 pozycji rejestru, choć wagi 5). **Marketing pozostaje
wstrzymany** (moduły B1/B2/B5/B6 z RECALL-90-DESIGN.md §5 wciąż nietknięte).

### §1.1 Dlaczego HEALTH_DATA pokazuje 50%/50% mimo zamkniętego przecieku

`src/eval/score.js` liczy P/R/F1 **ściśle** (`computeMetrics`): dopasowanie z `matchEntities` (IoU ≥ 0,5,
wymóg zgodności typu) dzieli się dalej na `exactMatches` (start/end identyczne z GT) i `partialMatches`
(dopasowane, ale inne granice) — **tylko exact liczy się jako TP**; partial liczy się jako **1 FP + 1 FN
jednocześnie** (komentarz w kodzie: „Partial matches count as both FP (wrong boundary) and FN (not fully
found)"). Mój span dla „zwolnieniu z powodu epizodu depresyjnego" [172,212) jest nadzbiorem GT [192,212)
(„epizodu depresyjnego") — kotwica „zwolnieniu z powodu" nie jest w adnotacji GT (patrz §2, drugi wpis
HEALTH_DATA w adw_38). IoU = 20/40 = dokładnie 0,5 → **dopasowanie istnieje** (≥ próg), ale ponieważ granice
się różnią, `score.js` liczy to jako partial → 1 FP + 1 FN zamiast 1 TP. To **wyłącznie artefakt ścisłego
scoringu granic**, nie przeciek: `src/eval/analyze.js`'s `charCoverage` (metryka rzeczywiście używana do
rejestru przecieków, agnostyczna względem granic/typu) potwierdza **100% pokrycia** tej encji GT — zweryfikowane
bezpośrednio (`ANALIZA.md` run `2026-07-13T07-20-28`, brak wpisu HEALTH_DATA w rejestrze). Ten sam mechanizm
(GT adnotuje samo dopełnienie, wzorzec B3 dodaje kotwicę) jest wprost przewidziany przez
RECALL-90-DESIGN.md §3.5 pkt 2 dla przyszłego korpusu 2.0: „rozbieżność GT↔B3 jest sygnałem do poprawy B3,
nigdy GT" — a nie coś do naprawy tutaj, skoro jest to jedyna taka rozbieżność na 4 trafienia GT w tym
dokumencie (pozostałe 3: choruje na cukrzycę, skazany za przywłaszczenie, członkinią związku — **dokładne
trafienia, bit w bit**, patrz §2).

---

## §2. Moduły – co zrobiono

Plumbing wzorowany na B4-lite (`RECALL-B-NOTES.md` §2), ale dopasowanie to **kotwica + dopełnienie**, nie
płaska forma: `src/pipeline/special-category-lexicon.js` (matcher) + `steps/special-category-lexicon.js`
(step, wpięty w fazę `ner` obok `lexiconStep` B4) + `data/special-category-lexicon.json` (17 wpisów: wzorzec,
kategoria, opis, przykład+/−, `mustCover`). Span: dopasuj kotwicę regexem, rozszerz do najbliższego znaku
kończącego frazę (`,.;` lub nowa linia) albo samodzielnego spójnika współrzędnego (i/oraz/lub/albo/ale/a/
czy/ani), twardy limit 60 znaków za kotwicą, przytnij końcową białą spację. `score = 0,95` (nie 1,0) — **ta
sama ochrona dedup co B4-lite** (`LEXICON_SCORE` w `lexicon.js`), tyle że dla przeciwnego kierunku ryzyka: tu
nasz span jest zwykle SZERSZY niż kandydat modelu (bo modele w ogóle nie widzą tych fraz opisowych), więc
score 1,0 („perfect tier" zawsze wygrywa) działałby poprawnie w typowym przypadku — ale nie ma gwarancji, że
kandydat modelu nigdy nie okaże się szerszy (np. inny punkt odcięcia na spójniku), a 0,95 kieruje taki
przypadek przez gałąź dedup „bliskie score → szerszy span wygrywa" zamiast przez bezwarunkowe weto „perfect
tier" — **nigdy gorsze niż 1,0, czasem lepsze**, dowiedzione dedykowanymi testami (patrz niżej).

### CRIMINAL_OFFENCE_DATA (commit `c158969`)

Pięć kotwic: `skazan(y/a/ego/ej/emu/ym/ą) (prawomocnym wyrokiem)? za`, `ukaran(...) za`, `odbywa(ł/ła)? karę`,
`(nie)?karan(y/a/...)`, `wyrok(iem)? w sprawie karnej`. Zamyka przeciek **#2** (adw_38: „skazany prawomocnym
wyrokiem za przywłaszczenie mienia" — **trafienie bit w bit** z GT [237,291)).

`wyrok(iem)? w sprawie karnej` wymaga literalnie kwalifikatora „w sprawie karnej" — bare „wyrok" to w tym
korpusie w większości cytowania orzecznictwa cywilnego (adw_32: „w wyroku z dnia 14 maja 2021 r. (V CSKP
12/21)"), dowiedzione jako pułapka FP w dedykowanym teście.

`(nie)?karan(y/a/...)` poprawnie i **zamierzenie** wykrywa „niekarany" w adw_30 (`Oskarżony ... niekarany.`)
— GT tego dokumentu nie anotuje tego tokenu jako CRIMINAL_OFFENCE_DATA (adnotuje sąsiednie „żonaty, dwoje
dzieci" jako PERSON_ATTRIBUTE, ale nie „niekarany" osobno). To **luka w korpusie, nie błąd modułu**:
RECALL-90-DESIGN.md §2.3 pkt 1 wprost nazywa to zamierzonym zakresem („oświadczenie o niekaralności to też
dana art. 10 – informacja o braku wyroków"), a §3.5 pkt 2 (polityka adnotacji dla przyszłego korpusu 2.0)
mówi wprost, że taka rozbieżność jest sygnałem do poprawy wzorca, nigdy GT — a wzorzec tu jest zgodny ze
specyfikacją. Efekt uboczny w scoringu: 1 FP dla CRIMINAL_OFFENCE_DATA w ogólnym wyniku (§1).

### HEALTH_DATA (commit `e6febbf`)

Sześć kotwic: `(choruje|cierpi) na`, `zdiagnozowano`, `lecz(y/ył/yła) się (na|w)`, `orzeczeni(e/em/u) o
(niepełnosprawności|niezdolności do pracy)`, `zwolnieni(e/u) (lekarski(m)?)? z powodu`, `uzależni(enie/enia/
ony/ona) od <zamknięta lista>`. Zamyka przeciek **#11** (patrz §1.1 o metryce granic).

Dwa świadome zawężenia względem literalnego brzmienia RECALL-90-DESIGN.md §2.3, obie udowodnione realną
pułapką z korpusu:
- **Forma 1. os. „cierpię" pominięta.** `pismo_03` (korpus syntetyczny) otwiera listę chorób zdaniem
  „Cierpię na następujące schorzenia, udokumentowane w załączonej dokumentacji:" — każda konkretna jednostka
  chorobowa z tej listy jest już osobno wykrywana przez model (9/9 TP, P/R/F1 100% na tym typie w tym
  dokumencie, zweryfikowane w tej sesji). Dodanie 1. os. dodałoby dopasowanie na samym nagłówku listy (span
  kończący się na przecinku: „Cierpię na następujące schorzenia") bez żadnego zysku pokrycia — czysty FP.
- **`uzależnienie/-y/-a od` wymaga zamkniętej listy przedmiotów** (alkohol/narkotyki/hazard/nikotyna/
  dopalacze/leki/substancje psychoaktywne), nie wolnego dopełnienia. Bare „uzależniony/-a od X" jest w
  polskim języku prawniczym pospolitą konstrukcją warunkową („wysokość odszkodowania jest uzależniona od
  stopnia przyczynienia się poszkodowanego") — bez tego ograniczenia byłby to największy pojedynczy
  generator FP w całym leksykonie. Nie występuje w żadnym z 45 dokumentów obu korpusów (sprawdzone), ale to
  ryzyko realne dla przyszłych dokumentów kancelarii (sprawy odszkodowawcze).

**Pominięte świadomie:** `przebył(a)? <dopełnienie-medyczne>` z listy wzorców RECALL-90-DESIGN.md §2.3 NIE
zaimplementowane. Czasownik „przebyć" ma dominującą sferę znaczeniową niezwiązaną ze zdrowiem („przebyć całą
drogę", „przebyć procedurę odwoławczą") i nie da się go bezpiecznie zawęzić bez listy jednostek chorobowych
— a to dokładnie to, czego v1 świadomie zakazuje (RECALL-90-DESIGN.md §2.3 pkt 4). Brak w obu korpusach
(sprawdzone), więc brak pomiaru recall utraconego przez to pominięcie; kandydat do rozważenia dopiero z
podejściem kontekstowym (W3-like) albo po pomiarze na korpusie 2.0.

### TRADE_UNION_MEMBERSHIP (commit `7fc0427`)

Dwie kotwice: `członek/członkini (...)` i `należy do/przynależność do (...)`, obie wymagające sąsiedztwa
wskaźnika związkowego (`związk(u/ów) zawodow(ego/ych)` / NSZZ / OPZZ / ZNP). Zamyka przeciek **#30**
(adw_38: „członkinią Związku Zawodowego Pracowników Przetwórstwa Spożywczego" — **trafienie bit w bit** z GT
[352,418)).

Wskaźnik związkowy nie jest ozdobnikiem: obie kotwice bez niego są w polskim prawniczym najpospolitszymi
konstrukcjami niezwiązanymi ze związkami — „członek" to najczęściej członek zarządu/rodziny/klubu, „należeć
do" to zwykła własność („nieruchomość należy do pozwanego"). Bez wymogu sąsiedztwa te dwie kotwice byłyby
prawdopodobnie największym generatorem FP w całym module. Dowiedzione dedykowanymi testami na obu
konstrukcjach.

Dedup: mechanizm przecieku #30 wymagał osobnego dowodu — model oznacza samą nazwę związku jako
ORGANIZATION_NAME (bez „członkinią"), więc nasz szerszy span TRADE_UNION_MEMBERSHIP musi wygrać arbitraż z
`deduplicateEntities` mimo różnicy typu (funkcja jest agnostyczna względem typu przy rozstrzyganiu
nakładania) — udowodnione wprost, nie założone.

### Pozostałe kategorie art. 9 (commit `1d02f8d`)

Cztery minimalne kotwice, świadomie krótkie (RECALL-90-DESIGN.md §2.3 pkt 5), do rozszerzenia dopiero po
pomiarze na korpusie 2.0 — **żaden z obu obecnych korpusów nie ma ani jednej encji GT tych czterech typów**
(sprawdzone bezpośrednio), więc to zerowe ryzyko pomiarowe teraz, ale realne pokrycie produkcyjne od razu:

- `RELIGION_OR_BELIEF`: `wyznani(e|a)`, z wykluczeniem „wyznanie winy" (przyznanie się do winy — jedyna
  znana kolizja znaczeniowa).
- `POLITICAL_OPINION`: `(poglądów|poglądy|przekonań|przekonania) polityczn(ych|e)` — **RECALL-90-DESIGN.md
  §2.3 nie podaje literalnego wzorca dla tej kategorii** (tylko nazwę „poglądy" w nawiasie), więc ten wzorzec
  to decyzja tej gałęzi, nie zawężenie danego wzorca. Bare „pogląd/poglądy" jest w piśmiennictwie prawniczym
  w ogromnej większości „poglądem sądu/doktryny" (stanowiskiem prawnym), nie opinią polityczną — kwalifikator
  „politycz-" jest obowiązkowy, inaczej byłby to prawdopodobnie największy generator FP w całym module (nawet
  większy niż bare „uzależniony od" czy „członek").
- `SEXUAL_ORIENTATION`: `orientacj(i|a|ę|ą) seksualn(ej|a|ą)` — bare „orientacja/orientacji" ma dominujące
  znaczenia niezwiązane (rynkowa, w terenie, zawodowa).
- `ETHNIC_ORIGIN`: `narodowości` / `pochodzenia etniczn(ego|ym)` — bare „pochodzenia" jest w praktyce
  komercyjnej (obsługa firm) dominująco pochodzeniem towaru/środków (dokumenty celne/handlowe, AML), nie
  cechą osoby.

---

## §3. Rejestr przecieków – porównanie (korpus kontradyktoryjny, 38 dok.)

**Przed (recall-b, 19 pozycji):** zawierał #2 (CRIMINAL_OFFENCE_DATA, pokrycie 0%, waga 5), #11
(HEALTH_DATA, pokrycie 58%, waga 5), #30 (TRADE_UNION_MEMBERSHIP, pokrycie 83%, waga 5) — trzy jedyne
pozycje wagi 5 w całym ówczesnym rejestrze.

**Po (recall-b3, 16 pozycji):** #2, #11, #30 **całkowicie usunięte z rejestru** (pokrycie 100%,
zweryfikowane wprost w `ANALIZA.md` runu `2026-07-13T07-20-28` — zero wpisów CRIMINAL_OFFENCE_DATA/
HEALTH_DATA/TRADE_UNION_MEMBERSHIP). **Zero nowych pozycji jakiegokolwiek typu** — pozostałe 16 to dokładnie
te same, wcześniej skatalogowane przecieki spoza zakresu tej gałęzi (OCR-rozstrzelenie PERSON_NAME/
ORGANIZATION_NAME ×2, FINANCIAL_AMOUNT opisowe ×2, LOCATION próg/filtr źródeł ×2, VEHICLE_IDENTIFIER granice,
PERSON_NAME inicjały ×3, PERSON_ROLE_OR_TITLE „ produkcji" — **ten sam, opisany już w RECALL-B-NOTES.md §3
jako jedyny pozostały cel B4** — oraz trzy drobne resztki `snapStep`/nerStep). Potwierdzone bezpośrednio: żaden
wpis rejestru nie jest atrybutowany do `specialCategoryLexiconStep` w `debug.json` (sprawdzone
programatycznie, nie tylko wizualnie).

**Pułapki adw_32/33/34 (kryterium akceptacji „zero nowych FP"):** zero trafień specjalnej kategorii na
wszystkich trzech, zweryfikowane i testem jednostkowym (czytającym pliki wprost z korpusu), i pełnym
przebiegiem eval (żaden z trzech nie ma wpisu w rejestrze przecieków ani w macierzy pomyłek dla typów B3).

**Skutek uboczny w scoringu (nie w rejestrze przecieków):** 1 nowy FP dla CRIMINAL_OFFENCE_DATA (adw_30
„niekarany" — §2, zamierzone) i formalnie 1 FP + 1 FN „partial" dla HEALTH_DATA (adw_38, artefakt granic —
§1.1). Żaden z dwóch nie jest przeciekiem treści.

---

## §4. Odłożone / opisane, nie naprawiane w tej gałęzi

1. **`przebył(a)? <dopełnienie-medyczne>`** (§2, HEALTH_DATA) — pominięty świadomie, verb zbyt
   wieloznaczny bez taksonomii chorób (zakazanej przez v1). Brak pomiaru recall utraconego (nie występuje w
   obu korpusach).
2. **Kotwica przecinająca się ze skrótem w środku dopełnienia** (np. „sygn. akt" po „wyrok w sprawie
   karnej") — algorytm granicy nie zna listy skrótów (`polish-abbreviations.js`), w przeciwieństwie do
   `trimTrailingPunctuationStep`; kropka skrótu jest traktowana jak każda inna kropka kończąca frazę, co
   może przedwcześnie uciąć dopełnienie. Nieobjęte żadnym przykładem z obu korpusów; udokumentowane wprost w
   `special-category-lexicon.json` (`note` pola `criminal-wyrok-w-sprawie-karnej`).
3. **Luka w GT adw_30 dla „niekarany"** (§2, §3) — zdiagnozowana jako luka korpusu, nie błąd modułu, zgodnie
   z RECALL-90-DESIGN.md §3.5 pkt 2. Nie naprawiana tutaj (poza zakresem tej gałęzi — dotyczy pliku
   `.expected.json`, nie kodu pipeline'u); kandydat do poprawki GT przy okazji generowania korpusu 2.0.
4. **`political-poglady` to wzorzec wymyślony w tej gałęzi**, nie zawężenie wzorca ze specyfikacji (§2) —
   RECALL-90-DESIGN.md §2.3 nie podaje literalnego brzmienia dla POLITICAL_OPINION. Warty jawnego
   potwierdzenia przy bramce: czy kwalifikator „politycz-" jest wystarczający, czy warto dodać alternatywne
   konstrukcje (np. „sympatyk/zwolennik partii X") po pomiarze na korpusie 2.0.
5. **B1/B2/B5/B6** (RECALL-90-DESIGN.md) — nietknięte, jak zaplanowano (ta gałąź to wyłącznie B3).
6. **Korpus 2.0** (RECALL-90-DESIGN.md §3.3: ≥90 encji art. 9-10, recall fraz opisowych ≥80% przy P≥95% dla
   źródła `lexicon`) — nie istnieje jeszcze; kryterium akceptacji pełnego kontraktu B3 (nie tylko #2/#11/#30)
   pozostaje niezmierzone do czasu jego wygenerowania.

---

## §5. Artefakty pomiaru – ostrożnie

- **Cache modelu jest per-worktree, nie globalny dla użytkownika**
  (`node_modules/@huggingface/transformers/.cache/`) — inaczej niż można by się spodziewać. Pierwsze
  uruchomienie `npm run eval` w nowym worktree pobiera modele od nowa (~1,1 GB + ~555 MB), nawet jeśli inny
  worktree tej samej maszyny ma je już pobrane.
- **Nieudane wcześniejsze wywołanie `--help` (nierozpoznana flaga, run.js po cichu odpala pełny eval
  domyślny) zostało przerwane w trakcie pobierania modelu**, co uszkodziło plik `model.onnx` (465 MB
  zamiast oczekiwanych ~1,1 GB — obcięty, „Protobuf parsing failed" przy starcie kolejnego przebiegu).
  Naprawa: usunięcie całego katalogu `.cache` i ponowne pobranie od zera. **Wniosek na przyszłość: `run.js`
  nie ma trybu `--help` — każde wywołanie bez rozpoznanej flagi odpala pełny eval na domyślnym korpusie;
  nigdy nie przerywać go w trakcie pierwszego pobierania modeli.**
- **Potwierdzony ponownie wzorzec z RECALL-B-NOTES.md §5:** przebieg na korpusie kontradyktoryjnym (38 dok.,
  2 modele) kończy realną pracę (wszystkie 38 katalogów dokumentów zapisane, `summary.json` zapisany i
  poprawny JSON, symlink `latest` zaktualizowany) **ale proces Node pozostaje żywy i rośnie pamięciowo**
  (obserwowane bezpośrednio: 9,5 GB → 10,6 GB working set, rosnący czas CPU) zamiast zakończyć się czysto —
  zgodne z wcześniejszą obserwacją „awaria jest w jakimś końcowym kroku procesu Node/V8, PO zapisaniu danych".
  **Zasada zastosowana w tej sesji:** po uruchomieniu, sprawdzić czy wszystkie oczekiwane katalogi dokumentów
  i `summary.json` istnieją i czy ten ostatni parsuje się jako poprawny JSON — jeśli tak, dane są kompletne i
  można bezpiecznie przerwać wiszący proces (`TaskStop`) i przejść do `eval:score`/`eval:analyze`, niezależnie
  od tego, czy proces sam zakończyłby się kodem 0 czy awarią pamięci.
- **Baseline zacytowany w §1 nie był ponownie mierzony od zera** na tej gałęzi (w odróżnieniu od praktyki
  `recall-b`) — main przy `cf8fdaa` jest bajt w bajt tym, co `RECALL-B-NOTES.md` już zmierzyła i
  udokumentowała w tej samej sesji co merge; bitowa identyczność PERSON_ROLE_OR_TITLE (kontr.) i P/R ogółem
  (synt.) w przebiegach tej gałęzi to bezpośrednie potwierdzenie, nie założenie. Decyzja świadoma: uniknięcie
  dodatkowego, kosztownego i ryzykownego (OOM) przebiegu na niezmienionym kodzie.
- **Ewaluacje per kategoria nie były uruchamiane osobno** (cztery pełne przebiegi na obu korpusach, jak
  sugerowałaby dyscyplina „commit per kategoria + tagowany eval per kategoria" czytana literalnie) — zamiast
  tego każda kategoria miała pełny przebieg `npm test` (tani, szybki, ~18 s) jako bramkę przed commitem, a
  drogi/ryzykowny (OOM) przebieg na obu korpusach wykonany raz, na kompletnym stanie końcowym. Kompromis
  świadomy, opisany tutaj wprost zamiast ukryty.

---

## §6. Reprodukcja

| Co | Komenda |
|---|---|
| Testy | `npm test` (1487 testów, 88 plików) |
| Eval syntetyczny (finalny) | `npm run eval -- --label=recall-b3-final` → run `2026-07-13T07-09-24` |
| Eval kontradyktoryjny (finalny) | `npm run eval -- --dir=test-data/adversarial --label=recall-b3-final-adv` → run `2026-07-13T07-20-28` |
| Scoring / rejestr | `npm run eval:score <run>` / `npm run eval:analyze <run>` |

Katalogi przebiegów (`test-data/results/…`) są poza gitem, jak w poprzednich audytach.

---

*Notatka sporządzona w ramach gałęzi `feature/recall-b3`, sesja Sonnet, 2026-07-13. Gałąź NIEZMERGOWANA —
zostawiona do lekkiej bramki (przegląd treści leksykonu + granic spanu). Główne artefakty:
`src/pipeline/special-category-lexicon.js` + `steps/special-category-lexicon.js` +
`data/special-category-lexicon.json` (nowe, 17 wpisów), `entity-sources.js` (+`lexicon` dla 7 typów art.
9-10), `configs/default.js`/`default.test.js` (wpięcie nowego kroku w fazę `ner`),
`special-category-lexicon.test.js` (nowy, 89 testów).*
