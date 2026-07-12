# GATE-RECALL-REMEDIATION.md — bramka Opusa nad planem A (Sonnet)

**Data:** 2026-07-12
**Autor:** Opus (bramka jakości)
**Zakres:** `feature/recall-remediation` (Sonnet) — Track 1 (moduły A1-A11),
Track 2 (OCR), Track 3 (C4), zmergowane do `main` (merge `da3327d`).
**Werdykt: PRZYJĘTE.**

## §1. Wynik (zweryfikowany z notatki + rejestru przecieków)

| Korpus | Metryka | Baseline | Po Track 1 | Δ |
|---|---|---|---|---|
| Kontradyktoryjny | recall | 78,1% | **84,2%** | **+6,1 p.p.** |
| Kontradyktoryjny | przecieki treści | 42 | **26** | **−38%** |
| Kontradyktoryjny | FP ogółem | 62 | 59 | −3 (mniej, mimo wyższego recall) |
| Syntetyczny | przecieki treści | 8 | **4** | −50% |

Pozorna regresja F1 syntetycznego (92,6→85,9) to **artefakt pomiaru, nie
regresja** (notatka §4): 17 „PESEli" w `test-data/synthetic` nie ma poprawnych
sum kontrolnych, więc A1 słusznie odmawia im dopasowania regexem — ale wszystkie
17 są nadal maskowane (jako PHONE_NUMBER), więc to pomyłka typu, nie przeciek
(rejestr przecieków niezmieniony 7→7 na tym kroku).

## §2. Co zweryfikowałam
- 9/9 modułów A + OCR (DPI 2→3 + plakietka przeglądu) + C4 (fetch-models fp16).
- **Zero nowych regresji:** każdy pozostały przeciek (26 kontr., 4 synt.) był już
  w rejestrze audytu albo jest świadomie nieporuszonym zakresem B/C. Masa
  dotkliwości wyraźnie spadła (mniej pozycji wagi 4-5).
- **Dyscyplina utrzymana:** GATE-STOP na C4 uszanowany (bez `desktop:build`,
  bez benchu), `src/verifier/` nietknięty (Fable równolegle), pełna suita zielona.
- Uczciwość notatki wzorowa — każde odchylenie od kontraktu opisane wprost.

## §3. Moje rozstrzygnięcia otwartych pozycji (zgłoszonych do bramki)
- **A7 nie na pełnej krzywej P/R** (skrypt padał na `bad_alloc` z onnxruntime-node
  po kilkunastu dokumentach): akceptuję punkty startowe z bramki jako tymczasowe;
  **dokończyć pomiar** (`cache-ner-for-thresholds.mjs` + `measure-thresholds.mjs`)
  na maszynie z większym zapasem pamięci — jest tam realny zapas recall.
- **`SB/00234/PN`** (ACCOUNT_IDENTIFIER, score 0,68, nie pasuje do wzorca A8):
  akceptuję jako udokumentowane ograniczenie — NIE obniżać progu siatki dla
  wszystkich typów wagi ≥4 dla jednego przypadku (zniweczyłoby sens siatki);
  domknięcie razem z B-track.
- **Regeneracja identyfikatorów w `test-data/synthetic`** z poprawnymi sumami
  kontrolnymi (jak w `adversarial`): **ZATWIERDZAM** — usuwa artefakt pomiaru
  z §1, niskie ryzyko (korpus referencyjny, deterministyczna generacja), poprawia
  uczciwość liczby syntetycznej. Do zrobienia przed kolejnym pomiarem.

## §4. Cel 90% — nieosiągnięty i to jest OK
84,2% to +6,1 p.p., zgodne z projekcją Fable (RECALL-90-DESIGN §0: „plan A nie
dowiezie 90% sam, ~86-89%"). Reszta luki leży w modułach B (leksykon ról B4 =
największa dźwignia, wersaliki B2, art. 9-10 B3, ensemble B1) + korpus 2.0 +
dokończone A7. **Marketing pozostaje wstrzymany** do GATE-RECALL-90 (Fable §4.2).

## §5. Otwarte do dalszej pracy
Track 4 (harness jakości w przeglądarce) odłożony świadomie (niestabilność
maszyny w trakcie sesji); C4 build+bench pod bramkę B1; pełny mix fp32/fp16 vs
podłoga fp16-oba (decyzja 21 dopuszcza podłogę). Reprodukcja: `RECALL-REMEDIATION-NOTES.md` §8.
