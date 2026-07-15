# SCOPE-TIERS-RESCORE-NOTES.md — re-scoring ST-7a (laptop, zero inference)

**Data:** 2026-07-15. **Autor:** Sonnet, pakiet nocny `feature/scope-st7a`
(SCOPE-TIERS-DESIGN.md §6, §9 — ST-7a). **Maszyna:** laptop (Ryzen 5700U,
16 GB RAM) — zero inferencji, wyłącznie przeliczenie istniejących
`entities.json` z dwóch przebiegów już na dysku.

**Status liczb w tej notatce: PODGLĄD, nie liczby do obrony.** Obie próby są
małe (11 i 38 dokumentów) i pochodzą z przebiegów, które nie były robione
pod kątem tego pomiaru. Autorytatywna liczba W1 to pełny holdout **206**
dokumentów, zmierzony na PC — patrz §4 (PENDING).

---

## §1. Co zostało policzone i skąd

| Przebieg | Dokumentów | GT (`--dir`) | Uwaga |
|---|---|---|---|
| `2026-07-13T22-09-45` (`latest`, label `opus-c2-preview2`) | 11 | `test-data/adversarial-holdout` | **PUŁAPKA 0/0/0**: `summary.json` ma wpisany `docsDir` wskazujący na scratchpad innej sesji (`…/AppData/Local/Temp/claude/…/d31e9f93-…/scratchpad/c2preview`), który **już nie istnieje na dysku** (zweryfikowane: `ls` → `No such file or directory`). Wszystkie 11 nazw dokumentów (`hold_adres_org_00`, `hold_art910_criminal_04`, …) istnieje w `test-data/adversarial-holdout` (206 dok.), więc przebieg został wykonany na (kopii) tego korpusu — użyto `--dir=test-data/adversarial-holdout` jako poprawnego źródła GT. |
| `2026-07-13T17-18-37` (label `recall-b2-baseline-adv`) | 38 | `test-data/adversarial` | `docsDir` w `summary.json` był poprawny (`test-data/adversarial`) — bez override. |

