# GATE-FL5.md – werdykt bramki wpięcia fleksji w żywe ujścia deanon

**Bramkujący:** Opus (Claudia). **Data:** 2026-07-19. **Projekt:** `FL-5-LIVE-WIRING-DESIGN.md` (Fable). **Implementacja:** Sonnet, gałąź `feature/fl5-live-wiring`. **Werdykt: PASS, scalone na main (`dbb8e7c`).**

## Co zweryfikowałem niezależnie (nie z raportu)

| Warunek | Metoda | Wynik |
|---|---|---|
| **Maskowanie bajt-w-bajt nietknięte** | `git diff main --stat` na `anonymizer.js`, `worker.js`, `pipeline/`, `tokens.js`, `substitution.js` | **PUSTO** – zero zmian |
| **Silnik fleksji niemodyfikowany** (granica §12) | `git diff main --stat` na `flexion-resolver.js`, `morph/analyze|generate|load|paradigms`, `case-detector/*`, `attested.js` | **PUSTO** – tylko nowe moduły obok (`flexion-live.js`, `artifact.js`) |
| **R-D9: brak wycieku cudzego nazwiska** (G-FL5-5) | odczyt asercji `main.flexion-live.test.js:382-410` | **PASS** – kolizja tokenu (snapshot „Jan Kowalski" vs żywe „Anna Nowak"), flaga wymuszona ON; forma „Nowak"/„Annie Nowak" NIE wychodzi w ekranie, schowku ani DOCX; „Kowalski" zachowany (fail-closed do bazy, nie ciche gubienie); U1==U2 przez kolizję |
| **Pełny zestaw** | `npx vitest run` na main po scaleniu | **144 pliki / 2995 testów zielono** |
| Flaga OFF = dzisiejsze bajty (G-FL5-1) | golden e2e (brak klucza + jawne '0') + istniejące testy bez zmian | PASS |
| Spójność hash U1==U2==U3 (G-FL5-2), U1==U4 (G-FL5-3) | testy w `main.flexion-live.test.js` | PASS |
| Jeden punkt konstrukcji (G-FL5-7) | grep: jedyne prod. `createFlexionResolver` w `flexion-live.js:69`, niesie `minConfidence:'wysoka'` | PASS |

## Ocena bezpieczeństwa R-D9

Potwierdziłem w kodzie mechanizm luki PRZED implementacją: `buildAttestedByCase` (analyze.js:283) indeksuje formy bez wiązania z wartością bazową, `generateForm` (generate.js:93) bierze poświadczenie przed regułą → przy renumeracji tokenów po zmianie źródeł do pisma mogło wejść nazwisko innej osoby (ścieżka DOCX, JUŻ scalona). Prawdopodobieństwo niskie, skutek w piśmie procesowym poważny. Naprawa `filterSeenForLegend` jest **bezstanowa i fail-closed** (potrafi tylko wstrzymać odmianę, nigdy wstawić złą formę) i obowiązuje **bezwarunkowo**, także poza flagą — więc FL-5 zamyka istniejącą dziurę niezależnie od aktywacji.

## Odstępstwa zaakceptowane

1. **Komentarz `flexion-resolver.js:18-21`** Sonnet słusznie zostawił (moja twarda zasada „zero zmian w silniku" była nadrzędna). Zaktualizowałem go osobno po scaleniu (był mylący: „inert" nieaktualne).
2. Podwójne, nieszkodliwe wywołanie `resolveReplacementFor(outcome)` dla wyników DOCX (funkcja czysta) – kosmetyka, udokumentowana.

## G-FL5-9: decyzje CZEKAJĄCE NA ALANA

- **Default flagi `FLEXION_LIVE_DEFAULT`** – scalone jako **OFF** (mechanizm śpi). Fable i Opus rekomendują **ON** (cel #2 Alana, fail-closed, odmiana widoczna na ekranie, dziś niespójność DOCX vs ekran; brak przełącznika UI w v1 → ON to realnie jedyny sposób ujawnienia funkcji). Zmiana = jedna stała w `main.js`.
- **A1 role-v0** (47 lematów, K6) – pominięte świadomie; wymaga przeglądu tabeli form przez Alana przed scaleniem. Odblokowuje sygnał S-A (apozycja) → „wysoka" bez anotacji.
- **FL-5a (A2, imiona-core CC0)** – następny krok, własny mini-przegląd.

## Stan

Mechanizm w 100% wpięty, przetestowany, śpi (default OFF). Naprawa R-D9 aktywna. Fleksja gotowa do działania w żywej apce o jeden przełącznik od decyzji Alana. FL-6 (UI przeglądu 'niska') i A3/SGJP (PC) poza zakresem.
