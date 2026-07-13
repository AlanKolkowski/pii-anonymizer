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

## §5. Roadmap — gdzie jesteśmy

```
✅ Bezpieczeństwo: B1-B4 zamknięte, wariant A CERTYFIKOWANY, gotowy do dystrybucji
✅ Tor pomiarowy naprawiony + korpus kontradyktoryjny + rejestr przecieków
✅ α (art. 9-10 domyślnie) + β (C4 desktop fp16) + γ zidentyfikowane
✅ Recall Track 1 (plan A): kontradyktoryjny 84,2%, przecieki −38%
✅ Recall B (B4 leksykon ról + A7 progi): kontradyktoryjny 86,7%, PERSON_ROLE R 29→70
✅ Recall B3 (leksykon art. 9-10): kontradyktoryjny 87,5%, trzy wycieki wagi 5 zamknięte
✅ Recall B2 (wersaliki): syntetyczny ZUS zamknięty; kontradyktoryjny bez zmian (brak okazji w GT tego korpusu); zdolność wersalikowa dla produktu
👉  ── TU JESTEŚMY ── (87,5%; koniec „ślepych" modułów — dalej B1 ensemble + korpus 2.0)
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
