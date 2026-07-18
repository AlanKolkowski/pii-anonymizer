# ZAKRES ANONIMIZACJI – model trzech warstw

**Wersja:** 0.2 (kierunek zatwierdzony przez Alana, wiersze sporne rozstrzygnięte)
**Data:** 2026-07-14
**Autor:** Claudia (na podstawie pomiaru holdout 206 dok. + analizy prawnej Alana)
**Status:** kierunek trójwarstwowy ZATWIERDZONY. Ten dokument nie zmienia kodu. Jest
podstawą do (a) projektu Fable (`SCOPE-TIERS-DESIGN.md`), (b) rekalibracji benchmarku,
(c) delty polityki anotacji korpusu 2.0.

**Decyzje Alana 2026-07-14:** kierunek trójwarstwowy przyjęty; wiersze sporne
rozstrzygnięte: DATE_OF_BIRTH → **W1**, ORGANIZATION_IDENTIFIER → **W1**.

---

## §1. Zasada nadrzędna (art. 4 pkt 1 RODO)

Dana osobowa to informacja o **zidentyfikowanej lub możliwej do zidentyfikowania**
osobie fizycznej. Kategorie szczególne (art. 9) i dane karne (art. 10) są
**podzbiorem** danych osobowych: jeśli informacja nie odnosi się do możliwej do
zidentyfikowania osoby, art. 9-10 **w ogóle się nie uruchamia**.

Konsekwencja: „skazany za kradzież z włamaniem", „leczy się z powodu nadciśnienia",
„prezes zarządu", „adwokat", „lat 37", sygnatura cytowanego wyroku – **samodzielnie
nie identyfikują nikogo**. Stają się danymi osobowymi (i ryzykiem tajemnicy) dopiero
w połączeniu z imieniem, nazwiskiem, pseudonimem albo inną daną identyfikującą.

Dotychczasowy benchmark (76%) mierzył zgodność z taksonomią modelu upstream
(bardsai/eu-pii), która jest **szersza** niż prawna definicja i szersza niż misja
narzędzia. Stąd pozorna słabość: karano nas za niemaskowanie rzeczy, które nie są
danymi osobowymi.

---

## §2. Trzy warstwy

- **Warstwa 1 – MASKUJ AUTOMATYCZNIE (rdzeń danych osobowych).**
  Identyfikuje osobę bezpośrednio albo jest twardym, unikalnym identyfikatorem.
  To jest właściwy benchmark. **Cel: recall ≥ 95%.**

- **Warstwa 2 – DO DECYZJI UŻYTKOWNIKA (dane nieidentyfikujące samodzielnie).**
  Wrażliwe lub quasi-identyfikujące, ale tylko w połączeniu z inną daną. Silnik
  je **wykrywa i pokazuje** radcy z kontekstem; radca klika „anonimizuj" albo
  „pomiń". Nie wchodzą do benchmarku warstwy 1 – mierzone osobno jako „pokrycie
  warstwy 2" (czy w ogóle zaproponowaliśmy je do przeglądu).

- **Warstwa 3 – NIE MASKUJ (nie są danymi osobowymi).**
  Maskowanie nie służy prywatności, a psuje pismo. Domyślnie nietykane (mogą mieć
  lokalny wyjątek, np. sygnatura własnej sprawy).

Podwójna korzyść (Twoja): benchmark warstwy 1 rośnie do 95%+, bo znika szum;
pisma stają się czytelniejsze; radca zachowuje kontrolę nad przypadkami mozaiki.

---

## §3. Macierz – 36 typów

### Warstwa 1 – maskuj automatycznie (cel recall ≥ 95%)

