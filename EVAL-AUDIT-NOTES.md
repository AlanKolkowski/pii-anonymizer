# EVAL-AUDIT-NOTES.md – przebieg sesji audytu recall (architekt/adwersarz)

**Data:** 2026-07-12, praca autonomiczna (Fable), bez pytań w trakcie.
**Branch:** `feature/eval-recall-audit`, 7 commitów, `main` NIETKNIĘTY.
**Miejsce pracy:** osobny worktree `../eval-audit-worktree` (powód: §4.1).
**Wynik:** tor pomiarowy naprawiony i obstawiony strażnikami (0% → realne liczby),
baseline zmierzony (syntetyczny F1 92,6%), korpus kontradyktoryjny zbudowany
(38 dokumentów + 2 DOCX, 279 encji, 100% fikcyjnych) i zmierzony (F1 78,0%),
rejestr 42 przecieków z atrybucją warstw, plan naprawczy A1–A12/B1–B3/C1–C5.
Pełny raport: **EVAL-RECALL-AUDIT.md** (tam wszystkie liczby i komendy reprodukcji).

Kolejność czytania dla bramki: EVAL-RECALL-AUDIT.md §1 (streszczenie) → §6 (rejestr
przecieków) → §8 (plan) → tu §2 (decyzje do podjęcia).

---

## §1. Ukończone (moduł → commit → testy)

| Co | Commit | Testy |
|---|---|---|
| Konwencja LF+UTF-16, walidacja GT, stemple przebiegów, strażnicy | `8ee63f9` | +24 (ground-truth.test.js), razem 84 pliki / 934 |
| `--dir` dla korpusów alternatywnych, sklejenie run↔score↔report stemplami | `545269a` | bez zmian (934) |
| Korpus kontradyktoryjny 38 dokumentów + generator deterministyczny + README wektorów | `6a98087` | strażnik rośnie 24→100, razem 84 / 1010 |
| Fixtury DOCX (tabela, przypis, nagłówek, stopka) + pin cichych strat importu | `189065a` | +4, razem 85 / 1014 |
| Analizator przecieków `eval:analyze` (pokrycie znakowe, macierz, warstwy, wagi) | `154433b` | +10, razem 86 / 1024 |
| Kuracja GT po pierwszym pomiarze (5 luk anotacji po stronie korpusu, 1 pułapka przeredagowana) | `867f33d` | 86 / 1024 (strażnik re-waliduje offsety) |
| Raport EVAL-RECALL-AUDIT.md + ta notatka | (commit raportu) | 86 / 1024 |

`npm test` zielone po KAŻDYM commicie z osobna, liczby plików/testów w każdym commit
message. Przebiegi eval: `2026-07-12T09-15-23` (baseline syntetyczny),
`2026-07-12T09-28-02` (adversarial przed kuracją GT), `2026-07-12T09-42-09`
(adversarial finalny; liczby raportu pochodzą z niego).

### Czego NIE ruszałam (zgodnie z poleceniem)

