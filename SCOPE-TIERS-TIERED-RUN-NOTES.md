# SCOPE-TIERS-TIERED-RUN-NOTES.md — pierwszy pełny przebieg z warstwowością WŁĄCZONĄ (PC, noc 2026-07-15/16)

**Data:** 2026-07-15/16. **Autor:** Sonnet, pakiet nocny (nienadzorowany).
**Maszyna:** PC (RTX 4080S, 32 GB) — pierwszy realny przebieg 206-dok.
holdoutu z `--allMask=false` (ST-2 partycja pipeline'u faktycznie
aktywna, nie tylko all-mask przez tę samą ścieżkę kodu).

**Status liczb w tej notatce: SUROWE, NIE werdykt bramkowy.** Interpretacja
H-3 (czy delta vs all-mask jest istotna, co to znaczy dla GATE-RECALL-90)
zostaje do rana. Poniżej wyłącznie liczby + ścieżki artefaktów.

---

## §1. Housekeeping i kod wykonane przed przebiegiem

1. **KROK 0** (main, commit `4705b93`, push wykonany): zamknięty PENDING
   w `SCOPE-TIERS-RESCORE-NOTES.md` §4 i `ROADMAP.md` §4a/§5 autorytatywnym
   wynikiem all-mask (W1 F1 86,5%, pełna tabela per-typu).
2. **KROK 1** (`feature/eval-tiered-run`, commit `2e40136`): `run.js`
   dostał flagę `--allMask=false` (domyślnie `true`, zero zmiany
   zachowania dla istniejących wywołań) przekazywaną do
   `createDefaultPipeline`/`createPostprocessSteps` (okazało się, że ST-2 —
   `src/pipeline/steps/tier-partition.js` — była już zaimplementowana
   i wpięta w tym samym pociągnięciu `main`, tylko nigdy nie wywołana
   z `allMask:false` przez żadnego callera; `run.js` był brakującym
   ostatnim ogniwem). Dopisany warunkowy zapis `candidates.json`
   (`ctx.reviewCandidates`) — **tylko gdy `!allMask`**, bo puste `[]`
   zapisane bezwarunkowo byłoby przez `score-tiers.js`
   (`reviewPredictionsFor`) potraktowane jako autorytatywne i po cichu
   wyzerowałoby W2 dla każdego przyszłego przebiegu all-mask (patrz
   komentarz w kodzie, `src/eval/run.js`). Test „flaga dociera do
   pipeline'u" już istniał (`default.test.js`, sekcja „ST-2 tier
   activation default", ten sam pull co ST-2) — nie duplikowany.
   `npm test`: **102 pliki / 2116 testów zielone**.
3. **KROK 1.5** (smoke, 3 dok., `--allMask=false`): potwierdzone —
   `entities.json` tylko typy warstwy `mask`, `candidates.json` wypełniony
   typami `review`, typy `pass` (np. `ORGANIZATION_NAME` w
   `hold_adres_org_00`) znikają całkowicie z obu plików. Zweryfikowane
   bezpośrednio z `TYPE_TIERS`, nie tylko z konsoli.

   **Pułapka po drodze (udokumentowana na przyszłość):** pierwsza próba
   smoke testu podała flagi PRZED jawną listą plików
   (`--allMask=false ... plik1 plik2 plik3`). `run.js`'s
   `if (args.length > 0 && !args[0].startsWith('--'))` sprawdza WYŁĄCZNIE
   pierwszy element `args` — skoro `args[0]` był flagą, cała jawna lista
   plików została zignorowana i skrypt przeczytał CAŁY katalog
   `test-data/adversarial-holdout` (206 dok.) w jednym procesie. Efekt:
   dokładnie ten `bad_alloc`, przed którym ostrzega twarda zasada maszyny
   — padło na ok. doku 122/206 (`2026-07-15T21-45-15`, bez `summary.json`,
   usunięty jako śmieć). **Wniosek: w `run.js` jawna lista plików MUSI
   być pierwsza, flagi po niej** — zastosowane konsekwentnie we
   wszystkich 7 porcjach poniżej (zweryfikowane `dry-run` przed każdym
   pierwszym użyciem wzorca).