| Typ | Waga | Recall holdout | Podstawa |
|---|---|---|---|
| PERSON_NAME | 4 | 78,6% | Bezpośredni identyfikator osoby. **Problem detekcji – patrz §5.** |
| PERSON_ALIAS | 4 | (brak w próbie) | Pseudonim/ksywa identyfikuje jak nazwisko. |
| PERSON_IDENTIFIER | 5 | 81,0% | PESEL, dowód, paszport, prawo jazdy – twardy unikalny identyfikator. |
| POSTAL_ADDRESS | 4 | 96,7% | Pełny adres lokalizuje i identyfikuje osobę. |
| EMAIL_ADDRESS | 4 | 75,0% | Adres e-mail identyfikuje i kontaktuje. |
| PHONE_NUMBER | 4 | 97,2% | Numer telefonu identyfikuje i kontaktuje. |
| CONTACT_HANDLE | 4 | (brak w próbie) | @handle / komunikator identyfikuje. |
| BANK_ACCOUNT_IDENTIFIER | 4 | 100% | IBAN/NRB – unikalny, powiązany z osobą. |
| PAYMENT_CARD | 4 | (brak w próbie) | Numer karty. |
| PAYMENT_CARD_SECURITY | 4 | (brak w próbie) | CVV / data ważności (z kartą). |
| ACCOUNT_IDENTIFIER | 4 | (brak w próbie) | Login / numer konta – unikalny. |
| DEVICE_IDENTIFIER | 4 | (brak w próbie) | MAC / IMEI / serial – unikalny identyfikator techniczny. |
| VEHICLE_IDENTIFIER | 4 | 84,4% | Tablica / VIN – powiązane z właścicielem. |
| LAND_REGISTER_IDENTIFIER | 4 | (brak w próbie) | **Dodane 2026-07-18 (zlecenie KW).** Numer księgi wieczystej – pośrednio identyfikuje osobę przez nieruchomość (jak tablica/VIN); portal publiczny (ekw.ms.gov.pl) rozwiązuje numer KW wprost na właściciela. Wykrywanie strukturalne (kształt 2 litery+cyfra+litera / 8 cyfr / 1 cyfra), bez wymogu kotwicy – twarda gwarancja „nigdy W3". |
| DATE_OF_BIRTH | 3 | 100% | **Decyzja Alana 2026-07-14: W1.** Data urodzenia + inne dane zbyt łatwo wiąże z osobą (np. ur. 1921 = ~105 lat, osób bardzo mało). |
| ORGANIZATION_IDENTIFIER | 2 | 100% | **Decyzja Alana 2026-07-14: W1.** NIP/REGON/KRS – unikalny identyfikator; dla JDG wprost dana osobowa. |
| AUTH_SECRET | 5 | (brak w próbie) | Hasło / klucz / token. Nie „dana osobowa", ale sekret – wyciek katastrofalny. Zawsze maskuj. |
| IP_ADDRESS / GEO_LOCATION / COOKIE_IDENTIFIER | 3 | (brak/śladowe) | Identyfikatory online (RODO motyw 30); w pismach prawnych rzadkie, niski wolumen. Maskuj gdy wystąpią. |

### Warstwa 2 – do decyzji użytkownika (nie w benchmarku warstwy 1)

