# GATE-SCOPE – werdykt bramki (Opus)

**Data:** 2026-07-18. **Bramkujący:** Opus. **Zakres:** stos scope-tiers (ST-2…ST-8),
moduły ze sprintu Fable (2026-07-16), aktywacja warstwowości. Sprzątanie Opus+Sonnet 2026-07-17/18.

## Werdykt nadrzędny

- **Kod sprintu: ZBRAMKOWANY i ZINTEGROWANY** na gałęzi `integration/sprint` (`4dbf74a`),
  z main (`4705b93` – NIETKNIĘTY). 11 gałęzi + naprawy. `npm test`: **2477 zielonych**
  (baseline main 2165). NIE zmergowane do main.
- **Warstwa neutralna** (stos ST, śpi przy `allMask:true`): niezmienność all-mask dowiedziona
  **bajt-w-bajt** (test ST-2, 50/50 fixtures). Mergeowalna z pewnością na laptopie.
- **Warstwa detekcyjna** (os1/sg-lite/b3/morph): scalona mechanicznie poprawnie
  (`requiredSources` = 8 docelowych źródeł, licznik kroków NER = 8), ale **jakość detekcji
  NIEZMIERZONA** → wymaga `npm run eval` na PC przed merge do main.
- **AKTYWACJA warstwowości (`allMask:false`): ZABLOKOWANA.** Dwa twarde warunki: patrz niżej.

## GS-1…6

| GS | Przedmiot | Werdykt |
|---|---|---|
| GS-1 | wyścig mostu (`reviewComplete`) | **PASS** – ST-6 twardy warunek, test grepuje każdy payload MCP (zero trafień) |
| GS-2 | powierzchnia kosza | **PASS** – ST-4, znaleziska recenzenta obalone; brak eksportu/schowka |
| GS-3 | słownik localStorage vs D2 | **PASS po naprawie** – waga 5 wykluczona przy zapisie i odczycie (`03f664f`) |
| GS-4 | allowlista sygnatur | **PASS po naprawie** – wyciek Nc-e (EPU) naprawiony (`955fa06`) |
| GS-5 | niezmienność all-mask | **PASS** – ST-2, 50/50 bajt-w-bajt |
| GS-6 | delta THREAT-MODEL | częściowo – kosz W2 jako nowa powierzchnia UI opisany; pełna delta do domknięcia z ST-4 UI |

## Rejestr defektów (znalezione podczas sprzątania → status)

Wszystkie znalezione w kodzie z ZIELONYMI testami. Zasada: żądaj czerwieni, zanim uwierzysz w zieleń.

1. **Wyciek nazwisk W1 na most MCP** (review-engine: księgowanie pozycja vs wartość) –
   **NAPRAWIONY** (`27a51cf`, dowiedziony czerwienią przez prawdziwy łańcuch pipeline).
2. **Żywy błąd produkcyjny** – `tokensFromEntities` rozbijał osobę na 2 tokeny, licznik w
   dialogu potwierdzenia kłamał – **NAPRAWIONY** na `fix/annotation-editor-token-grouping`
   (mergeowalny na main niezależnie od stosu ST).
3. **GS-3: art. 9-10 w trwałym słowniku na dysku** – **NAPRAWIONY** (`03f664f`).
4. **ST-5 Nc-e (EPU e-sąd)** – wyciek WŁASNEJ sygnatury użytkownika (parser nie łykał myślnika);
   wysokie znaczenie dla praktyki frankowej/SKD/windykacyjnej – **NAPRAWIONY** (`955fa06`).
5. **DOCX main.js:553** – pole `docx` gubione → rekonstrukcja martwa z UI, omijała bramkę
   egress i zero-replacement – **NAPRAWIONY** (`5f82ed7`).

## H-3 – warunek aktywacji

Pomiar na 49 lokalnych dok. (laptop, zero inferencji): **8 wycieków wagi ≥4 na 230 encji W1**
(identyfikatory/nazwiska typowane przez model jako `pass` → dropowane przez partycję →
zamaskowane przed piwotem, jawne po). W tym 4 wagi 5 (identyfikatory typu PESEL).
**Wprost łamie warunek G3 (zero pełnych wycieków wagi ≥4).** Zamyka moduł **B6** (jedna
decyzja maskowania po WSZYSTKICH nakładających się kandydatach: jeśli którykolwiek jest `mask`,
maskuj – niezależnie od rozstrzygnięcia typu). Pełny pomiar 206 na PC.

## Warunki aktywacji warstwowości (wszystkie naraz)

1. B6 zamyka H-3 (zero wycieków wagi ≥4 na holdoucie 206, pomiar na PC).
2. Eval `integration/sprint` na PC: recall W1 bez regresji (warstwa detekcyjna).
3. GS-6 domknięte (pełna delta THREAT-MODEL z UI kosza).

## Per-branch (stan bramki)

| Gałąź | Stan |
|---|---|
| st3-bucket-engine | PASS (bloker + GS-3 naprawione) |
| st6-mcp-boundary | PASS (GS-1) |
| st4-bucket-ui | PASS (GS-2) |
| st8-migration | PASS (narzędziówka eval; przejrzany, mimo obcego pochodzenia) |
| os1-ocr-spacing | PASS (inwariant mapy w runtime; fuzz, fail-open 0% na treści) |
| morph-w1-fleksja | PASS (O-3: zero datasetu w repo, bramka w narzędziu) |
| sg-lite | PASS (seed czysty; pełna lista odłożona) |
| b3-art910-extension | PASS |
| st5-signatures | PASS po naprawie Nc-e |
| docx-rebuild | PASS po naprawie main.js:553 |
| fix/annotation-editor-token-grouping | PASS – mergeowalny na main niezależnie |
| **integration/sprint (`4dbf74a`)** | wszystkie powyższe scalone, 2477 zielonych; czeka na PC-eval |

## Następne kroki (dla Alana)

1. Merge `fix/annotation-editor-token-grouping` do main (bezpieczny fix produkcyjny).
2. `npm run eval` na `integration/sprint` (PC) → jeśli W1 bez regresji → merge do main.
3. B6 (zamknięcie H-3) → dopiero potem `allMask:false` (aktywacja).