Obie próby są **podzbiorami mniejszymi niż odpowiadające im pełne korpusy**
(11 z 206 w holdout; 38 z 38 w dev — to jest pełny dev). Weryfikacja
TP > 0 wykonana przed zapisaniem liczb poniżej (patrz konsole obu
przebiegów — brak ostrzeżenia „PUŁAPKA 0/0/0" z `score-tiers.js`).

Narzędzie: `node src/eval/score-tiers.js <runId> [--dir=<path>]` (nowy
skrypt `npm run eval:score:tiers`), zaimplementowane w tej sesji
(`src/eval/score-tiers.js` + `src/pipeline/configs/type-tiers.js`).
Metodologia W1 = dokładnie `computeMetrics`/`computeByType` z `score.js`
(reużyte, nie przepisane), zawężone do typów `tierFor === 'mask'`. W2 =
`charCoverage` (analyze.js, reużyte) na sumie spanów `review ∪ mask`,
próg 50%. W3 = tylko liczba pominięta. Szczegóły kontraktu:
`SCOPE-TIERS-DESIGN.md` §6.2, `ZAKRES-ANONIMIZACJI.md` §3.

---

## §2. Holdout (11 dok., MAŁA próba — nie ekstrapoluj na 206)

### W1 (ścisły, liczba do obrony — typy warstwy mask)

**P: 92,2% R: 85,5% F1: 88,7%** — TP 47, FP 4, FN 8 (2 partial → FP+FN).

| Typ | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| BANK_ACCOUNT_IDENTIFIER | 100,0% | 100,0% | 100,0% | 3 | 0 | 0 |
| DATE_OF_BIRTH | 100,0% | 100,0% | 100,0% | 2 | 0 | 0 |
| EMAIL_ADDRESS | 100,0% | 50,0% | 66,7% | 1 | 0 | 1 |
| ORGANIZATION_IDENTIFIER | 100,0% | 100,0% | 100,0% | 7 | 0 | 0 |
| PERSON_IDENTIFIER | 80,0% | 80,0% | 80,0% | 4 | 1 | 1 |
| PERSON_NAME | 86,4% | 79,2% | 82,6% | 19 | 3 | 5 |
| PHONE_NUMBER | 100,0% | 50,0% | 66,7% | 1 | 0 | 1 |
| POSTAL_ADDRESS | 100,0% | 100,0% | 100,0% | 8 | 0 | 0 |
| VEHICLE_IDENTIFIER | 100,0% | 100,0% | 100,0% | 2 | 0 | 0 |

### W2 (pokrycie do przeglądu — typy warstwy review)

GT encji review: **30**. Pokrytych (≥50% znaków, review∪mask): **26**
(**86,7%**). Szum kosza: 2 kandydatów bez odpowiednika w GT (śr.
0,18/dok.) — ergonomia, bez bramki (O-ST-6).

### W3 (poza metrykami — typy warstwy pass)

Pominięto (dropped by tier): **13** encji GT.

---

## §3. Dev / adversarial (38 dok. — pełny korpus strojeniowy)

### W1 (ścisły, liczba do obrony — typy warstwy mask)

**P: 87,6% R: 88,6% F1: 88,1%** — TP 155, FP 22, FN 20 (7 partial → FP+FN).

| Typ | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| BANK_ACCOUNT_IDENTIFIER | 100,0% | 100,0% | 100,0% | 9 | 0 | 0 |
| DATE_OF_BIRTH | 100,0% | 100,0% | 100,0% | 3 | 0 | 0 |
| EMAIL_ADDRESS | 85,7% | 85,7% | 85,7% | 6 | 1 | 1 |
| ORGANIZATION_IDENTIFIER | 100,0% | 100,0% | 100,0% | 18 | 0 | 0 |
| PERSON_IDENTIFIER | 93,8% | 78,9% | 85,7% | 15 | 1 | 4 |
| PERSON_NAME | 81,1% | 85,9% | 83,4% | 73 | 17 | 12 |
| PHONE_NUMBER | 100,0% | 100,0% | 100,0% | 7 | 0 | 0 |
| POSTAL_ADDRESS | 88,0% | 91,7% | 89,8% | 22 | 3 | 2 |
| VEHICLE_IDENTIFIER | 100,0% | 66,7% | 80,0% | 2 | 0 | 1 |

### W2 (pokrycie do przeglądu — typy warstwy review)

GT encji review: **73**. Pokrytych: **68** (**93,2%**). Szum kosza: 10
kandydatów bez odpowiednika w GT (śr. 0,26/dok.).

### W3 (poza metrykami — typy warstwy pass)

Pominięto (dropped by tier): **31** encji GT.

---

## §4. Porównanie W1 holdout vs W1 dev — i ścieżka do liczby autorytatywnej

- **Holdout (11 dok.) recall W1: 85,5%** vs **dev (38 dok.) recall W1: 88,6%**
  — holdout niżej o 3,1 pp. Kierunek zgodny z oczekiwaniem
  (`RECALL-90-DESIGN.md` §3.1: dev jest korpusem strojeniowym, więc jest
  optymistycznie obciążony; holdout to sprawdzian na rozłącznych wartościach
  i szablonach). **Ta konkretna 11-dokumentowa wycinka holdoutu zawiera też
  klasy historycznie trudne** (`hold_ocr_mega_06` — degradacja OCR;
  `hold_pulapka_cytowania_02` — pułapka FP, 0 encji realnych), więc różnica
  może być częściowo artefaktem doboru próby, nie tylko efektem
  strojenia/generalizacji.
- **Oba wyniki są blisko szacunku z `ZAKRES-ANONIMIZACJI.md` §4**
  („Rdzeń W1 … recall ≈ 86%", wyliczone ręcznie z tabeli per-typu starego
  76%-owego przebiegu holdout). Trzy niezależne metody (ręczne wyliczenie z
  tabeli, re-scoring 11 dok., re-scoring 38 dok.) zgadzają się w przedziale
  85,5–88,6% — spójny sygnał, że **~86% W1 jest realistycznym punktem
  startowym** przed domknięciem luk nazwiskowych (`ZAKRES-ANONIMIZACJI.md`
  §5: OCR-spacing, nazwiska pospolite).
- **Żadna z tych liczb nie jest bramkowa.** Cel 95%+ W1 (`ZAKRES` §2,
  `SCOPE-TIERS-DESIGN.md` §6.4) mierzy się na **pełnym, zamrożonym holdoucie
  206 dokumentów / 1685 encji**, nie na tych podglądach.

### Autorytatywna liczba — ZAMKNIĘTE 2026-07-15

Pełny przebieg 206-dok. holdoutu został wykonany na PC w **7 paczkach
(~30 dok. każda)** — commit `e4f4d04` („corpus 2.0 built (206 docs/1685
entities) + eval fix; measurement moves to PC"), etykiety `holdout-full-b1`
… `holdout-full-b7` (`test-data/results/2026-07-14T06-12-20` …
`06-23-06`; 30+30+30+30+30+30+26, nazwy dokumentów zweryfikowane jako
rozłączne, suma 206). Scalone 2026-07-15 na PC do
`test-data/results/holdout-206-merged` i przeliczone:

```powershell
$batches = @('2026-07-14T06-12-20', '2026-07-14T06-14-10', '2026-07-14T06-15-28',
             '2026-07-14T06-17-03', '2026-07-14T06-19-32', '2026-07-14T06-21-22',
             '2026-07-14T06-23-06')
$merged = 'test-data/results/holdout-206-merged'
New-Item -ItemType Directory -Force $merged | Out-Null
foreach ($b in $batches) {
  Get-ChildItem "test-data/results/$b" -Directory | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $merged $_.Name) -Recurse -Force
  }
}
Copy-Item "test-data/results/$($batches[0])/summary.json" "$merged/summary.json" -Force

npm run eval:score:tiers -- holdout-206-merged --dir=test-data/adversarial-holdout
```

Konsola potwierdziła `Documents scored: 206 of 206 in corpus` i **brak**
ostrzeżenia „PUŁAPKA 0/0/0".

#### W1 (ścisły, liczba do obrony — typy warstwy mask) — AUTORYTATYWNE

**P: 87,4% R: 85,7% F1: 86,5%** — TP 829, FP 120, FN 138 (74 partial → FP+FN).

| Typ | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| BANK_ACCOUNT_IDENTIFIER | 100,0% | 100,0% | 100,0% | 41 | 0 | 0 |
| DATE_OF_BIRTH | 100,0% | 100,0% | 100,0% | 26 | 0 | 0 |
| EMAIL_ADDRESS | 81,8% | 75,0% | 78,3% | 27 | 6 | 9 |
| ORGANIZATION_IDENTIFIER | 100,0% | 100,0% | 100,0% | 110 | 0 | 0 |
| PERSON_IDENTIFIER | 98,6% | 81,0% | 88,9% | 68 | 1 | 16 |
| PERSON_NAME | 80,1% | 78,6% | 79,3% | 378 | 94 | 103 |
| PHONE_NUMBER | 100,0% | 97,2% | 98,6% | 35 | 0 | 1 |
| POSTAL_ADDRESS | 89,3% | 96,7% | 92,9% | 117 | 14 | 4 |
| VEHICLE_IDENTIFIER | 84,4% | 84,4% | 84,4% | 27 | 5 | 5 |

#### W2 (pokrycie do przeglądu — typy warstwy review)

GT encji review: **488**. Pokrytych (≥50% znaków, review∪mask): **403**
(**82,6%**). Szum kosza: 41 kandydatów bez odpowiednika w GT (śr.
0,20/dok.) — ergonomia, bez bramki (O-ST-6).

#### W3 (poza metrykami — typy warstwy pass)

Pominięto (dropped by tier): **230** encji GT.

**To domyka jedyny krok, którego pakiet ST-7a nie wykonał** (brak
artefaktów na laptopie, zero inferencji był twardym zakazem tamtej sesji).
F1 86,5% W1 jest teraz **autorytatywną liczbą all-mask** dla pełnego
206-dokumentowego holdoutu — zastępuje podglądy z §2 (11 dok.) i §3
(38 dok.) jako liczba do cytowania; te dwa pozostają jako potwierdzenie
kierunku/spójności, nie jako liczby do obrony. To **nadal nie jest werdykt
bramkowy GATE-RECALL-90** (cel 95%+ W1, `ZAKRES-ANONIMIZACJI.md` §2,
`SCOPE-TIERS-DESIGN.md` §6.4) — liczby są przed wdrożeniem ST-2 (patrz §6
pkt 3 poniżej) i przed domknięciem luk nazwiskowych z `ZAKRES-ANONIMIZACJI.md`
§5. Artefakty (`test-data/results/holdout-206-merged/`) są gitignorowane —
zostają lokalnie na tej maszynie, nie w historii git.

---

## §5. Reprodukcja (obie tabele w tej notatce)

```bash
node src/eval/score-tiers.js 2026-07-13T22-09-45 --dir=test-data/adversarial-holdout
node src/eval/score-tiers.js 2026-07-13T17-18-37
```

lub przez npm (`package.json` → `eval:score:tiers`, dodany w tej sesji):

```bash
npm run eval:score:tiers -- 2026-07-13T22-09-45 --dir=test-data/adversarial-holdout
npm run eval:score:tiers -- 2026-07-13T17-18-37
```

Oba zapisują `tiers-scores.json` do katalogu przebiegu (`scoringVersion:
"tiers-v1"`, pełna `tiersConfig`).

---

## §6. Co zostało świadomie odłożone (nie w zakresie ST-7a / tej nocy)

1. **`eval:compare` i `scoringVersion`.** `tiers-scores.json` niesie
   `scoringVersion`/`tiersConfig`, ale `compare.js` dziś czyta wyłącznie
   `scores.json` i o `tiers-scores.json` nie wie — nie ma więc jeszcze
   ścieżki, na której odmowa przy niezgodnym `scoringVersion` (§6.2 pkt 5)
   miałaby coś realnie chronić. **TODO jawne**: gdy `run.js`/`score.js`
   zaczną stemplować `scoringVersion` na `scores.json` (ST-7b lub później,
   wymaga też zmian w `run.js`, które są poza zakresem tego pakietu —
   `run.js` to ścieżka inferencji, dotykać jej nie wolno), dopisać w
   `compare.js` twardą odmowę porównania dwóch niezgodnych wersji zamiast
   cichych liczb.
2. **`candidates.json` z prawdziwej partycji ST-2.** `score-tiers.js`
   preferuje `candidates.json`, jeśli istnieje, ale dziś nie istnieje dla
   ŻADNEGO przebiegu (ST-2 — krok partycji w pipeline — nie jest
   zaimplementowany). W2 dla obu przebiegów w tej notatce korzysta z
   fallbacku: filtrowania `entities.json` po warstwie `review`. To dokładnie
   to, co poleciło zadanie, i jest udokumentowane komentarzem w kodzie
   (`src/eval/score-tiers.js`, `reviewPredictionsFor`).
3. **Liczby W1/W2/W3 tej notatki są PRZED ST-2** — dedup/backfill
   (`deduplicateEntities`, `backfillOccurrencesStep`) w dzisiejszym
   pipeline nie są jeszcze świadome warstw (H-1/H-2, `SCOPE-TIERS-DESIGN.md`
   §3.2 pkt 3–4). `score-tiers.js` filtruje `entities.json` (wyjście
   DZISIEJSZEGO, jednowarstwowego pipeline'u) po warstwie post-hoc — to
   dobre przybliżenie, ale realne liczby po wdrożeniu ST-2 mogą się nieco
   różnić (typowo: precyzja W1 lekko w górę, gdy tier-aware dedup przestanie
   tracić maskowanie na rzecz szerszych spanów W3 — patrz H-1 w projekcie).
4. **`--tiers=all-mask` (niezmienność, §3.4 pkt 3)** wymaga ST-2 (kroku
   partycji w pipeline) — nie ma go jeszcze do przetestowania.
