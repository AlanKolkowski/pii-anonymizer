# IDENTIFIER-COVERAGE-AUDIT.md — audyt pokrycia identyfikatorów

**Data:** 2026-07-19. **Autor:** Opus (bramka), na zlecenie Alana. **Kanwa:** wykrycie luki KW (numer księgi wieczystej łapany tylko przez model → `DOCUMENT_REFERENCE` = W3 = wyciek po aktywacji).

**Cel:** które identyfikatory z polskich pism prawnych są łapane DETERMINISTYCZNIE (regex/gazeter/leksykon), które tylko „jak model trafi", a których brak — i gdzie są luki klasy KW (dane osobowe/pół-osobowe, dziś niedeterministyczne, ryzyko wycieku w W3 po aktywacji warstwowości).

## 1. Łapane deterministycznie (bezpieczne)

**Suma kontrolna (precyzja z arytmetyki):** PESEL, NIP (+VAT-EU), REGON 9/14, IBAN/NRB (mod-97), dowód osobisty (3L+6C ścieżka A). Wszystkie W1.
**Struktura (kształt=sygnał):** VIN, e-mail (IDN), telefon, kwoty (W2). W1 poza kwotami.
**Kontekst-kotwica:** KRS, prawo jazdy, tablica (+ wariant bez kotwicy z whitelistą powiatów, O-HC-1), paszport, dowód ścieżka B. W1.
**Kształt bezwarunkowy:** **KW (`LAND_REGISTER_IDENTIFIER`, W1, never-W3 gwarantowany)** — dodane 2026-07-19.
**Sygnatury własnej sprawy:** DOCKET_RE → DOCUMENT_REFERENCE (W3 celowo; allowlista ST-5 dla własnej sprawy).
**Leksykon:** role/tytuły zawodowe (W2), kategorie art. 9-10 (W2).
**Gazeter:** nazwiska kolizyjne (Wilk, Sowa, Kogut, Ptak…) — case-sensitive + sloty składniowe (FP-safe).

## 2. PRIORYTETOWE LUKI klasy KW (dane, dziś niedeterministyczne → ryzyko W3)

| Identyfikator | Dziś | Warstwa | Rekomendacja |
|---|---|---|---|
| **KW (księga wieczysta)** | ✅ **ZAMKNIĘTE** (R-KW, W1) | W1 | zrobione |
| **Rep. A (akt notarialny)** | tylko model → DOCUMENT_REFERENCE | W3 ⚠ | R-REPA kotwiczony „Rep. A"/„Repertorium A"; tier W2 (pół-osobowe) |
| **Numer polisy** | tylko model → DOCUMENT_REFERENCE | W3 ⚠ | R-POL wyłącznie kotwiczony „polis\* nr"; tier W2 |
| **Numer umowy** (kredytu) | tylko model | W3 ⚠ | rozstrzygnąć tier (semi-osobowe) |

**Luki „W1 bez deterministycznej podłogi"** (typ jest maskowany, ale łapie TYLKO model → bywa chybienie):
- **Karta płatnicza** — brak walidacji **Luhna** (pewny algorytm) → **R-CARD: najczystszy, tani domyk, jak PESEL/IBAN**.
- **Data urodzenia** — brak wzorca → R-DATE kotwiczony („ur.", „data urodzenia").
- **Numer legitymacji zawodowej** — np. „Tr-1138" (dana radcy) → R-LEG kotwiczony.
- **DEVICE_IDENTIFIER** — ~0% recall (realna dziura detekcji).

## 3. Poza zakresem / świadomie nie-dana (W3, nie maskować)
Sygnatury cytowanych orzeczeń (CSKP/CZP/C-…), numery faktur, numery aktów prawnych (art./poz./Dz.U.), nazwy sądów/banków/urzędów (część osobowa nazwy → PERSON_NAME osobno).

## 4. Rekomendowana kolejność następnych R-\* (menu dla Alana)
1. **R-CARD** (Luhn) — najwyższa wartość, zero ryzyka FP.
2. **Re-typ klasy KW** (Rep. A/polisa/umowa: W3 → W2) — decyzja prawna Alana (czy to dane osobowe do kosza przeglądu).
3. **R-REPA / R-POL** (kotwiczone).
4. **R-DATE / R-LEG** (kotwiczone).

Dyscyplina domu: każdy nowy R-\* przez zmierzony wyciek + test (czerwona linia w pułapkowniku, potem wzór), nigdy spekulacyjnie.
