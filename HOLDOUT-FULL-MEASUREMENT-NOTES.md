# HOLDOUT-FULL-MEASUREMENT-NOTES.md — pełny pomiar korpusu holdout 2.0 (206 dok.)

Sesja Sonnet, 2026-07-14, maszyna PC (32 GB RAM). Pomiar bramkowy zlecony w
`ROADMAP.md` §5 / `CORPUS-2.0-NOTES.md` ("pomiar bramkowy przenosi się na PC") —
laptop 15,4 GB nie udźwignął tego przebiegu (OOM). **Gałąź NIEZMERGOWANA —
do przeglądu Opusa.** Zero zmian w kodzie (sesja pomiarowa, zgodnie z zadaniem).

Przeczytane dla kontekstu: `ROADMAP.md`, `RECALL-90-DESIGN.md` §3-4 (definicja
`GATE-RECALL-90`), `CORPUS-2.0-NOTES.md`, `GATE-RECALL-REMEDIATION.md`.

---

## §0. Nie jest to werdykt bramki

Ten dokument dostarcza surowy pomiar (TP/FP/FN, per typ, rejestr przecieków).
Werdykt `GATE-RECALL-90` (`RECALL-90-DESIGN.md` §4.2) wymaga dodatkowo: (a) dolnej
granicy 95% przedziału ufności (bootstrap po dokumentach, 10 000 replik — NIE
liczona w tej sesji), (b) rozstrzygnięcia wpływu luki deklinacji ORGANIZATION_NAME
(§3 niżej), (c) ręcznego przeglądu G4 (częściowe przecieki wagi 5, §4 niżej).
Świadomie nie wyciągam wniosku „mamy/nie mamy 90%".

## §1. Środowisko i sanity

- Node.js 24.18.0 LTS (winget), Git 2.55.0.
- `npm ci`: 469 pakietów, 0 podatności. Ostrzeżenie „allow-scripts" dla 7 pakietów
  (onnxruntime-node, sharp, esbuild i in.) — zweryfikowane ręcznie: natywne binarki
  (`onnxruntime_binding.node`, `@img/sharp-win32-x64`) obecne mimo ostrzeżenia.
- `npm test`: **98/98 plików, 2062/2062 testów zielonych** — zgodnie z oczekiwaniem.
- Smoke (1 dok. holdout): modele HuggingFace pobrane i wczytane poprawnie
  (106 s zimny start) — **HF działa, nie trzeba kopiować cache z laptopa.**

## §2. Incydent: bad_alloc w ciągłym przebiegu (NOWE, nie w zadaniu sesji)

