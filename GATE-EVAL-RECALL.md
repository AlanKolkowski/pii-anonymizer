# GATE-EVAL-RECALL.md — bramka Opusa nad audytem recall

**Data:** 2026-07-12
**Autor:** Opus (bramka bezpieczeństwa i jakości)
**Zakres:** audyt toru pomiarowego i recall (`EVAL-RECALL-AUDIT.md`, Fable),
gałąź `feature/eval-recall-audit` zmergowana do `main` (merge `33851d7`), wraz
z wdrożeniem decyzji A12 (`2fc4eee`).
**Cel:** utrwalić werdykt bramki i warunki, żeby kolejne sesje budowały na nich,
a nie odtwarzały ich z pamięci czatu (jak `GATE-PHASE0.md`).

---

## §1. Werdykt

**Audyt PRZYJĘTY.** Metodologia rzetelna, ustalenia strukturalne zweryfikowane
u źródła, gałąź merge-safe, zmergowana do `main` — **1029 testów zielonych,
86 plików**.

## §2. Co zweryfikowałam sama (nie z raportu)

- **Przyczyna zer w `eval:score`** potwierdzona potrójnie niezależnie (audyt +
  `NIGHT-NOTES §3` Sonneta + pamięć innej sesji): offsety GT w jednostkach UTF-16
  względem tekstu LF, checkout Windows daje CRLF przez `core.autocrlf=true`.
  GT nigdy nie był zepsuty, zepsute było czytanie. Naprawa: `src/eval/eval-text.js`
  (LF+UTF-16+walidacja+stempel `lf-utf16-v1`), strażnik `src/eval/ground-truth.test.js`.
- **Korpus kontradyktoryjny:** 38 `.txt` + 38 `.expected.json` + 2 DOCX, w 100%
  fikcyjny (PESEL/NIP/IBAN z sumami, nienależące do nikogo), deterministyczny
  generator, offsety pod tego samego strażnika. Taksonomia celuje w praktykę
  kancelarii (dopełniacz/wołacz, formaty PESEL/NIP/REGON/IBAN, OCR, pozew/umowa
  kredytu, pułapki prawne).
- **Gałąź merge-safe:** dotyka wyłącznie `test-data/adversarial`, `src/eval`,
  skryptów generatora, jednego testu i `entity-sources.js` (tam odczyt
  `VITE_MODEL_DTYPE` w Node — inertny w przeglądarce, `process` undefined).
  Plan A1-A12/B1-B3 to PROPOZYCJA, nie kod — merge nie zmienił detekcji.

## §3. Liczby

Baseline na naprawionym torze: **syntetyczny F1 92,6** (P 93,0 / R 92,1);
**kontradyktoryjny F1 78,0** (P 77,9 / R 78,1). NIE przeliczone moją ręką (eval
pobiera modele) — metoda (scoring ścisły, analiza znakowa, macierz pomyłek)
i komendy repro (raport §10) zweryfikowane, liczby przyjęte jako odtwarzalne.
Liczba kontradyktoryjna jest PO kuracji GT (raczej optymistyczny brzeg).

## §4. Trzy ustalenia zmieniające postawę wydania — i ich rozstrzygnięcia

- **α — domyślna konfiguracja nie maskowała danych art. 9-10 RODO.** Zweryfikowane
  u źródła (`entity-sources.js:135` — `DEFAULT_ENABLED_CATEGORIES` bez
  `health-biometric`/`special-categories`; `main.js:305` startuje z
  `defaultEnabledEntities()`). **ROZSTRZYGNIĘTE: decyzja 20/A12 — włączone
  domyślnie** (commit `2fc4eee`, koszt zerowy, dwa strażniki regresji).
