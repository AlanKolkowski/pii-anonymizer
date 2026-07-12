# GATE-PHASE0.md — rozstrzygnięcia bramki Opusa nad Fazą 0

**Data:** 2026-07-12
**Autor:** Opus (bramka bezpieczeństwa i jakości)
**Zakres:** faza 0 wspólnego fundamentu (S1–S4, MD1–MD2, W5), gałąź
`feature/foundation-phase0` zmergowana do `main` (fast-forward, commity
`8e8e758..19323e1`).
**Cel dokumentu:** utrwalić w repozytorium rozstrzygnięcia, które padły w
przeglądzie bramkowym — tak, żeby kolejne sesje (Fable, Sonnet) budowały na nich,
a nie odtwarzały ich z pamięci czatu. `NIGHT-NOTES.md §2` zgłaszał siedem decyzji
„do potwierdzenia na bramce"; poniżej ich rozstrzygnięcia.

---

## §1. Werdykt

**Faza 0 zaakceptowana i zmergowana do `main`.** 899 testów zielonych, zero
regresji. Rdzeń (S1 gramatyka tokenów, S2 substytucja) przejrzany bezpośrednio;
MD1/MD2 (parser niezaufanego ZIP), W5 (checkery) i projekt macOS ocenione przez
trzech niezależnych subagentów. Rozstrzygnięcia decyzji §2 niżej, uzupełnienia
w paczce poprawek (`feature/phase0-fixes`, §4).

## §2. Rozstrzygnięcia decyzji z NIGHT-NOTES §2

| # | Decyzja | Werdykt | Uzasadnienie |
|---|---|---|---|
| 2.1 | `token` w `findTokens`/`splitTokenParts` = forma kanoniczna `[${tokenId}]`, nie surowy literał | **ZATWIERDZAM** | Daje jedną spójną definicję „token" dla wszystkich konsumentów; `legend[token]` działa niezmieniony; adnotacja przypadka niesiona osobnym polem `case`. Zgodne z istniejącym wzorcem `deanon-workspace`. |
| 2.2 | Poszerzenie gramatyki w `mcp/listings.js` o anotację przypadka to realna zmiana zachowania (outcome z wyłącznie tokenem adnotowanym nie jest już odrzucany z MCP) | **ZATWIERDZAM jako zamierzoną konsekwencję decyzji 17** | To dokładnie cel decyzji 17: spójne rozpoznawanie adnotowanych tokenów wszędzie. Brakujący test dopisany w paczce poprawek (`feature/phase0-fixes`, commit `2b9653b`). |
| 2.3 | Okno kontekstu `resolveReplacement` ±40 znaków | **ZATWIERDZAM jako rozsądny domyślny** | Spójne z rozmiarem kontekstu raportu rezyduów DOCX (§6.2). Nieistotne w v1 (resolver tożsamościowy). Do potwierdzenia/korekty przy pierwszym module czytającym kontekst (W3/MD4). |
| 2.4 | Rezygnacja z kaskady sekwencyjnego `replaceAll` (single-pass) | **ZATWIERDZAM** (już zaakceptowane jako O-SF-4) | Kaskada nieosiągalna produktowo dzięki rezerwacji tokenów (`collectReservedTokens`); single-pass czyni gwarancję „pokazane = skopiowane" konstrukcyjną. Golden bajt-w-bajt dowodzi „stary ≡ nowy". |
| 2.5 | `extractRaw` dopisane do MD1 w trakcie MD2 | **ZATWIERDZAM** | Uzasadnione: verbatim-copy wymaga surowych skompresowanych bajtów; czysty odczyt bez dekompresji, więc bez nowego ryzyka bomby. |
| 2.6 | Metoda kompresji zmodyfikowanego wpisu = metoda oryginału | **ZATWIERDZAM jako zachowawcze** | Zero niespodziewanej zmiany formatu. Do potwierdzenia przy MD4 (pierwszy realny konsument). |
| 2.7 | Progi i leksykony checkerów W5 wybrane bez precyzyjnej specyfikacji | **ZATWIERDZAM z zastrzeżeniem** | Findings niczego nie blokują (V2), więc zła kalibracja nie psuje pisma. Priorytetowa kalibracja N-5 i N-2 w paczce poprawek (trafiają w praktykę frankową); N-3/N-4/N-7/N-8 odłożone do W6/W7, gdy powstanie UI i realne przypadki. |

## §3. Status modułów (z przeglądu bramkowego)

- **S1 `src/tokens.js`** — PASS. Gramatyka kanoniczna + opcjonalna anotacja
  przypadka (decyzja 17); `Ms` przed `M` w alternacji (pułapka backtrackingu);
  wyłącznie czyste funkcje, zero eksportu mutowalnego RegExp (hazard `lastIndex`);
  `tokenId` zawsze bez anotacji.
- **S2 `src/substitution.js`** — PASS. Warstwy `decyzja ?? resolver ?? baza`;
  `rawTokenLength` poprawnie liczy surowy span (token kanoniczny krótszy niż
  adnotowany); `effectiveOutcomeLegend` skonsolidowany; single-pass.
- **MD1/MD2 `src/docx-rebuild/`** — PASS bezpieczeństwowo. Allow-lista metod,
  odrzucenie ZIP64/szyfrowania/multi-disk/patch-data, limit dekompresji
  **w strumieniu** (bomba przerywa, nie po pełnym rozpakowaniu), duplikat =
  odrzucenie, zip-slip niemożliwy z konstrukcji, verbatim-copy z zerowaną flagą.
  Uzupełnienia: testy luk pokrycia (ZIP64-locator, data-descriptor, `../`,
  multi-disk) w paczce poprawek; C-INP-10 (limit rozmiaru wejścia) jest zewnętrzny
  i musi wejść przed realnym wejściem (MD5).
- **W5 `src/verifier/checkers/`** — PASS (flag-only, V2). Warstwa czysta.
  Kalibracja N-5 (kwoty > mln, FP wysokiej wagi w sprawach frankowych) i N-2
  (kwoty LLM) w paczce poprawek; reszta do W6/W7.
- **MACOS-BUILD-DESIGN.md** (Fable) — oceniony pozytywnie. Otwarta decyzja
  bramki: parytet B3 przy `.dmg` (blokuje tylko TCC) vs `.pkg`; teza App Sandbox
  do potwierdzenia na sprzęcie macOS.

## §4. Paczka poprawek (gałąź `feature/phase0-fixes`)

N-5 (skala > mln → nie zgaduj), N-2 (FINANCIAL_AMOUNT → informacyjna + NBSP),
testy luk ZIP, test §2.2 (token adnotowany jako jedyny w outcome). Wchodzi przez
bramkę Opusa i merge, jak reszta.

## §5. Dług odnotowany

`eval:score` daje dziś 0% na wszystko (offsety `.expected.json` względem LF przy
plikach CRLF; odkrycie Sonneta, `NIGHT-NOTES §3`). Objęte audytem recall
(`feature/eval-recall-audit`, Fable).