Pełny przebieg 206 dok. w jednym procesie
(`npm run eval -- --dir=test-data/adversarial-holdout --label=holdout-full`) padł
na `onnxruntime-node` „bad allocation" po **124/206** dokumentach
(`hold_inicjaly_00`). Przed awarią narastające spowolnienie per dokument
(5 s → 40-65 s). Ten sam objaw co `GATE-RECALL-REMEDIATION.md` §5
(`cache-ner-for-thresholds.mjs`, tam po „kilkunastu" dokumentach) — teraz w
`src/eval/run.js`, na maszynie 32 GB dociera dalej (124) ale wciąż pada. Wygląda
na akumulację pamięci natywnej w wielokrotnym cyklu load/dispose modeli w jednym
procesie, **NIE na brak RAM** (~29 GB wolne zaraz po awarii, sprawdzone
`Get-CimInstance Win32_OperatingSystem`). `summary.json` niezapisany (pisany
dopiero po pętli w `src/eval/run.js`) — 124 częściowe wyniki nieużywalne dla
`eval:score`/`eval:analyze` (oba twardo wymagają `summary.json`, `analyze.js`
nawet bez `try/catch` przy jego odczycie).

**Nie naprawiane w tej sesji** (sesja pomiarowa, zero zmian w kodzie). Wniosek dla
backlogu: flaga `--batch=N`, odłożona w `CORPUS-2.0-NOTES.md` z uzasadnieniem
„na 32 GB PC pamięć nie jest wąskim gardłem", **staje się teraz uzasadniona** —
32 GB nie wystarcza dla ciągłego przebiegu 206 dok. w jednym procesie, wbrew
założeniu z `ROADMAP.md`/`CORPUS-2.0-NOTES.md`. Obejście poniżej (batching bez
zmian w kodzie) usuwa pilność, ale root cause w `onnxruntime-node`/`@huggingface/transformers`
pozostaje nieznaleziony.

### Obejście: batching, zero zmian w kodzie

Podział 206 dokumentów na 7 przebiegów po ~30 (jawne listy plików jako argumenty
pozycyjne + `--dir=test-data/adversarial-holdout` dla poprawnego stempla `docsDir`
w `summary.json`, `--label=holdout-full-bN`). Każdy przebieg = świeży proces =
zerowa akumulacja. Wynik: **0/7 awarii bad_alloc**, i szybciej
(~3-5 s/dok. stabilnie w każdym batchu, bez degradacji).

| Batch | Run ID | Dok. | Encji wykrytych | Czas |
|---|---|---|---|---|
| holdout-full-b1 | `2026-07-14T06-12-20` | 30 | 204 | 107.24s |
| holdout-full-b2 | `2026-07-14T06-14-10` | 30 | 159 | 76.84s |
| holdout-full-b3 | `2026-07-14T06-15-28` | 30 | 204 | 93.45s |
| holdout-full-b4 | `2026-07-14T06-17-03` | 30 | 332 | 146.28s |
| holdout-full-b5 | `2026-07-14T06-19-32` | 30 | 248 | 107.92s |
| holdout-full-b6 | `2026-07-14T06-21-22` | 30 | 253 | 102.46s |
| holdout-full-b7 | `2026-07-14T06-23-06` | 26 | 276 | 104.98s |

Reprodukcja per batch: `npm run eval:score <runId>` + `npm run eval:analyze <runId>`.
Wyniki brutto (JSON per-dokument, `summary.json`, `scores.json`, `analysis.json`,
`ANALIZA.md`) zostają na maszynie PC pod `test-data/results/<runId>/` —
gitignored (poza `baseline/`), zgodnie z istniejącą konwencją repo (patrz historia:
„chore: remove stale baseline eval results"). Ten plik jest samodzielnym, pełnym
podsumowaniem — nie wymaga dostępu do tamtych plików.

## §2b. Incydent: EPERM na symlinku „latest" (NOWE, kosmetyczny)

Wszystkie 9 uruchomień (smoke + pełny ciągły + 7×batch) kończyły się `EPERM` przy
`updateLatestSymlink` (Windows, brak trybu deweloperskiego/uprawnień admina do
symlinków na tej maszynie). **Nie wpływa na dane** — `summary.json` zapisywany
PRZED tym krokiem (`src/eval/run.js:229-230`), zweryfikowane w kodzie i na dysku
za każdym razem. Nie naprawiane (zmiana ustawień systemowych, poza zakresem sesji
pomiarowej) — Alan może włączyć tryb deweloperski dla przyszłego czystego
przebiegu, jeśli mu na tym zależy.

### Weryfikacja naprawy `process.exit()` (`CORPUS-2.0-NOTES.md` §5)

9/9 uruchomień: proces kończył się **natychmiast, bez zawieszenia** (zero
`node.exe` widocznych po awarii, sprawdzone `Get-Process` za każdym razem) —
potwierdza ścieżkę błędu (`.catch()` → `exit(1)`), 9/9. Ścieżka sukcesu
(`.then(() => exit(0))`) pozostaje **formalnie nieprzetestowana** — coś rzuciło
wyjątek przed jej osiągnięciem za każdym razem (raz bad_alloc, 8× symlink EPERM).
Więcej niezależnych potwierdzeń niż poprzednia sesja (9 zamiast 3), wszystkie na
ścieżce błędu — brak zawieszenia jest teraz dobrze potwierdzony, sama linia sukcesu
nadal nie.

---

## §3. Wynik ogólny (agregat 7 batchy = 206/206 dokumentów)

Micro-averaged, dopasowanie ścisłe (IoU ≥ 0,5, granice dokładne wymagane dla TP —
częściowe trafienia liczone jako FP+FN naraz).

**Precision: 76.4%   Recall: 76.0%   F1: 76.2%**

TP: 1280  FP: 396  FN: 405  (180 częściowych)

Kontrola spójności: TP+FN = 1280+405 = **1685** (zgodne z
1685 encji oczekiwanych, `CORPUS-2.0-NOTES.md`). TP+FP =
**1676** (zgodne z sumą encji wykrytych w 7 przebiegach).

### Per typ (wszystkie 34, posortowane wg wagi dotkliwości)

| Typ | Waga | TP | FP | FN | P | R | F1 |
|---|---|---|---|---|---|---|---|
| CRIMINAL_OFFENCE_DATA | 5 | 4 | 13 | 29 | 23.5% | 12.1% | 16.0% |
| ETHNIC_ORIGIN | 5 | 0 | 3 | 5 | 0.0% | 0.0% | 0.0% |
| HEALTH_DATA | 5 | 19 | 18 | 19 | 51.4% | 50.0% | 50.7% |
| PERSON_IDENTIFIER | 5 | 68 | 1 | 16 | 98.6% | 81.0% | 88.9% |
| POLITICAL_OPINION | 5 | 0 | 3 | 5 | 0.0% | 0.0% | 0.0% |
| RELIGION_OR_BELIEF | 5 | 0 | 4 | 5 | 0.0% | 0.0% | 0.0% |
| SEXUAL_ORIENTATION | 5 | 0 | 4 | 5 | 0.0% | 0.0% | 0.0% |
| TRADE_UNION_MEMBERSHIP | 5 | 0 | 0 | 18 | 0.0% | 0.0% | 0.0% |
| BANK_ACCOUNT_IDENTIFIER | 4 | 41 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| EMAIL_ADDRESS | 4 | 27 | 6 | 9 | 81.8% | 75.0% | 78.3% |
| PERSON_NAME | 4 | 378 | 94 | 103 | 80.1% | 78.6% | 79.3% |
| PHONE_NUMBER | 4 | 35 | 0 | 1 | 100.0% | 97.2% | 98.6% |
| POSTAL_ADDRESS | 4 | 117 | 14 | 4 | 89.3% | 96.7% | 92.9% |
| VEHICLE_IDENTIFIER | 4 | 27 | 5 | 5 | 84.4% | 84.4% | 84.4% |
| DATE_OF_BIRTH | 3 | 26 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| DOCUMENT_REFERENCE | 3 | 75 | 40 | 8 | 65.2% | 90.4% | 75.8% |
| FINANCIAL_AMOUNT | 3 | 131 | 7 | 1 | 94.9% | 99.2% | 97.0% |
| INCOME_COMPENSATION | 3 | 0 | 1 | 0 | 0.0% | 0.0% | 0.0% |
| PERSON_ATTRIBUTE | 3 | 10 | 16 | 46 | 38.5% | 17.9% | 24.4% |
| LOCATION | 2 | 79 | 16 | 10 | 83.2% | 88.8% | 85.9% |
| ORGANIZATION_IDENTIFIER | 2 | 110 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| ORGANIZATION_NAME | 2 | 66 | 84 | 81 | 44.0% | 44.9% | 44.4% |
| PERSON_ROLE_OR_TITLE | 1 | 67 | 67 | 35 | 50.0% | 65.7% | 56.8% |

**ORGANIZATION_NAME (R=44,9%):** znana, świadomie nienaprawiona luka z
`CORPUS-2.0-NOTES.md` — ~18 nazw organizacji w holdoucie to gołe stringi w
mianowniku, nieodmieniane przez przypadki. Span/typ ground truth poprawne
niezależnie od formy gramatycznej — wpływ na R nieznany bez ręcznej analizy próby.
Do rozstrzygnięcia: Opus/Alan.

**Art. 9-10 RODO (waga 5), R=0,0% ścisłe dla 5 z 6 podtypów** (TRADE_UNION_MEMBERSHIP,
RELIGION_OR_BELIEF, POLITICAL_OPINION, SEXUAL_ORIENTATION, ETHNIC_ORIGIN — tylko
HEALTH_DATA i CRIMINAL_OFFENCE_DATA mają TP>0): **uwaga metodologiczna** — R=0%
ścisłe NIE znaczy „model nic nie widzi". Rejestr przecieków (§4) pokazuje częściowe
pokrycie 45-84% dla większości tych typów (np. TRADE_UNION_MEMBERSHIP „jest
członkinią ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓" pokrycie 67%, RELIGION_OR_BELIEF „jest ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓"
pokrycie 84%) — ścisłe dopasowanie granic zawodzi częściej niż sama detekcja.

---

## §4. Rejestr przecieków

274 wpisy ogółem (dowolne pokrycie < 100%, sumowane z 7×`analysis.json`). **98 pełnych
przecieków** (pokrycie 0%), wszystkie wagi. **47 pełnych przecieków
wagi ≥ 4** (cel bramki G3: ZERO). **61 częściowych przecieków wagi 5**
oznaczonych do ręcznego przeglądu wg G4 (rezyduum bez samego faktu = dopuszczalne,
rezyduum z faktem = blokada — nieoceniane samodzielnie w tej sesji, zostawione do
przeglądu Opusa/Alana).

Poniższe dwie tabele grupują wg unikalnej frazy (encje z tych samych szablonów
korpusu powtarzają się w wielu dokumentach) — kolumna „Wyst." to liczba dokumentów,
kolumna „Przykład" to jeden reprezentatywny dokument.

### §4.1 Pełne przecieki, waga ≥ 4 — 29 unikalnych fraz (47 wystąpień)

| Waga | Typ | Tekst (w całości niezamaskowany) | Warstwa | Wyst. | Przykład dok. |
|---|---|---|---|---|---|
| 5 | CRIMINAL_OFFENCE_DATA | „toczyło się przeciwko niej dochodzenie o zniesławienie" | detekcja | 4 | hold_art910_criminal_02 |
| 5 | TRADE_UNION_MEMBERSHIP | „reprezentuje pracowników jako delegat związkowy" | thresholdStep | 3 | hold_art910_union_04 |
| 5 | CRIMINAL_OFFENCE_DATA | „toczy się przeciwko niemu postępowanie karne o oszustwo" | sourceFilterStep | 2 | hold_art910_criminal_00 |
| 5 | CRIMINAL_OFFENCE_DATA | „skazany wyrokiem za kradzież z włamaniem" | sourceFilterStep | 2 | hold_art910_criminal_01 |
| 5 | HEALTH_DATA | „pozostaje pod stałą opieką kardiologiczną" | sourceFilterStep | 2 | hold_art910_health_03 |
| 5 | CRIMINAL_OFFENCE_DATA | „skazany prawomocnie za jazdę w stanie nietrzeźwości" | detekcja | 1 | hold_art910_criminal_04 |
| 5 | CRIMINAL_OFFENCE_DATA | „był tymczasowo aresztowany w sprawie o rozbój" | sourceFilterStep | 1 | hold_art910_criminal_04 |
| 5 | CRIMINAL_OFFENCE_DATA | „postawiono mu zarzut fałszowania dokumentów" | detekcja | 1 | hold_art910_criminal_05 |
| 5 | POLITICAL_OPINION | „uczestniczył w wiecach organizacji o poglądach konserwatywnych" | detekcja | 1 | hold_art910_pozostale_00 |
| 5 | POLITICAL_OPINION | „jest członkiem partii politycznej o profilu lewicowym" | sourceFilterStep | 1 | hold_art910_pozostale_01 |
| 5 | POLITICAL_OPINION | „działa w lokalnej strukturze partyjnej" | detekcja | 1 | hold_art910_pozostale_03 |
| 4 | PERSON_NAME | „W r ó b l e w s k a" | detekcja | 3 | hold_ocr_mega_00 |
| 4 | PERSON_NAME | „W o j n o w s k a" | detekcja | 3 | hold_ocr_mega_01 |
| 4 | PERSON_NAME | „K a m i ń s k i" | sourceFilterStep | 3 | hold_ocr_mega_06 |
| 4 | PERSON_NAME | „P i o t r o w s k i" | thresholdStep | 2 | hold_ocr_mega_10 |
| 4 | PERSON_NAME | „W i t k o w s k a" | detekcja | 2 | hold_ocr_mega_11 |
| 4 | PERSON_NAME | „Dzięcioł" | thresholdStep | 2 | hold_pospolite_00 |
| 4 | PERSON_NAME | „Głowacka" | thresholdStep | 2 | hold_zlozony_02 |
| 4 | PERSON_NAME | „W.O." | sourceFilterStep | 1 | hold_inicjaly_06 |
| 4 | PERSON_NAME | „Z a l e w s k a" | detekcja | 1 | hold_ocr_mega_03 |
| 4 | PERSON_NAME | „M i c h a l s k i" | thresholdStep | 1 | hold_ocr_mega_04 |
| 4 | PERSON_NAME | „J a n k o w s k i" | sourceFilterStep | 1 | hold_ocr_mega_08 |
| 4 | PERSON_NAME | „L e w a n d o w s k i" | detekcja | 1 | hold_ocr_mega_09 |
| 4 | PERSON_NAME | „S z y m a ń s k i" | sourceFilterStep | 1 | hold_ocr_mega_14 |
| 4 | PERSON_NAME | „K w a ś n i e w s k a" | sourceFilterStep | 1 | hold_ocr_mega_17 |
| 4 | PERSON_NAME | „G ó r s k a" | thresholdStep | 1 | hold_ocr_mega_19 |
| 4 | PERSON_NAME | „Pszczoła" | detekcja | 1 | hold_pospolite_02 |
| 4 | PERSON_NAME | „Wrona" | detekcja | 1 | hold_pospolite_03 |
| 4 | PERSON_NAME | „Osioł" | thresholdStep | 1 | hold_pospolite_04 |

### §4.2 Częściowe przecieki, waga 5 — 26 unikalnych fraz (61 wystąpień, przegląd ręczny G4)

| Typ | Pokrycie | Tekst pełny | Rezyduum (co wychodzi) | Wyst. | Przykład dok. |
|---|---|---|---|---|---|
| SEXUAL_ORIENTATION | 7% | „żyje w nieformalnym związku partnerskim z osobą tej samej płci" | `żyje w nieformalnym związku partnerskim z osobą tej samej ` | 1 | hold_art910_pozostale_03 |
| TRADE_UNION_MEMBERSHIP | 8% | „korzysta z ochrony związkowej jako działacz OPZZ" | `korzysta z ochrony związkowej jako działacz ` | 4 | hold_art910_union_02 |
| TRADE_UNION_MEMBERSHIP | 17% | „przystąpiła do związku zawodowego «Solidarność» w zakładzie pracy" | `przystąpiła do związku zawodowego « … » w zakładzie pracy` | 2 | hold_art910_union_00 |
| CRIMINAL_OFFENCE_DATA | 23% | „postawiono mu zarzut fałszowania dokumentów" | `postawiono mu zarzut fałszowania ` | 1 | hold_art910_criminal_00 |
| TRADE_UNION_MEMBERSHIP | 25% | „pełni funkcję przewodniczącego zakładowej organizacji związkowej" | `pełni funkcję  …  zakładowej organizacji związkowej` | 1 | hold_art910_union_06 |
| HEALTH_DATA | 30% | „korzysta z rehabilitacji po udarze mózgu" | `korzysta z rehabilitacji po ` | 5 | hold_art910_health_02 |
| POLITICAL_OPINION | 38% | „jest członkiem partii politycznej o profilu lewicowym" | `jest członkiem partii  …  o profilu ` | 1 | hold_art910_pozostale_04 |
| HEALTH_DATA | 39% | „leczy się psychiatrycznie od pięciu lat" | `leczy się  …  od pięciu lat` | 2 | hold_art910_health_04 |
| SEXUAL_ORIENTATION | 45% | „ujawniła swoją orientację homoseksualną w toku zeznań" | `ujawniła swoją  …  w toku zeznań` | 2 | hold_art910_pozostale_00 |
| ETHNIC_ORIGIN | 46% | „deklaruje przynależność do mniejszości niemieckiej" | `deklaruje przynależność do ` | 3 | hold_art910_pozostale_01 |
| RELIGION_OR_BELIEF | 47% | „praktykuje jako świadek Jehowy" | `praktykuje jako ` | 2 | hold_art910_pozostale_01 |
| SEXUAL_ORIENTATION | 50% | „określa się jako osoba biseksualna" | `określa się jako ` | 2 | hold_art910_pozostale_01 |
| RELIGION_OR_BELIEF | 50% | „jest osobą niewierzącą" | `jest osobą ` | 1 | hold_art910_pozostale_02 |
| POLITICAL_OPINION | 53% | „otwarcie popiera ruch libertariański" | `otwarcie popiera ` | 1 | hold_art910_pozostale_02 |
| HEALTH_DATA | 55% | „leczy się z powodu nadciśnienia tętniczego" | `leczy się z powodu ` | 2 | hold_art910_health_04 |
| RELIGION_OR_BELIEF | 56% | „deklaruje przynależność do Kościoła Ewangelicko-Augsburskiego" | `deklaruje przynależność do ` | 1 | hold_art910_pozostale_00 |
| CRIMINAL_OFFENCE_DATA | 61% | „wyrokiem nakazowym ukarany za wykroczenie drogowe" | `wyrokiem nakazowym ` | 6 | hold_art910_criminal_01 |
| TRADE_UNION_MEMBERSHIP | 67% | „jest członkinią Związku Nauczycielstwa Polskiego" | `jest członkinią ` | 5 | hold_art910_union_00 |
| CRIMINAL_OFFENCE_DATA | 69% | „figuruje w Krajowym Rejestrze Karnym" | `figuruje w ` | 3 | hold_art910_criminal_02 |
| CRIMINAL_OFFENCE_DATA | 71% | „był uprzednio karany za znęcanie się nad rodziną" | `był uprzednio ` | 4 | hold_art910_criminal_01 |
| HEALTH_DATA | 73% | „przeszedł operację kardiochirurgiczną" | `przeszedł ` | 3 | hold_art910_health_02 |
| HEALTH_DATA | 75% | „przebywał na zwolnieniu lekarskim z powodu depresji" | `przebywał na ` | 2 | hold_art910_health_07 |
| TRADE_UNION_MEMBERSHIP | 78% | „jest członkiem Niezależnego Samorządnego Związku Zawodowego «Metalowcy»" | `jest członkiem  … »` | 3 | hold_art910_union_01 |
| HEALTH_DATA | 82% | „jest uzależniony od alkoholu" | `jest ` | 2 | hold_art910_health_05 |
| RELIGION_OR_BELIEF | 84% | „jest wyznania grekokatolickiego" | `jest ` | 1 | hold_art910_pozostale_03 |
| CRIMINAL_OFFENCE_DATA | 94% | „skazany prawomocnie za jazdę w stanie nietrzeźwości" | ` ni` | 1 | hold_art910_criminal_09 |

Legenda warstw (`layer`, z `attributeLayer` w `src/eval/analyze.js`):
`detekcja` = żadna warstwa nie zgłosiła kandydata; `sourceFilterStep` = kandydat
wykryty, odrzucony przez filtr źródeł encji; `thresholdStep` = kandydat wykryty,
odrzucony progiem pewności.

---

## §5. Co dalej

1. **Dolna granica 95% CI** (bootstrap po dokumentach, G2) — do policzenia przez
   Opusa/Alana, poza zakresem tej sesji.
2. **Wpływ luki deklinacji ORGANIZATION_NAME** na interpretację R=44,9% —
   rozstrzygnięcie Opusa/Alana.
3. **Przegląd ręczny G4** — 26 unikalnych fraz częściowych przecieków wagi 5 (§4.2).
4. **Root cause bad_alloc** (§2) nieznaleziony — kandydat dla przyszłej sesji, jeśli
   przebiegi > ~100 dok. w jednym procesie mają stać się rutyną.
5. Werdykt `GATE-RECALL-90` + wpis do `PRODUCT-DECISIONS.md` — decyzja Opusa.

*Notatka sporządzona w tej samej sesji, co pomiar. Gałąź NIEZMERGOWANA — zostawiona
do przeglądu Opusa, zgodnie z konwencją repo (patrz `CORPUS-2.0-NOTES.md`,
`GATE-RECALL-REMEDIATION.md`).*