| Typ | Waga | Recall holdout | Podstawa |
|---|---|---|---|
| PERSON_ROLE_OR_TITLE | 1 | 65,7% | Sama funkcja nie identyfikuje. Rzadki wyjątek: quasi-ident. w małej populacji → decyzja radcy. |
| PERSON_ATTRIBUTE | 3 | 17,9% | Wiek / stan cywilny / rysopis. Samodzielnie nie identyfikują; efekt mozaiki → decyzja. |
| HEALTH_DATA | 5 | 50,0% | Art. 9. Fakt zdrowotny wrażliwy, identyfikuje tylko z nazwiskiem/inną daną. |
| GENETIC_DATA | 5 | (brak w próbie) | Art. 9. Wzmianka o wyniku genetycznym (surowy profil DNA byłby W1, ale w pismach nie występuje). |
| BIOMETRIC_DATA | 5 | (brak w próbie) | Art. 9. Wzmianka o biometrii (szablon biometryczny byłby W1). |
| RELIGION_OR_BELIEF | 5 | 0%\* | Art. 9. |
| POLITICAL_OPINION | 5 | 0%\* | Art. 9. |
| SEXUAL_ORIENTATION | 5 | 0%\* | Art. 9. |
| TRADE_UNION_MEMBERSHIP | 5 | 0%\* | Art. 9. |
| ETHNIC_ORIGIN | 5 | 0%\* | Art. 9. |
| CRIMINAL_OFFENCE_DATA | 5 | 12,1% | Art. 10. Sam czyn / sprawa nie identyfikuje (przykład: „sprawa z art. 148 kk"). |
| FINANCIAL_AMOUNT | 3 | 99,2% | Kwota sama nie identyfikuje; konkretna suma bywa quasi-ident. → decyzja. |
| INCOME_COMPENSATION | 3 | 0% (1 enc.) | Wynagrodzenie. Wrażliwe (zatrudnienie), nie identyfikuje samo. |
| LOCATION | 2 | 88,8% | Miasto/region: duże nie identyfikują; mała miejscowość + rola/organizacja może → decyzja. |

\* Recall 0% jest **ścisły** (granice). Rejestr przecieków pokazuje, że przy 45-94%
tych fraz jądro (choroba, nazwa związku, orientacja) jest **maskowane**, a wychodzi
tylko rama („leczy się z powodu ___"). Po przejściu do warstwy 2 problem znika
z benchmarku – liczy się „czy zaproponowano do przeglądu", nie „czy granica co do znaku".

### Warstwa 3 – nie maskuj (nie są danymi osobowymi)

| Typ | Waga | Podstawa |
|---|---|---|
| DOCUMENT_REFERENCE | 3 | Sygnatury **cytowanych** orzeczeń i nr faktur nie identyfikują osoby. **Wyjątek:** sygnatury własnej sprawy użytkownika → lokalna allowlista → maskowane (patrz Fable). |
| ORGANIZATION_NAME | 2 | Nazwa osoby prawnej ≠ dana osoby fizycznej (RODO chroni os. fizyczne). Sądów/banków/urzędów nie maskujemy. **Wyjątek:** nazwa zawierająca imię i nazwisko (JDG, kancelaria) – część osobowa łapana jako PERSON_NAME (W1); użytkownik może zamaskować konkretną nazwę przez przegląd. |

---

## §4. Konsekwencja dla benchmarku

- **Warstwa 1 staje się „liczbą do obrony".** Cel: recall ≥ 95% na rzeczywistych
  danych osobowych. To ona idzie do materiałów.
- **Warstwa 2 ma osobną metrykę:** „pokrycie do przeglądu" – czy silnik zaproponował
  daną radcy. Tu cel jest łagodniejszy (wykryć i pokazać, nie idealna granica).
- **Warstwa 3 wypada z benchmarku** całkowicie.

### Szacunek recall warstwy 1 DZIŚ (przeliczenie z tabeli per-typ holdout, nie nowy pomiar)

Rdzeń W1 (NAME, PERSON_ID, POSTAL, EMAIL, PHONE, BANK, VEHICLE, DATE_OF_BIRTH,
ORG_ID): TP ≈ 829, FN ≈ 135 → **recall ≈ 86%** (vs 76% ogółem).

Z ~135 braków W1: ~40 to rozstrzelony OCR (klasa C1, osobny projekt), ~10 nazwiska-
wyrazy pospolite, reszta granice/inicjały. **Po wyłączeniu OCR-spacing (osobny tor)
i naprawie nazwisk pospolitych: recall W1 ≈ 91%.** Typy adresów/telefonów/kont/ID/
daty urodzenia już dziś **96-100%**.

Wniosek: „95%+ na rzeczywistych danych osobowych" jest realnym, bliskim celem –
nie „76% i tyle pracy na marne". Droga: rekalibracja zakresu (ten dokument) +
domknięcie dwóch realnych luk nazwiskowych (§5).

---

## §5. Co NIE znika po rekalibracji (realne luki detekcji)

Rekalibracja zakresu nie naprawia trzech rzeczy, bo dotyczą **warstwy 1** albo
zdolności wykrycia w ogóle:

1. **Rozstrzelony OCR** („W r ó b l e w s k a") – klasa C1, dziś bez zbudowanego
   rozwiązania (zaprojektowana jako odłożona: warstwa mapowania offsetów). Uwaga:
   moduł B5 dotyczy **diakrytyków** („Kolkowski→Kołkowski"), to inny problem niż spacje.
2. **Nazwiska-wyrazy pospolite** („Osioł", „Wrona", „Pszczoła") – brak dedykowanego
   modułu; kandydaci: gazeter nazwisk, heurystyka slotu składniowego, B1 (ensemble).
3. **Pełne wycieki art. 9-10** (jądro, nie rama) – po przejściu do warstwy 2 mniej
   krytyczne (nie identyfikują bez nazwiska, a nazwisko jest w W1), ale nadal trzeba
   je **wykryć**, by zaproponować do przeglądu → rozszerzenie leksykonu B3.

Priorytet (z Twojego własnego modelu): **nazwiska przede wszystkim** – bo nazwisko
jest kotwicą identyfikacji; kiedy ono jest zamaskowane, wyciek reszty jest
niegroźny. Dlatego luki 1-2 (nazwiskowe, W1) biją lukę 3 (art. 9, W2).
