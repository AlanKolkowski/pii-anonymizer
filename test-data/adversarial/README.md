# Korpus kontradyktoryjny (test-data/adversarial)

Wygenerowany deterministycznie przez `scripts/generate-adversarial-corpus.mjs`
(uruchomienie odtwarza pliki co do bajtu). **Wszystkie dane są w 100% fikcyjne**:
osoby, adresy, spółki i sygnatury nie istnieją, a PESEL/NIP/REGON/IBAN mają
poprawne sumy kontrolne, ale nie należą do nikogo.

Cel: korpus ATAKUJE sito detekcji, zamiast je potwierdzać. Każdy dokument
łamie jeden konkretny mechanizm (kolumna „wektor ataku”). Offsety w
`*.expected.json` to jednostki UTF-16 względem tekstu z końcami linii LF —
tak samo jak w `test-data/synthetic` (strażnik: `src/eval/ground-truth.test.js`).

Uruchomienie ewaluacji na tym korpusie:

```bash
npm run eval -- --dir=test-data/adversarial --label=<slug>
npm run eval:score
```

## Polityka anotacji

Zgodna z korpusem syntetycznym (szczegóły i uzasadnienie:
EVAL-RECALL-AUDIT.md):

- sądy, ZUS, banki, spółki → `ORGANIZATION_NAME` (waga „instytucja publiczna
  vs dane klienta” jest nadawana dopiero w rejestrze przecieków, nie w GT);
- sygnatury WŁASNYCH spraw i numery dokumentów → `DOCUMENT_REFERENCE`;
  cytowania publikowanego orzecznictwa i przepisów (art., Dz.U., sygnatury
  uchwał) NIE są anotowane — to pułapki na fałszywe pozytywy;
- wynagrodzenia → `FINANCIAL_AMOUNT` (precedens: pismo_05);
- pełny blok adresowy = jeden `POSTAL_ADDRESS`; samodzielna miejscowość =
  `LOCATION`; encje zagnieżdżone w większym spanie nie są anotowane osobno;
- role generyczne (powód, pozwany) nieanotowane; konkretne tytuły
  (adw., r. pr., Prezes Zarządu) → `PERSON_ROLE_OR_TITLE`;
- PII zniekształcone przez OCR jest anotowane swoim prawdziwym typem:
  sito ma chronić tajemnicę zawodową, a człowiek zniekształcony numer
  nadal odczyta.

## Dokumenty (38, 273 encji oczekiwanych)

