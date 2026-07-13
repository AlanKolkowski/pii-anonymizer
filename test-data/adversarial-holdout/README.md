# Korpus sprawdzianowy (test-data/adversarial-holdout)

Wygenerowany deterministycznie przez `scripts/generate-adversarial-corpus.mjs --pool=holdout`
(`scripts/corpus/holdout-templates.mjs` + `holdout-people.mjs` + `holdout-pools.mjs`,
uruchomienie odtwarza pliki co do bajtu). **Wszystkie dane są w 100% fikcyjne**
(RECALL-90-DESIGN.md §3.4 pkt 4): osoby, adresy, spółki i sygnatury nie
istnieją; PESEL/NIP/REGON/IBAN mają poprawne sumy kontrolne, ale nie należą
do nikogo.

## Czym różni się od test-data/adversarial (dev)

`test-data/adversarial/` jest korpusem **strojeniowym** — na nim kalibrowane
były progi (A7), leksykony (B3/B4) i wzorce planu A. Wynik zmierzony na
korpusie, którym stroniono, jest optymistycznie obciążony w sposób
niemierzalny (RECALL-90-DESIGN.md §3.1). Ten katalog jest **sprawdzianem**:
rozłączne przestrzenie wartości (nazwiska, PESEL-e, numery IBAN — żadna
wartość identyfikująca z dev nie występuje tutaj, strażnik:
`scripts/corpus/holdout-disjointness.test.js`) ORAZ rozłączne szablony
dokumentów (nowe kształty zdań/dokumentów w `holdout-templates.mjs`, nie
tylko nowe nazwiska wstawione w stare zdania dev) — inaczej sprawdzian
mierzyłby pamięć szablonów, nie generalizację.

## Polityka zamrożenia (RECALL-90-DESIGN.md §3.2 — WIĄŻĄCE)

1. **Ten katalog jest zamrożony natychmiast po wygenerowaniu.** Żadna zmiana
   ręczna w `*.txt`/`*.expected.json` — jedyny legalny sposób modyfikacji to
   ponowne uruchomienie generatora (co przy tym samym kodzie i manifeście
   daje bajtowo identyczny wynik) albo świadoma regeneracja wg pkt 3 poniżej.
2. **Dziennik pomiarów jest obowiązkowy.** Każdy przebieg `npm run eval` na
   tym katalogu (`--dir=test-data/adversarial-holdout`) ma być odnotowany
   (data, run ID, cel pomiaru, wynik) w raporcie bramki GATE-RECALL-90 albo w
   notatce sesji, która go wykonała — warunek G8 bramki (RECALL-90-DESIGN.md
   §4.2). Pomiar bramkowy ma być 1.–2. pomiarem tego katalogu w historii.
3. **Skażenie = obowiązkowa regeneracja z NOWYM seedem.** Jeżeli ktokolwiek
   zacznie naprawiać moduły detekcji „pod holdout" (dopisując wzorzec, próg
   albo leksykon w reakcji na konkretny przypadek z TEGO katalogu), korpus
   przestaje być sprawdzianem. Wtedy: (a) odnotować incydent w notatce sesji,
   (b) zmienić namespace seedów w `holdout-templates.mjs` (np.
   `holdout/odmiana/` → `holdout/odmiana-v2/`) tak, aby wszystkie wartości i
   kombinacje szablonów wypadły inaczej, (c) ponownie uruchomić generator,
   (d) zacząć dziennik pomiarów od nowa. Ten akapit istnieje, żeby przyszłe
   sesje nie odtwarzały tej polityki z pamięci ani jej nie pomijały.
4. **Podzbiór holdout-human jest osobnym, ręcznym zadaniem** (5–10 dokumentów
   pisanych ręcznie, wzorowanych na realnej praktyce, anotowanych przez inną
   osobę/sesję niż autor dokumentu) — RECALL-90-DESIGN.md §3.2. Generator NIE
   go tworzy; to świadomie odłożone follow-up dla Alana (CORPUS-2.0-NOTES.md).

## Delty polityki anotacji względem test-data/adversarial (§3.5)

Dziedziczy politykę dev w całości (patrz `test-data/adversarial/README.md`),
z trzema doprecyzowaniami rozstrzygniętymi PRZED generacją tego katalogu:

