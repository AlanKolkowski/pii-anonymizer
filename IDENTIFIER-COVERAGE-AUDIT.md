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
- **Karta płatnicza** — ✅ **ZAMKNIĘTE** (R-CARD, 2026-07-19): Luhn + prefiks IIN (Visa/MC/Amex) + grupowanie, FP=0. `PAYMENT_CARD` listuje `'regex'` (autorytatywne).
- **Data urodzenia** — ✅ **ZAMKNIĘTE** (R-DATE, 2026-07-19): wyłącznie kotwiczony („ur.", „urodzon…", „data urodzenia"), daty spraw/umów nietknięte; `\bur\.` na granicy słowa (procedur./struktur. nie kotwiczą). `DATE_OF_BIRTH` listuje `'regex'`.
- **Numer legitymacji zawodowej** — np. „Tr-1138" (dana radcy) → R-LEG kotwiczony. **UWAGA (decyzja Alana):** numer WŁASNY radcy jest na papierze firmowym (jawny, jak własna sygnatura → allowlista ST-5), ale numer INNEGO pełnomocnika/strony identyfikuje osobę. Domyślnie maskować, allowlista dla własnego — do potwierdzenia.
- **DEVICE_IDENTIFIER** — ~0% recall (realna dziura detekcji).

**Strażnik systemowy (2026-07-19):** `entity-sources.test.js` ma self-validating strażnika pokrycia podłogi regex — uruchamia realny `findRegexEntities` na wektorach i żąda `'regex'` w `ENTITY_SOURCES` dla KAŻDEGO faktycznie emitowanego typu. Domyka klasę błędu, przez którą R-CARD początkowo ominął konwencję (typ regexowy bez `'regex'` w źródłach → ciche wypadnięcie przy wadze <4 albo mis-flag `unauthoritativeSource` przy ≥4).

## 3. Poza zakresem / świadomie nie-dana (W3, nie maskować)
Sygnatury cytowanych orzeczeń (CSKP/CZP/C-…), numery faktur, numery aktów prawnych (art./poz./Dz.U.), nazwy sądów/banków/urzędów (część osobowa nazwy → PERSON_NAME osobno).

## 4. Rekomendowana kolejność następnych R-\* (menu dla Alana)
1. ✅ **R-CARD** (Luhn) — ZROBIONE 2026-07-19 (na main).
2. ✅ **R-DATE** (data urodzenia, kotwiczony) — ZROBIONE 2026-07-19 (na main).
3. **Re-typ klasy KW** (Rep. A/polisa/umowa: W3 → W2) — **decyzja prawna Alana** (czy to dane osobowe do kosza przeglądu). BLOKUJE R-REPA/R-POL: bez re-typu detekcja ich nie maskuje (zostają W3).
4. **R-REPA / R-POL** (kotwiczone) — czekają na decyzję #3.
5. **R-LEG** (legitymacja zawodowa, kotwiczony) — decyzjo-lekki, ale patrz uwaga o numerze własnym (allowlista ST-5) w §2.

Dyscyplina domu: każdy nowy R-\* przez zmierzony wyciek + test (czerwona linia w pułapkowniku, potem wzór), nigdy spekulacyjnie. Każdy nowy typ regexowy MUSI dopisać `'regex'` do `ENTITY_SOURCES` — pilnuje tego strażnik z §2.