| Dokument | Encje | Wektor ataku |
|---|---|---|
| `adw_01_nazwisko_dopelniacz` | 5 | Jednowyrazowe nazwisko odmienione przez przypadki: fuzzyBackfill żąda co najmniej dwóch słów wielką literą, więc pojedyncze „Żurawskiego” nie zostanie dosiane z rescanu. |
| `adw_02_apozycja_rol` | 4 | Imię i nazwisko wyłącznie w apozycji do roli procesowej („pozwanemu Bartłomiejowi Czyżowi”): model zjada granicę rola–nazwisko, a odmieniona forma nie wraca do formy bazowej. |
| `adw_03_nazwisko_dywiz` | 7 | Nazwiska dwuczłonowe z dywizem w kilku przypadkach: „-” jest w klasie granic słowa snapu, więc dosunięcie do granic nie przejdzie przez dywiz, a model tnie człony na łączniku. |
| `adw_04_nazwisko_nieodmienne` | 6 | Żeńskie nazwiska nieodmienne (Wilk, Kos): odmienia się tylko imię, więc heurystyka wspólnego rdzenia i normalizacja nazw łatwo rozjeżdżają wystąpienia tej samej osoby. |
| `adw_05_nazwisko_pospolite` | 10 | Nazwiska będące wyrazami pospolitymi (Kowal, Zamek, Lis, Sad, Baran), także na początku zdania: dezambiguacja rzeczownik/nazwisko to najsłabszy punkt NER poza kontekstem roli. |
| `adw_06_inicjaly` | 8 | Inicjały i skróty („K. Żurawski”, „adw. J. M.”, parafka „M.K.”): znany przeciek z docs/RESULTS-ensemble-experiment.md, inicjał nie skleja się z nazwiskiem w jedną encję. |
| `adw_07_wolacz_cudzyslow` | 6 | Wołacz i nazwiska wewnątrz cytowanej wypowiedzi świadka: przypadki rzadkie w danych treningowych NER, cudzysłowy typograficzne przy granicach encji. |
| `adw_08_lista_swiadkow` | 11 | Wyliczenie świadków w punktach z pełnymi danymi w jednej linii: segmentacja list, adres i PESEL sklejone w pozycji wyliczenia. |
| `adw_09_pesel_formaty` | 5 | PESEL sklejony z etykietą, rozdzielony spacjami i przełamany wierszem: regex \b\d{11}\b znosi wyłącznie zapis ciągły. |
| `adw_10_nip_formaty` | 7 | NIP w grupowaniu 3-2-2-3 i w formacie VAT UE: regex zna wyłącznie grupowanie 3-3-2-2, pozostałe warianty widzi tylko model. |
| `adw_11_regon_krs` | 6 | REGON 9- i 14-cyfrowy oraz KRS: żaden nie ma własnego wzorca regex, wykrycie zależy w całości od modelu. |
| `adw_12_iban_lamany` | 4 | NRB bez prefiksu PL, IBAN z dywizami i IBAN przełamany wierszem: regex rachunku wymaga literału „PL” i dopuszcza wyłącznie spacje między grupami. |
| `adw_13_telefony` | 5 | Telefon stacjonarny z numerem kierunkowym w nawiasie, siedmiocyfrowy numer lokalny i zapis z zerem wiodącym: oba wzorce regex wymagają 11–12 cyfr bez nawiasów. |
| `adw_14_dokumenty_tozsamosci` | 5 | Numery dowodu osobistego, paszportu i prawa jazdy: identyfikatory osobiste bez dedykowanego wzorca regex, wykrywalne wyłącznie modelem. |
| `adw_15_kwoty_formaty` | 6 | Kwoty z kropką tysięcy, bez groszy, w EUR i z walutą przed liczbą: regex kwot wymaga przecinka, groszy i literału „zł” po liczbie. |
| `adw_16_kwoty_slownie` | 4 | Kwoty wyrażone wyłącznie słownie oraz w nawiasie po zapisie cyfrowym: warstwa regex ich nie widzi, a model tnie długie frazy liczebnikowe. |
| `adw_17_wynagrodzenie` | 4 | Kwoty w kontekście płacowym (brutto, netto, stawka godzinowa): taksonomia modelu zna INCOME_COMPENSATION, a ground truth korpusu używa FINANCIAL_AMOUNT — pomyłka typu kosztuje podwójnie (FP+FN). |
| `adw_18_naglowek_pisma` | 9 | Blok nadawcy i adresata w nagłówku pisma procesowego: krótkie linie bez czasowników wypadają z kontekstu zdaniowego, na którym trenowano model. |
| `adw_19_tabela_ascii` | 9 | Dane osobowe w tabeli tekstowej z separatorami pionowymi: kreski sklejają się z wartościami i psują granice słów oraz segmentację zdań. |
| `adw_20_adres_lamany` | 3 | Adres przełamany w środku nazwy ulicy (z dywizem przeniesienia) oraz kod pocztowy oddzielony od miejscowości końcem wiersza: scalanie adjacentnych encji ma lukę na granicy wiersza. |
| `adw_21_stopka_gesta` | 9 | Stopka kancelaryjna: wiele typów PII w jednej linii rozdzielonych kreskami pionowymi, bez zdań — kumulacja granic słów nieznanych snapowi. |
| `adw_22_koperta` | 2 | Sam blok adresowy jak na kopercie, bez żadnego kontekstu zdaniowego: NER musi rozpoznać osobę i adres z samego układu wierszy. |
| `adw_23_ocr_podmiany` | 5 | Podmiany glifów OCR (l↔1, O↔0) wewnątrz PESEL, NIP i rachunku: regexy cyfrowe wypadają całkowicie, a model widzi „słowa” zamiast liczb. |
| `adw_24_ocr_rozstrzelone` | 5 | Rozstrzelone litery (spacja po każdym znaku) w nazwisku i numerze PESEL: tokenizacja subword rozpada się na pojedyncze znaki bez sygnału encji. |
| `adw_25_ocr_sklejone` | 5 | Sklejone słowa bez spacji (imię z nazwiskiem, przyimek z miejscowością, ulica z numerem): granice słów znikają, snap nie ma czego dosunąć. |
| `adw_26_ocr_przenoszenie` | 4 | Przeniesienie wyrazu z dywizem na końcu wiersza w środku nazwiska i kwoty: encja rozcięta twardym łamaniem, którego żadna warstwa nie skleja. |
| `adw_27_pozew` | 33 | Kompletny pozew o zapłatę: kumulacja wszystkich mechanizmów naraz w długim dokumencie — chunking segmentów, powtórzenia encji, odmiana w uzasadnieniu i gęste dane w komparycji. |
| `adw_28_odpowiedz_na_pozew` | 12 | Odpowiedź na pozew z odmianą nazwisk stron w narracji i odesłaniami do sygnatury: nazwisko pojawia się niemal wyłącznie w przypadkach zależnych. |
| `adw_29_umowa_kredytu` | 14 | Fragment umowy kredytu: wysoka gęstość liczb, z których tylko część to PII — oprocentowanie i marża kuszą model do fałszywych kwot, a dane kredytobiorcy giną w szumie liczbowym. |
| `adw_30_protokol` | 16 | Protokół rozprawy: dane świadków podawane w toku narracji (wiek, zawód, adres w jednym zdaniu), atrybuty osobowe obok nazwisk. |
| `adw_31_komornik` | 14 | Zawiadomienie komornicze: identyfikator pojazdu (rejestracja i VIN) oraz sygnatura KM — typy rzadkie, bez wzorca regex, w gęstym piśmie egzekucyjnym. |
| `adw_32_pulapki_prawne` | 1 | Pułapka na fałszywe pozytywy: cytowania przepisów, pozycje Dz.U. i sygnatury publikowanego orzecznictwa NIE są danymi osobowymi klienta i nie wolno ich maskować. |
| `adw_33_pulapki_nazwy` | 4 | Pułapka na fałszywe pozytywy: rzeka, hotel, nazwa ulicy pochodząca od nazwiska i rzeczowniki pospolite wielką literą na początku zdania nie są osobami. |
| `adw_34_role_generyczne` | 0 | Pułapka na fałszywe pozytywy: tekst wyłącznie z rolami procesowymi bez żadnego nazwiska — każde oznaczenie roli jako osoby to czysty fałszywy alarm. |
| `adw_35_email_nietypowe` | 4 | Adresy e-mail z plus-tagiem, wielkimi literami, kropką zdaniową tuż za adresem i obfuskacją „(at)”: wzorzec e-mail działa, ale granice i obfuskacja go wyprowadzają. |
| `adw_36_daty_urodzenia` | 7 | Data urodzenia w formatach cyfrowych (7.03.1985, 1985-03-07) obok zwykłych dat czynności: DATE_OF_BIRTH wymaga rozumienia kontekstu „ur.”, inne daty to pułapka FP. |
| `adw_37_sygnatury_formaty` | 8 | Sygnatury własnych spraw w różnych repertoriach (C, GC upr, K, Ns, KM): każda ma inny układ, a żadna nie ma wzorca regex — wykrycie zależy od modelu. |
| `adw_38_kategorie_szczegolne` | 6 | Dane szczególnych kategorii (zdrowie, karalność, związki zawodowe) w jednym piśmie: najcięższe wagowo dla tajemnicy zawodowej, wykrywane wyłącznie modelem. |