1. **Taksonomia wynagrodzeń (decyzja Alana R0a, PRODUCT-DECISIONS.md):**
   klasa ekwiwalencji `{FINANCIAL_AMOUNT, INCOME_COMPENSATION}` w scoringu —
   scoring ma raportować OBIE liczby (ścisłą i po ekwiwalencji), bramka liczy
   po ekwiwalencji. Ten korpus anotuje wynagrodzenia jako `FINANCIAL_AMOUNT`
   (ten sam precedens co dev), więc deklaracja klasy ekwiwalencji jest
   obowiązkiem konfiguracji scoringu, nie generatora.
2. **Frazy opisowe art. 9–10:** anotowany span to minimalna fraza niosąca
   fakt szczególny (kotwica + dopełnienie), NIE całe zdanie, i napisana z
   definicji faktu — NIGDY „pod wzorce B3". Rozbieżność GT↔B3 jest sygnałem
   do poprawy B3, nigdy do przepisania GT.
3. **Diakrytyki:** wystąpienie zdegradowane (klasa `ocr:diacritics`,
   `scripts/corpus/diacritics.mjs`) anotowane prawdziwym typem i pełnym
   spanem — spójnie z istniejącą polityką OCR.

## Manifest kwot

`scripts/corpus/holdout-manifest.json` (RECALL-90-DESIGN.md §3.3). Generator
odmawia zapisu, jeżeli którakolwiek kwota (byType/identifierSubtypes/
ocrClasses/targetTotalEntities) nie jest osiągnięta — kwota jest kontraktem
egzekwowanym w kodzie (`checkHoldoutQuota` w tym pliku), nie deklaracją.

Uruchomienie ewaluacji na tym korpusie:

```bash
npm run eval -- --dir=test-data/adversarial-holdout --label=<slug>
npm run eval:score
```

## Dokumenty (206, 1685 encji oczekiwanych)

