# RECALL-90-DESIGN.md – droga do defensywnego recall 90%+ (architektura)

**Wersja:** 1.0 (projekt, zero kodu)
**Data:** 2026-07-12
**Autor:** Fable (architekt), sesja równoległa do wdrożenia planu A przez Sonneta
**Cel nadrzędny:** GATE-EVAL-RECALL §6 – „skuteczność 90%+ (recall na korpusie
kontradyktoryjnym) przed materiałami marketingowymi" (decyzja Alana 2026-07-12).
**Rodzice:** `EVAL-RECALL-AUDIT.md` (rejestr przecieków §6, macierz pomyłek §5.1,
plan A/B/C §8), `GATE-EVAL-RECALL.md` (werdykt + warunki), `test-data/adversarial/`
(korpus + polityka anotacji), `docs/RESULTS-ensemble-experiment.md` (ryzyka ensemble).
**Granice tej sesji:** Sonnet RÓWNOLEGLE implementuje moduły taktyczne A1–A11
w `src/pipeline/**` – ten dokument NICZEGO tam nie zmienia i nie renegocjuje
kontraktów A; jedyne doprecyzowania do planu A są zebrane jako rekomendacje
R-1/R-2 (§6.2), do przekazania, nie do wykonania tutaj. Produktem sesji jest
wyłącznie ten plik.

**Konwencja:** moduł → kontrakt → kryterium akceptacji → test dowodzący →
koszt (S ≤ pół dnia, M 1–2 dni, L projekt) → bramka Opusa (tak/nie).
Liczby z pomiarów cytują źródło (raport §, pozycja rejestru); liczby oznaczone
„szacunek" to projekcje z rejestru przecieków do zweryfikowania pomiarem po
merge'u planu A – żadna nie jest obietnicą.

---

## §0. Teza i mapa drogi

1. **Plan A nie dowiezie 90% sam.** Z dekompozycji FN i rejestru przecieków
   (§1): moduły A odzyskują warstwy próg/filtr/dedup/granice-regexowe, czyli
   szacunkowo +8–10 p.p. recall na korpusie kontradyktoryjnym (78,1% → ~86–89%).
   Reszta luki siedzi w klasach, których regex i progi nie widzą: role/tytuły,
   wersaliki, inicjały, frazy opisowe art. 9–10, OCR.
2. **Do 90%+ punktowo** potrzebne są moduły detekcyjne B (§2): B1 ensemble,
   B2 przebieg po normalizacji wersalików, B3 leksykon kategorii szczególnych,
   B4 leksykon ról/tytułów (nowy, największa pojedyncza dźwignia recall),
   B5 pakiet OCR-diakrytyki (nowa klasa, spoza obecnego korpusu), B6 semantyka
   rodzin typów przy wyłączaniu kategorii (kanał konfiguracyjny z macierzy §5.1).
3. **Do DEFENSYWNEGO 90%** – czyli liczby, którą radca prawny może napisać
   w materiałach i obronić metodą – nie wystarczy punktowy wynik na 279
   encjach: przedział ufności jest za szeroki (±3,5 p.p.), a obecny korpus
   jest skażony strojeniem (plan A powstał z jego przecieków). Potrzebny jest
   korpus 2.0 z podziałem strojeniowy/sprawdzian (§3) i bramka, która liczy
   dolną granicę przedziału ufności, nie punkt (§4).
4. **Definicja sukcesu (bramka GATE-RECALL-90, §4.2):** na zamrożonym
   sprawdzianie (holdout, ~1000 encji): recall punktowy ≥ 93%, dolna granica
   95% (bootstrap po dokumentach) ≥ 90%, **zero pełnych wycieków typów wagi
   ≥ 4**, każdy częściowy przeciek wagi 5 przejrzany ręcznie, precyzja nad
   podłogą. Dopiero to odblokowuje marketing (§4.3).

Mapa zależności: (Sonnet: A1–A11) ∥ (korpus 2.0 §3 – można zacząć od zaraz)
→ pomiar po-A → B4/B2/B3/B5/B6 (§2, kolejność w §5) → B1 warunkowo →
GATE-RECALL-90.

---

## §1. Analiza luki: czego plan A nie domknie

### 1.1 Metoda i zastrzeżenie

Dekompozycja z trzech niezależnych źródeł pomiaru (wszystkie z przebiegu
`adversarial-final`, raport §5–§6): (a) rejestr 42 przecieków z atrybucją
warstwy powstania, (b) macierz pomyłek §5.1 z wierszem „(brak)"
(31 encji niewykrytych w ogóle, 8 pomyłek typu), (c) scoring ścisły
(FN 61, w tym 18 częściowych). Przypisanie „domyka / nie domyka" opiera się
na kontraktach A1–A12 z §8.1 raportu, nie na nadziei: moduł domyka klasę
tylko wtedy, gdy jego kryterium akceptacji jawnie wymienia jej przypadki.

Zastrzeżenie uczciwości: dopóki Sonnet nie zmergował planu A, wszystkie
liczby „po A" są szacunkami z rejestru. Pierwszy krok po merge'u to tagowany
pomiar na obu korpusach (§5, krok R1) – on zastępuje ten paragraf liczbami.

### 1.2 Co plan A domyka (rachunek strony przeciwnej)

Wg warstw rejestru (42 przecieki: granice 22, próg 8, filtr źródeł 6,
detekcja 5, dedup 1):

- **próg (8)** → A7 (progi typów wagi ≥ 3 z krzywej P/R): #1 paszport,
  #5 rejestracja, #15–16 miejscowości, 4× role z #22–29;
- **filtr źródeł (6)** → A8 (siatka bezpieczeństwa score ≥ 0,9): #3 „Sad",
  #9 `KM 1552/25` (plus A2), #13 „Torunia", 3× role;
- **dedup (1)** → A6: #12 REGON;
- **granice (22)** → w większości A1/A2/A4/A5 (identyfikatory z sumami
  kontrolnymi, sygnatury repertoriów, kwoty, maxLength flaguje zamiast
  kasować): #17–21, #31–42 i syntetyczny „Sebastian Grabowski";
- **pomyłki typu w rodzinie identyfikatorów** (macierz: 8) → częściowo A1:
  PESEL/NIP/REGON/IBAN z sumą kontrolną dostają score 1,0 i właściwy typ
  (~6 z 8 par).

Szacunkowy odzysk: ~25–30 z 61 FN → recall ~86–89%. Do celu brakuje
~4–6 p.p., które w całości leżą w klasach z 1.3.

### 1.3 Klasy resztkowe (nazwane, z udziałem)

