# ROADMAP.md — podsumowanie, stan i droga

_Stan na 2026-07-12. Podsumowanie maratonu (czwartek → niedziela) i plan przed nami._

## §1. Od czego zaczęliśmy

Fork `wjarka/pii-anonimizer`: browserowy anonimizator PII na modelach HuggingFace.
Cel: **offline (air-gap) anonimizator dla kancelarii**, chroniący tajemnicę
zawodową, a docelowo bezpieczny most do AI.

**Co ujawnił pierwszy audyt (punkt zero prawdy):**
- Tor pomiarowy był **zepsuty** — `eval:score` dawał 0% na wszystkim (offsety
  ground truth w LF/UTF-16 vs pliki CRLF na Windows). Jakość była nieznana.
- Po naprawie realne liczby: syntetyczny **F1 92,6%**, kontradyktoryjny **78,0%**.
- Desktop dystrybuował **słabszy model (q8)**: syntetyczny 86%, HEALTH_DATA 13%.
- Domyślna konfiguracja **nie maskowała danych art. 9-10 RODO** (zdrowie, karalność).

## §2. Etapy, które przeszliśmy

1. **Audyt bezpieczeństwa + 4 blokery B1-B4 → wszystkie zamknięte.** Integralność
   modeli w runtime (B1), usunięcie WebMCP z desktopu (B2), instalacja perMachine
   (B3), **podpis kodu Azure — certyfikat w instalce** (B4). Werdykt: **ZIELONY**.
2. **Faza 0 — wspólny fundament** (gramatyka tokenów, substytucja, parser ZIP,
   N-checkery). Zmergowana, 899 testów.
3. **Audyt eval/recall.** Naprawa toru (LF/UTF-16), korpus kontradyktoryjny (38
   fikcyjnych pism celujących w słabości sita), rejestr przecieków. Ujawnił trzy
   rzeczy: α (art. 9-10 domyślnie wyłączone), β (desktop q8), γ (DOCX nagłówki/stopki).
4. **A12** — art. 9-10 RODO maskowane **domyślnie** (zamyka α).
5. **C4** — desktop dystrybuuje **fp16 = jakość web**, nie q8 (zamyka β).
6. **Recall remediation (plan A, Track 1)** — 9 modułów: kontradyktoryjny
   **78 → 84,2**, przecieki treści **42 → 26 (−38%)**, przy MNIEJSZEJ liczbie FP.
7. **Projekty rozwoju** (zaprojektowane, gotowe do implementacji): morfologia/fleksja
   (W1-W3), droga do recall 90% (moduły B + korpus 2.0), DOCX-rebuild (utrzymanie
   formatowania), build macOS.
8. **Drugi produkt** — Weryfikator wyjścia AI (projekt 1.1 + fundament kodu).

## §3. Detekcja w stosunku do oryginału

„Oryginał" = webowy upstream (fp32/fp16). Nasz fork **dodał** warstwę, której
upstream nie ma: identyfikatory z **sumami kontrolnymi** (PESEL/NIP/REGON/IBAN),
sygnatury sądowe, kwoty, ensemble, post-processing, **art. 9-10 domyślnie**,
hardening pod korpus kontradyktoryjny.

- **Desktop był gorszy od web** (q8: syntetyczny 86%). **Po C4 desktop = jakość
  web** (fp16). Czyli desktop już **dogonił** oryginał webowy co do modelu.
- **Na naszej mierzonej osi** kontradyktoryjny recall: **78,0 → 84,2 → 86,7 → 87,5**
  (plan A → B4/A7 → B3 art. 9-10), przecieki treści od 42 do **16** (trzy wycieki
  wagi 5 zamknięte).
- **Czego jeszcze nie mamy:** mierzonego head-to-head z waniliowym upstreamem na
  tym samym runtime — to da **harness jakości w przeglądarce** (odłożony Track 4).

## §4. Kiedy przebijemy oryginał jakością

- **Na zdolności — już przebijamy:** więcej typów, identyfikatory z sumami,
  art. 9-10 domyślnie, fp16 na desktopie.
