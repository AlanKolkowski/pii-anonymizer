# PROJECT-MAP.md — mapa projektu: dwa produkty, jeden silnik

_Stan na 2026-07-12. Ten plik jest po to, żeby całość dała się ogarnąć jednym
spojrzeniem: co jest czym, co z czym się dzieli, gdzie leży w plikach i gałęziach._

## Skrót w jednym zdaniu

Pod marką **„Paragraf i Prompt"** budujemy **dwa produkty w jednym repo**:
**Anonimizator** (chroni WEJŚCIE do AI — dojrzały, certyfikowany, gotowy do
dystrybucji) i **Weryfikator wyjścia AI** (chroni WYJŚCIE AI — na razie szkic:
projekt + fundament). Dzielą silnik weryfikacji, powłokę aplikacji i fundament
bezpieczeństwa. Rozdzielone są **roadmapą, bramką i SKU — nie repozytorium**.

---

## Produkt 1 — Anonimizator PII (FLAGOWY, dojrzały)

**Co robi:** wykrywa dane osobowe w piśmie, zamienia je na tokeny, deanonimizuje
lokalnie. Wariant A = air-gap (zero sieci, dane nie wychodzą z komputera). Wariant
B = most do AI (human-in-the-loop, „pokazane = wysłane").

**Chroni:** poufność, tajemnicę zawodową, RODO — to, co WYSYŁASZ do AI.

**Stan: bardzo zaawansowany, gotowy do dystrybucji (wariant A).**
- Bezpieczeństwo: blokery B1-B4 zamknięte (integralność modeli, podpis kodu
  Azure = **certyfikat w instalce**, instalacja perMachine, air-gap konstrukcyjny).
  Werdykt bramki bezpieczeństwa: **ZIELONY**.
- Jakość: kontradyktoryjny recall 84,2% (był 78,0%), art. 9-10 RODO maskowane
  domyślnie, desktop dystrybuuje fp16 (jakość web). Cel 90%+ w toku.

**Pliki (rdzeń detekcji i anonimizacji):** `src/pipeline/` (NER + regex),
`src/file-import/` (DOCX/PDF/OCR), `src/anonymizer.js`, `src/substitution.js`,
`src/tokens.js`, `src/main.js`, `src/worker.js`, `electron/`, morfologia
(`src/verifier/morph/`, `src/verifier/case-detector/` — fleksja) i N-checkery
(`src/verifier/checkers/n*`).
**Projekty rozwoju:** `RECALL-90-DESIGN.md`, `W1-W3-MORPHOLOGY-DESIGN.md`,
`DOCX-REBUILD-DESIGN.md`, `MCP-BRIDGE-DESIGN.md`, `SHARED-FOUNDATION-DESIGN.md`,
`MACOS-BUILD-DESIGN.md`, `PRODUCT-DECISIONS.md`, `FL-5-LIVE-WIRING-DESIGN.md`.

**Fleksja w żywych ujściach (FL-5, `feature/fl5-live-wiring`, pod bramką):**
silnik fleksji (K1-K5/K7 z FL-5-LIVE-WIRING-DESIGN.md) wpięty w ekran, schowek
i oba eksporty (`src/verifier/flexion-live.js`: `filterSeenForLegend` +
`buildOutcomeResolver`, jedyny punkt konstrukcji resolvera; artefakt
morfologiczny przez `src/verifier/morph/artifact.js`, dziś pusty-poprawny A0).
Flaga `pii.deanon-flexion` (localStorage), domyślnie **OFF**
(`FLEXION_LIVE_DEFAULT`, `src/main.js`) — aktywacja to osobna decyzja Alana.
Ujście DOCX-rekonstrukcja pozostaje zawsze włączone, poza flagą. Silnik sam
(`flexion-resolver.js`/`morph/*`/`case-detector/*`) pozostał niezmieniony.

---

## Produkt 2 — Weryfikator wyjścia AI (SZKIC, drugi produkt)

**Co robi:** skanuje tekst od AI, wykrywa powołania (sygnatury orzeczeń, artykuły,
cytaty), konfrontuje je ze zbiorami offline i — opcjonalnie — z **publicznymi,
darmowymi bazami** (SN, TK, NSA/WSA, sądy powszechne, ISAP) przez osobny demon;
to, czego nie potwierdzi, flaguje `[DO WERYFIKACJI W LEGALIS/LEX]`. Automatyzuje
Twoją regułę pracy z `REGULY-PRACY.md`.

**Chroni:** trafność — zmyślone orzecznictwo, nieistniejące artykuły, przekręcone
cytaty — to, co AI ODESŁAŁO.

**Stan: szkic.** Projekt 1.1 + fundament kodu (ekstraktor offline air-gap-czysty
+ szkielet demona z adapterami baz publicznych). Warstwa online pod bramką Opusa
(O-TR-6, transport jeszcze niezbudowany).

**Pliki:** `src/verifier/legal-refs/` (ekstraktor offline), `verifier-daemon/`
(egress w osobnym procesie), T-checkery (`src/verifier/checkers/t*`, przyszłe).
**Projekt:** `LEGAL-OUTPUT-VERIFIER-DESIGN.md`, `LEGAL-VERIFIER-NOTES.md`.

---

## Co dzielą (wspólny fundament — dlatego JEDNO repo)

- **Silnik weryfikacji:** `src/verifier/checkers/` — rodzina N (spójność
  wewnętrzna) i T (konfrontacja ze światem) w jednym katalogu, jeden kształt
  findingu, jeden panel UI „Weryfikacja pisma" (sekcje „Odmiana" / „Nieścisłości"
  / „Trafność prawna").
- **Gramatyka tokenów i substytucja:** `src/tokens.js`, `src/substitution.js`.
- **Fundament bezpieczeństwa:** integralność (`electron/model-integrity.mjs`,
  fuse, manifest), niezmiennik air-gap (C-NET-6: `electron/` nie importuje
  `node:net`/`http`), redakcja logów, „nic bez akceptacji człowieka".

**Dlatego nie dwa repozytoria:** osobne repo duplikowałoby silnik weryfikacji,
powłokę aplikacji i cały łańcuch integralności; tryb zintegrowany weryfikatora
i tak żyje w aplikacji anonimizatora (`LEGAL-OUTPUT-VERIFIER-DESIGN §1.2`). Osobne
repo rozważamy dopiero, gdyby weryfikator urósł we własny, samodzielny produkt.

---

## Rozdział w gałęziach (git)

| Gałąź | Zawartość | Rola |
|---|---|---|
| `main` | wspólny fundament + zmergowany anonimizator (wszystko gotowe) | pień, źródło prawdy |
| `feature/*` (recall, docx, morfologia…) | robocze gałęzie **anonimizatora** | PRIORYTET |
| `feature/legal-verifier` | projekt 1.1 + fundament **weryfikatora** | rozwijany OSOBNO, poza drogą anonimizatora |

Bramka Opusa przed każdym merge do `main` dla modułów dotykających **detekcji,
kanału albo integralności**. Weryfikator ma własną bramkę (O-TR) i własny cykl.

---

## Model myślowy (do zapamiętania)

> Anonimizator chroni to, co **wysyłasz** do AI (gotowy, certyfikowany).
> Weryfikator chroni to, co AI **odesłało** (zaprojektowany, w budowie).
> Jeden silnik, dwie role, dwa SKU. **Najpierw kończymy anonimizator.**

Pełny stan, etapy i plan: `ROADMAP.md`.
