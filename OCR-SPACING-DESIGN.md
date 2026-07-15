# OCR-SPACING-DESIGN.md – rozstrzelone nazwiska ze skanów (moduł OS)

Status: projekt (zero kodu). Autor: Fable (architekt). Data: 2026-07-15.
Wzorzec formatu: moduł B4 / SURNAME-GAZETTEER-DESIGN.md (diagnoza → kontrakt →
kryterium akceptacji → test dowodzący → koszt → bramka).

## §0. Werdykt tezy (deliverable zadania)

**Teza potwierdzona: wąski wzorzec „pojedyncze litery oddzielone pojedynczą
spacją" to moduł M, nie duża sesja.** Uzasadnienie techniczne w trzech
zdaniach: (1) `normalizeWhitespace` jest no-opem, a pipeline nigdy nie
przepisuje `ctx.text` – offsety encji zawsze wskazują oryginał, więc mapa
offsetów może być **przejściowa i lokalna** (per segment, żyje wyłącznie
wewnątrz jednego kroku fazy `ner`, jak wariant wersalikowy B2); (2) dla tego
wzorca mapa jest **mechaniczna i monotoniczna** (tablica pozycji liter:
i-ty znak sklejonego wariantu → znana pozycja w oryginale), z własnością
wierności znakowej testowalną property-testem; (3) GT holdoutu anotuje pełny
rozstrzelony span w oryginale (`hold_ocr_mega_00`: `[73,92]`
„W r ó b l e w s k a"), więc kandydat po zmapowaniu jest zwykłą encją –
segmentacja, dedup, warstwy, legenda i tokenizacja pozostają nietknięte.

**Co pozostaje dużą sesją (C1-ogólne):** dowolne wstawki/usunięcia/podmiany
glifów wymagają dokumentowej warstwy tekst-znormalizowany ↔ oryginał
przenikającej segmentację, backfill i legendę – nic z tego dokumentu tego
nie buduje ani nie przybliża. Tripwire'y odcięcia w §2.6.

## §1. Diagnoza i zakres

**Zmierzony problem (holdout §4.1, klasa `hold_ocr_mega`):** OCR oddaje
nazwiska jako litery rozdzielone spacjami – „W r ó b l e w s k a",
„K a m i ń s k i". Żaden matcher tokenowy ani model nie widzi takiego
nazwiska (tokenizacja rozcina je co znak) → pełne wycieki wagi 4
(PERSON_NAME, warstwa `mask`). To luka nr 1 z ZAKRES-ANONIMIZACJI.md §5
(klasa C1): z ~135 braków rdzenia W1 **~40 to OCR** – największa pojedyncza
resztka po rekalibracji zakresu. Gazeter SG i leksykon B3 tej klasy nie
ruszają (SG §1 jawnie odsyła tutaj).

**Zakres (wąski, zamknięty):** wyłącznie ciągi **pojedynczych liter**
rozdzielonych **pojedynczą spacją**, z przerwą międzywyrazową ≥ 2 spacje
albo przejściem wielkości liter (gramatyka §2.2 pkt 1). Klasa `hold_ocr_mega`
zawiera też sklejenia („BożenaWróblewska") i przenoszenia („Wr-\nóblewską") –
te **pozostają FN** tego modułu (nazwane, mierzone dalej, bez ukrywania).

**Poza zakresem (twarde):** ogólne mapowanie offsetów (dowolne zniekształcenia
OCR), podmiany glifów l↔1/O↔0 (A1/R-1), diakrytyki „Kolkowski↔Kołkowski"
(B5), rozstrzelenia częściowe/mieszane („Wr ó blewska"), rozstrzelone ciągi
cyfr (kandydat na v1.1, O-OS-4), sklejenia i przenoszenia.

## §2. Moduł OS – detekcja rozstrzelonych słów z proweniencją OCR

### 2.1 Zasada: normalizuj i pytaj model, nie zgaduj z wzorca

Rozstrzygnięcie mechanizmów z zadania:

- **(a) NORMALIZUJ** (sklej ciąg → NER na wariancie → zmapuj offsety):
  koszt = detektor + mapa + inferencja ×2 na segmentach z ciągami (tylko
  dokumenty OCR, pojedyncze segmenty – wzór kosztowy B2); precyzja = decyzję
  „czy to nazwisko i JAKIEGO typu" podejmuje model na tekście, na którym jest
  kompetentny; ryzyko = błąd mapy (mitygowany property-testem i fail-open).
- **(b) EMITUJ WPROST** (rozstrzelony ciąg z wielkiej litery → kandydat
  PERSON_NAME): koszt niższy (zero inferencji, zero mapy – span ciągu jest
  znany z detekcji); ale precyzja ma dwie dziury nie do załatania wzorcem:
  (i) **typowanie** – „W I E L K O P O L S K I  U R Z Ą D  W O J E W Ó D Z K I"
  (GT: ORGANIZATION_NAME, warstwa `pass`) zostałby PERSON_NAME, czyli błąd
  typu i szum/nadmaskowanie dokładnie tam, gdzie model trójwarstwowy mówi
  „nie maskuj"; (ii) **pokrycie ścieżki mask** – potwierdzeniem w (b) miał
  być gazeter SG, ale SG jest listą KOLIZYJNĄ (~300–500 lematów); „Wróblewska"
  i „Kamiński" w niej nie występują, więc ścieżka mask mechanizmu (b)
  kurczy się do samych slotów składniowych.
- **Rekomendacja: (a) jako silnik, z resztówką (b) do kosza W2.** NER na
  wariancie sklejonym typuje i punktuje kandydatów (ścieżka główna); ciąg
  wykryty wzorcem, którego NER nie potwierdził, nie znika bez śladu, tylko –
  jeżeli jest title-case – idzie do W2 jako kandydat `forceTier: 'review'`
  (siatka bezpieczeństwa: „rozstrzelone słowo z wielkiej litery na skanie"
  jest z góry podejrzane; decyzja radcy, nie maszyny). To nie jest trzeci
  mechanizm: detektor i tak istnieje, emisja resztkowa jest darmowa.

### 2.2 Kontrakt

1. **Gramatyka wzorca (detektor, faza `ner`, per segment).**
   - *Token:* dokładnie jedna litera `\p{L}` z nie-literą po obu stronach.
   - *Separator wewnątrzwyrazowy:* dokładnie jedna spacja.
   - *Słowo rozstrzelone:* klasa **T** (title-case): 1 token wielką literą +
     ≥ 3 tokeny małymi („W r ó b l e w s k a"); klasa **C** (wersaliki):
     ≥ 4 tokeny wielkimi. Minimalna długość N = 4 litery; 3-literowe słowa
     („K o s") dopuszczone WYŁĄCZNIE gdy sklejenie ∈ formy gazetera SG albo
     lista imion PESEL (O-OS-1) – inaczej cisza.
   - *Granica słowa:* ≥ 2 spacje, tabulator, koniec linii, znak niebędący
     literą ani spacją, ALBO przejście mała→WIELKA między tokenami
     („B o ż e n a W r ó b l e w s k a" → dwa słowa: „Bożena", „Wróblewska";
     polszczyzna nie ma wielkich liter wewnątrz wyrazu).
   - *Fraza:* sąsiadujące słowa rozstrzelone (przerwa ≤ 3 znaki białe)
     tworzą jedną frazę – w wariancie sklejonym rozdzielone pojedynczą spacją
     („Bożena Wróblewska"), żeby model widział pełne imię i nazwisko.
   - *Wykluczenia z konstrukcji:* inicjały „J. K." (kropka przylega do
     litery → token nie jest goły), wyliczenia „a) b) c)" (nawias), akronimy
     „RP", „S.A." (brak separatorów pojedynczej spacji), tokeny małą literą
     przed słowem T („w T o r u n i u" → tylko „Toruniu"; przyimek zostaje),
     rozstrzelenia emfatyczne małą literą („p o s t a n a w i a" – konwencja
     maszynopisów sądowych: brak klasy, cisza i zero kosztu inferencji).
2. **Wariant sklejony + mapa (rdzeń modułu, własność przejściowa kroku).**
   Dla segmentu z ≥ 1 słowem rozstrzelonym: zbuduj wariant, w którym każde
   słowo rozstrzelone jest sklejone, przerwy międzywyrazowe frazy → jedna
   spacja, cała reszta segmentu przepisana tożsamościowo. Równolegle tablica
   `origPos[i]` = pozycja w oryginale i-tego znaku wariantu. **Inwariant
   wierności znakowej:** dla każdego `i` nie będącego wstawioną spacją frazy,
   `original[origPos[i]] === variant[i]`; tablica ściśle rosnąca. Naruszenie
   (asercja w kroku) ⇒ segment pomijany, fail-open do status quo (wzór B2:
   brak kandydatów, zero szkody). Mapowanie encji `[s,e)` z wariantu →
   `[origPos[s], origPos[e-1] + 1)` w oryginale (span obejmuje litery WRAZ
   z wewnętrznymi spacjami – zgodnie z anotacją GT pełnego ciągu). Mapa
   umiera z końcem kroku – nie wycieka do kontekstu, legendy ani debug diffs.
3. **Słowa klasy C w wariancie:** po sklejeniu dostają fold Title Case
   funkcją B2 (zachowuje długość, więc składa się z mapą bez nowych offsetów) –
   „WIELKOPOLSKI" → „Wielkopolski"; bez tego oba modele są ślepe na wersaliki
   (diagnoza B2). Krok B2 sam w sobie NIE koliduje: jego trigger to słowo
   wersalikowe ≥ 3 liter, a w tekście rozstrzelonym każda litera jest
   1-literowym słowem – triggery rozłączne, zero podwójnej inferencji.
4. **Inferencja i źródło.** Oba modele (jak B2) na wariancie, wyłącznie dla
   segmentów z detekcją. Kandydaci wchodzą jako osobne źródło, alias
   `despaced`: wpis w `SOURCES`, jawne dopisanie do `ENTITY_SOURCES` dla
   zamkniętej listy typów **identycznej z B2** (PERSON_NAME,
   ORGANIZATION_NAME, POSTAL_ADDRESS, LOCATION, PERSON_ROLE_OR_TITLE – bez
   wpisu `sourceFilterStep` wycina kandydata niezależnie od score), próg
   w `thresholdBySource` start 0,8 (kontekst zdaniowy zaburzony jak w B2;
   finalnie z pomiaru na dev). Typ z modelu → warstwa z `tierFor(type)`:
   PERSON_NAME → `mask`, LOCATION → `review`, ORGANIZATION_NAME → `pass` –
   model trójwarstwowy działa bez wyjątków, nagłówek urzędu NIE jest maskowany.
5. **Emisja resztkowa (siatka W2).** Słowo/fraza klasy T bez pokrycia żadnym
   kandydatem NER z wariantu → jeden kandydat PERSON_NAME na pełny span,
   `score: 0.95` (racje `LEXICON_SCORE`: poniżej regex-tier 1,0, w oknie
   epsilon dedupu – wzór SG §2.2 pkt 7), z flagą:
   - sklejenie ∈ gazeter SG (formy) **albo** słowo w slocie S1–S5 z pliku SG
     (imię PESEL obok, inicjał, Pan/Pani, rola procesowa z `nonEntity`,
     fraza funkcyjna) → **bez flagi** (efektywna warstwa `mask` – „wysoka
     pewność" wg zadania);
   - w przeciwnym razie → `forceTier: 'review'` (kosz W2). Klasa C bez
     potwierdzenia NER: cisza (wersalikowe rozstrzelenia to w praktyce
     nagłówki instytucji; koszt tej decyzji mierzony na holdoucie).
   Mechanizm `forceTier: 'review'` to TA SAMA delta kontraktu ST-2, którą
   wprowadza SG (GS-5) – moduł, który wejdzie pierwszy, niesie deltę,
   drugi ją konsumuje; brzmienie identyczne, zero renegocjacji.
6. **Brama proweniencji (warunek aktywacji, reuse B5a).** Krok działa
   WYŁĄCZNIE gdy dokument ma proweniencję OCR – to samo pole, które
   definiuje B5a (RECALL-90 §2.5 pkt 1: „flaga importu, rozróżnialna po
   ścieżce pliku/obrazu"). Kontrakt pola: `ctx.meta.ocrProvenance = true`
   ustawiane przez wołającego (worker: import przez `src/ocr/*`; eval:
   manifest klasy dokumentu / prefiks pliku `*ocr*`); brak pola ⇒ krok jest
   twardym no-opem (`active`-guard jak `createLexiconStep`). Kto pierwszy
   wejdzie do main (OS albo B5a), ten definiuje pole; drugi reużywa. Na
   czystym tekście wzorzec nie ma prawa nic kosztować – ani FP, ani latencji.
7. **Postproces bez zmian kontraktów.** Zmapowany kandydat jest zwykłą
   encją: snap nie rusza granic (span zaczyna i kończy się na pełnych
   1-literowych słowach), dedup z kandydatami modelu/fragmentami idzie
   istniejącymi gałęziami (bliskie score → szerszy span; kandydat `review`
   pokryty modelowym `mask` znika z kosza w partycji ST-2 – precedens SG),
   `maxLengthStep` musi tolerować spany ~2× długości sklejonej (golden;
   jeżeli limit typu tnie – korekta limitu, nie mapy). Backfill: wartość
   encji to oryginalny rozstrzelony tekst, więc `fuzzyBackfill` NIE dosieje
   form zwartych tego nazwiska w dokumencie ani odwrotnie – każde
   rozstrzelone wystąpienie łapie sam detektor (deterministyczny), a dosiew
   między formami zwartymi a rozstrzelonymi tylko MIERZYMY (obietnic brak;
   analogia SG §2.2 pkt 8). Legenda pokazuje formę rozstrzeloną verbatim –
   kosmetyka do ewentualnej poprawy w UI, nie kontrakt.
8. **Więzy wykonawcze.** Air-gap: zero danych zewnętrznych (reuse plików SG),
   zero sieci. Budżet czasu: detektor liniowy po segmencie; inferencja ×2
   tylko na segmentach z detekcją w dokumentach OCR (na czystych: 0). Krok
   samowyłączalny flagą `active`; emisja resztkowa `review` wyłączona do
   wejścia ST-2 (kandydat bez kosza nie ma ujścia – sekwencja §6).

### 2.3 Kryterium akceptacji

Podzbiór pomiarowy definiowany MECHANICZNIE z GT: encje holdoutu, których
`text` pasuje do gramatyki §2.2 pkt 1 (klasyfikator w eval:analyze, nie nowa
anotacja); klasa `hold_ocr_mega` + rozstrzelenia w innych klasach OCR.

1. **Recall rozstrzelonych PERSON_NAME (podzbiór jw.): ≥ 80% w warstwie
   `mask`; pokrycie (mask ∪ review) = 100% dla słów klasy T** zgodnych
   z gramatyką (scorer trójdrożny ST-7a liczy W1/W2 osobno). Reszta do 100%
   mask ma nazwane przyczyny per przypadek (np. klasa C bez potwierdzenia).
2. **Zero regresu na czystym tekście – dowód izolacji:** oba korpusy
   przepuszczone bez flagi OCR dają wyniki **bajt w bajt** identyczne
   z baseline (precedens kryterium B5a).
3. **Zero nowych FP w warstwie `mask` na dokumentach OCR:** rozstrzelone
   nagłówki instytucji (GT: ORGANIZATION_NAME/`pass`) nie są maskowane ani
   nie lądują w koszu jako PERSON_NAME; golden na `hold_ocr_mega_00`
   (nagłówek urzędu → ORGANIZATION_NAME albo cisza, nigdy mask).
4. **Sklejenia i przenoszenia jawnie poza pomiarem sukcesu:** ich FN nie
   maleją i nie rosną (moduł ich nie dotyka); raport bramki wymienia je
   osobno, żeby „recall OCR" nie sugerował pokrycia całej klasy.
5. **Szum kosza ograniczony:** średnio ≤ 3 kandydatów `review` z OS na
   dokument OCR (próg wspólnej rodziny z O-SG-3; przekroczenie = zaostrzenie
   gramatyki/N, nie akceptacja szumu).
6. Syntetyczny i adversarial-dev: P/R bez zmian (wynika z pkt 2); eval
   tagowany przed/po na obu korpusach + holdout wyłącznie na bramce
   (dyscyplina G8).

### 2.4 Test dowodzący

- **Property-test mapy (rdzeń dowodu):** fuzz na losowych tekstach
  z wstrzykniętymi rozstrzeleniami (nazwiska z korpusowych pul, różne klasy
  T/C, frazy wielowyrazowe, przerwy 2–4 spacje): inwariant wierności
  znakowej (`original[origPos[i]] === variant[i]`), ścisła monotoniczność,
  roundtrip spanów (encja na wariancie → oryginał → tekst spanu po usunięciu
  spacji == tekst encji z wariantu).
- **Jednostkowe gramatyki (pozytywy/negatywy z §2.2 pkt 1):**
  „W r ó b l e w s k a" → słowo T; „B o ż e n a W r ó b l e w s k a" →
  fraza 2 słów; „J. K.", „a) b) c)", „S.A.", „p o s t a n a w i a",
  „w T o r u n i u" (przyimek), „K o s" bez potwierdzenia → cisza.
- **Golden dokumentowy `hold_ocr_mega_00` przez pełny pipeline z flagą OCR:**
  „W r ó b l e w s k a" zamaskowana (span GT `[73,92]`), nagłówek urzędu
  niemaskowany, „BożenaWróblewska" i „Wr-\nóblewską" pozostają FN (asercja
  jawna – dokument granicy zakresu).
- **Test izolacji bramy:** ten sam dokument bez flagi → zero kandydatów OS,
  wynik identyczny z baseline.
- **Testy warstwy:** NER-potwierdzony → tier typu; slot/gazeter → mask bez
  flagi; goły ciąg T → `forceTier: 'review'`; kandydat review pokryty
  modelowym mask znika z kosza (kontrakt partycji ST-2).
- Snap/maxLength/dedup: goldeny nakładek (fragment modelowy vs pełny span
  OS) i spanu ~2× długości.

### 2.5 Koszt

**M (1–2 dni):** detektor gramatyki (S) + wariant z mapą i asercjami (S,
ale to jedyny fragment wymagający chirurgicznej staranności – stąd property
test przed integracją) + scaffolding kroku po wzorze `case-folded-ner` (S) +
emisja resztkowa z reuse plików SG (S) + przewód proweniencji worker/eval
(S) + testy i eval na obu korpusach (M w sumie). Bez nowych danych, bez
nowych artefaktów modelowych, bez zmian schematu kontekstu poza polem
`meta.ocrProvenance` współdzielonym z B5a.

### 2.6 Bramki i tripwire'y odcięcia

- **Bramka Opusa: NIE.** Zero łańcucha dostaw (reuse danych SG), zero nowych
  artefaktów; obowiązuje dyscyplina eval z nagłówka RECALL-90 §2 + zasada
  holdoutu (pomiar wyłącznie na bramkach, dziennik przebiegów).
- **Delta `forceTier: 'review'`:** materia GS-5, współdzielona z SG (§2.2
  pkt 5) – jedno brzmienie, jeden wpis, niezależnie od kolejności wejścia.
- **Tripwire'y „to jednak duża sesja" (każdy z osobna zatrzymuje moduł
  i zwraca C1 do statusu L):** (T1) mapa musiałaby przeżyć krok (być
  widoczna dla dedup/backfill/legendy/UI); (T2) potrzebne przepisanie
  `ctx.text` albo zmiana offsetów segmentów; (T3) gramatyka wymaga obsługi
  wstawek/usunięć znaków (nie samych spacji), żeby przejść kryterium 2.3
  pkt 1; (T4) konieczna zmiana kontraktu snap/dedup/merge zamiast goldenów.
  Wystąpienie tripwire'a = werdykt w GATE, nie obejście w kodzie.

## §3. Styk z istniejącą architekturą (nic nie renegocjujemy)

| Element | Relacja OS | Zmiana? |
|---|---|---|
| `type-tiers.js` (ST-1) | typy bez zmian; warstwa z `tierFor(type)` + per-encyjny `forceTier: 'review'` | nie |
| ST-2 partycja | konsumuje `forceTier` – ta sama delta co SG (GS-5) | delta wspólna z SG |
| B2 case-folded | rozłączne triggery (słowa ≥ 3 liter vs 1-literowe); OS reużywa funkcji folda na słowach C | nie |
| B5a proweniencja | wspólne pole `ctx.meta.ocrProvenance`; pierwszy w main definiuje, drugi reużywa | kontrakt wspólny |
| SG gazeter | reuse: formy (potwierdzenie 3-literowych i mask), sloty S1–S5, lista imion (O-SG-2); OS nie dopisuje danych do SG | nie |
| entity-sources / SOURCES | nowy alias `despaced` (kind jak `case-folded`), jawne wpisy typów, `thresholdBySource` 0,8 | tak (wpis, wzór B2) |
| dedup/backfill (H-1/H-2) | zwykłe gałęzie; review nie seeduje backfillu; dosiew zwarte↔rozstrzelone tylko mierzony | nie |
| maxLength | limit musi tolerować span ~2× długości sklejonej | golden, ew. korekta limitu |
| eval / score-tiers (ST-7a) | klasyfikator podzbioru „rozstrzelone" w analyze + flaga proweniencji per dokument w runnerze | tak (eval-side, S) |
| korpus (RECALL-90 §3.3) | podklasa OCR ~40 encji PERSON_NAME + `hold_ocr_mega` = gotowy pomiar; zero nowej anotacji | nie |

## §4. Rejestr decyzji otwartych (dla Alana)

| Nr | Decyzja | Rekomendacja | Status |
|---|---|---|---|
| O-OS-1 | Próg N: minimum 4 litery; 3-literowe tylko z potwierdzeniem (SG/imiona) | tak jak w §2.2 pkt 1; po pomiarze ewentualnie N=3 dla klasy T ze slotem | otwarta |
| O-OS-2 | Czy emisja resztkowa `review` wchodzi razem z ST-2, czy OS startuje NER-only | NER-only może wejść wcześniej (czysty zysk mask); review razem z ST-2, jak O-SG-1 | otwarta |
| O-OS-3 | Próg szumu kosza na dokumentach OCR | ≤ 3 kandydatów OS/dokument średnio (rodzina O-SG-3) | otwarta |
| O-OS-4 | Rozszerzenie gramatyki na rozstrzelone ciągi CYFR (PESEL „9 2 0 5…") | nie w v1 (zmierzona luka to nazwiska); v1.1 po pomiarze – ta sama mapa, inna klasa tokenów i typowanie regexowe zamiast NER | odłożona |
| O-OS-5 | Aktywacja na tekście WKLEJONYM (użytkownik wkleja tekst z OCR-owanego PDF – brak flagi importu) | nie w v1 (brama ścisła = dowód precyzji); v2: heurystyka gęstości rozstrzeleń jako propozycja włączenia w UI, nigdy cicha aktywacja | otwarta |
| O-OS-6 | Definicja pola proweniencji (`ctx.meta.ocrProvenance`) wspólnie z B5a | jedno pole, kontrakt z §2.2 pkt 6; wpis do obu dokumentów przy pierwszym wdrożeniu | otwarta |

## §5. Ryzyka

| Nr | Ryzyko | Mitygacja |
|---|---|---|
| R-OS-1 | Błąd mapy (off-by-one) → maska pokrywa złe znaki: wyciek + zniszczenie treści naraz | inwariant wierności znakowej + property-test przed integracją; asercja w kroku z fail-open (segment pomijany = status quo, nigdy złe offsety) |
| R-OS-2 | FP mask na rozstrzelonych nie-nazwiskach | typowanie przez NER (ORG→pass, LOCATION→review); emisja resztkowa mask tylko slot/gazeter; klasa C bez NER milczy; kryterium 2.3 pkt 3 |
| R-OS-3 | Kosz W2 zalany na gęstych skanach | próg O-OS-3, zaostrzanie gramatyki zamiast tolerancji; review tylko klasa T |
| R-OS-4 | Brama proweniencji nie obejmuje wklejek → klasa wraca bokiem | jawna decyzja O-OS-5 (v2 z propozycją w UI), nie cicha heurystyka |
| R-OS-5 | Fraza wielowyrazowa sklejona źle (brak sygnału przerwy po agresywnym OCR) → „SĄDREJONOWY" | fallback: brak kandydata NER → dla klasy T emisja review na słowo, dla C cisza; golden z przerwą 1-spacjową między słowami C |
| R-OS-6 | Regres arbitrażu z fragmentami modelu na wariancie | score modelu/0,95 w oknie epsilon + szerszy span wygrywa (istniejąca gałąź); goldeny nakładek |

## §6. Sekwencjonowanie

1. **OS-1 (NER-primary):** detektor + mapa + krok `despaced` + brama
   proweniencji + przewód eval; emisja resztkowa wyłączona. Niezależne od
   ST-2 i SG. Eval tagowany na obu korpusach (oczekiwanie: zero zmian bez
   flagi), holdout dopiero na bramce.
2. **OS-2 (siatka W2):** po wejściu ST-2 do main (kosz istnieje) – emisja
   resztkowa `review` + próg O-OS-3; delta GS-5 wspólna z SG.
3. **OS-3 (upgrade slotowy):** po wejściu danych SG (formy, sloty, imiona) –
   część resztówki awansuje do `mask`; przy okazji decyzja o N=3.

Deferred (poza projektem): cyfry rozstrzelone (O-OS-4), wklejki (O-OS-5),
sklejenia, przenoszenia, rozstrzelenia częściowe, ogólna warstwa mapowania
offsetów (C1-ogólne – duża sesja, jeżeli pomiar po OS wykaże, że resztka
klasy OCR nadal blokuje GATE-RECALL-90).