Dokumenty projektowe (SHARED-FOUNDATION, DOCX-REBUILD, LOCAL-VERIFIER, MCP-BRIDGE,
MACOS-BUILD, SECURITY-CHECKLIST): zero zmian, rekomendacje wyłącznie w raporcie (§9).
`src/pipeline/**`: zero zmian zachowania produktu – audyt mierzy, plan naprawia
(świadomie: każda naprawa pipeline'u wymaga własnego cyklu eval, nie nocnej wrzutki).
NIGHT-NOTES.md: nietknięty (ta notatka jest osobnym plikiem w tej samej konwencji).

---

## §2. Decyzje wymagające Alana (posortowane wg wagi)

1. **A12 – kategorie szczególne w konfiguracji domyślnej.** Dziś aplikacja startuje
   bez maskowania zdrowia/karalności/związków (art. 9–10 RODO):
   `DEFAULT_ENABLED_CATEGORIES` ich nie zawiera (`src/main.js:305`). Dla akt ZUS,
   karnych i pracowniczych to 100% wycieku tych danych niezależnie od modelu.
   Rekomendacja: włączyć domyślnie; wariant minimum: trwałe ostrzeżenie w UI.
2. **A7 – kierunek strojenia progów.** Zmierzone: paszport odrzucony przy score 0,78
   (próg 0,9), rejestracja przy 0,67 (próg 0,7). Rekomendacja: dla typów wagi ≥ 3
   progi w dół wg krzywej P/R, akceptując wzrost FP (dla tajemnicy FP jest tani,
   FN jest katastrofą). Potrzebna zgoda na ten kompromis co do zasady.
3. **A8/B1 – polityka źródeł.** Filtr źródeł wyrzucił PERSON_NAME „Sad" ze score 0,98
   (bo z modelu PL). Rekomendacja: siatka bezpieczeństwa (A8) najpierw, pełny ensemble
   (B1) tylko jeśli inicjały/role dalej cieknąc będą.
4. **Polityka anotacji instytucji publicznych.** Zadanie mówiło „nazwy sądów/banków NIE
   są danymi klienta"; istniejący korpus syntetyczny anotuje je jako ORGANIZATION_NAME
   i korpus kontradyktoryjny robi tak samo (spójność pomiaru), a różnicę dotkliwości
   niesie waga typu (2) w rejestrze przecieków. Jeżeli Alan chce, by produkt ICH NIE
   maskował, to jest to przełącznik kategorii w UI, nie zmiana ground truth.
5. **Taksonomia wynagrodzeń.** GT (za precedensem pismo_05) używa FINANCIAL_AMOUNT,
   model emituje INCOME_COMPENSATION → podwójna kara w scoringu. Do rozstrzygnięcia:
   klasa ekwiwalencji w scoringu albo zmiana polityki anotacji.
6. **C4 – q8 vs fp16/fp32.** Desktop dystrybuuje q8, eval mierzy fp32/fp16. Po A10
   (pomiar parytetu) może wrócić decyzja: większy instalator czy jawne ograniczenie.

---

## §3. Czego nie dało się zweryfikować w tym środowisku i dlaczego

- **Jakość wariantu q8 (desktopowego).** W Node `import.meta.env` nie istnieje, więc
  override dtype nie działa bez zmiany kodu (moduł A10). Świadomie niewykonane w tej
  sesji: zmiana `entity-sources.js` to zmiana produktu, a dyscyplina sesji brzmiała
  „audyt mierzy, nie przestraja".
- **Zachowanie na realnych skanach.** Korpus OCR symuluje WZORCE błędów (l/1, O/0,
  rozstrzelenia, sklejenia, przenoszenia) w tekście; nie przepuszczałam bitmap przez
  PaddleOCR (brak korpusu skanów, których mogłabym użyć bez danych realnych).
- **Parytet środowisk wykonania.** Eval biegnie w Node (onnxruntime-node, CPU);
  produkt w przeglądarce/Electronie (ORT WASM). Te same modele i wejścia, inny runtime;
  ewentualny dryf liczbowy między środowiskami nie był mierzony (bench framework
  istnieje, ale nie mierzy jakości, tylko czas).
- **Fixtury DOCX w prawdziwym Wordzie.** Jak w NIGHT-NOTES §4: brak Worda/LibreOffice;
  mammoth służy jako niezależny parser-proxy (fixtury przechodzą; pin dokumentuje,
  co ginie na imporcie).
- **Dwa przebiegi tła zabite awarią Claude Desktop** w trakcie sesji: oba okazały się
  ukończone przed awarią (artefakty na dysku kompletne, `summary.json` + scoring
  policzony po restarcie) – zweryfikowane, nie założone.

## §4. Obserwacje poboczne

1. **W głównej kopii repo pracowała równolegle inna sesja** (commity `d5f81c2`,
   `9911931` powstały w trakcie mojej pracy; niezacommitowany `src/mcp/listings.test.js`
   z testem decyzji 17). Mój pierwotny `checkout -b` przestawił jej gałąź – naprawione
   w ciągu minut: gałąź `feature/phase0-fixes` przywrócona, a cały audyt przeniósł się
   do **osobnego worktree** `../eval-audit-worktree` (z junction `node_modules` do
   głównej kopii). Wniosek na przyszłość: sesje równoległe w jednej kopii repo powinny
   od razu zaczynać od `git worktree add`.
2. Branch `feature/eval-recall-audit` wyrasta z `feature/phase0-fixes` (commit
   `9911931`), nie z `main` – zawiera więc S1/S2/MD1/MD2/W5 z nocy. Przy scalaniu:
   najpierw phase0-fixes, potem audyt.
3. `MACOS-BUILD-DESIGN.md` (untracked, praca innej sesji) – nietknięty.
4. Junction `eval-audit-worktree/node_modules` → `kopia repo pii/node_modules`:
   do usunięcia przy sprzątaniu worktree (`Remove-Item` junctiona nie kasuje celu).

## §5. Stan testów na koniec sesji

```
npm test: 86 plików / 1024 testy, zielone (baseline sesji: 83 / 910)
```

Nowe testy: 100 strażników ground truth (konwencja offsetów, kanarki CRLF/astral,
higiena, oba korpusy), 10 analizatora, 4 piny importu DOCX.

---

*`main` nietknięty. Wszystkie liczby raportu odtwarzalne komendami z
EVAL-RECALL-AUDIT.md §10. Korpus kontradyktoryjny jest w 100% fikcyjny: żadnych
realnych osób, spraw ani sygnatur; identyfikatory mają poprawne sumy kontrolne,
ale nie należą do nikogo.*