| # | Klasa | Dowody | Skala dziś (przecieki / szac. FN / p.p. recall) | Domyka |
|---|---|---|---|---|
| L1 | **Role i tytuły poza zasięgiem detekcji** | rejestr #22–29 (po A7/A8 zostaje ~1 detekcja + granice), macierz: PERSON_ROLE 10× „(brak)", R typu 23,5% | 11 przecieków wagi 1; ~5–6 FN po A (**~2 p.p.** – największa pojedyncza resztka) | **B4** (+B1 pomocniczo) |
| L2 | **Wersaliki** (komparycje, nagłówki, oznaczenia stron) | ZUS ×3 (syntetyczny, §3.4), nagłówki adw_18/24/29, FP „UMOWA KREDYTU GOTÓWKOWEGO" score 1,00 (§5.2) | 3 przecieki synt. + ~2–3 FN adv. (**~1 p.p.**; na realnych pismach procesowych więcej – komparycja to standard) | **B2** |
| L3 | **Frazy opisowe art. 9–10** („skazany za…", „choruje na…", „członkinią…") | #2 (5,0 – **jedyny pełny wyciek wagi 5 w rejestrze**), #11, #30 | 3 przecieki, ~3 FN (**~1 p.p.**, ale dominują masę dotkliwości) | **B3** |
| L4 | **Inicjały i skróty nazwisk** | #6, #7 (po 3,2), znany przeciek z RESULTS-ensemble („T. Wiśniewski") | 2 przecieki, ~2–4 FN (**~1 p.p.**) | **B1** (A8 tylko częściowo) |
| L5 | **Rozstrzelony OCR** („K o n r a d Ż u r a w s k i") | #4 (4,0), #14 (2,0) | 2 przecieki (**~0,7 p.p.**) | poza zasięgiem v1: **C1** (warstwa mapowania offsetów = osobny projekt); weryfikator flaguje (R3 audytu) |
| L6 | **Podmiany glifów OCR w identyfikatorach** (`lO9O` w IBAN) | #18 (56% pokrycia) | 1 przeciek (**~0,3 p.p.**) | **A1 – POD WARUNKIEM** fałdowania glifów (rekomendacja R-1, §6.2; bez tego resztka) |
| L7 | **OCR-diakrytyki** („Kolkowski"→„Kołkowski"; zgłoszenie Alana, GATE §7 – podmiana wewnątrz modelu rozpoznawania PaddleOCR mobile, nie na obrazie) | poza obecnym korpusem (symulujemy l/1, O/0, rozstrzelenia, sklejenia – nie diakrytyki); kanał techniczny w §2.5 | dziś niemierzalna; na realnych skanach każdy dokument z nazwiskiem z diakrytykiem jest kandydatem | **B5** (pakiet trzech linii obrony) |
| L8 | **Kwoty opisowe** („dwukrotność wynagrodzenia", „0,5% wartości kontraktu") | #8 (3,0), #10 (2,5) | 2–3 przecieki (**~1 p.p.**) | świadome ograniczenie **C2**: weryfikator N-5 flaguje; nie gonić regexem (precyzja) |
| L9 | **Pomyłki typów w rodzinie identyfikatorów jako kanał konfiguracyjny** | macierz §5.1: PESEL→DOC_REF ×4, VIN→DOC_REF ×2, ORG_ID/IBAN→DOC_REF; TRADE_UNION→ORG_NAME | 0 p.p. recall przy pełnej konfiguracji (treść ukryta); **kanał wycieku przy selektywnym wyłączaniu kategorii** przez użytkownika | **B6** (+A1 dla typów z sumą; VIN: R-2) |

Masa dotkliwości resztki: pozycje #2, #4, #6–8, #10, #11, #14, #30 + ~1 rola
≈ 27 z 69 punktów rejestru (**~40% dotkliwości zostaje po planie A**), w tym
oba pełne wycieki wagi ≥ 4, które przetrwają plan A: #2 (art. 10) i #4 (OCR).
Wniosek: plan A czyści objętość, moduły B czyszczą wagę.

### 1.4 Rachunek do 90%

Szacunek składany (do zastąpienia pomiarem):

| Krok | Recall (adversarial, ścisły) |
|---|---|
| baseline (raport §5) | 78,1% |
| + plan A (A1–A12) | ~86–89% |
| + B4 (role/tytuły) | +1,5–2,5 p.p. |
| + B2 (wersaliki) | +0,7–1 p.p. |
| + B1 (inicjały, fragmentacja) | +0,7–1,5 p.p. |
| + B3 (art. 9–10) | +0,7–1 p.p. (na korpusie 2.0 z kwotą art. 9–10: decydujące dla wag) |
| **Razem punktowo** | **~91–93%** |

B5 i B6 nie podnoszą recall na dzisiejszym korpusie (klasa L7 w nim nie
występuje, L9 nie objawia się przy pełnej konfiguracji) – zapobiegają
regresowi na korpusie 2.0 i na realnych skanach; bez nich „90%" byłoby
prawdziwe tylko na papierze bez OCR i przy nietkniętej konfiguracji.

---

## §2. Moduły B – rozwinięcie wykonawcze

Dyscyplina wspólna dla KAŻDEGO modułu z tej sekcji (dziedziczona z R1
audytu i GATE §5): zmiana w `src/pipeline/**` → tagowany `npm run eval` na
OBU korpusach + `eval:score` + `eval:analyze`, porównanie z baseline'ami,
rejestr przecieków przed F1. Pomiary progów wyłącznie na artefakcie
dystrybucji po decyzji 21 (fp32/fp16, nie q8).

### 2.1 B1 – współautorytatywność polish-fp16 dla PERSON_NAME / PERSON_ROLE_OR_TITLE

**Stan dziś:** `ENTITY_SOURCES.PERSON_NAME = ['multilang-fp32']`
(`entity-sources.js:48`) – kandydaci polish-fp16 są wyrzucani przez
`sourceFilterStep` niezależnie od score (dowód: „Sad", 0,98, rejestr #3).
A8 (siatka score ≥ 0,9) jest tanim podzbiorem; B1 wchodzi **tylko jeżeli**
po zmierzeniu A8 inicjały (#6/#7) albo role nadal ciekną – to warunek
wejścia, nie automat (zgodnie z §8.2 raportu).

**Argument kosztowy, którego nie było w audycie:** polish-fp16 JUŻ biega na
każdym segmencie (jest autorytatywny m.in. dla adresów, e-maili, art. 9–10),
więc B1 nie dodaje żadnej inferencji – konsumuje wyniki, które dziś są
liczone i wyrzucane. Koszt to wyłącznie kalibracja i arbitraż, nie latencja.

**Kontrakt:**
1. `ENTITY_SOURCES.PERSON_NAME += 'polish-fp16'`,
   `ENTITY_SOURCES.PERSON_ROLE_OR_TITLE += 'polish-fp16'`, z osobnym progiem
   per źródło przez istniejący mechanizm `thresholdBySource`
   (`entity-rules.js`; start 0,75, finalnie z krzywej P/R);
2. **krzywa P/R przed merge'em:** progi 0,3–0,9 co 0,05 dla polish-fp16 na
   obu korpusach (dev), per typ; wynik jako `docs/RESULTS-b1-pr-curve.md`
   (analogia RESULTS-ensemble); próg wybrany = max recall przy wzroście
   czystych FP ≤ 10% na korpusie syntetycznym;
3. **dedup jako arbiter fragmentacji** (ryzyko „Joan"+„na Kwiatkowska"
   z RESULTS-ensemble): kandydaci PERSON_NAME z polish-fp16, którzy po snapie
   do granic słów sąsiadują albo nakładają się (przerwa ≤ 1 znak
   niealfanumeryczny), są scalani w jeden span PRZED właściwym dedupem;
   przy nakładce między źródłami wygrywa: (a) span multilang pokrywający
   kandydata w całości, (b) w przeciwnym razie unia spanów po snapie
   (nadmiar maskowania tańszy niż dziura, spójnie z A5/A6);
4. inicjały: span obejmujący sekwencję `X.( X.)* Nazwisko` z któregokolwiek
   źródła nie jest przycinany przez snap na kropce inicjału (współgra
   z kontraktem A2/A5, nie zastępuje go).

**Kryterium akceptacji:** przecieki #6, #7 znikają (pokrycie 100%);
PERSON_NAME na syntetycznym: P nie spada poniżej 98% (baseline 100%,
§3.4); PERSON_NAME na adversarial: R ≥ 95% (dziś 88,2%); zero nowych FN
(scalenie nie może zjadać sąsiednich encji innego typu).

**Test dowodzący:** goldeny adw_06/adw_28 (inicjały) + przypadek
„Joanna Kwiatkowska" odtworzony jednostkowo na arbitrze (fragmenty
„Joan"/„na Kwiatkowska" → jeden span) + oba korpusy przed/po + krzywa P/R
w repo.

**Koszt:** M (pomiar + arbiter). **Bramka Opusa:** nie (konfiguracja
detekcji bez nowego kanału/artefaktu); obowiązuje dyscyplina eval z nagłówka §2.

### 2.2 B2 – drugi przebieg NER na tekście znormalizowanym z wersalików

**Diagnoza:** oba modele są trenowane na tekście o naturalnej kapitalizacji;
pełne wersaliki gubią sygnał nazw własnych (ZUS ×3 niewykryte, §3.4/§7.6)
albo produkują FP o score 1,00 („UMOWA KREDYTU GOTÓWKOWEGO", §5.2).

**Fundament techniczny (dlaczego to jest tanie):** case-folding
wersalikowego tokenu do Title Case jest w polszczyźnie transformacją
1:1 na jednostkach UTF-16 (Ż→ż, Ł→ł, Ó→ó – wszystkie mapowania
zachowują długość; brak tureckiego İ i niemieckiego ẞ w tekstach
docelowych). Offsety kandydatów mapują się tożsamościowo – NIE powstaje
warstwa mapowania offsetów (ta pozostaje poza zakresem, C1). Własność
przybija test (poniżej), nie deklaracja.

**Kontrakt:**
1. nowy krok w fazie `ner` (za `createNerStep`): wykryj segmenty zawierające
   ≥ 1 słowo ≥ 3 liter w pełnych wersalikach (z polskimi znakami);
2. dla takich segmentów zbuduj wariant znormalizowany: tokeny wersalikowe →
   Title Case (pierwsza litera bez zmian, reszta `toLowerCase` per znak);
   twarda asercja `folded.length === original.length`, przy niespełnieniu –
   segment pomijany (fail-open do oryginału: brak kandydatów, zero szkody);
3. inferencja obu modeli na wariancie znormalizowanym **tylko dla tych
   segmentów** (koszt ×2 wyłącznie na nagłówkach/komparycjach, nie na całym
   dokumencie);
4. kandydaci wchodzą do postprocessu jako osobne źródło (alias
   `case-folded`), z własnym progiem w `thresholdBySource` (start 0,8 –
   wyżej niż bazowe, bo kontekst zdaniowy jest zaburzony) i z zamkniętą
   listą typów: PERSON_NAME, ORGANIZATION_NAME, POSTAL_ADDRESS, LOCATION,
   PERSON_ROLE_OR_TITLE;
5. strażnik FP: kandydat ORGANIZATION_NAME ze źródła `case-folded`, którego
   span jest nagłówkiem dokumentu (zamknięta lista ~20 lematów: UMOWA,
   POZEW, WYROK, POSTANOWIENIE, UZASADNIENIE, ZAŚWIADCZENIE, PEŁNOMOCNICTWO,
   PROTOKÓŁ, WEZWANIE, ANEKS…), nie powstaje – lista jest częścią kontraktu,
   nie heurystyką ad hoc.

**Kryterium akceptacji:** ZUS ×3 (pismo_03) maskowane; nagłówek adw_18
i wersalikowe encje adw_29 wykrywane (adw_24 zostaje w L5 – rozstrzelenie
to inna klasa); czyste FP na obu korpusach rosną < 10% (kryterium z §8.2);
FP „UMOWA KREDYTU GOTÓWKOWEGO" nie wraca w żadnej kapitalizacji.

**Test dowodzący:** property-test length-preservation (fuzz na stringach
z pełnym polskim alfabetem: `|fold(s)| == |s|`); goldeny ZUS/nagłówki;
oba korpusy przed/po.

**Koszt:** M. **Bramka Opusa:** nie.

### 2.3 B3 – kategorie szczególne: leksykon kontekstowy wysokiej precyzji

**Diagnoza:** frazy opisowe niosące fakt z art. 9–10 RODO są poza zasięgiem
obu modeli (rejestr #2, #11, #30) – to jedyna klasa z pełnym wyciekiem
wagi 5. A12 (decyzja 20) włączył kategorie do konfiguracji domyślnej, ale
detekcji nie poprawił.

**Kontrakt (v1 – bez zewnętrznych słowników, świadomie):**
1. nowe źródło `lexicon` w fazie `ner`: wzorce kotwica→span dla trzech
   kategorii o udowodnionych przeciekach:
   - CRIMINAL_OFFENCE_DATA: `skazan(y|a|ego|ej|…) (prawomocnym wyrokiem )?za
     <dopełnienie>`, `ukaran(y|a|…) za <dopełnienie>`, `odbywa karę
     <dopełnienie>`, `(nie)?karan(y|a|…)` (oświadczenie o niekaralności to
     też dana art. 10 – informacja o braku wyroków), `wyrok(iem)? w sprawie
     karnej <sygnatura?>`;
   - HEALTH_DATA: `(choruje|cierpi) na <dopełnienie>`, `zdiagnozowano
     <dopełnienie>`, `leczy się (na|w) <dopełnienie>`, `przebył(a)?
     <dopełnienie-medyczne>`, `orzeczenie o (niepełnosprawności|niezdolności
     do pracy)<uzupełnienie?>`, `zwolnieni(e|u) lekarski(m)? z powodu
     <dopełnienie>`, `uzależnie(nie|niony|niona) od <dopełnienie>`;
   - TRADE_UNION_MEMBERSHIP: `(członek|członkini|należy do|przynależność do)
     <nazwa związku: związk(u)? zawodow(ego)?|NSZZ|OPZZ|ZNP…>`;
2. **granica spanu:** kotwica + dopełnienie do najbliższego znaku
   interpunkcyjnego kończącego frazę (przecinek, kropka, średnik) albo
   spójnika współrzędnego, z twardym limitem 60 znaków za kotwicą – span ma
   pokryć fakt szczególny, nie zdanie;
3. score 1,0 (precyzja z konstrukcji wzorca), typ wg kategorii wpisu;
4. leksykon jako plik danych w repo (JSON: wzorzec, kategoria, przykład
   pozytywny, przykład negatywny), nie literały w kodzie – audytowalny
   i rozszerzalny; wzorce v1 NIE zawierają list chorób/wyznań/orientacji
   (kotwica kontekstowa łapie dopełnienie bez znajomości taksonomii) – zero
   nowego łańcucha dostaw danych, zero kwestii licencyjnych typu O-3;
5. pozostałe kategorie art. 9 (wyznanie, poglądy, orientacja, pochodzenie):
   krótka zamknięta lista fraz (`wyznania <dopełnienie>`, `orientacji
   <dopełnienie>`, `narodowości/pochodzenia <dopełnienie>`) – świadomie
   minimalna, do rozszerzenia po pomiarze na korpusie 2.0.

**Kryterium akceptacji:** przecieki #2, #11, #30 – pokrycie 100%; zero
nowych FP na pułapkach adw_32/33/34; na korpusie 2.0 (§3.3: ≥ 90 encji
art. 9–10): recall fraz opisowych ≥ 80% przy P ≥ 95% dla źródła `lexicon`.

**Test dowodzący:** jednostkowy per wzorzec (pozytyw + negatyw z pliku
leksykonu, test iteruje po danych); oba korpusy; przypadki #2/#11/#30 jako
asercje regresyjne.

**Koszt:** M (trzy kategorie udowodnione + minimalna reszta).
**Bramka Opusa: TAK, lekka** – przegląd treści leksykonu i polityki granic
spanu. Uzasadnienie: to polityka wykrywania najcięższej klasy danych
(art. 9–10); pomyłka konstrukcyjna (np. za wąski span systematycznie
odsłaniający dopełnienie) jest dokładnie tym rodzajem błędu, który bramka
łapie lepiej niż testy autora.

**Opcja docelowa – fine-tuning (poza tą iteracją).** Kryteria WEJŚCIA
(wszystkie muszą być spełnione, decyzja świadoma, osobny projekt + bramka):
1. B3-leksykon zmierzony na korpusie 2.0 i recall fraz opisowych < 85%
   mimo iteracji wzorców (leksykon się wyczerpał);
2. istnieje plan danych treningowych: ≥ 2–5 tys. zdań syntetycznych
   generowanych deterministycznie + ręczna walidacja próby (żadnych danych
   realnych – tajemnica zawodowa wyklucza akta jako trening);
3. licencja modeli bazowych (`wjarka/eu-pii-anonimization-*`) potwierdzona
   u źródła jako dopuszczająca redystrybucję pochodnych w produkcie
   komercyjnym (do sprawdzenia na karcie modelu, nie z pamięci);
4. budżet: GPU/czas treningu + powtórzenie CAŁEGO toru eval (oba korpusy,
   parytet dtype, bench rozmiaru artefaktu pod decyzję 21);
5. plan integralności artefaktu jak dla modeli B1-desktop (manifest, sumy).
Bez spełnienia wszystkich pięciu – fine-tuning nie startuje.

### 2.4 B4 – leksykon ról i tytułów jako źródło detekcji (nowy moduł)

**Diagnoza:** PERSON_ROLE_OR_TITLE to największa pojedyncza resztka recall
(L1: R 23,5%, 13 FN, 11 przecieków #22–29). Multilang nie widzi polskich
skrótów zawodowych („r. pr.", „adw.", „sekr. sąd.") ani funkcji („prezes
zarządu", „główna księgowa"). To klasa zamknięta językowo – idealna dla
leksykonu, nie dla modelu.

**Zależność strategiczna:** W1 (warstwa morfologiczna weryfikatora,
`W1-W3-MORPHOLOGY-DESIGN.md` §1) skompiluje z SGJP pełne paradygmaty ról –
ale W1 czeka na bramkę O-3 (licencje, łańcuch dostaw). B4 NIE może na tym
wisieć, więc dwustopniowo:

**Kontrakt:**
1. **B4-lite (od razu):** źródło `lexicon` emituje PERSON_ROLE_OR_TITLE dla
   zamkniętej, ręcznie spisanej listy ~40 lematów tytułów zawodowych
   i funkcji wraz z formami fleksyjnymi lp (ręcznie, wzór z listy §1.8
   projektu morfologii: adwokat, radca prawny, notariusz, komornik, biegły,
   sędzia, prokurator, referendarz, aplikant, asesor, mecenas, prezes/członek
   zarządu, prokurent, dyrektor, kierownik, księgowa/księgowy, sekretarz
   sądowy…) oraz skrótów (`adw.`, `r. pr.`, `not.`, `prok.`, `sędzia SR/SO/SA`,
   `sekr. sąd.`); dane w pliku (JSON), nie w kodzie;
2. **B4-full (po W1):** formy fleksyjne zastępowane paradygmatami
   skompilowanymi z SGJP (sekcja `role` artefaktu `morph-pl.json`) – jeden
   słownik prawdy dla pipeline'u (B4), blocklisty (A9) i weryfikatora (W3);
   do tego czasu duplikacja listy jest świadoma i mała;
3. **rozłączność z rolami procesowymi:** lematy ról procesowych (powód,
   pozwany, wnioskodawca, uczestnik…) są w leksykonie JAWNIE oznaczone jako
   „nie-encja" (to blocklista A9, nie detekcja) – zgodnie z polityką
   anotacji korpusu (role generyczne nieanotowane, README adversarial);
   wpis nie może być jednocześnie encją i blocklistą (test spójności);
4. granice spanu: tytuł wielowyrazowy w całości („główna księgowa",
   „prezes zarządu", „kierownik produkcji"), skróty z kropkami bez
   przycinania przez trim interpunkcji (współpraca z A5/A9, nie nadpisanie).

**Kryterium akceptacji:** przecieki #22–29 znikają w całości; adw_34
(pułapka: wyłącznie role generyczne) – **zero FP**; syntetyczny
PERSON_ROLE: P pozostaje 100%, R ≥ 96,4% (baseline); adversarial
PERSON_ROLE: R ≥ 75% (dziś 23,5%).

**Test dowodzący:** jednostkowy per wpis leksykonu (formy fleksyjne
i skróty); adw_34 jako test negatywny w całości; oba korpusy przed/po.

**Koszt:** S–M (lite), S (przełączenie na W1 po jego bramce).
**Bramka Opusa:** nie (dane ręczne w repo, bez łańcucha dostaw; B4-full
dziedziczy bramkę W1, która i tak jest warunkiem jego istnienia).

### 2.5 B5 – klasa OCR-diakrytyki: trzy linie obrony (i werdykt architektoniczny)

**Diagnoza techniczna.** Zgłoszenie Alana (GATE §7): po OCR „Kolkowski"
czytane jako „Kołkowski". Diagnoza wskazuje na podmianę WEWNĄTRZ modelu
rozpoznawania (`latin_PP-OCRv5_mobile_rec`, `src/ocr/models.js:20`): prior
językowy recognizera „poprawia" rzadszą formę na częstszą. To nie jest szum
obrazu – preprocessing bitmapy tego nie cofnie; klasa istnieje u źródła.

**Dlaczego to jest kanał RECALL, a nie tylko estetyka legendy.** Mechanika
dzisiejszego pipeline'u (`backfillOccurrencesStep`, `src/pipeline/steps/backfill.js`):
dosiew wystąpień działa po dokładnym dopasowaniu wartości
(`buildWordBoundaryRegex`) albo – dla PERSON_NAME – po koreferencji
`couldBeSamePerson`, której rdzenie są porównywane ŚCIŚLE
(`sameAdjectivalSurnameForm`, `src/anonymizer.js:25`: `left.stem ===
right.stem`; „Kolkow" ≠ „Kołkow"). Skutek: jeżeli model wykrył „Kołkowski"
w jednym miejscu, a w innym miejscu skanu stoi „Kolkowskiego" (albo
odwrotnie) i model tego wystąpienia nie złapał, backfill go NIE dosieje –
niezamaskowane nazwisko, pełny wyciek wagi 4. Dodatkowo legenda dostaje
dwie „osoby" i fleksja W2 liczy się dla każdej osobno.

**Werdykt na pytanie projektowe (weryfikator-flaga czy fuzzy-match
w koreferencji):** OBIE warstwy, ale z twardym podziałem ról,
wyprowadzonym z asymetrii kosztów:

- **maskowanie może być diakrytyko-nieczułe** – nadmiar maskowania jest
  odwracalny i tani (filozofia A5/A8);
- **tożsamość osób NIE może być sklejana automatycznie** – „Kos" i „Koś"
  bywają dwiema różnymi osobami w jednym piśmie; automatyczne scalenie
  w legendzie to podmiana treści pisma procesowego, czyli złamanie V2
  weryfikatora (nic bez akceptacji człowieka). Fuzzy-match wchodzi do
  `couldBeSamePerson` wyłącznie w trybie dosiewu (maskowanie), NIGDY
  w `createNameNormalizer` (konsolidacja legendy).

**Kontrakt (pakiet):**
1. **B5a – dosiew odporny na diakrytyki (pipeline, koszt S):**
   w `backfillOccurrencesStep`, dla typów wagi ≥ 4 i WYŁĄCZNIE gdy dokument
   ma proweniencję OCR (flaga importu, dziś już rozróżnialna po ścieżce
   pliku/obrazu): skan wartości klasą znaków diakrytyko-konfuzyjnych
   (l↔ł, a↔ą, e↔ę, c↔ć, n↔ń, o↔ó, s↔ś, z↔ź↔ż) zamiast literalu; analogiczny
   fold w porównaniu słów `wordsMatch` na użytek `fuzzyBackfill`.
   Warunek proweniencji chroni precyzję na czystych tekstach (tam klasa nie
   występuje, więc fold nie ma prawa nic kosztować).
2. **B5b – checker weryfikatora N-11 (koszt S):** nowy wpis katalogu W5
   (LOCAL-VERIFIER §4.1, katalog jawnie otwarty): pary wartości legendy /
   wystąpień w wyniku, które po diakrytyko-foldzie są identyczne, a literalnie
   różne → finding „prawdopodobny wariant OCR tej samej osoby" z sugestią
   scalenia. Człowiek decyduje (V2); checker jest czystą funkcją, zero PII
   w spoczynku.
3. **B5c – koreferencja legendy:** BEZ ZMIAN automatyki (werdykt wyżej);
   scalenie wykonuje użytkownik z poziomu sugestii N-11 (UI istniejącego
   mechanizmu scalania legendy, jeżeli go brak – wchodzi z W7 weryfikatora).
4. **B5d – OCR u źródła (koszt M, pomiarowy):** deterministyczny
   mikro-korpus bitmap (teksty z gęstymi diakrytykami renderowane w 2–3
   fontach i DPI, seed stały) przepuszczony przez obecny recognizer oraz
   dostępne warianty (większy rec latin, jeżeli istnieje w ekosystemie
   PP-OCRv5 – do ustalenia pomiarem, nie z pamięci); raport CER na znakach
   diakrytycznych per wariant. Jeżeli wymiana artefaktu znosi klasę
   u źródła → decyzja produktowa rozmiar-vs-jakość (analogia decyzji 21,
   z liczbami na stole).
5. **Korpus:** nowa klasa dokumentów `adw_diakrytyki` w korpusie 2.0 (§3.4):
   deterministyczna degradacja diakrytyków w częściach wystąpień PII
   (anotowane prawdziwym typem, zgodnie z istniejącą polityką OCR).

**Kryterium akceptacji:** golden „Kołkowski"/„Kolkowskiego" w jednym
dokumencie z flagą OCR – oba wystąpienia zamaskowane, w legendzie sugestia
N-11 zamiast automatycznego scalenia; zero zmiany wyników na obu korpusach
bez flagi OCR (dowód izolacji); klasa `adw_diakrytyki`: recall PERSON_NAME
≥ 90% na zdegradowanych wystąpieniach.

**Test dowodzący:** jednostkowe folda (mapa par, w obie strony); golden
dokumentowy jw.; przebieg korpusu 2.0 z klasą diakrytyczną; dla B5d –
raport CER w repo.

**Koszt:** S (B5a) + S (B5b) + M (B5d pomiar). **Bramka Opusa:** nie dla
B5a/B5b (pipeline + czysty checker); B5d **tak, jeżeli** kończy się wymianą
artefaktu OCR (łańcuch integralności modeli jak przy decyzji 21 – dotyka
manifestu i sum, to jest materia bramkowa).

### 2.6 B6 – rodziny typów przy selektywnym wyłączaniu kategorii

**Diagnoza (macierz §5.1):** model maskuje PESEL-e/VIN-y jako
DOCUMENT_REFERENCE. Przy pełnej konfiguracji treść jest ukryta; gdy
użytkownik wyłączy kategorię „Finanse" (DOCUMENT_REFERENCE tam mieszka),
odsłoni PESEL zamaskowany pod błędnym typem. Wniosek z audytu („pomyłka
typu staje się kanałem wycieku") wymaga domknięcia konstrukcyjnego, nie
ostrzeżenia w UI (ostrzeżenie nie chroni).

**Kontrakt:**
1. decyzja o maskowaniu spanu zapada na podstawie WSZYSTKICH nakładających
   się kandydatów sprzed rozstrzygnięcia typu: jeżeli jakikolwiek kandydat
   spanu należy do typu WŁĄCZONEGO, span pozostaje zamaskowany – etykietę
   bierze najwyższy wagą (TYPE_WEIGHTS) typ włączony spośród kandydatów;
2. realizacja architektoniczna: filtr `enabledEntities` przesuwa się na
   koniec postprocessu (po dedupie), a `sourceFilterStep` na wejściu
   filtruje wyłącznie autorytatywność źródeł, nie włączoność typów –
   kandydaci typów wyłączonych żyją do decyzji maskowania i giną dopiero
   w niej;
3. **kolizja z Sonnetem:** to przestawia kolejność kroków postprocessu,
   więc B6 wchodzi DOPIERO po merge'u planu A i po jego pomiarze (osobna
   gałąź, pełny eval);
4. eval dostaje tryb konfiguracji okrojonej: przebieg z profilem
   `enabledEntities` bez kategorii „Finanse" jako stały punkt pomiarowy
   (dziś eval mierzy wyłącznie pełną konfigurację – luka pomiarowa,
   przez którą L9 jest dziś niewidzialna dla liczb).

**Kryterium akceptacji:** scenariusz macierzy: PESEL wykryty jako
DOCUMENT_REFERENCE przy wyłączonych „Finansach" pozostaje zamaskowany
(etykieta PERSON_IDENTIFIER, jeżeli był kandydat tego typu; inaczej
najwyższa waga z kandydatów); pełna konfiguracja: wyniki obu korpusów
bajt w bajt bez zmian (dowód, że B6 nie dotyka ścieżki domyślnej).

**Test dowodzący:** jednostkowy na scenariuszu macierzy; przebieg eval
w profilu okrojonym przed/po; asercja niezmienności pełnej konfiguracji.

**Koszt:** M. **Bramka Opusa:** nie; dyscyplina eval + jawny wpis do
dokumentacji kategorii (użytkownik ma wiedzieć, że wyłączenie kategorii
nie odsłania danych innej włączonej kategorii).

---

## §3. Korpus 2.0 – fundament „defensywnego" 90%

### 3.1 Dlaczego 279 encji nie wystarcza

Dwa niezależne powody:

1. **Szerokość przedziału ufności.** Przy n = 279 i recall punktowym 90%
   dolna granica jednostronnego 95% przedziału (Wilson) to **86,7%** –
   uczciwie można powiedzieć „nie wykluczamy 87%", nie „ponad 90%". Nawet
   obserwowane 93,0% daje dolną granicę 90,1% – na styk, bez zapasu na
   drugi powód.
2. **Skażenie strojeniem.** Plan A został ZAPROJEKTOWANY z rejestru
   przecieków tego korpusu; progi A7 i krzywe B1 będą na nim KALIBROWANE.
   Wynik zmierzony na korpusie, którym strojono, jest optymistycznie
   obciążony w sposób niemierzalny. Liczba marketingowa z takiego pomiaru
   nie jest defensywna – pierwszy audytor (albo konkurent) zapyta „a na
   czym Państwo stroili?".

Dodatkowo encje klastrują się w dokumentach (38 dokumentów, średnio 7,3
encji/dokument) i błędy są skorelowane wewnątrz dokumentu (jeden zły skan =
seria FN), więc efektywna próba jest MNIEJSZA niż liczba encji – przedziały
z pkt 1 są w praktyce jeszcze szersze (współczynnik deff szacunkowo
1,4–1,7; §3.6 liczy z tym zapasem).

### 3.2 Podział dev / holdout – warunek defensywności

- **`test-data/adversarial/` (istniejące 38 dokumentów + rozszerzenia):
  korpus STROJENIOWY (dev).** Na nim: krzywe progów (A7, B1), iteracje
  wzorców (B3, B4), rejestr przecieków jako narzędzie pracy. Jest jawnie
  „spalony" dla celów dowodowych – i to jest w porządku, od tego jest.
- **`test-data/adversarial-holdout/`: SPRAWDZIAN.** Nowe seedy wartości
  I nowe szablony dokumentów (nie tylko nowe nazwiska w starych zdaniach –
  inaczej holdout nie mierzy generalizacji, tylko pamięć szablonów).
  Zamrożony po wygenerowaniu; mierzony wyłącznie na bramkach; każdy pomiar
  odnotowany w dzienniku przebiegów. Jeżeli ktokolwiek zacznie naprawiać
  błędy „pod holdout", korpus przestaje być sprawdzianem – wtedy
  obowiązkowa regeneracja z nowym seedem i nowymi szablonami (polityka
  zapisana w README holdoutu, żeby przyszłe sesje jej nie odtwarzały
  z pamięci).
- **Podzbiór `holdout-human` (opcjonalny, najsilniejszy dowodowo):**
  5–10 dokumentów napisanych ręcznie (fikcyjnych, wzorowanych na realnej
  praktyce kancelarii – komparycje, styl, gęstość), anotowanych wg tej samej
  polityki. Generator nie ma szans pokryć pełnej wariancji żywego języka
  pism; ręczna próbka jest odpowiedzią na zarzut „testowaliście na własnym
  generatorze". Anotacja przez drugą osobę/sesję niż autor dokumentu
  (rozdzielenie ról pisarz–anotator).

### 3.3 Kwoty per klasa (z uzasadnieniem)

Zasada: klasy słabe i klasy wagi 5 dostają próbę wystarczającą do
STEROWANIA pracą (dwustronny 95% przedział ±5–7 p.p. przy oczekiwanym
recall 80–90% ⇒ n ≈ 100–200 na klasę); klasy mocne (telefony, e-maile,
daty) tylko podtrzymują pokrycie regresyjne. Docelowy holdout:

| Klasa / typ | Dziś (dev, 279) | Holdout (cel) | Uzasadnienie |
|---|---|---|---|
| PERSON_NAME (w tym odmiana, inicjały, dwuczłonowe) | 85 | 200 | typ wagi 4 o największej liczności w realnych pismach; podklasy: odmiana 60, inicjały 30, dwuczłonowe 30, OCR 40, pospolite-pułapki 40 |
| PERSON_ROLE_OR_TITLE | 17 | 100 | najsłabsza klasa (R 23,5%); bez próby nie da się przyjąć B4 |
| DOCUMENT_REFERENCE (sygnatury własne) | 14 | 80 | F1 44,4%; formaty repertoriów × sądy × lata |
| Rodzina identyfikatorów (PESEL, NIP, REGON, KRS, IBAN/NRB, dowód, paszport, prawo jazdy, VIN, rejestracja) | ~45 | 150 (≥ 15/podtyp) | wagi 4–5; tu żyje L6/L9 i sumy kontrolne A1 |
| Art. 9–10 (HEALTH, CRIMINAL, TRADE_UNION + pozostałe) | 6 | 90 (30/30/15 + 15) | waga 5; dziś próba śladowa – recall tej klasy jest dziś NIEZNANY, a to ona niesie tajemnicę najcięższą; frazy opisowe ≥ 50% próby |
| FINANCIAL_AMOUNT (w tym słowne i mieszane) | 33 | 80 | formaty + pułapki stóp procentowych |
| POSTAL_ADDRESS / LOCATION | 40 | 100 | łamania wierszy, koperty, stopki |
| ORGANIZATION_NAME / _IDENTIFIER | 35 | 80 | wersaliki komparycji (dowód dla B2) |
| Klasy OCR (podmiany glifów, rozstrzelenia, sklejenia, przenoszenia, **diakrytyki**) | ~24 | 100 (20/klasę) | diakrytyki to nowa klasa (B5); rozstrzelenia zostają jako pomiar ograniczenia C1 (oczekiwany niski recall – mierzymy uczciwie, nie ukrywamy) |
| Pułapki FP (cytowania, role generyczne, nazwy pospolite, stopy) | ~30 dok.-encji | utrzymać ~12% objętości | precyzja pod podłogę z §4.2 |
| **Razem encji** | **279** | **~1000–1100** | §3.6: przy 1000 encjach i deff ≤ 1,6 obserwowane ≥ 92,5% daje dolną granicę ≥ 90% |

Dokumentów: ~120–140 (średnio 8 encji/dokument, jak dziś), w tym ~15%
dokumentów „długich" (typ adw_27, pozew z kumulacją) – długie dokumenty
testują chunking i powtórzenia, których krótkie ataki nie widzą.

### 3.4 Generator (rozszerzenie istniejącego, nie nowy byt)

`scripts/generate-adversarial-corpus.mjs` już jest deterministyczny
(bajt w bajt, offsety liczone przy generacji, strażnik
`ground-truth.test.js` obejmuje korpus automatycznie). Rozszerzenia:

1. **parametr `--pool=dev|holdout`:** rozłączne przestrzenie seedów
   ORAZ rozłączne zestawy szablonów zdań/dokumentów (twarda asercja
   rozłączności wartości: żadne nazwisko/PESEL/IBAN z dev nie występuje
   w holdout – test);
2. **kwoty per klasa z §3.3 jako manifest generatora** (JSON w repo):
   generacja czyta manifest, samokontrola liczy wygenerowane encje per typ
   i odmawia zapisu przy niedoborze (kwota jest kontraktem, nie nadzieją);
3. **klasa diakrytyczna:** deterministyczna mapa degradacji (pozycje
   wyznaczane seedem, podmiany z tablicy par l↔ł, a↔ą, e↔ę, ó↔o, ś↔s, ż↔z,
   ź↔z, ć↔c, ń↔n) aplikowana do CZĘŚCI wystąpień encji (nigdy wszystkich –
   scenariusz ataku to właśnie mieszanka form w jednym dokumencie);
4. **wszystkie wartości w 100% fikcyjne** – bez zmian (sumy kontrolne
   poprawne, przynależność żadna); to jest warunek publikowalności
   metodologii (§4.3);
5. README holdoutu dokumentuje politykę z §3.2 (zamrożenie, dziennik
   pomiarów, regeneracja po skażeniu).

### 3.5 Polityka anotacji – delty względem README korpusu

Dziedziczymy politykę istniejącą w całości (sądy/banki jako
ORGANIZATION_NAME, cytowania orzecznictwa nieanotowane jako pułapki,
OCR anotowany prawdziwym typem, blok adresowy jako jeden POSTAL_ADDRESS).
Trzy delty wymagające rozstrzygnięcia PRZED generacją holdoutu:

1. **Taksonomia wynagrodzeń (decyzja otwarta nr 5 z EVAL-AUDIT-NOTES §2):**
   GT używa FINANCIAL_AMOUNT, model emituje INCOME_COMPENSATION – podwójna
   kara w scoringu za rozstrzygnięcie czysto nazewnicze. Rekomendacja:
   **klasa ekwiwalencji w scoringu** `{FINANCIAL_AMOUNT,
   INCOME_COMPENSATION}`, zadeklarowana jawnie w konfiguracji scoringu
   i w README (scoring raportuje OBIE liczby: ścisłą i po ekwiwalencji;
   bramka liczy po ekwiwalencji). Rodzina identyfikatorów ekwiwalencji NIE
   dostaje – typ niesie semantykę legendy i ryzyko L9; jej pomyłki łapie
   rejestr przecieków (już agnostyczny) i domyka B6.
2. **Frazy opisowe art. 9–10:** anotowany span = minimalna fraza niosąca
   fakt szczególny (kotwica + dopełnienie), NIE całe zdanie. Uwaga
   metodologiczna: GT nie może być pisane „pod wzorce B3" – anotator
   wyznacza span z definicji faktu, nie z tego, co złapie leksykon;
   rozbieżność GT↔B3 jest sygnałem do poprawy B3, nigdy GT.
3. **Diakrytyki:** wystąpienie zdegradowane anotowane prawdziwym typem
   i pełnym spanem (spójnie z istniejącą polityką OCR: człowiek
   zniekształcone nazwisko nadal odczyta).

### 3.6 Statystyka: co daje jaka próba

Dolna granica jednostronnego 95% przedziału ufności (Wilson) dla recall,
na poziomie encji; w nawiasie wariant z korektą klastrowania (deff = 1,6,
czyli n efektywne = n/1,6) – bramka liczy dodatkowo bootstrap po
dokumentach (10 000 replik, percentyl 5), który korekty nie potrzebuje,
bo respektuje strukturę dokumentową wprost:

| Recall obserwowany | n = 279 | n = 600 | n = 1000 |
|---|---|---|---|
| 91,0% | 87,8% | 88,9% (88,3%) | 89,4% (88,9%) |
| 92,0% | 88,9% | 90,0% (89,4%) | 90,5% (90,0%) |
| 93,0% | 90,1% | 91,1% (90,5%) | 91,6% (91,1%) |
| 95,0% | 92,4% | 93,3% (92,8%) | 93,7% (93,4%) |

Odczyt praktyczny: **przy ~1000 encjach holdoutu obserwowane 92,5–93%
daje dolną granicę ≥ 90% także po korekcie klastrowania.** Stąd cel
operacyjny modułów: ≥ 93% punktowo (spójny z rachunkiem §1.4), i stąd
kwota ~1000, nie „im więcej tym lepiej" (koszt anotacji rośnie liniowo,
zysk CI maleje pierwiastkowo; 600 encji wystarczyłoby ledwie na styk przy
93%, bez zapasu na klastrowanie i na klasy słabe).

Per klasa (sterowanie, nie marketing): n = 100 przy recall ~85% daje
dwustronnie ±7 p.p. – wystarcza do decyzji „które moduły działają",
za mało do publicznych deklaracji per typ. Deklaracja marketingowa
pozostaje na poziomie agregatu + zdania o wagach (§4.3).

---

## §4. Definicja „90%+" i bramka GATE-RECALL-90

### 4.1 Metryka, korpus, artefakt (definicja bez niedomówień)

**„Recall 90%+" znaczy dokładnie:**

- **metryka:** recall ścisły na poziomie encji – dopasowanie IoU ≥ 0,5,
  zgodność typu z jawnie zadeklarowanymi klasami ekwiwalencji (§3.5 pkt 1),
  TP tylko przy dokładnych granicach; ta sama definicja co audyt §2
  (kontynuowalność liczb). Metryka wspierająca: pokrycie znakowe
  i rejestr przecieków (`eval:analyze`) – bo scoring ścisły mierzy jakość
  detekcji, a rejestr mierzy to, co realnie wychodzi;
- **korpus:** `adversarial-holdout` (§3.2–3.3), zamrożony, ≥ 1000 encji;
  dev i syntetyczny raportowane obok informacyjnie;
- **artefakt:** warianty dystrybucji po decyzji 21 – multilang-fp32 +
  polish-fp16 (web i desktop identyczne); ŻADEN pomiar bramkowy na q8;
- **środowisko:** Node/onnxruntime-CPU (tor eval) + **smoke parytetu
  runtime'u**: ≥ 5 dokumentów holdoutu przepuszczonych przez realny worker
  przeglądarkowy (ORT WASM) z porównaniem wyników detekcji – domyka
  zastrzeżenie „artefakt ≠ runtime" (GATE §5 pkt 2) w minimalnym,
  wykonalnym zakresie; pełny harness jakości w przeglądarce pozostaje
  osobną pozycją (O-R90-5);
- **konfiguracja:** domyślna produktu (po decyzji 20 obejmuje art. 9–10) –
  mierzymy to, co dostaje użytkownik, nie tryb specjalny.

### 4.2 Warunki bramki (wszystkie naraz, nie „większość")

| # | Warunek | Próg |
|---|---|---|
| G1 | recall ścisły, holdout, agregat | **punktowo ≥ 93,0%** |
| G2 | dolna granica 95% (bootstrap po dokumentach, 10 000 replik; sanity: Wilson) | **≥ 90,0%** |
| G3 | pełne wycieki (pokrycie znakowe 0%) typów wagi ≥ 4 na holdoucie | **ZERO** (rekomendacja przyjęta wprost z zadania bramki) |
| G4 | częściowe przecieki typów wagi 5 | każdy przejrzany ręcznie z wpisem w raporcie bramki; żaden nie ujawnia samego faktu szczególnego (rezyduum typu „choruje na " bez nazwy choroby – dopuszczalne; nazwa choroby w rezyduum – blokada) |
| G5 | precyzja (podłoga, żeby recall nie był kupiony nieużywalnością) | syntetyczny P ≥ 85% (baseline 93,0%; A7 ma jawną licencję na +20% FP), holdout P ≥ 70% |
| G6 | syntetyczny bez regresji recall | R ≥ 92% (baseline 92,1%) |
| G7 | dyscyplina pomiaru | przebiegi tagowane, stempel `lf-utf16-v1`, strażnicy GT zieloni, komendy reprodukcji w raporcie bramki (wzór: audyt §10) |
| G8 | dziennik holdoutu | pomiar bramkowy jest 1.–2. pomiarem holdoutu w historii (§3.2); przy większej liczbie – uzasadnienie, czemu holdout nie jest skażony |

Werdykt bramki (Opus) + wpis do `PRODUCT-DECISIONS.md` (kolejny numer:
decyzja 22) z zatwierdzonym brzmieniem deklaracji marketingowej.
Do czasu zielonej bramki obowiązuje decyzja Alana: **marketing wstrzymany**
(GATE §7).

### 4.3 Co Alan może wtedy uczciwie napisać (i czego nie)

**Wariant pełny (materiały produktowe, strona):**

> „Skuteczność wykrywania danych osobowych zmierzyliśmy na kontradyktoryjnym
> korpusie ~140 fikcyjnych dokumentów prawniczych (ponad 1000 danych
> osobowych: nazwiska w odmianie, PESEL/NIP/IBAN w zapisach łamanych,
> dokumenty po OCR, dane o zdrowiu i karalności). Wynik: wykrywalność
> [XX,X]%, z ufnością 95% co najmniej 90%. Żadna dana o najwyższej wadze
> (identyfikatory, zdrowie, karalność) nie przeszła w całości. Metodologia
> i korpus testowy są jawne; dane testowe są w 100% fikcyjne."

**Wariant krótki (ulotka, slajd):**

> „Ponad 9 na 10 danych osobowych wykrytych w najtrudniejszych testach na
> polskich pismach procesowych – wynik mierzony, nie deklarowany."

**Obowiązkowe zastrzeżenia obok każdej deklaracji** (to one czynią liczbę
obronialną, a nie ją osłabiają):

- wynik narzędzia zawsze podlega przeglądowi człowieka przed wysłaniem
  (human-in-the-loop to konstrukcja produktu, nie przeprosiny);
- dokumenty z OCR (skany) wymagają szczególnej uwagi – rozstrzelone
  litery i zniekształcenia mogą ujść detekcji (ograniczenie C1, mierzone
  jawnie w korpusie);
- kwoty opisane słowami bez cyfr („dwukrotność wynagrodzenia") nie są
  maskowane automatycznie – weryfikator je flaguje (C2);
- do czasu MD4: przy imporcie DOCX treść przypisów, nagłówków i stopek nie
  przechodzi przez sito (C3/γ).

**Czego napisać NIE wolno (lista zamknięta na potrzeby materiałów):**
„usuwa wszystkie dane", „gwarantuje anonimizację", „zapewnia zgodność
z RODO", „100% skuteczności", jakakolwiek liczba bez wskazania korpusu
i metody, jakakolwiek sugestia, że przegląd człowieka jest zbędny.
Uzasadnienie zawodowe: deklaracje radcy prawnego o produkcie muszą być
rzetelne i weryfikowalne (zasady informowania o działalności); liczba
z jawną metodą i przedziałem ufności spełnia ten standard, przymiotniki
nie.

---

## §5. Kolejność, koszty, zależności, bramki

| Krok | Co | Koszt | Zależy od | Bramka Opusa |
|---|---|---|---|---|
| R0a | rozstrzygnięcie taksonomii wynagrodzeń (§3.5 pkt 1) – decyzja Alana | XS | – | nie (decyzja produktowa) |
| R0b | korpus 2.0: manifest kwot + generator `--pool` + klasa diakrytyczna + holdout (§3) | M–L | R0a | nie (dane testowe; przegląd próbki na bramce końcowej) |
| R0c | przekazanie R-1/R-2 Sonnetowi (fałdowanie glifów w A1, VIN) – notatka, nie kod | XS | – | nie |
| R1 | pomiar po merge'u planu A: oba korpusy dev + analyze, aktualizacja rachunku §1.4 realnymi liczbami | S | merge A | nie |
| R2 | **B4-lite** leksykon ról/tytułów | S–M | R1 | nie |
| R3 | **B2** wersaliki | M | R1 | nie |
| R4 | **B3** leksykon art. 9–10 | M | R1 | **tak (lekka: przegląd leksykonu)** |
| R5 | **B5a/B5b** diakrytyki (dosiew + checker N-11) | S+S | R1 (B5b także W5 – już scalony) | nie |
| R6 | **B1** ensemble – WARUNKOWO: wchodzi, jeżeli po R1 inicjały/role nadal ciekną mimo A8 | M | R1 (pomiar A8) | nie |
| R7 | **B6** rodziny typów (przestawienie filtra kategorii) | M | R1 (kolizja kolejności kroków z planem A) | nie |
| R8 | **B5d** pomiar OCR rec (CER diakrytyków, warianty modelu) | M | niezależny | tak, jeżeli wymiana artefaktu |
| R9 | iteracja na dev do celu operacyjnego ≥ 93% punktowo | S–M | R2–R7 | nie |
| R10 | **GATE-RECALL-90** na holdoucie (§4.2) + decyzja 22 + odblokowanie marketingu | S (pomiar) | R0b + R9 | **TAK (właściwa bramka)** |
| po | B4-full (paradygmaty ról z W1), fine-tuning B3 (kryteria wejścia §2.3) | S / L | bramka O-3 W1 / kryteria | dziedziczą swoje |

Uwagi do sekwencji:

- **R0b można zacząć natychmiast** – korpus nie dotyka `src/pipeline`,
  więc nie koliduje z Sonnetem; im wcześniej istnieje holdout, tym mniejsza
  pokusa mierzenia bramki na dev.
- Kolejność R2 przed R3/R6: role to największa resztka (L1) przy
  najniższym koszcie; B1 jest warunkowy, więc nie blokuje niczego.
- Wszystkie moduły R2–R7 są rozłączne plikowo poza B6 (przestawia kroki) –
  B6 celowo ostatni z pipeline'owych.
- Bramka R10 obejmuje przegląd próbki holdoutu (jakość szablonów
  i anotacji), warunki G1–G8 i brzmienie deklaracji z §4.3.

---

## §6. Rejestr ryzyk i decyzji otwartych + rekomendacje

### 6.1 Rejestr O-R90 (do rozstrzygnięcia; właściciel w nawiasie)

| # | Ryzyko / decyzja | Propozycja projektu | Stan |
|---|---|---|---|
| O-R90-1 | **Skażenie holdoutu** przez wielokrotne pomiary/naprawy „pod sprawdzian" | dziennik pomiarów + polityka regeneracji (§3.2); warunek G8 bramki | polityka w tym dokumencie; egzekwuje bramka (Opus) |
| O-R90-2 | **Koszt precyzji** strojenia pod recall (C5: maskowane cytowania, stopy) – gdzie jest granica użyteczności | podłogi G5 (synt. P ≥ 85%, holdout P ≥ 70%); powyżej podłogi FP jest tani, FN katastrofalny | wymaga akceptacji Alana co do zasady (jak A7 w EVAL-AUDIT-NOTES §2 pkt 2) |
| O-R90-3 | **Klasy ekwiwalencji typów w scoringu** (wynagrodzenia) | tak dla {FINANCIAL_AMOUNT, INCOME_COMPENSATION}, jawnie deklarowane, obie liczby raportowane; identyfikatory bez ekwiwalencji (L9/B6) | decyzja Alana (R0a) |
| O-R90-4 | **Fuzzy diakrytyczny a tożsamość osób**: czy scalanie wariantów w legendzie może być kiedykolwiek automatyczne | NIE – tylko sugestia N-11 + decyzja człowieka (werdykt §2.5); dosiew maskowania tak, konsolidacja nie | werdykt projektu; do potwierdzenia przy bramce W4/W7 weryfikatora |
| O-R90-5 | **Parytet runtime'u** (Node vs ORT-WASM) mierzony tylko smoke'iem | smoke ≥ 5 dokumentów w bramce (§4.1); pełny harness jakości w przeglądarce jako osobny projekt (GATE §7 „otwarte") | otwarte, poza tą iteracją |
| O-R90-6 | **Generator za schematyczny** → recall zawyżony względem żywych pism | rozłączne szablony dev/holdout + podzbiór holdout-human (§3.2) + przegląd próbki na bramce | mitygacja w projekcie |
| O-R90-7 | **Licencje modeli bazowych** przy ewentualnym fine-tuningu | kryterium wejścia nr 3 w §2.3 – weryfikacja u źródła przed startem projektu | odłożone do decyzji o fine-tuningu |
| O-R90-8 | **Rozstrzelony OCR (L5) zostaje poza 90%** – czy komunikacja C1 wystarcza | tak dla tej iteracji: klasa mierzona jawnie w holdoucie (niski wynik raportowany, nie ukrywany), weryfikator flaguje sekwencje liter (R3 audytu), warstwa mapowania offsetów = osobny projekt z własnym gate'em | decyzja Alana przy R10: akceptacja ograniczenia w materiałach |

### 6.2 Rekomendacje do innych dokumentów i strumieni (bez modyfikowania ich tutaj)

- **R-1 (do Sonneta, kontrakt A1):** A1 MUSI obejmować fałdowanie glifów
  OCR (l/I→1, O→0, ewentualnie S→5, B→8) wewnątrz okien kandydatów
  identyfikatorów PRZED liczeniem sumy kontrolnej (dowód: rejestr #18,
  IBAN `lO9O`); fold ograniczony do okien z kontekstem etykiety
  (PESEL/NIP/IBAN/nr) albo długich ciągów cyfropodobnych – nie globalnie
  (precyzja). Bez tego L6 zostaje resztką i psuje G3.
- **R-2 (do Sonneta, A1 rozszerzenie):** wzorzec VIN (17 znaków
  [A-HJ-NPR-Z0-9], bez I/O/Q) jako identyfikator wysokiej precyzji
  z samej długości i alfabetu – domyka pomyłki VIN→DOCUMENT_REFERENCE
  z macierzy §5.1 po stronie typu.
- **R-3 (LOCAL-VERIFIER, katalog W5):** dopisać checker N-11
  (pary diakrytyko-konfuzyjne, §2.5 B5b) do katalogu §4.1 – katalog jest
  jawnie otwarty; sekwencje pojedynczych liter (C1) i kwoty słowne (C2)
  już są w R3 audytu.
- **R-4 (SHARED-FOUNDATION / dyscyplina):** pomiary bramkowe rozszerzyć
  o profil konfiguracji okrojonej (§2.6 pkt 4) – dziś eval nie widzi
  kanału L9.
- **R-5 (PRODUCT-DECISIONS):** po bramce R10 wpis decyzji 22 (deklaracja
  marketingowa + liczby + data pomiaru + odesłanie do raportu bramki).
- **R-6 (W1-W3-MORPHOLOGY):** sekcja `role` artefaktu morph-pl.json zyskuje
  drugiego konsumenta (B4-full) – przy implementacji W1 uwzględnić
  w kontrakcie loadera, że formy ról służą też pipeline'owi (afordancja
  już zapowiedziana w §3.5 tamtego projektu dla A9; B4 to trzeci klient
  tego samego słownika).

---

*Koniec projektu. Następne kroki wykonawcze: R0a (decyzja Alana o taksonomii
wynagrodzeń), R0b (korpus 2.0 – można startować równolegle z pracą Sonneta),
R0c (przekazanie R-1/R-2). Pomiar R1 po merge'u planu A zastępuje szacunki
§1.4 liczbami i rozstrzyga warunek wejścia B1. Bramka GATE-RECALL-90 (§4.2)
jest jedynym miejscem, w którym „90%+" staje się zdaniem do publikacji.*