- **β — desktop dystrybuował q8, słabszy niż mierzone fp32/fp16** (§11 raportu:
  syntetyczny F1 86,0, HEALTH_DATA 13,3, pełne wycieki wagi ≥4 rosną 5→13).
  **ROZSTRZYGNIĘTE: decyzja 21/C4 — desktop dystrybuuje warianty jakości web
  (fp32/fp16), nie q8.** To USUWA β (desktop = mierzona jakość) i przywraca
  ważność jakościowej części zielonego werdyktu wariantu A. Implementacja: Sonnet
  (repack + regeneracja `models/manifest.json` + łańcuch integralności B1),
  **bramka Opusa** (dotyka integralności modeli). Warunek pomiaru: fp32 na WASM
  to koszt pamięci/latencji — bench na sprzęcie docelowym, czy ścieżka GPU działa
  na desktopie.
- **γ — import DOCX gubi po cichu nagłówki/stopki/przypisy** (mammoth, przybite
  `docx-adversarial.test.js`). Dziś: brak przecieku (tekst nie wchodzi do
  pipeline'u, więc i nie wychodzi), ale niekompletność. Przy DOCX-REBUILD
  (kopiowanie verbatim) surowe PII z tych części trafi do eksportu, jeśli MD4 ich
  nie obejmie. Alan (2026-07-12): nagłówki/stopki to prawie zawsze dane kontaktowe
  kancelarii i innych podmiotów — priorytet. **TWARDY warunek kontraktu MD4:**
  silnik tokenów obejmuje `word/header*.xml`, `word/footer*.xml`,
  `word/footnotes.xml`, `word/endnotes.xml`; import musi te części WIDZIEĆ (dziś
  gubi). Wchodzi do bramki DOCX-REBUILD (audyt R2).

## §5. Zastrzeżenia drugiego rzędu (warunki bramki)

- **Progi A7 mierzyć na artefakcie, który dystrybuuje desktop.** Po C4 to
  fp16/fp32 (nie q8) — kalibracja spójna z web, prostsza niż przy q8.
- **Artefakt ≠ runtime:** eval mierzy wagi w Node/ORT-CPU; produkt to ORT-WASM.
  Realna wierność wykonawcza wciąż niezmierzona — patrz §7 (harness jakości).
- **Rejestr przecieków, nie tylko F1:** każda zmiana w `src/pipeline` → tagowany
  eval na OBU korpusach + `eval:analyze`, patrząc na wagę przecieku (audyt R1).

## §6. Cel i sekwencja naprawy

**Cel Alana (2026-07-12): skuteczność 90%+ (recall na korpusie kontradyktoryjnym)
przed materiałami marketingowymi.** Sekwencja po wadze przecieku:
A12 (zrobione) → A5 (maxLength flaguje, nie kasuje) + A7 (progi na fp16) →
A1/A2/A6/A8 (identyfikatory z sumami kontrolnymi, sygnatury repertoriów, dedup
bez kasowania pokrycia, siatka bezpieczeństwa w filtrze źródeł) → A9 (fleksja ról,
taktycznie; docelowo W3 weryfikatora) → A4/A11. B1-B3 i C1-C5 później albo jako
komunikacja ograniczeń.

## §7. Otwarte

- **Harness jakości w przeglądarce/Electronie:** dziś eval mierzy artefakt w Node;
  „rzeczywiste" porównanie produktu z oryginałem webowym wymaga przepuszczenia
  korpusu przez realny runtime (analogicznie do bench czasowego). Zamyka §5 pkt 2.
- **C4 bench** (pamięć/latencja fp32-WASM na sprzęcie kancelaryjnym).
- **Marketing wstrzymany do 90%+** (decyzja Alana 2026-07-12).
- **OCR l→ł** (osobne zgłoszenie Alana: „Kolkowski"→„Kołkowski" po OCR) — w toku
  diagnoza.

## §8. Reprodukcja

`npm test` (1029/86). Eval: `npm run eval -- --label=<slug>` (syntetyczny) i
`--dir=test-data/adversarial`; scoring `npm run eval:score`; analiza przecieków
`npm run eval:analyze`; parytet q8 `VITE_MODEL_DTYPE=q8 npm run eval`. Pełna
tabela komend: `EVAL-RECALL-AUDIT.md §10`.