| Dokument | Encje | Wektor ataku |
|---|---|---|
| `hold_odmiana_00` | 9 | Odmiana nazwiska "Zieliński" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_01` | 9 | Odmiana nazwiska "Szymański" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_02` | 9 | Odmiana nazwiska "Kamiński" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_03` | 9 | Odmiana nazwiska "Lewandowski" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_04` | 9 | Odmiana nazwiska "Jankowski" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_05` | 9 | Odmiana nazwiska "Piotrowski" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_06` | 9 | Odmiana nazwiska "Pawłowski" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_07` | 9 | Odmiana nazwiska "Michalski" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_08` | 9 | Odmiana nazwiska "Wróblewska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_09` | 9 | Odmiana nazwiska "Zalewska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_10` | 9 | Odmiana nazwiska "Górska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_11` | 9 | Odmiana nazwiska "Witkowska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_12` | 9 | Odmiana nazwiska "Głowacka" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_13` | 9 | Odmiana nazwiska "Kwaśniewska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_14` | 9 | Odmiana nazwiska "Sobolewska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_odmiana_15` | 9 | Odmiana nazwiska "Wojnowska" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values. |
| `hold_dwuczlonowe_00` | 8 | Nazwisko dwuczłonowe "Grzymała-Siedlecki" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_01` | 8 | Nazwisko dwuczłonowe "Nałęcz-Korzeniewski" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_02` | 8 | Nazwisko dwuczłonowe "Jastrzębiec-Wolski" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_03` | 8 | Nazwisko dwuczłonowe "Radwan-Zdrojewski" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_04` | 8 | Nazwisko dwuczłonowe "Łada-Podgórski" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_05` | 8 | Nazwisko dwuczłonowe "Korwin-Siedlecka" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_06` | 8 | Nazwisko dwuczłonowe "Bończa-Korzeniewska" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_07` | 8 | Nazwisko dwuczłonowe "Pomian-Wolska" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_08` | 8 | Nazwisko dwuczłonowe "Junosza-Zdrojewska" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_dwuczlonowe_09` | 8 | Nazwisko dwuczłonowe "Rawicz-Podgórska" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template. |
| `hold_inicjaly_00` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_01` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_02` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_03` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_04` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_05` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_06` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_07` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_08` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_inicjaly_09` | 13 | Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values. |
| `hold_pospolite_00` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_pospolite_01` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_pospolite_02` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_pospolite_03` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_pospolite_04` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_pospolite_05` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_pospolite_06` | 10 | Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames. |
| `hold_identyfikatory_00` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_01` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_02` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_03` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_04` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_05` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_06` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_07` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_08` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_09` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_10` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_11` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_12` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_13` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_14` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_identyfikatory_15` | 13 | Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne. |
| `hold_ocr_mega_00` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_01` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_02` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_03` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_04` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_05` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_06` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_07` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_08` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_09` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_10` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_11` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_12` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_13` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_14` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_15` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_16` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_17` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_18` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_19` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_ocr_mega_20` | 6 | Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values. |
| `hold_diakrytyki_00` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Kamiński") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_01` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Zalewska") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_02` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Kwaśniewska") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_03` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Kamiński") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_04` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Wróblewska") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_05` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Kamiński") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_06` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Sobolewska") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_07` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Michalski") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_08` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Pawłowski") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_09` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Zalewska") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_10` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Michalski") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_diakrytyki_11` | 5 | Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("Zieliński") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5). |
| `hold_finanse_umowa_00` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_01` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_02` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_03` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_04` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_05` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_06` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_umowa_07` | 12 | Formaty kwot (umowa) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_00` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_01` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_02` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_03` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_04` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_05` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_06` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_07` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_finanse_wezwanie_08` | 8 | Formaty kwot (wezwanie) — mirrors adw_15-17/29 on new values. |
| `hold_adres_org_00` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_01` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_02` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_03` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_04` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_05` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_06` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_07` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_08` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_09` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_10` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_11` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_12` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_13` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_14` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_adres_org_15` | 9 | Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values. |
| `hold_art910_health_00` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_01` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_02` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_03` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_04` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_05` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_06` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_07` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_08` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_health_09` | 5 | Frazy opisowe art. 9-10 RODO (health) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_00` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_01` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_02` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_03` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_04` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_05` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_06` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_07` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_08` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_09` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_criminal_10` | 5 | Frazy opisowe art. 9-10 RODO (criminal) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_00` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_01` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_02` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_03` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_04` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_05` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_06` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_07` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_union_08` | 4 | Frazy opisowe art. 9-10 RODO (union) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_pozostale_00` | 6 | Frazy opisowe art. 9-10 RODO (pozostale) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_pozostale_01` | 6 | Frazy opisowe art. 9-10 RODO (pozostale) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_pozostale_02` | 6 | Frazy opisowe art. 9-10 RODO (pozostale) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_pozostale_03` | 6 | Frazy opisowe art. 9-10 RODO (pozostale) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_art910_pozostale_04` | 6 | Frazy opisowe art. 9-10 RODO (pozostale) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2). |
| `hold_dane_osobowe_00` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_01` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_02` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_03` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_04` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_05` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_06` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_07` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_08` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_09` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_10` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_11` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_12` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_13` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_14` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_15` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_16` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_dane_osobowe_17` | 8 | Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values. |
| `hold_zlozony_00` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_01` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_02` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_03` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_04` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_05` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_06` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_zlozony_07` | 29 | Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia. |
| `hold_pulapka_cytowania_00` | 0 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_01` | 0 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_02` | 0 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_03` | 0 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_04` | 1 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_05` | 0 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_06` | 1 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_cytowania_07` | 0 | Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna. |
| `hold_pulapka_nazwy_00` | 1 | Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33. |
| `hold_pulapka_nazwy_01` | 1 | Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33. |
| `hold_pulapka_nazwy_02` | 1 | Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33. |
| `hold_pulapka_nazwy_03` | 1 | Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33. |
| `hold_pulapka_nazwy_04` | 1 | Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33. |
| `hold_pulapka_nazwy_05` | 1 | Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33. |
| `hold_pulapka_role_00` | 0 | Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP. |
| `hold_pulapka_role_01` | 0 | Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP. |
| `hold_pulapka_role_02` | 0 | Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP. |
| `hold_pulapka_role_03` | 0 | Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP. |
| `hold_pulapka_role_04` | 0 | Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP. |
| `hold_pulapka_role_05` | 0 | Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP. |