---

## §2. Pełny przebieg tiered (206 dok., 7 świeżych procesów)

Te same grupowania dokumentów co `holdout-full-b1`…`b7` (all-mask
baseline) — bezpośrednia porównywalność porcja-do-porcji, nie tylko
agregat-do-agregatu.

| Porcja | Run ID | Dok. | bad_alloc? | doc-dirs = oczekiwane? |
|---|---|---|---|---|
| tiered-206-b1 | `2026-07-15T22-23-02` | 30 | nie | tak (30) |
| tiered-206-b2 | `2026-07-15T22-25-19` | 30 | nie | tak (30) |
| tiered-206-b3 | `2026-07-15T22-26-57` | 30 | nie | tak (30) |
| tiered-206-b4 | `2026-07-15T22-28-51` | 30 | nie | tak (30) |
| tiered-206-b5 | `2026-07-15T22-31-43` | 30 | nie | tak (30) |
| tiered-206-b6 | `2026-07-15T22-33-51` | 30 | nie | tak (30) |
| tiered-206-b7 | `2026-07-15T22-35-56` | 26 | nie | tak (26) |

**0/7 crashes.** Suma 206/206, nazwy dokumentów zweryfikowane rozłączne
(206 unikalnych z 206 total) przed scaleniem.

**Higiena procesu (twarda zasada maszyny):** po KAŻDEJ z 7 porcji i na
końcu, `Get-Process`-równoważnik (`tasklist /FI "IMAGENAME eq node.exe"`)
wykonany DWUKROTNIE (race) — **za każdym razem zero wyników, zero
node.exe do zabicia**. `process.exit(0)`/`process.exit(1)` w `run.js`
(już istniejący fix na wiszące wątki natywne onnxruntime, patrz komentarz
w kodzie) wystarczył samodzielnie w każdym z 7 przypadków — dodatkowa
kontrola z zasady maszyny nie musiała nic sprzątać, ale została wykonana
zgodnie z poleceniem.

**Uwaga EPERM (kosmetyczna, znana — patrz pamięć/`onnxruntime_bad_alloc_batching`):**
wszystkie 7 porcji zgłosiło `exit code 1` / „failed" —
**nie z powodu bad_alloc**, tylko `updateLatestSymlink` (Windows, brak
trybu deweloperskiego, `EPERM` przy tworzeniu symlinka `latest`).
`summary.json` zapisywany PRZED tym krokiem, więc dane nie ucierpiały —
zweryfikowano per porcja: `summary.json` obecny, `documents` = oczekiwana
liczba, `docsDir` poprawny, zero wystąpień `bad_alloc`/`bad allocation`
w pełnym logu. **Exit code nie jest tu sygnałem sukcesu — zawartość
`summary.json` jest.**

---

## §3. Scoring — tiered W1 vs all-mask baseline (DELTA)

Scalone do `test-data/results/tiered-206-merged` (206/206 doc-dirs, 206/206
z `candidates.json` — potwierdza tiering aktywny na każdym dokumencie).

```
npm run eval:score:tiers -- tiered-206-merged --dir=test-data/adversarial-holdout
```

Konsola: `Documents scored: 206 of 206 in corpus`, **brak** „PUŁAPKA 0/0/0".

### W1 (ścisły — typy warstwy mask)

| | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| **All-mask baseline** (`SCOPE-TIERS-RESCORE-NOTES.md` §4) | 87,4% | 85,7% | 86,5% | 829 | 120 | 138 |
| **Tiered (ten przebieg)** | 86,5% | 86,0% | 86,3% | 832 | 130 | 135 |
| **Δ (tiered − baseline)** | −0,9 pp | +0,3 pp | −0,2 pp | +3 | +10 | −3 |

