# MASK-FLOOR-DESIGN.md – próg-podłoga dla warstwy mask (moduł MF)

Status: **wersja 1.0 – projekt (zero kodu)**. Autor: Fable (architekt).
Data: 2026-07-18. Zleceniodawca: Opus (bramka jakości), kolejność Alana.
**Źródła prawdy:** `POSTPROCESS-LEAK-AUDIT.md` §3/§6 (gałąź `feature/h3-hc2`
– kanał `threshold` jako „zamierzony, strojenie granicy recall, pytanie
projektowe"), `PRODUCT-DECISIONS.md` decyzje 20/21 („nadmiar maskowania
odwracalny, przeciek nie"), `RECALL-90-DESIGN.md` G5/A7/A8,
`src/pipeline/steps/threshold.js`, `src/pipeline/configs/entity-rules.js`,
`src/pipeline/configs/type-tiers.js` (`effectiveTier`).
**Granice sesji:** zero zmian w `src/**`; produktem jest ten plik
(niezacommitowany, bramkuje Opus). Nie renegocjuję B1–B6, ST, HC, OS ani
żadnej bramki.

**Konwencja:** moduł → kontrakt → kryterium akceptacji → test dowodzący →
koszt (S/M/L) → bramka. Decyzje otwarte: **O-MF-n** (§7), ryzyka:
**R-MF-n** (§8).

---

## §0. Teza i granice uczciwości

1. **Mechanizm tak, wartość z pomiaru, wynik negatywny dopuszczalny.**
   Podłoga dla warstwy `mask` jest zgodna z filozofią produktu (koszt FN =
   wyciek > koszt FP = odwracalne nadmaskowanie), więc MECHANIZM budujemy
   (laptop, MF-1). Ale o tym, czy podłoga cokolwiek realnie odzyskuje,
   decyduje POMIAR (PC, MF-3) – i projekt jawnie dopuszcza werdykt
   „kanał na dzisiejszych modelach/korpusach jest pusty, `MASK_FLOOR`
   zostaje wyłączona". Audyt Opusa nazwał to precyzyjnie: to nie jest luka
   strukturalna, tylko strojenie granicy recall.
2. **Pole działania jest wąskie i trzeba to powiedzieć wprost** (§1.2):
   tylko 4 typy warstwy `mask` mają dziś próg bazowy > 0. Dla pozostałych
   ~10 typów mask (próg `DEFAULT_RULE.threshold = 0`) kanał „drop przez
   próg" NIE ISTNIEJE z konstrukcji – podłoga jest tam matematycznym
   no-opem. Oczekiwania kalibruje §1, nie marketing mechanizmu.
3. **Metryka pomiaru to WYCIEK, nie strict.** Istniejący sweep progów
   (recall-b, komentarz A7 w `entity-rules.js:35-55`) zmierzył krzywe
   strict P/R i pokazał płaskość 0,3–0,8 dla PERSON_IDENTIFIER
   i VEHICLE_IDENTIFIER. To NIE przesądza wyniku podłogi: kandydat
   o score 0,45 może być w strict partialem/FP (złe granice), a mimo to
   POKRYWAĆ encję GT i zamykać pełny wyciek. Pomiar MF liczy pokrycie
   znakowe i pełne wycieki wagi ≥ 4 (rodzina metryk G3/eval:h3), obok
   strict – §5.
4. **Aktywacja wyłącznie przy `allMask:false`** – niezmienność all-mask
   bajt w bajt z konstrukcji, ta sama dyscyplina co korekta O-OS-2 w OS
   (cicha zmiana zachowania certyfikowanego produktu tylnymi drzwiami
   jest niedopuszczalna). §2.2 pkt 2.

---

## §1. Stan i pole działania

### 1.1 Mechanika dzisiejsza (fakty z kodu)

`thresholdStep` (`src/pipeline/steps/threshold.js:7-19`):
próg encji = `thresholdBySource[source] ?? (overrides[typ] ?? rules.threshold)`;
encja poniżej progu znika. Krok biegnie na początku postprocessu (przed
snap/dedup/partycją), jest tier-ślepy. Regexy, gazeter, leksykon,
case-allowlist i dosiew emitują score 0,95–1,0 – żaden próg ich nie
dotyka; kanał dotyczy WYŁĄCZNIE kandydatów modelowych.

### 1.2 Gdzie podłoga w ogóle może działać (tabela faktów)

Typy warstwy `mask` z progiem bazowym > 0 (`entity-rules.js`):

| Typ (waga) | Próg bazowy | Pasmo ratowane podłogą F |
|---|---|---|
| PERSON_NAME (4) | 0,50 | [F, 0,50) |
| PERSON_IDENTIFIER (5) | 0,50 | [F, 0,50) |
| VEHICLE_IDENTIFIER (4) | 0,50 | [F, 0,50) |
| POSTAL_ADDRESS (4) | 0,60 | [F, 0,60) |

Wszystkie pozostałe typy mask (EMAIL_ADDRESS, PHONE_NUMBER, DATE_OF_BIRTH,
BANK_ACCOUNT_IDENTIFIER, ORGANIZATION_IDENTIFIER, AUTH_SECRET, PAYMENT_*,
DEVICE/COOKIE/ACCOUNT/CONTACT/IP/GEO, PERSON_ALIAS…) mają próg 0
(`DEFAULT_RULE`/`IDENTIFIER_RULE` bez `threshold`) – kanał pusty
z konstrukcji, podłoga ich nie dotyczy i dokument nie obiecuje tam niczego.

Progi źródłowe (`thresholdBySource`) istniejące dziś: `case-folded` 0,8
(B2, pięć typów), `multilang-fp32` 0,95 dla ORGANIZATION_NAME (pass –
poza tematem); po wejściu OS dojdzie `despaced` 0,8. Te progi są POZA
podłogą (§2.2 pkt 3).

### 1.3 Dowody, że kanał bywał realny – i że bywa pusty

- **Realny (historycznie):** komentarz A7 (`entity-rules.js:36-40`):
  paszport score 0,78 i tablica 0,67 wyciekły W CAŁOŚCI przy dawnych
  progach 0,7. A7 obniżył progi do 0,5 – te przypadki dziś przechodzą.
- **Pusty (na dziś, strict):** recall-b zmierzył pełne krzywe 0,3–0,9
  (artefakt `threshold-sweep.json`, gitignored; skrypty
  `scripts/cache-ner-for-thresholds.mjs` + `measure-thresholds.mjs`):
  PERSON_IDENTIFIER i VEHICLE_IDENTIFIER płaskie w 0,3–0,8 na obu
  korpusach – w paśmie [0,3, 0,5) korpusy nie miały kandydatów GT tych
  typów. Krzywych PERSON_NAME/POSTAL_ADDRESS w tym pomiarze nie
  raportowano jako „ruszających się" – pasmo nieznane.
- **Ostrzeżenie precyzyjne (A8, `source-filter.js:9-20`):** obniżenie
  poprzeczki dla PERSON_NAME z polish-fp16 do 0,9 wpuściło 15 FRAGMENTÓW
  nazwisk, 5 nowych FP, **zero zmiany liczby wycieków**. Lekcja: niskie
  pasmo score dla nazwisk to w dużej mierze fragmenty spanów, które GT
  i tak pokrywa innym kandydatem – odzysk trzeba liczyć per WYCIEK,
  nie per kandydat.

Wniosek kalibrujący: oczekiwany zysk podłogi to pojedyncze encje
z pasma [F, 0,5–0,6) czterech typów – być może zero na dzisiejszych
korpusach. Mierzalne tanio (§5), więc mierzymy zamiast wierzyć.

---

## §2. MF-1 – mechanizm: tier-aware próg z podłogą

### 2.1 Zasada

Dla encji, której **efektywna warstwa to `mask`**, w trybie aktywowanym
(`allMask:false`), efektywny próg bazowy nie może przekroczyć podłogi:
`min(prog_bazowy, MASK_FLOOR)`. Podłoga wyłącznie OBNIŻA poprzeczkę
(bias ku maskowaniu); nigdy jej nie podnosi (`min`), nigdy nie dotyka
warstw `review`/`pass` i nigdy nie działa w all-mask.

### 2.2 Kontrakt

1. **Formuła** (rozszerzenie `thresholdStep`, zero zmian pozostałych
   kroków):
   ```
   źródłowy = rules.thresholdBySource[e.source]        // jak dziś
   bazowy   = overrides[e.entity_group] ?? rules.threshold
   próg     = źródłowy ?? bazowy                        // jak dziś
   JEŻELI floorActive ∧ źródłowy === undefined
          ∧ effectiveTier(e, tierOpts) === 'mask':
       próg = min(próg, MASK_FLOOR)
   ```
   `effectiveTier` z `type-tiers.js` – to samo źródło prawdy co
   dedup/backfill/merge/partycja (respektuje `forceTier` z ST-5:
   allowlistowana sygnatura własna dostaje podłogę; respektuje
   `tierOverrides` radcy). Krok dostaje `tierOpts` z
   `createPostprocessSteps` tym samym przewodem co `bindTierOf`
   (`default.js`) – żadnego drugiego kanału konfiguracji.
2. **Aktywacja: `floorActive ⟺ !allMask ∧ MASK_FLOOR !== null`.**
   Dwa niezależne bezpieczniki:
   - pod `allMask:true` (dzisiejszy produkt) podłoga jest MARTWA
     z konstrukcji – `thresholdStep` bajt w bajt dzisiejszy,
     `tier-partition-invariance.test.js` nietknięty; dokładnie
     dyscyplina O-OS-2 (feature czasu aktywacji, nie zmiana globalna);
   - `MASK_FLOOR` jest daną w `entity-rules.js` (obok progów, jedno
     miejsce prawdy o progach) z wartością startową **`null`
     (wyłączona)** – mechanizm może wejść na main PRZED pomiarem,
     bo bez wartości jest no-opem także w trybie tiered; wartość
     ustawia dopiero werdykt GATE-MF (§6). Mechanizm i wartość są
     rozprzęgnięte także w konfiguracji.
3. **Wyjątek: progi źródłowe (`thresholdBySource`) POZA podłogą.**
   Uzasadnienie trójgłosem zmierzonych decyzji:
   - `case-folded` 0,8 (B2) i `despaced` 0,8 (OS) to poprzeczki
     WIARYGODNOŚCI ŹRÓDŁA (zaburzony kontekst wariantu), zmierzone
     evalem – ścięcie ich podłogą odwracałoby tamte decyzje bez pomiaru;
   - lekcja A8 (§1.3): niskie pasmo wariantowych/nieautorytatywnych
     kandydatów nazwisk to fragmenty – FP bez zysku szczelności;
   - `multilang-fp32` 0,95 dotyczy typu `pass` – poza tematem.
   Ewentualne objęcie źródeł wariantowych podłogą = osobny pomiar,
   O-MF-4 (nie w v1).
4. **Interakcje rozstrzygnięte:**
   - `overrides` (narzędzie sweep A7): podłoga składa się z nimi przez
     `min` jak z progiem z reguł – skrypt pomiarowy może sweepować oba
     wymiary niezależnie;
   - flaga `unauthoritativeSource` (siatka A8): encje z niej mają score
     ≥ 0,95 – podłoga bez wpływu, zero interakcji;
   - encje score 0,95–1,0 (regex/leksykon/gazeter/dosiew): przechodzą
     każdy próg – podłoga ich nie dotyczy (wymóg zlecenia spełniony
     z konstrukcji);
   - kroki za progiem (blocklist/maxLength/merge): encja przepuszczona
     podłogą podlega im normalnie; klasa tier-ślepych dropów jest już
     pod strażnikami `tier-safety.js` (h3-hc2) – podłoga nie otwiera
     nowego kanału, tylko dosyła kandydatów do istniejących, strzeżonych.
5. **Zakres świadomie NIE objęty:** warstwa `review` (koszt FN kosza =
   brak propozycji, nie wyciek – bias ku maskowaniu nie przenosi się
   1:1; O-MF-3); progi = 0 (kanał pusty, §1.2); typy `pass` (nic nie
   maskujemy z definicji).

### 2.3 Kryterium akceptacji (mechanizm)

1. Przy `allMask:false`, `MASK_FLOOR = 0,4`: PERSON_NAME score 0,45
   (źródło modelowe, bez wpisu `thresholdBySource`) PRZEŻYWA próg 0,5;
   ta sama encja z `MASK_FLOOR = null` – dropowana; encja `review`
   (PERSON_ATTRIBUTE 0,45 przy progu 0,6) – dropowana niezależnie od
   podłogi; encja `case-folded` 0,45 – dropowana (wyjątek źródłowy).
2. Przy `allMask:true` (każda wartość `MASK_FLOOR`): wyjście
   `thresholdStep` identyczne z dzisiejszym na dowolnym wejściu –
   test niezmienności + `tier-partition-invariance.test.js` bez zmian.
3. `forceTier:'mask'` poniżej progu typu a powyżej podłogi – przeżywa;
   `tierOverrides` przestawiający typ na `pass` – podłoga nie działa.
4. Property: dla każdej encji i konfiguracji
   `prógEfektywny(floor) ≤ prógEfektywny(null)` – podłoga nigdy nie
   podnosi poprzeczki.

### 2.4 Test dowodzący

Jednostkowe na `thresholdStep` (przypadki 2.3.1–2.3.3), property 2.3.4
(fuzz po score/typach/warstwach/flagach), test spójności configu:
`MASK_FLOOR ∈ (0,1] ∪ {null}` + ostrzegawcza asercja „podłoga poniżej
najniższego progu bazowego typów mask ma sens; powyżej wszystkich =
cichy no-op" (dokumentująca, nie blokująca – R-MF-4).

**Koszt:** S. **Bramka Opusa:** nie osobno (wchodzi w GATE-MF §6).

---

## §3. MF-2 – infrastruktura pomiaru: reuse sweepa A7, nowa metryka

### 3.1 Zasada: jedna inferencja, sweep offline

Wybór wartości NIE wymaga wielu przebiegów z modelami. Infrastruktura
istnieje od recall-b: `scripts/cache-ner-for-thresholds.mjs` (jedna
inferencja per korpus, cache surowych kandydatów NER na dysk,
proces-na-korpus + dispose-per-doc – rozwiązany OOM) i
`scripts/measure-thresholds.mjs` (offline: kandydaci z cache → postproces
→ scoring, pętla po wartościach progu bez dotykania modeli). MF-2
rozszerza TE skrypty, nie buduje nowych:

1. **Wymiar podłogi:** siatka `MASK_FLOOR ∈ {off, 0,45, 0,40, 0,35,
   0,30}` (O-MF-1) × tryb `allMask:false`; baseline = `off` w tym samym
   przebiegu offline (idealna porównywalność – identyczny cache NER).
2. **Ogon tiered w skrypcie offline:** postproces w measure-thresholds
   dostaje `tierOpts` (dokładnie `createPostprocessSteps` z
   `allMask:false`) – kroki są czystymi funkcjami, więc tryb tiered
   liczy się offline tak samo tanio jak all-mask.
3. **Nowe metryki per wartość podłogi (obok strict):**
   - **odzysk wycieków:** liczba encji GT warstwy `mask` wagi ≥ 4,
     które przy `off` są pełnym wyciekiem (pokrycie znakowe 0%),
     a przy F > 0 mają pokrycie > 0 – per typ i per dokument;
   - **nowe FP:** kandydaci przepuszczeni pasmem [F, próg), którzy nie
     pokrywają żadnej encji GT – per typ, plus flaga „fragment"
     (kandydat pokrywający GT częściowo, gdy GT już jest pokryte innym
     kandydatem – dokładnie klasa z lekcji A8);
   - **histogram score:** rozkład score wszystkich dropowanych dziś
     kandydatów mask w paśmie [0,25, 0,60), rozdzielony na
     „pokrywa GT-wyciek / pokrywa GT-już-pokryte / nie pokrywa nic" –
     to jest wykres, z którego czyta się kolano i wartość;
   - delta masek na dokument (ergonomia).
4. **Air-gap i dyscyplina:** artefakty gitignored na PC (jak
   threshold-sweep.json); do repo notatka liczb (wzorzec
   TIERED-RUN-NOTES).

### 3.2 Kryterium akceptacji / test

Golden skryptu na spreparowanym mini-cache (3 dokumenty, po jednym
przypadku: odzysk realny / fragment / czysty FP) daje dokładnie
przewidziane liczniki trzech koszyków histogramu; tryb `off` reprodukuje
liczby dzisiejszego measure-thresholds na tym samym cache (dowód, że
rozszerzenie nie zepsuło starego wymiaru).

**Koszt:** S–M (rozszerzenie dwóch istniejących skryptów + golden).
**Bramka Opusa:** nie osobno.

---

## §4. Podział laptop-safe vs PC-gated

**Laptop („buduj teraz, test-first"):** MF-1 w całości (mechanizm +
testy 2.3/2.4); MF-2 w całości jako KOD (rozszerzenia skryptów + golden
na fixture-cache – zero modeli); `npm test` zielony.

**PC („czeka na pomiar"):** jedna inferencja cache-NER per korpus
(proces-na-korpus, dyscyplina maszyny), sweep offline na cache (minuty),
histogram, wybór wartości; przebieg walidacyjny holdout (§5.2); liczby
bramkowe. Laptop NIE liczy sweepa, bo cache NER (artefakt gitignored)
żyje na PC – przenoszenie artefaktów między maszynami poza dyscypliną.

---

## §5. MF-3 – plan pomiaru i kryterium wyboru wartości

### 5.1 Korekta metodologiczna względem zlecenia (jawna)

Zlecenie proponuje „sweep na holdout". To łamałoby dyscyplinę holdoutu
z RECALL-90 (§3.1/G8: holdout wyłącznie na bramkach; strojenie na dev) –
wybór wartości podłogi JEST strojeniem. Plan:
**sweep i wybór wartości na dev 38** (+ syntetyczny dla podłóg G5),
**holdout 206 tylko walidacyjnie** dla wartości wybranej i `off`
(dwa punkty, nie siatka), na bramce. Dokładnie ta sama korekta, którą
przyjęto w H-3 (dev do strojenia, holdout do werdyktu).

### 5.2 Sekwencja

1. PC: `cache-ner-for-thresholds` na dev 38 i syntetycznym (jeżeli
   cache z recall-b jest aktualny co do wersji pipeline'u – reuse;
   stempel wersji rozstrzyga, nie pamięć).
2. PC: sweep offline (siatka §3.1 pkt 1) → tabela metryk + histogram.
3. Wybór wartości wg 5.3; jeżeli odzysk = 0 dla każdego F – werdykt
   negatywny (5.4).
4. PC: walidacja holdout 206 (7 porcji, dyscyplina TIERED-RUN-NOTES),
   profile `off` i F\*, tryb tiered; metryki: W1 strict, pokrycie,
   pełne wycieki w≥4, rodzina eval:h3 (po wejściu HC-0 – jeżeli
   `eval:h3` jeszcze nie istnieje, liczniki pokrycia z measure-MF
   wystarczają bramce, zależność miękka).
5. Notatka liczb do repo; GATE-MF.

### 5.3 Kryterium wyboru F\* (zamknięte, mierzalne)

1. **Cel:** maksymalny **odzysk wycieków** (§3.1 pkt 3) na dev.
2. **Więzy (wszystkie naraz):**
   - syntetyczny W1 P ≥ 85% (podłoga G5), dev: spadek P W1 ≤ 2 p.p.
     względem `off`;
   - nowe FP klasy „fragment" ≈ 0 (lekcja A8: fragmenty nie zamykają
     wycieków, a psują precyzję – histogram musi pokazać, że pasmo
     ratowane to NIE fragmenty);
   - delta masek/dok. raportowana (ergonomia; bez progu twardego w v1).
3. **Kolano:** spośród wartości spełniających więzy wybierz NAJWYŻSZĄ,
   która osiąga ≥ 90% maksymalnego odzysku (minimalna ingerencja o tym
   samym skutku szczelności).
4. **Walidacja holdout:** przy F\*: pełne wycieki w≥4 nie rosną, W1 R
   nie spada, P ≥ 70% (G5). Rozjazd dev↔holdout = wpis do raportu
   i decyzja w bramce, nie ciche przyjęcie.

### 5.4 Wynik negatywny jest wynikiem

Jeżeli sweep pokaże odzysk 0 (lub wyłącznie fragmenty) dla każdego F:
`MASK_FLOOR` zostaje `null`, mechanizm zostaje w kodzie (uzbrojony,
zerokosztowy), a raport bramki dokumentuje: „kanał threshold na
dzisiejszych modelach/korpusach pusty w paśmie [0,30, 0,60); re-pomiar
przy zmianie modeli, dtype (fp16/q8) albo progów". To zamyka pytanie
z audytu §6 równie mocno, jak wdrożenie wartości – liczbami, nie opinią.

---

## §6. GATE-MF – bramka Opusa (werdykt przed merge i przed ustawieniem wartości)

| # | Przedmiot | Pytanie bramkowe |
|---|---|---|
| GM-1 | niezmienność | all-mask bajt w bajt: test 2.3.2 + `tier-partition-invariance.test.js` nietknięty + (w pomiarze PC) byte-diff profilu all-mask na korpusach; `MASK_FLOOR=null` = no-op także w tiered |
| GM-2 | mechanizm | wyjątek źródłowy (2.2 pkt 3) poprawny; `effectiveTier` jako jedyne źródło warstwy (forceTier/tierOverrides – testy 2.3.3); property 2.3.4; brak interakcji z A8 |
| GM-3 | dyscyplina pomiaru | sweep na dev, holdout tylko walidacyjnie (5.1); cache stemplowany wersją pipeline'u; artefakty poza gitem, notatka liczb w repo |
| GM-4 | wybór wartości | histogram trzech koszyków przedstawiony; F\* wg 5.3 ALBO jawny werdykt negatywny wg 5.4 – oba wyniki są zieloną bramką, „brak liczb" nie jest |
| GM-5 | domknięcie audytu | wpis do `PRODUCT-DECISIONS.md` + aktualizacja `POSTPROCESS-LEAK-AUDIT.md` §6/§8: kanał threshold = „domknięty podłogą F\*" albo „zmierzony pusty, mechanizm uzbrojony" |

**Koszt bramki:** S. **Bramka Opusa: TAK (GATE-MF).**

---

## §7. Rejestr decyzji otwartych

| Nr | Decyzja | Rekomendacja | Status |
|---|---|---|---|
| O-MF-1 | siatka sweep | {off, 0,45, 0,40, 0,35, 0,30}; poniżej 0,30 nie schodzimy bez osobnej zgody (szum modelu) | rekomendacja |
| O-MF-2 | podłoga globalna vs per-waga (w5 niżej niż w4) | v1: JEDNA globalna stała (prostota kontraktu i pomiaru); per-waga tylko jeżeli histogram pokaże wyraźnie różne kolana per typ | rekomendacja |
| O-MF-3 | czy podłoga obejmuje warstwę `review` | NIE w v1 (FN kosza ≠ wyciek; kosz nie ma jeszcze pomiaru szumu z realnego użycia) | rekomendacja |
| O-MF-4 | czy podłoga kiedyś obejmie progi źródłowe (case-folded/despaced) | NIE w v1 (odwracałaby zmierzone decyzje B2/OS); ewentualny osobny sweep po wdrożeniu OS | rekomendacja |
| O-MF-5 | los przy wyniku negatywnym | `MASK_FLOOR=null` zostaje w kodzie (mechanizm uzbrojony), wpis do rejestru, re-pomiar przy zmianie modeli/dtype | rekomendacja |
| O-MF-6 | kiedy mechanizm wchodzi na main | może wejść PRZED pomiarem (null = no-op wszędzie, testy niezmienności zielone) – ale wartość F\* ustawia wyłącznie werdykt GATE-MF | rekomendacja |

## §8. Ryzyka

| Nr | Ryzyko | Mitygacja |
|---|---|---|
| R-MF-1 | pasmo niskich score dla nazwisk to fragmenty → FP bez zysku szczelności (zmierzone w A8) | histogram trzech koszyków PRZED wyborem; więz „fragmenty ≈ 0" w 5.3; werdykt negatywny 5.4 jako pełnoprawny wynik |
| R-MF-2 | skażenie strojeniem (wartość dobrana pod holdout) | sweep wyłącznie na dev (5.1); holdout dwa punkty na bramce |
| R-MF-3 | fałszywy komfort „podłoga = koniec wycieków przez próg" | podłoga ratuje TYLKO pasmo [F, próg) czterech typów; poniżej F i przy progu 0 kanał wygląda inaczej (odpowiednio: dalej drop / brak kanału); tabela §1.2 w raporcie bramki |
| R-MF-4 | dryf configu: F ustawione ≥ progów typów = cichy no-op udający ochronę | asercja dokumentująca w teście spójności (2.4); raport sweep drukuje realne pasmo działania |
| R-MF-5 | interakcja z przyszłymi źródłami (OS `despaced`) | wyjątek źródłowy 2.2 pkt 3 – progi źródłowe nietknięte; nowe źródło o score 1,0 (regexy HC-2) niedotknięte z konstrukcji |
| R-MF-6 | koszt ergonomii (więcej masek niskiej pewności) | delta masek/dok. w metrykach; nadmiar odwracalny w edytorze anotacji (istniejący przepływ usuń/zmień); bez progu twardego w v1, obserwacja jak O-ST-6 |

## §9. Sekwencja i koszty

| Krok | Co | Koszt | Zależy od | Bramka |
|---|---|---|---|---|
| MF-1 | mechanizm + testy (laptop) | S | – | nie |
| MF-2 | rozszerzenie skryptów sweep + golden (laptop) | S–M | MF-1 | nie |
| MF-3 | cache NER + sweep + wybór + walidacja holdout (PC) | S proceduralny + noc PC | MF-2; miękko HC-0 (eval:h3) | nie |
| GATE-MF | werdykt GM-1…GM-5 + wpisy | S | MF-3 | **TAK** |

Względem reszty frontu aktywacji: MF jest NIEZALEŻNE plikowo od
feature/h3-hc2 (HC dotyka regexów i lintów, MF dotyka thresholdStep
+ skryptów) i od OS (E1); jedyny wspólny mianownik to `tierOpts`
z `createPostprocessSteps` (przewód już istnieje). Pomiar MF-3 można
skleić z nocą pomiarową GH-4/GATE-OS w jeden pakiet PC (te same porcje,
te same korpusy) – rekomendowane, jedna noc zamiast trzech.

---

*Koniec projektu. Następne kroki: (1) decyzje O-MF-1…6 Alana (wszystkie
mają rekomendacje; żadna nie blokuje MF-1); (2) Sonnet: MF-1+MF-2
test-first na laptopie; (3) pomiar MF-3 na PC (rekomendacja: wspólna noc
z GH-4/GATE-OS); (4) GATE-MF. Dokument nie zmienia żadnego kontraktu
B1–B6, ST, HC, OS ani strażników tier-safety; kanał `sourceFilter`
(drugi „zamierzony" z audytu §7) pozostaje osobnym tematem konfiguracji
domyślnej, nie progów.*