- **Na mierzonej jakości — już wyżej:** kontradyktoryjny **87,5** > pierwotne 78,0.
- **Definitywnie (liczba do obrony w materiałach):** **90%+ na zamrożonym
  holdoucie** (bramka GATE-RECALL-90 z `RECALL-90-DESIGN.md`: dolna granica 95%
  przedziału ufności ≥ 90%, zero pełnych wycieków wagi ≥4). To osiągamy po
  modułach B + korpusie 2.0. **To jest kamień, po którym „przebiliśmy oryginał"
  staje się zdaniem, które radca może napisać i obronić.**

## §4a. Piwot zakresu: trzy warstwy i widok „W1" (2026-07-14/15)

Po pomiarze holdoutu (76% „ogółem") Alan przedefiniował zakres
(`ZAKRES-ANONIMIZACJI.md`, decyzja 2026-07-14): nie każdy typ, który wykrywa
model, jest daną osobową w rozumieniu art. 4 pkt 1 RODO. Trzy warstwy:
**W1 maskuj automatycznie** (rdzeń danych osobowych — cel recall ≥ 95%),
**W2 do decyzji radcy** (wrażliwe, ale nieidentyfikujące samodzielnie —
role, atrybuty, art. 9-10, kwoty, lokalizacje — silnik wykrywa i pokazuje,
nie maskuje w ciemno), **W3 nie maskuj** (podmioty, sygnatury cytowane —
nie są danymi osobowymi). Mechanika (`SCOPE-TIERS-DESIGN.md`, ST-1…ST-8)
jest zaprojektowana; **ST-1** (`TYPE_TIERS`) i **ST-7a** (scoring
trójdzielny) są zaimplementowane (`feature/scope-st7a`) — ST-2…ST-6
(partycja w pipeline, kosz UI, allowlista sygnatur) czekają na GATE-SCOPE.

**Uwaga: 76% „ogółem" NIE jest kasowane** — to uczciwa liczba na pełnej
taksonomii modelu upstream i zostaje w §1/§3 jako punkt odniesienia
historycznego. **W1 to nowa, węższa i bardziej trafna „liczba do obrony"**
— mierzy dokładnie to, co RODO nazywa daną osobową, bez kary za
niemaskowanie sygnatur, nazw sądów czy kwot.

**Widok W1 — PODGLĄD, nie liczba do obrony** (pełne wyliczenie:
[`SCOPE-TIERS-RESCORE-NOTES.md`](SCOPE-TIERS-RESCORE-NOTES.md)):

| Próba | Dok. | W1 Recall | W1 Precision | W1 F1 |
|---|---|---|---|---|
| Holdout (wycinek, 11 z 206) | 11 | 85,5% | 92,2% | 88,7% |
| Dev/adversarial (pełny, strojeniowy) | 38 | 88,6% | 87,6% | 88,1% |
| **Holdout (pełny, zamrożony) — all-mask, AUTORYTATYWNE** | **206** | **85,7%** | **87,4%** | **86,5%** |

Pierwsze dwie próby są małe i/lub strojeniowe — kontekst/potwierdzenie
kierunku, nie liczby do cytowania. Zgodne z ręcznym szacunkiem z
`ZAKRES-ANONIMIZACJI.md` §4 („rdzeń W1 ≈ 86%"). **Pełny W1 na zamrożonym
holdoucie 206 dok. / 1685 encji (all-mask, przed wdrożeniem ST-2 partycji
w pipeline) zmierzony 2026-07-15: F1 86,5% (P 87,4% / R 85,7%)** — pełna
tabela per-typu i metodologia w `SCOPE-TIERS-RESCORE-NOTES.md` §4. **To
jeszcze nie werdykt bramkowy GATE-RECALL-90** — cel „95%+ W1" (`ZAKRES` §2,
`SCOPE-TIERS-DESIGN.md` §6.4) pozostaje celem: 86,5% jest obronialnym
punktem startowym przed domknięciem luk nazwiskowych (OCR-spacing, nazwiska
pospolite — `ZAKRES-ANONIMIZACJI.md` §5) i przed ST-2…ST-6.

## §5. Roadmap — gdzie jesteśmy

```
✅ Bezpieczeństwo: B1-B4 zamknięte, wariant A CERTYFIKOWANY, gotowy do dystrybucji
✅ Tor pomiarowy naprawiony + korpus kontradyktoryjny + rejestr przecieków
✅ α (art. 9-10 domyślnie) + β (C4 desktop fp16) + γ zidentyfikowane
✅ Recall Track 1 (plan A): kontradyktoryjny 84,2%, przecieki −38%
✅ Recall B (B4 leksykon ról + A7 progi): kontradyktoryjny 86,7%, PERSON_ROLE R 29→70
✅ Recall B3 (leksykon art. 9-10): kontradyktoryjny 87,5%, trzy wycieki wagi 5 zamknięte
✅ Recall B2 (wersaliki): syntetyczny ZUS zamknięty; kontradyktoryjny bez zmian; zdolność wersalikowa dla produktu
✅ Korpus 2.0 ZBUDOWANY (holdout 206 dok./1685 encji, dev/holdout rozłączne) + naprawa evalu; pomiar bramkowy przenosi się na PC (32 GB)
✅ Piwot zakresu (W1/W2/W3, ZAKRES-ANONIMIZACJI.md) + ST-1/ST-7a scoring trójdzielny (feature/scope-st7a); pełny W1/206 all-mask zmierzony: F1 86,5% (P 87,4%/R 85,7%) — §4a
👉  ── TU JESTEŚMY ── (87,5% na dev-korpusie „ogółem"; **W1 all-mask na pełnym 206-dok. holdoucie: F1 86,5%** (§4a), punkt startowy nie bramka; **cel 95%+ W1** wymaga domknięcia luk nazwiskowych + ST-2…ST-6 pod GATE-SCOPE)
⬜ Recall do 90%+  (moduły B: B4 leksykon ról = największa dźwignia, B2 wersaliki,
                    B3 art.9-10, B1 ensemble; + korpus 2.0; + dokończone A7)
⬜ C4 build + bench  (domknięcie desktopu fp16: pełne pakowanie + pomiar pamięci/latencji)
⬜ Harness jakości w przeglądarce  (Track 4 — liczba „my vs oryginał" na realnym runtime)
⬜ DOCX-rebuild (utrzymanie formatowania) + morfologia/fleksja  — implementacja projektów
⬜ Most MCP (wariant B)  — implementacja
⬜ (OSOBNO, po anonimizatorze) Weryfikator wyjścia AI: dokończenie + warstwa online pod bramką
```

## §6. Co robimy dalej (rekomendacja)

**Zgadzam się z Tobą: najpierw w pełni dokończyć anonimizator, priorytet
SKUTECZNOŚĆ.** Bezpieczeństwo jest już zielone (B1-B4 + air-gap konstrukcyjny) —
tam nie ma pilnej pracy poza domknięciem C4. Kolejność:

1. **Recall do 90%+** — moduły B (B4 leksykon ról/tytułów pierwszy, największy
   zysk; potem B2/B3/B1) + **korpus 2.0** (dev/holdout ~1000 encji, żeby liczba
   była obronialna) + **dokończone A7** (pełna krzywa P/R na maszynie z zapasem
   pamięci — jest tam dodatkowy zysk). **To odblokowuje materiały marketingowe.**
2. **Regeneracja identyfikatorów syntetycznych** z sumami kontrolnymi — usuwa
   artefakt pomiaru (pozorna regresja syntetyczna po A1).
3. **C4 build + bench** — domknięcie desktopu fp16 (bramka B1 Opusa).
4. **Harness jakości** — mierzone „my vs oryginał" na realnym runtime.
5. **DOCX-rebuild + morfologia** — implementacja (projekty gotowe).

**Weryfikator wyjścia AI parkuje** na `feature/legal-verifier` do czasu domknięcia
anonimizatora. Marketing (dla obu) czeka na odpowiednie bramki jakościowe.

## §7. Bramki i dokumenty kontrolne

- `GATE-EVAL-RECALL.md` — werdykt audytu recall + cel 90%.
- `GATE-RECALL-REMEDIATION.md` — werdykt planu A (Track 1, 84,2%).
- `GATE-LEGAL-VERIFIER.md` — werdykt weryfikatora (fundament + 2 warunki MEDIUM).
- `GATE-PHASE0.md` — werdykt fundamentu.
- `PRODUCT-DECISIONS.md` — decyzje Alana (21 + audyt/recall).
- `PROJECT-MAP.md` — mapa dwóch produktów.