Per typ — **tylko EMAIL_ADDRESS i PERSON_NAME różnią się**; pozostałych 7
typów jest bit-identycznych między all-mask a tiered (BANK_ACCOUNT_IDENTIFIER,
DATE_OF_BIRTH, ORGANIZATION_IDENTIFIER, PERSON_IDENTIFIER, PHONE_NUMBER,
POSTAL_ADDRESS, VEHICLE_IDENTIFIER — patrz `SCOPE-TIERS-RESCORE-NOTES.md`
§4 dla wartości baseline, pominięte tu dla zwięzłości):

| Typ | | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|---|
| EMAIL_ADDRESS | baseline | 81,8% | 75,0% | 78,3% | 27 | 6 | 9 |
| EMAIL_ADDRESS | tiered | 75,0% | 75,0% | 75,0% | 27 | 9 | 9 |
| PERSON_NAME | baseline | 80,1% | 78,6% | 79,3% | 378 | 94 | 103 |
| PERSON_NAME | tiered | 79,0% | 79,2% | 79,1% | 381 | 101 | 100 |

Surowa obserwacja (nie interpretacja): jedyny mechanizm, przez który tiered
i all-mask W1 mogą się różnić, to `bindTierOf(dedupStep, tierOf)` /
`bindTierOf(backfillOccurrencesStep, tierOf)` — pod all-mask `tierOf`
zwraca `'mask'` dla każdej encji (jednolite traktowanie), pod tiered
zwraca prawdziwą warstwę. Że różnica pojawia się WYŁĄCZNIE przy
EMAIL_ADDRESS/PERSON_NAME sugeruje, że tylko te dwa typy mają w tym
korpusie realną konkurencję/nakładanie się spanów z encjami innej warstwy
podczas dedup/backfill — reszta typów nie ma takich nakładań, więc
tier-awareness nie zmienia dla nich nic.

### W2 (pokrycie do przeglądu)

| | Total GT | Hits | Pokrycie | Szum | Śr. szumu/dok |
|---|---|---|---|---|---|
| All-mask baseline | 488 | 403 | 82,6% | 41 | 0,20 |
| Tiered (ten przebieg) | 488 | 406 | 83,2% | 41 | 0,20 |
| Δ | — | +3 | +0,6 pp | 0 | 0 |

Tiered W2 czyta prawdziwy `candidates.json` (nie fallback filtrowania
`entities.json` po typie) — różnica +3 hits może pochodzić z tego, że
prawdziwa partycja stosuje filtr `isFullyMasked` (kandydat w pełni
pokryty maskowanym spanem odpada), którego fallback nie zna. Szum
identyczny (41, śr. 0,20/dok w obu) — zbieżność, nie zweryfikowana głębiej
w tej sesji.

### W3 (poza metrykami)

Identyczne w obu: **230** encji GT pominiętych (typ `pass`) — oczekiwane,
W3 liczy tylko stronę GT, niezależną od trybu pipeline'u.

---

## §4. Artefakty

- `test-data/results/tiered-206-b1`…`b7/` — 7 surowych porcji (gitignored).
- `test-data/results/tiered-206-merged/` — scalenie (gitignored),
  `tiers-scores.json` pełne wyniki (per-dok. + agregat).
- `test-data/results/2026-07-15T21-45-15/` — **usunięty** (śmieć po
  pułapce z §1, bad_alloc na doku ~122, brak `summary.json`).
- Wszystko lokalne na tej maszynie, nic z tego w historii git.

---

## §5. Co NIE zostało zrobione (świadomie, poza zakresem tej nocy)

Identyczne odłożenia co `SCOPE-TIERS-RESCORE-NOTES.md` §6 (nie
powtórzone tu) — `eval:compare`/`scoringVersion` w `compare.js`, ST-3/ST-4
(UI kosza), `--tiers=all-mask` jako formalny test niezmienności przez CLI
(niezmienność jest już dowiedziona jednostkowo w
`tier-partition-invariance.test.js`, ale nie przebiegiem end-to-end tej
nocy). Branch `feature/eval-tiered-run` **NIE zmergowany** — czeka na
przegląd (H-3 + decyzja o run.js jako ścieżce inferencji).
