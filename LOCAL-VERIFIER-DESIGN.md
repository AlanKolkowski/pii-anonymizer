# LOCAL-VERIFIER-DESIGN.md – projekt lokalnego weryfikatora pisma po deanonimizacji

**Wersja:** 1.0 (projekt do akceptacji)
**Data:** 2026-07-10
**Autor:** Fable (architekt aplikacji desktopowej)
**Status:** PROJEKT. Zero kodu implementacji. Dokument czeka na bramkę Opusa,
implementacja (Sonnet) nie startuje przed akceptacją.
**Odbiorca:** Opus jako bramka bezpieczeństwa; wtórnie Alan (decyzje produktowe,
§13) i Sonnet (plan implementacji, §11).

**Relacja do istniejących dokumentów:** `SECURITY.md` opisuje zbudowany
air-gap wariantu A; `THREAT-MODEL.md` §5 R1 nazywa nieusuwalną granicę jakości
NER, a `MCP-BRIDGE-DESIGN.md` §9.4 RB-2 zapowiada „lokalny LLM-weryfikator"
jako wizję produktu. Ten dokument projektuje tę wizję w wersji, która
w większości **nie potrzebuje LLM-a**: moduł weryfikacji pisma po
deanonimizacji (fleksja imion i nazwisk + flagowanie oczywistych
nieścisłości). Rozstrzygnięcie transportowe mostu (§4.2 tamtego dokumentu:
HTTP na loopbacku odrzucone) jest tu wiążącym precedensem dla pytania
o LM Studio.

**Konwencja oznaczeń:** fragmenty JSON i tabele to schematy danych
i przykłady, nie kod implementacji. Każde miejsce dotykające kanału, PII albo
air-gap jest oznaczone **[DO WERYFIKACJI PRZEZ OPUSA: O-n]** i zebrane
w rejestrze §12. Numeracja O-n jest **lokalna dla tego dokumentu**
(rejestr mostu ma własne, niezależne O-1…O-12). Decyzje produktowe dla
Alana: §13.

---

## §1. Problem, teza, wymagania nienegocjowalne

### 1.1 Problem produktowy (workflow Alana)

Deanonimizacja podmienia token na wartość z legendy. Z kodu wynika ważne
doprecyzowanie briefu: legenda **nie trzyma formy podstawowej**, tylko formę
**pierwszego wystąpienia** danej osoby w dokumencie źródłowym
(`src/anonymizer.js:110-137`: `legend[token]` dostaje `value` pierwszego
wystąpienia grupy; warianty odmiany są grupowane przez `couldBeSamePerson`,
ale ich zbiór nie jest nigdzie zachowywany). Jeżeli pismo źródłowe zaczyna się
od „Pozywam Jana Kowalskiego…", legenda trzyma „Jana Kowalskiego" (dopełniacz)
i **każde** wstawienie w wyniku dostaje dopełniacz, także w pozycji podmiotu.
Problem jest więc dwustronny:

1. wstawiana wartość bywa już odmieniona (zła baza),
2. kontekst wstawienia wymaga innego przypadka niż wartość z legendy
   („pełnomocnik powoda ______", „doręczyć ______").

Do tego pismo po deanonimizacji, napisane przez LLM na tokenach, miewa
oczywiste nieścisłości: niezgodność rodzaju („powódka Jan Kowalski"),
ta sama osoba w rolach przeciwnych, kwota słownie inna niż cyfrowo, resztki
placeholderów, tokeny nierozwiązane, osoby, których nie było w źródłach.

Moduł „druga para oczu" ma: (1) zaproponować poprawną odmianę wstawianych
imion i nazwisk, (2) oflagować oczywiste nieścisłości. Wszystko jako
**sugestie do zatwierdzenia przez radcę**, nic automatycznie.

### 1.2 Teza centralna projektu

**Żadna z dwóch funkcji nie wymaga w v1 ani kanału komunikacji, ani nowego
runtime'u AI.** Fleksja polskich imion i nazwisk jest zadaniem morfologicznym:
regułowo-słownikowym, deterministycznym i lekkim. Najcenniejsze wykrywanie
nieścisłości to checkery deterministyczne plus ponowny przebieg **istniejących**
modeli NER na tekście wynikowym. Generatywny LLM jest wyłącznie opcjonalnym
poziomem 3 (§4, §5), którego v1 nie zawiera. W konsekwencji rekomendowany
moduł działa w całości w wariancie A i nie osłabia żadnej warstwy air-gap.
**[DO WERYFIKACJI PRZEZ OPUSA: O-1 – akceptacja tego zakresu jako
rozstrzygnięcia architektonicznego]**

Uczciwa granica obietnicy (lekcja S-MCP-1): moduł działa na **drodze
powrotnej** (wynik LLM → pismo). Nie cofa ekspozycji, która mogła nastąpić na
drodze wyjściowej (R1: przeoczone PII w tekście tokenizowanym) – adresuje
ducha RB-2 (lokalna, maszynowa druga para oczu przed użyciem dokumentu),
a jego moduły skanujące są współdzielone z kierunkiem wyjściowym (skan §6.3
mostu, moduł M4). W dokumentacji produktu: „weryfikacja wspiera przegląd,
nie zastępuje go".

### 1.3 Wymagania nienegocjowalne (V1–V5)

- **V1 – wariant A nieosłabiony.** Domyślne rozwiązanie nie ma żadnego kanału
  sieciowego ani międzyprocesowego; wszystkie warstwy `SECURITY.md` §1–§8
  pozostają nietknięte, a istniejące testy dymne przechodzą bez zmian.
- **V2 – wyłącznie sugestie.** Żadna zmiana tekstu bez jawnej akceptacji
  radcy. Schowek i eksport konsumują wyłącznie zatwierdzony bufor; brak
  decyzji = zachowanie identyczne z dzisiejszym. Gwarancja „pokazane =
  skopiowane/wyeksportowane" jak §6.8 mostu.
- **V3 – jawność losu PII.** Moduł pracuje na tekście **po deanonimizacji**,
  czyli na prawdziwych danych osobowych. W rozwiązaniu wbudowanym dane nie
  opuszczają procesów aplikacji (renderer + jego worker, tam gdzie żyją już
  dziś A1/A2). Każda opcja z kanałem (LM Studio) oznacza, że PII opuszcza
  aplikację do innego procesu – dopuszczalna wyłącznie w wariancie B, nigdy
  domyślnie, za bramką człowieka z jawnym ostrzeżeniem (§5.2).
- **V4 – integralność danych modułu.** Słowniki morfologiczne (i ewentualny
  model poziomu 3) są artefaktami wpływającymi na **treść pisma
  procesowego** – obejmuje je ta sama dyscyplina integralności co modele NER
  (fuse asara albo kotwica B1, §7.2).
- **V5 – pełna bramka Opusa** dla każdego modułu dotykającego PII, kanału,
  integralności danych albo kontraktu tokenów.

### 1.4 Poza zakresem

- Jakość detekcji NER na drodze wyjściowej (R1) – bez zmian, zarządzana
  bramką mostu i podglądem.
- Zachowanie formatowania dokumentu przygotowanego przez AI (osobny kierunek
  produktowy, ortogonalny).
- Trwałość legendy (D2: pamięć ulotna) – moduł niczego tu nie zmienia;
  wszystkie nowe struktury (formy poświadczone, plan sugestii, decyzje) są
  ulotne jak legenda.
- Poprawność merytoryczno-prawna pisma (kwoty roszczeń, podstawy prawne) –
  to domena radcy i osobnych narzędzi, nie tego modułu.

---

## §2. Miejsce w przepływie i wejście modułu

### 2.1 Przepływ dziś (z kodu)

1. Użytkownik wkleja wynik LLM: `outcome.text` z tokenami
   (`src/ui/deanon-workspace/index.js:281-289`).
2. Deanonimizacja to czysta podmiana `replaceAll(token, value)`:
   `deanonymizeText` (`src/anonymizer.js:425-431`).
3. Konsumenci podmiany (cztery miejsca):
   - podgląd wyjściowy per token (`renderParts`,
     `src/ui/deanon-workspace/index.js:141-152`, tryb `output` pokazuje
     `part.orig`),
   - przycisk „Kopiuj" (`src/ui/deanon-workspace/index.js:293`),
   - karty wyników (`src/ui/outcomes-list/index.js:65,209`),
   - eksport DOCX/PDF (`src/export/deanon.js:76` przez
     `buildDeanonExportEntries`, wołane z `src/main.js:472`).
4. Legenda efektywna per wynik: `legendSnapshot` robiony przy
   utworzeniu/aktualizacji wyniku (`src/ui/outcomes-coordinator.js:30,44`).

### 2.2 Wejście weryfikatora

Trójka: `(tekstWyniku, legendaEfektywna, formyPoświadczone)`.

**Formy poświadczone** to nowa, ulotna struktura: przy tokenizacji
`buildTokenMap`/`buildTokenMapMulti` widzi wszystkie warianty odmiany tej
samej osoby (`rawKey` → token, `src/anonymizer.js:132-136`), ale dziś je
gubi. Projekt przewiduje zachowanie zbioru wariantów obok legendy:

```json
{ "[PERSON_NAME_1]": ["Jan Kowalski", "Jana Kowalskiego", "Janem Kowalskim"] }
```

Zasady: struktura żyje wyłącznie w RAM, jest snapshotowana per wynik
dokładnie jak `legendSnapshot`, nigdy nie przechodzi przez żaden kanał
(WebMCP w webowej wersji, most w wariancie B – bez zmian: przez granicę idą
wyłącznie tokeny). Legenda sama w sobie **pozostaje nietknięta** – moduł
niczego w niej nie zmienia i nie dopisuje. **[DO WERYFIKACJI PRZEZ OPUSA:
O-2 – nowa struktura sąsiaduje z A1; potwierdzić, że nie tworzy nowej ścieżki
serializacji]**

### 2.3 Umiejscowienie obliczeń

Preferencja: **worker** (spójnie z NER/OCR: dane ładowane jak zasoby, ciężar
poza wątkiem UI; komunikacja istniejącym `postMessage`, bez nowych granic
procesowych ani IPC). Dopuszczalne uproszczenie: fleksja + checkery poziomu 1
na wątku głównym, jeśli słownik po kompilacji okaże się mały (rząd 1–3 MB) –
decyzja pomiarowa w W1. Kontrola krzyżowa NER (poziom 2) zawsze w workerze,
bo tam żyją modele. Długie przebiegi trzymają Web Lock jak inne prace
(`src/background-lock.js`).

---

## §3. Rozstrzygnięcie 1: fleksja bez LLM

### 3.1 Dlaczego to zadanie deterministyczne

- **Paradygmaty są zamknięte.** Odmiana polskich imion jest słownikowa
  (zbiór imion nadawanych w Polsce jest skończony i publikowany), a odmiana
  nazwisk rozpada się na kilka produktywnych klas: przymiotnikowe
  (-ski/-cki/-dzki: Kowalski→Kowalskiego), rzeczownikowe męskie
  (Nowak→Nowaka, z alternacjami: Marek→Marka, Wróbel→Wróbla), żeńskie
  nieodmienne bez -a (pani Nowak→pani Nowak), żeńskie na -a odmienne
  (Kowalska→Kowalskiej), dwuczłonowe z dywizem (odmiana członów wg płci:
  Annie Nowak-Kowalskiej).
- **Sygnały przypadka w piśmie procesowym są lokalne i konwencjonalne.**
  Apozycja do roli procesowej („powoda ______", „pozwanemu ______"),
  rząd przyimka („przeciwko ______", „na rzecz ______"), rekcja czasownika
  („doręczyć ______", „wzywa się ______"). Proza prawnicza jest pod tym
  względem bardziej przewidywalna niż język ogólny.
- **Pismo procesowe wymaga przewidywalności.** Dwa identyczne przebiegi muszą
  dać identyczny wynik, a każda propozycja musi umieć wskazać regułę, z której
  wynika. To dyskwalifikuje generację swobodną: LLM przy odmianie potrafi
  zamienić nie końcówkę, lecz nazwisko – w piśmie procesowym to wada
  nieakceptowalna niezależnie od częstości.

Repo zawiera już zalążek morfologii, ale wyłącznie do **dopasowywania**
wariantów (`INFLECTION_SUFFIXES`, `ADJECTIVAL_SURNAME_FAMILIES`,
`src/anonymizer.js:1-66`). Nowy moduł potrzebuje zdolności odwrotnej:
**generacji** formy w zadanym przypadku. Docelowo obie zdolności powinny
korzystać z jednych danych paradygmatycznych (lepsze grupowanie wariantów
w tokenizacji to efekt uboczny, nie cel v1).

### 3.2 Potok fleksji: cztery kroki

**K1 – ustalenie lematu i paradygmatu** dla wartości tokenu:
1. formy poświadczone (§2.2): zbiór wariantów z dokumentów źródłowych często
   zawiera mianownik i przypadki zależne – to pinuje lemat i paradygmat bez
   zgadywania,
2. słownik imion (z płcią) + klasyfikacja nazwiska do klasy paradygmatu,
3. rozpoznanie płci: z imienia (słownik; wyjątki typu Kuba/Kosma/Barnaba
   w danych, nie w regule „końcówka -a"),
4. brak pewności (imię spoza słownika, nazwisko obce, struktura inna niż
   „imię + nazwisko") → token oznaczony „nieodmienialny automatycznie",
   zero propozycji, flaga informacyjna.

**K2 – wykrycie wymaganego przypadka** w miejscu wstawienia, kaskadą sygnałów
o malejącym priorytecie:

| Sygnał | Przykład | Wynik |
|---|---|---|
| apozycja do odmienionej roli procesowej (leksykon: powód, pozwany, wnioskodawca, uczestnik, dłużnik, wierzyciel, kredytobiorca, pełnomocnik, świadek, biegły, komornik…) | „pozwanemu ______" | przypadek roli (tu: celownik), zgoda przypadka |
| rząd przyimka (tabela: dla/do/od/u/bez/wobec/według/na rzecz/w imieniu + D; przeciwko/ku/dzięki/wbrew + C; z/nad/pod/przed/między + N; o/przy/po + Ms…) | „przeciwko ______" | celownik |
| rekcja czasownika z leksykonu prawniczego (doręczyć/przysługiwać/wypowiedzieć + C; pozwać/wezwać/zawiadomić/reprezentować/obciążyć + B; zasądzić od + D na rzecz + D…) | „doręczyć ______" | celownik |
| pozycja podmiotu (początek zdania, brak innych sygnałów, orzeczenie w pobliżu) | „______ wnosi o…" | mianownik |
| brak sygnału albo sygnały sprzeczne | – | **brak zmiany**, forma jak dziś, flaga „przypadek nieustalony" |

Własność sprzyjająca: dla męskich nazw osobowych dopełniacz i biernik są
tożsame (Jana Kowalskiego), więc najczęstsza niejednoznaczność D/B jest
nieszkodliwa; rozróżnienia wymagają formy żeńskie (Anny/Annę), gdzie decyduje
rekcja.

**K3 – wygenerowanie formy**, w kolejności bezpieczeństwa:
1. **forma poświadczona:** jeśli wymagany przypadek występuje w zbiorze form
   poświadczonych, użyj go dosłownie – zero ryzyka generacji; dokument
   źródłowy jest najwyższym autorytetem co do tego, jak strony same odmieniają
   swoje nazwisko (to istotne przy nazwiskach o wariantywnej odmianie:
   Kozioł→Kozioła albo Kozła, Gołąb→Gołąba albo Gołębia – wybór bywa decyzją
   właściciela nazwiska, nie gramatyki),
2. generator regułowo-słownikowy dla klasy paradygmatu (z alternacjami:
   e ruchome, ó:o, ą:ę),
3. fallback: forma z legendy bez zmian + flaga „nie umiem odmienić" –
   **nigdy „najlepszy strzał"**.

**K4 – plan sugestii** (wyjście potoku, schemat):

```json
{ "occurrence": { "outcomeId": "…", "index": 3, "token": "[PERSON_NAME_1]" },
  "current": "Jana Kowalskiego",
  "proposed": "Janowi Kowalskiemu",
  "case": "celownik",
  "confidence": "wysoka | niska",
  "rationale": "apozycja: „pozwanemu" (celownik)",
  "alternatives": ["Jan Kowalski", "Jana Kowalskiego", "…pełny paradygmat…"],
  "decision": null }
```

`decision` wypełnia wyłącznie człowiek (§9). Pewność „wysoka" wymaga
jednoznacznego sygnału K2 **i** źródła K3 typu 1 lub 2 bez wariantywności;
wszystko inne to „niska" i nigdy nie wchodzi do akceptacji zbiorczej.

### 3.3 Dane morfologiczne

- **Imiona:** słownik imię → płeć + pełny paradygmat. Źródła kandydackie:
  SGJP / PoliMorf (słowniki morfologiczne polszczyzny), otwarte listy imion
  z rejestru PESEL (dane.gov.pl) jako lista bytów. Licencje **do potwierdzenia
  przy wyborze źródła** w W1 (PoliMorf historycznie na liberalnej licencji
  BSD-podobnej, SGJP na licencji otwartej – nie przesądzam tu, to warunek
  wejścia W1, wpis do THIRD_PARTY_NOTICES jak przy pozostałych zależnościach).
- **Nazwiska:** reguły klas + słownik wyjątków i alternacji; opcjonalnie
  lista frekwencyjna nazwisk (rejestr PESEL) do klasyfikacji trudnych
  przypadków. Nazwiska obce: ostrożność, częściej flaga niż generacja.
- **Format:** źródła kompilowane **w czasie budowania** (skrypt deweloperski)
  do własnego, minimalnego formatu danych aplikacji; do artefaktu trafia
  wyłącznie skompilowany plik. Zero parserów cudzych formatów w runtime,
  zero nowych zależności runtime.
- **Rozmiar:** cel rzędu 1–5 MB po kompilacji (imiona ~2–3 tys. lematów
  z paradygmatami, klasy nazwisk + wyjątki; słownik pełnoformowy całej
  polszczyzny NIE jest potrzebny). Pomiar w W1 decyduje o miejscu bytowania
  (§7.2).
- **Integralność:** patrz §7.2 i V4. **[DO WERYFIKACJI PRZEZ OPUSA: O-3 –
  łańcuch dostaw słowników: pinowanie źródła, suma kontrolna zakotwiczona
  w repo (uniknąć powtórki C-INT-7/C-INT-8: TOFU), licencje]**

### 3.4 Odrzucone: mały LLM do fleksji

| Kryterium | Morfologia regułowo-słownikowa | Mały lokalny LLM |
|---|---|---|
| Determinizm | pełny: te same wejścia → ten sam wynik | brak (albo pozorny przy temp=0, nadal nieaudytowalny) |
| Audytowalność propozycji | każda forma wskazuje regułę/wpis słownika | „bo tak twierdzi model" |
| Tryb błędu | forma niezgrabna albo flaga „nie umiem" | może podmienić nazwisko na inne, dopisać albo zgubić słowo – błąd klasy treści, nie klasy formy |
| Koszt | 1–5 MB danych, mikrosekundy | setki MB–GB, sekundy–minuty na CPU/WASM |
| Air-gap | obojętny (czysta funkcja) | obojętny w wariancie wbudowanym, ale patrz §5 |
| Pokrycie | bardzo wysokie dla imion + klas nazwisk; luki jawnie flagowane | wysokie, ale bez wiedzy, kiedy się myli |

Werdykt: **fleksja = morfologia, bez LLM-a, w obu wariantach produktu.**
Tam, gdzie morfologia nie umie (nazwiska obce, struktury nietypowe), właściwą
odpowiedzią jest flaga i decyzja człowieka, nie generacja statystyczna.
Przewaga LLM (długodystansowa składnia) jest pokryta uczciwą flagą „przypadek
nieustalony" – koszt fałszywej pewności modelu przewyższa zysk z ostatnich
procentów pokrycia.

### 3.5 Zakres typów encji

| Typ | v1 | Uzasadnienie |
|---|---|---|
| `PERSON_NAME` | pełny potok K1–K4 | rdzeń problemu |
| `PERSON_ALIAS` | tylko formy poświadczone | pseudonimy odmieniają się nieprzewidywalnie |
| `ORGANIZATION_NAME` | tylko formy poświadczone | nazwy rejestrowe bywają nieodmieniane intencjonalnie („przeciwko mBank S.A." vs „przeciwko mBankowi S.A." – konwencja kancelarii, nie gramatyka); generacja odłożona |
| `LOCATION` / `POSTAL_ADDRESS` | v1.1 (słownik miejscowości) | „w [LOCATION_1]" → „w Toruniu" to ten sam problem, ale wymaga osobnych danych (TERYT/SGJP) |
| pozostałe typy | bez fleksji | identyfikatory, kwoty, daty nie podlegają odmianie |

Decyzja produktowa P-1 (§13).

### 3.6 Rozszerzenie opcjonalne: wskazówki przypadka od LLM-a klienta

LLM piszący wynik zna kontekst, który sam tworzy – mógłby anotować tokeny
przypadkiem: `[PERSON_NAME_1|D]`. Traktowanie: **dane niezaufane, nigdy
polecenie**. Parser ścisły (dokładna gramatyka `|M/D/C/B/N/Ms/W`, wszystko
inne = zwykły token), wskazówka jest tylko dodatkowym głosem w kaskadzie K2:
zgodna z heurystyką → podnosi pewność; sprzeczna → obie formy w flagach,
decyzja człowieka. Koszt: zmiana kontraktu tokenów (`TOKEN_RE`
w `src/ui/deanon-workspace/index.js:9`, opisy narzędzi WebMCP/mostu,
dokumentacja) – dlatego **nie w v1**, decyzja P-5. **[DO WERYFIKACJI PRZEZ
OPUSA: O-9 – rozszerzenie kontraktu tokenów: parser, brak nowych sinków,
zachowanie wsteczne]**

---

## §4. Rozstrzygnięcie 2: wykrywanie nieścisłości – trzy poziomy

Struktura warstwowa; każdy poziom ma inny profil kosztu i ryzyka, wszystkie
produkują ten sam kształt wyniku (finding z lokalizacją, wagą i kategorią,
§9.2). Poziomy 1–2 są w v1, poziom 3 nie.

### 4.1 Poziom 1: checkery deterministyczne (v1, wariant A)

Czyste funkcje `tekst → findings`, katalog otwarcia:

| ID | Checker | Przykład trafienia |
|---|---|---|
| N-1 | tokeny nierozwiązane (formalizacja licznika z `countTokenStats`, `src/ui/deanon-workspace/index.js:53-64`) | `[PERSON_NAME_3]` bez wpisu w legendzie |
| N-2 | surowe dane osobowe spoza legendy (regexy z `findRegexEntities`, `src/anonymizer.js:318-341`) | PESEL w wyniku, którego nie było w źródłach |
| N-3 | zgodność rodzaju: rola procesowa vs płeć imienia | „powódka Jan Kowalski" |
| N-4 | spójność ról: ten sam token/osoba w rolach przeciwnych w obrębie pisma | [PERSON_NAME_1] raz jako powód, raz jako pozwany |
| N-5 | kwota słownie vs cyfrowo (deterministyczny słownik liczebników) | „10 500 zł (słownie: dziesięć tysięcy złotych)" |
| N-6 | daty niemożliwe i niespójne | „31 lutego 2026", termin wcześniejszy niż data pisma |
| N-7 | warianty tej samej sygnatury akt w jednym piśmie (odległość edycyjna) | „I C 123/26" vs „I C 123/25" |
| N-8 | artefakty LLM i stylu: markdown (`##`, `**`), placeholdery („[uzupełnić]", „TODO"), fragmenty po angielsku, em-dash „—" (reguła interpunkcyjna kancelarii: wyłącznie en-dash „–") | „**Uzasadnienie**" |
| N-9 | zduplikowane akapity | powtórzony akapit żądań |
| N-10 | nawiasy kwadratowe niebędące tokenami po deanonimizacji | „[sygnatura]" |

Katalog jest otwarty (dopisywanie checkerów to najtańsza ścieżka rozwoju
modułu) i w całości testowalny na korpusie syntetycznym
(`test-data/synthetic/`).

### 4.2 Poziom 2: kontrola krzyżowa NER (v1, wariant A)

Ponowny przebieg **istniejących** modeli NER na tekście **po deanonimizacji**
i porównanie z legendą:

- `PERSON_NAME` wykryte w wyniku, niemapowalne (`couldBeSamePerson`) na żadną
  wartość legendy → finding wysokiej wagi: „osoba spoza dokumentów źródłowych"
  (LLM zmyślił osobę, wprowadził dane z kontekstu rozmowy po stronie klienta,
  albo zrobił literówkę w nazwisku – każda z tych trzech przyczyn jest warta
  oflagowania),
- analogicznie organizacje, kwoty, daty, adresy: wartości nieobecne
  w źródłach → finding informacyjny,
- symetrycznie: encje z legendy, których w wyniku brak – informacja
  („w piśmie nie występuje pozwany"), niska waga.

Właściwości: zero nowych zależności i zero nowych artefaktów (modele już są
w `resources/models/`, objęte B1), koszt to jedna inferencja na tekst wyniku
(sekundy; Web Lock jak przy innych długich pracach). Zasady izolacji:

- wynik przebiegu **nie zasila** legendy ani tokenizacji – wyłącznie odczyt
  do porównania,
- przebieg weryfikacyjny **omija** cache NER workera (`createBoundedNerCache`,
  `src/worker.js:53`) – cache służy powtórnej anonimizacji źródeł; wpisy
  z encjami tekstu po deanonimizacji nie mają tam czego szukać (a byłyby
  kolejną kopią danych w RAM),
- debug pipeline'u wyłączony dla przebiegów weryfikacyjnych (runner zapisuje
  diffy między krokami – dla tekstu po deanonimizacji byłyby to kopie
  prawdziwych danych w obiekcie debug; interakcja z C-PERS-8, gdzie panel
  debug wciąż ma status FAIL(S)).

**[DO WERYFIKACJI PRZEZ OPUSA: O-4 – przepływ tekstu po deanonimizacji do
workera (ten sam proces co dziś, nowy kierunek danych), izolacja od
legendy/cache/debug]**

### 4.3 Poziom 3: generatywny LLM (nie w v1, opcjonalny)

Zakres sensowny dopiero ponad poziomami 1–2: nieścisłości semantyczne
(sprzeczność między akapitami, żądanie niespójne z uzasadnieniem), ocena
płynności zdań wokół wstawień. Wyłącznie jako flagi z lokalizacją, nigdy
przepisywanie tekstu. Środowisko uruchomienia: §5. Odporność na wstrzyknięcia:
§6.4. Decyzja produktowa P-3.

Uwaga projektowa: poziomy są niezależne – rezygnacja z poziomu 3 (na zawsze
albo na start) nie zmienia niczego w 1–2. To celowe: całą wartość progową
dostarczają warstwy deterministyczne.

---

## §5. Środowisko LLM dla poziomu 3 i pytanie o LM Studio

### 5.1 Opcje

| | (i) wbudowany ONNX/WASM w workerze | (ii) LM Studio, HTTP na loopbacku | (iii) llama.cpp natywnie w procesie | (iv) ścieżka ręczna: schowek + gotowy prompt |
|---|---|---|---|---|
| Kanał | **żaden** (in-process) | gniazdo TCP + klient HTTP | żaden (in-process) | żaden (schowek = zamierzony interfejs) |
| PII opuszcza aplikację | nie | **tak, w postaci jawnej, do procesu LM Studio** | nie | tak, jawnym gestem człowieka (jak dziś „Kopiuj") |
| Wariant A | ✓ | ✗ **nigdy** | ✓ technicznie | ✓ |
| Nowe zależności/artefakty | model ~0,5–1,5 GB (komponent opcjonalny) | klient HTTP w kodzie + zależność od cudzej aplikacji | natywny addon (prebuilty, install scripts – klasa C-PKG-5) | brak |
| Gdzie wykonuje się kod natywny | WASM w sandboksie renderera (jak ORT/OpenCV – błąd parsera ląduje w sandboksie, S4/R2) | poza aplikacją | **proces główny, pełne uprawnienia użytkownika** – regres względem wzorca WASM | poza aplikacją |
| Jakość/rozmiar modelu | sufit ~1,5–2 B parametrów (q4) przy budżecie WASM; wolno na CPU | dowolny model użytkownika, GPU | średni (bez ograniczeń WASM, ale koszt wyżej) | dowolny model użytkownika, GPU |
| Audytowalność | pełna (wzorzec identyczny z NER/OCR) | LM Studio poza granicą audytu (logi, retencja, aktualizacje – nieznane i zmienne) | duży łańcuch dostaw do audytu | n/d (odpowiedzialność człowieka) |

Szczegóły (i): wzorzec dokładnie jak NER (`src/worker.js:20-32`:
`allowRemoteModels=false`, modele z `app://`) i OCR (`src/ocr/models.js`:
tary vendorowane na desktopie). Budżet pamięci: worker rezerwuje
`MEMORY_BUDGET_MB = 1680` (`src/worker.js:39`), a mechanizm ewikcji już
istnieje (`evictForBudget`, `src/worker.js:139-150`) – współrezydencja
generatywnego 1,5 B q4 z modelami NER wymaga ewikcji i ponownego ładowania,
co jest kwestią czasu, nie architektury. Tryb pracy: „werdykt strukturalny
per akapit" (klasyfikacja/flagi z twardym limitem wyjścia), nie swobodna
generacja – to zmniejsza i koszt, i pole halucynacji. Kandydaci do benchmarku
(W9): modele polskojęzyczne małej skali (np. rodzina Bielik ~1,5 B, jeśli
dostępna w ONNX – do sprawdzenia) oraz wielojęzyczne 0,5–1,5 B z konwersji
społecznościowych. Dystrybucja: **nie** powiększać domyślnego instalatora
o ~1 GB; komponent opcjonalny instalatora NSIS albo osobna paczka modelu,
instalowana ręcznie i weryfikowana kotwicą jak modele NER (aplikacja sama
niczego nie pobiera – air-gap bez zmian). **[DO WERYFIKACJI PRZEZ OPUSA:
O-6 – poziom 3 w wariancie A: brak kanału, ale nowy duży artefakt wykonujący
się na PII; rekomendacja: osobny mini-projekt przed v1.1]**

### 5.2 LM Studio: ocena i warunki brzegowe

LM Studio wystawia lokalny serwer zgodny z API OpenAI (typowo
`http://127.0.0.1:1234`). Podłączenie się do niego to **dokładnie ten wzorzec,
który odrzuciliśmy dla mostu MCP** (`MCP-BRIDGE-DESIGN.md` §4.2: „HTTP/SSE na
loopbacku – zakazany"), z **dwiema okolicznościami obciążającymi**, których
tam nie było:

1. **Klasa danych.** Most niósł tekst tokenizowany; tu kanał niósłby
   **prawdziwe dane osobowe po deanonimizacji** (aktywa klasy A2, tajemnica
   zawodowa) do cudzego procesu. Pamięć, logi, historia i ewentualne zrzuty
   LM Studio są poza naszymi kontrolami (R3 nie obejmie cudzego procesu);
   zachowanie logowania promptów w LM Studio jest nieznane i zmienne między
   wersjami – nie do zakotwiczenia w naszym audycie.
2. **Klasa zdolności.** Dla potoku nazwanego rozważaliśmy **nasłuch**
   (accept-only, zero zdolności egress – cała argumentacja C-NET-6b). Klient
   HTTP to zdolność `connect(host, port)`: dokładnie ta, której brak jest
   dziś niezmiennikiem C-NET-6 i twierdzeniem S5 z `THREAT-MODEL.md`
   („node:net/http z procesu głównego: zamknięte przez dyscyplinę").
   Argument „`\\.\pipe\` nie ma zdolności egress" **nie przenosi się**:
   „127.0.0.1" to string w konfiguracji, nie mechanizm – jedna zmiana wartości
   i ten sam kod dzwoni w świat. Do tego serwer LM Studio jest domyślnie
   nieuwierzytelniony i dostępny dla każdego lokalnego procesu – nie my
   kontrolujemy, kto jeszcze z nim rozmawia i co mu każe zapamiętać.

**Werdykt:**

- **Wariant A: wykluczone bezwzględnie.** Air-gap by construction nie zna
  wyjątków „bo to tylko loopback". Kod klienta HTTP nie może istnieć
  w artefakcie A (wzorzec fizycznej nieobecności jak B2/W4).
- **Wariant B: dopuszczalne co najwyżej jako „integracja zaawansowana",
  nigdy domyślna, po osobnym projekcie i osobnej bramce Opusa.** Warunki
  minimum, gdyby Alan potwierdził potrzebę (P-4c):
  - kod wyłącznie w procesie głównym; renderer bez żadnego poluzowania CSP
    ani strażnika §3 (żadnego `connect-src http://127.0.0.1` – nigdy),
  - niezmiennik **C-NET-6c**: `node:http` (albo `net.fetch`) wolno importować
    wyłącznie jednemu plikowi klienta, wyłącznie do literalnych adresów
    loopback (`127.0.0.1` / `[::1]`), zakaz nazw hostów zakodowany w module
    (nie w skutkach ubocznych: `--host-resolver-rules` z C-NET-7 nie obejmuje
    resolvera Node), port z jawnej konfiguracji użytkownika; egzekwowanie
    trzema warstwami testów jak C-NET-6b,
  - **bramka człowieka per wysyłka** z ostrzeżeniem mocniejszym niż w moście
    (tam szły tokeny, tu idą dane jawne), tekst wprost: „Kliknięcie wyśle
    poniższy tekst z danymi osobowymi w postaci jawnej do programu LM Studio
    na tym komputerze. Aplikacja nie kontroluje, co LM Studio zapisuje
    w logach i historii."; podgląd dokładnego payloadu; „pokazane = wysłane"
    (wzorzec §6.8 mostu); opóźnienie aktywacji przycisku,
  - wskaźnik stanu i wyłącznik jak §5.5 mostu; zero retencji
    żądań/odpowiedzi na dysku; reguła redakcji logów bez zmian,
  - asercje artefaktów: artefakt A (i B do czasu decyzji) nie zawiera
    stringów klienta (`127.0.0.1:`, nazwa modułu klienta) – lustro C-BR-13.

  **[DO WERYFIKACJI PRZEZ OPUSA: O-7 – cała ta sekcja: wykluczenie w A,
  warunki dla B, albo werdykt ostrzejszy (zakaz na stałe); to jest główna
  decyzja kanałowa tego projektu]**

- **Rekomendacja: nie w v1 w ogóle.** Najpierw poziomy 1–2 + ścieżka ręczna
  (§5.3); do rozmowy o (ii) wracamy wyłącznie, jeśli po używaniu v1 Alan
  wskaże konkretne braki, których nie zamyka (i) ani (iv).

### 5.3 Ścieżka ręczna (iv): LM Studio bez żadnego kanału

Alan ma LM Studio i może go używać do weryfikacji **już dziś, bez zmiany
architektury**: przycisk „Kopiuj pakiet weryfikacyjny" składa do schowka
gotowy prompt kontrolny (checklista nieścisłości, instrukcja „wyłącznie
flagi z cytatami, zero przepisywania") razem z tekstem pisma; użytkownik
wkleja go do okna LM Studio i czyta odpowiedź. Właściwości:

- zero nowego kanału: schowek jest zamierzonym interfejsem produktu
  (C-PERS-9/C-PERS-10), a wysyłka do lokalnego procesu jest jawnym gestem
  człowieka – granica odpowiedzialności jak przy `shell.openExternal` (R5)
  i jak przy dzisiejszym „Kopiuj tokenizowane",
- różnica względem (ii) jest uczciwie komunikowana w UI: to człowiek
  przenosi dane jawne do LM Studio, aplikacja tylko przygotowuje prompt,
- dostępne od zaraz w obu wariantach, z dużymi modelami na GPU użytkownika.

**[DO WERYFIKACJI PRZEZ OPUSA: O-8 – czy opis granicy odpowiedzialności
wystarcza (parytet ze schowkiem), czy przycisk wymaga dodatkowego
ostrzeżenia]**

### 5.4 Odrzucone: (iii) llama.cpp / node-llama-cpp w procesie

Bez gniazda, ale: natywny addon w **procesie głównym** wykonuje parser GGUF
i runtime C++ z pełnymi uprawnieniami użytkownika – regres względem wzorca
repo, w którym każdy natywny parser pada do sandboksu renderera jako WASM
(S4/R2); prebuilty i skrypty instalacyjne to dokładnie klasa problemów
C-PKG-5; do tego ABI Electrona, podpis drugiego rodzaju artefaktu i duży
łańcuch dostaw. Wraca do rozważenia wyłącznie, jeśli (i) okaże się za słabe,
a (ii) pozostanie niedopuszczalne – wtedy jako WASM-owy wariant llama.cpp
w workerze (czyli w praktyce znowu (i), innym runtime'em).

### 5.5 Rekomendacja środowiska

**v1: bez generatywnego LLM-a w ogóle** (fleksja + poziomy 1–2; wszystko
wariant A). **Od zaraz dodatkowo:** ścieżka ręczna (iv). **v1.1 (po decyzji
P-3):** poziom 3 jako (i) – wbudowany model WASM, komponent opcjonalny,
osobny mini-projekt z benchmarkiem (W9). **(ii) LM Studio:** wyłącznie
wariant B, wyłącznie po osobnym projekcie, dziś nierekomendowane.
**(iii):** odrzucone.

---

## §6. Model zagrożeń modułu

### 6.1 Nowe aktywa

| ID | Aktyw | Gdzie żyje | Skutek utraty/naruszenia |
|---|---|---|---|
| A9 | tekst pisma po deanonimizacji w buforach weryfikatora | RAM renderera/workera (tam, gdzie już dziś żyją A1/A2 i wynik `deanonymizeText`) | jak A2 (katastrofalny); **nowych lokalizacji nie przybywa** w wariancie wbudowanym |
| A10 | dane morfologiczne (słowniki, reguły) | artefakt aplikacji | **integralność = treść pisma**: podmieniony słownik może generować inne nazwisko; mitygacja: §7.2 + V2 (człowiek zatwierdza każdą formę) |
| A11 | plan sugestii i decyzje radcy | RAM, ulotne | integralność analogiczna do A8 mostu: to, co zatwierdzone, musi być tym, co wyjdzie (V2) |

### 6.2 Granice zaufania

Wariant wbudowany: **zero nowych granic**. Weryfikator działa w rendererze
i jego workerze, komunikacja istniejącym `postMessage`; żadnych nowych kanałów
IPC, żadnych nowych procesów. Zdanie wymagane przez brief, wprost:
**rozwiązanie wbudowane = PII zostaje w aplikacji; LM Studio = PII opuszcza
aplikację do innego procesu na tej samej maszynie** – lokalnie, ale poza
granicą odpowiedzialności i poza wszystkimi naszymi kontrolami (retencja,
logi, pamięć, aktualizacje cudzego programu). Opcja (ii) tworzyłaby nową
granicę **G7: aplikacja → proces LM Studio**, przez którą przechodzi A9
w postaci jawnej; dlatego cała §5.2. Ścieżka ręczna (iv) nie tworzy granicy
technicznej: przeniesienie danych jest aktem człowieka (jak dziś schowek).

### 6.3 STRIDE – delta względem modelu wariantu A

| STRIDE | Wektor | Obrona | Status |
|---|---|---|---|
| **T**ampering | podmiana słownika morfologicznego (G3) | §7.2 (asar/fuse albo kotwica B1) + V2 (żadna forma nie wchodzi bez akceptacji człowieka) | zamknięte konstrukcyjnie |
| T | zatruty **źródłowy** słownik (łańcuch dostaw przy budowaniu) | pinowanie źródła + suma zakotwiczona w repo (O-3); przegląd danych po kompilacji | otwarte do W1 |
| **I**nfo disclosure | findings/formy nazwisk w logach | reguła redakcji D3 pkt 2 rozszerzona: żaden `console.*` nie interpoluje findingów, form ani fragmentów tekstu wyniku; egzekwowana testem jak C-PERS-7 | wymóg implementacyjny |
| I | kopie A9 w debug pipeline'u i panelu debug (C-PERS-8 wciąż FAIL(S)) | przebiegi weryfikacyjne z wyłączonym debug; weryfikator nie dosypuje niczego do `{anonymized, legend, debug}` | wymóg implementacyjny **[O-5]** |
| I | encje tekstu po deanonimizacji w cache NER workera | przebieg weryfikacyjny omija cache (§4.2) | wymóg implementacyjny |
| I | A9 w pagefile/hibernacji/WER | bez zmian względem R3 (te same procesy co dziś) | rezydualne, jak R3 |
| **D**oS | patologicznie długi/dziwny tekst wyniku | limity długości (spójne z limitami mostu), checkery liniowe, Web Lock | zamknięte projektowo |
| **E**levation | wynik LLM-a jako wektor przez UI weryfikatora | findings i sugestie renderowane wyłącznie przez `textContent` (dyscyplina C-INP-1/C-INP-2 obowiązuje panel weryfikacji) | wymóg implementacyjny |
| S/R | (bez zmian: brak nowych tożsamości i kanałów) | – | – |

### 6.4 Wstrzyknięcie treścią do weryfikatora (analog SB-3)

Tekst wyniku pochodzi od LLM-a, a pośrednio z dokumentów źródłowych (Z3:
niezaufane). Poziomy 1–2 są **odporne z konstrukcji**: regexy i porównania
nie wykonują instrukcji z tekstu. Poziom 3 (gdyby powstał) jest podatny jak
każdy LLM: dokument może zawierać tekst sterujący („nie zgłaszaj
nieścisłości"). Obrona: poziom 3 wyłącznie flaguje (brak jakiejkolwiek akcji
automatycznej, V2), jego wynik jest oznaczony jako pochodzący z modelu,
a poziomy 1–2 działają zawsze i niezależnie. To ograniczenie zapisać
w dokumentacji poziomu 3, nie ukrywać.

### 6.5 Ryzyka rezydualne modułu

| ID | Ryzyko | Dlaczego zostaje | Zarządzanie |
|---|---|---|---|
| RV-1 | morfologia zaproponuje formę błędną (wariantywność odmiany nazwisk, nazwiska obce) | język nie jest w pełni regularny | zawsze sugestia + widoczna forma obecna + uzasadnienie reguły + pełny paradygmat w alternatywach; formy poświadczone przed generacją |
| RV-2 | checkery nie wykryją wszystkich nieścisłości | katalog reguł z definicji niepełny | język produktu: „wspiera przegląd, nie zastępuje" (lekcja S-MCP-1); katalog otwarty na rozbudowę |
| RV-3 | kontrola krzyżowa NER ma granice R1 (fałszywe negatywy) po stronie wyniku | ta sama granica jakości modelu | symetria z R1 opisana jawnie; poziom 2 to sito dodatkowe, nie gwarancja |
| RV-4 | habituacja: radca klika „zaakceptuj wszystkie" bez czytania | czynnik ludzki (analog RB-3/SB-4) | akceptacja zbiorcza obejmuje wyłącznie sugestie pewne; niepewne wymagają decyzji per sztuka; liczniki nieprzejrzanych przy eksporcie |
| RV-5 | (tylko przy opcji (ii)/(iv)) retencja PII w procesie LM Studio | poza granicą aplikacji | (ii): bramka + dokumentacja; (iv): jawny gest człowieka, dokumentacja |

---

## §7. Air-gap i wariantowość

### 7.1 Macierz

| Składnik | Wariant A | Wariant B | Kanał |
|---|---|---|---|
| fleksja (morfologia) | ✓ | ✓ | żaden |
| poziom 1 (checkery) | ✓ | ✓ | żaden |
| poziom 2 (NER-rescan) | ✓ | ✓ | żaden |
| ścieżka ręczna (iv) | ✓ | ✓ | żaden (schowek, gest człowieka) |
| poziom 3 (i) WASM | ✓ (komponent opcjonalny) | ✓ | żaden |
| LM Studio (ii) | ✗ **nigdy** | tylko po osobnym projekcie + bramce Opusa; domyślnie wyłączone | TCP loopback (G7) |
| llama.cpp (iii) | odrzucone | odrzucone | – |

Wszystkie istniejące testy dymne wariantu A (`desktop:smoke`,
`desktop:smoke:packaged`, `desktop:smoke:offline`) przechodzą bez modyfikacji;
licznik zablokowanych żądań po pełnym przebiegu **z weryfikacją włącznie**
pozostaje 0. Nowa asercja artefaktów (lustro C-BR-13): artefakt A nie zawiera
żadnego klienta HTTP ani stringów integracji LM Studio; do czasu decyzji P-4c
dotyczy to również artefaktu B.

### 7.2 Integralność danych modułu (realizacja V4)

Preferencja: **słowniki morfologiczne w bundlu renderera** (trafiają do
`app.asar`, więc chroni je fuse `EnableEmbeddedAsarIntegrityValidation` –
zero nowego mechanizmu). Warunek: rozmiar po kompilacji w okolicach 1–5 MB
(pomiar w W1). Jeśli dane urosną (słownik miejscowości w v1.1, model
poziomu 3), lądują w `resources/` **wyłącznie** z wpisem w `manifest.json`
i weryfikacją runtime przez istniejący `electron/model-integrity.mjs`
(dokładnie ścieżka B1; bez cichego rozszerzania listy plików poza kotwicą).
**[DO WERYFIKACJI PRZEZ OPUSA: O-3 – jw., łącznie z wyborem miejsca
bytowania]**

---

## §8. Integracja z deanonimizacją: plan substytucji

### 8.1 Zasada konstrukcyjna

Fleksja **nie modyfikuje legendy** i nie dotyka `buildTokenMap`. Jest warstwą
**planu substytucji** nad dzisiejszą podmianą:

- dziś: `deanonymizeText(text, legend)` = dla każdego tokenu zawsze
  `legend[token]`,
- projekt: rozwiązanie substytucji per **wystąpienie** tokenu:
  `wartość(wystąpienie) = decyzja człowieka ?? legend[token]`,
  gdzie kandydatów na decyzję dostarcza plan z §3.2 K4.

Brak jakiejkolwiek decyzji = plan pusty = zachowanie bajt w bajt jak dziś
(gwarancja zgodności wstecznej, testowana goldenami na istniejących
przypadkach `src/anonymizer.test.js`).

### 8.2 Punkty zaczepienia (zamknięta lista)

| Miejsce | Dziś | Po zmianie |
|---|---|---|
| podgląd wyjścia (`renderParts`, `src/ui/deanon-workspace/index.js:141-152`) | pigułka pokazuje `part.orig` | pigułka pokazuje formę wynikającą z planu + stan sugestii (§9) |
| „Kopiuj" (`src/ui/deanon-workspace/index.js:293`) | `deanonymizeText` | rozwiązanie planu (te same decyzje co w podglądzie) |
| karty wyników (`src/ui/outcomes-list/index.js:65,209`) | `deanonymizeText` | rozwiązanie planu (formy zatwierdzone; bez decyzji = jak dziś) |
| eksport (`src/export/deanon.js:76`) | `deanonymizeText` | rozwiązanie planu |

**Jedno źródło prawdy:** wszystkie cztery miejsca konsumują ten sam plan
i ten sam stan decyzji. Gwarancja „pokazane = skopiowane/wyeksportowane":
test porównuje hash tekstu widocznego w podglądzie z hashem tekstu
skopiowanego i wyeksportowanego (wzorzec §6.8 mostu). **[DO WERYFIKACJI
PRZEZ OPUSA: O-10 – realizacja V2 na wszystkich czterech ujściach]**

### 8.3 Cykl życia planu i decyzji

- Plan liczony przy wklejeniu/aktualizacji wyniku i przy zmianie legendy
  (spójnie z `refreshLegend`, `src/ui/deanon-workspace/index.js:525-529`).
- Decyzje człowieka są per wystąpienie, trzymane w RAM przy wyniku
  (jak `legendSnapshot`), giną z zamknięciem aplikacji (D2 bez zmian).
- Aktualizacja tekstu wyniku unieważnia decyzje wystąpień, których kontekst
  się zmienił (porównanie otoczenia wystąpienia), pozostałe zachowuje.

---

## §9. UX: sugestie do zatwierdzenia, nie automat

### 9.1 Przebieg

1. Wklejenie/aktualizacja wyniku → automatycznie: fleksja + poziom 1
   (milisekundy, bez modeli).
2. Poziom 2 (NER): przycisk „Sprawdź krzyżowo" z paskiem postępu
   (koszt inferencji jest zauważalny; auto-start to decyzja P-6).
3. Panel „Weryfikacja" obok wyjścia: sekcja „Odmiana" (sugestie fleksji)
   i sekcja „Nieścisłości" (findings), liczniki w nagłówku.

### 9.2 Sugestie fleksji

- Pigułka w tekście wyjściowym w stanie „sugestia" (odróżnialna wizualnie od
  dzisiejszych pigułek tokenów): pokazuje formę **obecną**; obok proponowana
  forma z przypadkiem, np. „→ Janowi Kowalskiemu (celownik)".
- Klik = menu wystąpienia: zatwierdź propozycję · zostaw formę obecną ·
  wybierz inną formę (pełny paradygmat) · pokaż uzasadnienie (reguła K2/K3).
- Przycisk zbiorczy: „Zatwierdź wszystkie pewne (N)" – wyłącznie sugestie
  o pewności wysokiej (§3.2); niepewne zawsze per sztuka. To nadal jawny
  gest człowieka (V2), decyzja P-2.
- Tekst nigdy nie zmienia się sam: do momentu decyzji wszystkie ujścia (§8.2)
  używają formy jak dziś.

### 9.3 Findings

- Wiersz: waga (wysoka/średnia/informacyjna) · kategoria (N-1…N-10, poziom 2)
  · cytat fragmentu · skok do miejsca w tekście.
- Akcje: „odrzuć" (znika do końca sesji), „pokaż wszystkie odrzucone".
- Findings **niczego nie blokują**: eksport i kopiowanie działają zawsze;
  jeśli są nieprzejrzane sugestie albo findings wysokiej wagi, przy
  „Kopiuj"/„Eksportuj" pojawia się licznik („3 nieprzejrzane") – informacja,
  nie zapora. Radca decyduje.

### 9.4 Język i ton

Cały UI po polsku; nazwy przypadków słownie (mianownik, dopełniacz, celownik,
biernik, narzędnik, miejscownik, wołacz); komunikaty bez anglicyzmów; zero
wykrzykników i straszenia – moduł jest asystentem korekty, nie strażnikiem.
Nazwa funkcji w UI: decyzja P-7.

---

## §10. Wpływ na SECURITY-CHECKLIST.md i pozostałe dokumenty

### 10.1 Nowe pozycje checklisty (propozycja: sekcja „10. Weryfikator lokalny")

| ID | Pozycja (skrót) |
|---|---|
| C-VER-1 | moduł weryfikatora nie ma żadnego kodu sieciowego: zero importów modułów sieciowych, zero `fetch` poza `app://` (test statyczny; oba warianty) |
| C-VER-2 | dane morfologiczne objęte integralnością: w asarze (fuse) albo w `resources/` z wpisem w `manifest.json` i weryfikacją runtime (test: podmiana bajtu słownika = odmowa startu albo odmowa załadowania modułu, fail-closed) |
| C-VER-3 | żadna sugestia nie zmienia tekstu bez decyzji człowieka: eksport/kopia przed jakąkolwiek akceptacją = bajt w bajt zachowanie dzisiejsze (test e2e) |
| C-VER-4 | „pokazane = skopiowane/wyeksportowane": hash tekstu podglądu == hash schowka == hash treści eksportu (test e2e, wzorzec C-BR-7) |
| C-VER-5 | przebieg weryfikacyjny nie zasila legendy, tokenizacji ani cache NER; debug wyłączony (test jednostkowy + przegląd) |
| C-VER-6 | żaden `console.*` nie interpoluje findingów, form nazwisk ani fragmentów tekstu wyniku (rozszerzenie reguły C-PERS-7, egzekwowane testem) |
| C-VER-7 | panel weryfikacji renderuje treści wyłącznie przez `textContent` (rozszerzenie C-INP-1) |
| C-VER-8 | formy poświadczone i plan sugestii: wyłącznie RAM, zero trwałości, zero ścieżki przez kanały (WebMCP/most) – przez granice idą nadal wyłącznie tokeny (test) |
| C-VER-9 | artefakt A bez klienta LM Studio i bez stringów integracji; do decyzji P-4c dotyczy też artefaktu B (asercja artefaktów, lustro C-BR-13) |
| C-VER-10 | (warunkowe, tylko jeśli powstanie poziom 3) model weryfikatora w kotwicy integralności; komponent opcjonalny nie zmienia statusów pozostałych pozycji |

### 10.2 Zmiany pozycji istniejących

- **C-PERS-7:** rozszerzenie reguły redakcji o artefakty weryfikatora
  (C-VER-6).
- **C-PERS-8:** adnotacja: weryfikator nie dosypuje danych do debug JSON;
  zamknięcie samego panelu (S-LOG-3) pozostaje osobną, wcześniejszą poprawką.
- **C-INT-4/C-INT-5/C-INT-6:** adnotacja, że kotwica obejmuje także dane
  weryfikatora, jeśli wylądują w `resources/` (C-VER-2).
- **C-INT-7/C-INT-8:** obejmują również źródła słowników morfologicznych
  (pinowanie + suma zakotwiczona w repo, O-3).
- **C-NET-6:** bez zmian w v1 (moduł niczego sieciowego nie importuje);
  ewentualna integracja (ii) wymagałaby nowego C-NET-6c – poza zakresem v1.
- **C-PKG-9:** THIRD_PARTY_NOTICES uzupełnione o licencje danych
  morfologicznych.

### 10.3 Pozostałe dokumenty

- **SECURITY.md:** nowa sekcja opisująca weryfikator po implementacji
  (umiejscowienie, integralność danych, brak kanału); §14 rejestr – dopisać
  „integracja LM Studio: świadomie odłożona/odrzucona" zgodnie z decyzją
  z O-7/P-4.
- **THREAT-MODEL.md:** dopisek A9–A11, RV-1…RV-5, warunkowo G7; adnotacja
  przy R1/RB-2, że droga powrotna zyskała maszynowe wsparcie przeglądu.
- **CLAUDE.md / dokumentacja użytkownika:** opis funkcji językiem „wspiera
  przegląd, nie zastępuje" (spójnie z S-MCP-1); instrukcja ścieżki ręcznej
  (iv) z jawnym opisem odpowiedzialności.

---

## §11. Plan implementacji dla Sonneta

Zasady nadrzędne: (1) zero nowych zależności runtime; dane słownikowe
kompilowane w czasie budowania do własnego formatu; (2) każdy moduł
z testami wchodzącymi razem z nim; (3) bramka Opusa przed merge dla modułów
oznaczonych niżej; (4) `npm run eval` (tagowany) i `npm run eval:score` po
każdej zmianie dotykającej `src/pipeline` – przy czym plan celowo **nie
zmienia** istniejącego pipeline'u anonimizacji: przebieg weryfikacyjny to
osobna konfiguracja.

| Moduł | Zakres | Kryteria akceptacji (skrót) | Bramka Opusa |
|---|---|---|---|
| **W1** dane morfologiczne + kompilator (skrypt deweloperski) | wybór źródeł (licencje!), kompilacja do formatu aplikacji, pomiar rozmiaru, decyzja asar vs `resources/`+manifest | licencje potwierdzone i odnotowane; suma źródła zakotwiczona w repo; golden testy pokrycia (top-N imion i nazwisk z korpusu syntetycznego) | tak (O-3: łańcuch dostaw, integralność) |
| **W2** silnik fleksji: lematyzacja + generacja | czyste funkcje; klasy paradygmatów, alternacje, płeć, dwuczłonowe; formy poświadczone przed generacją | goldeny odmiany (korpus przypadków: regularne, e ruchome, żeńskie nieodmienne, dwuczłonowe, obce → flaga); zero propozycji przy niepewności | nie (czysta funkcja, bez PII w spoczynku) |
| **W3** detektor przypadka | leksykon ról procesowych, tabela przyimków, rekcja czasowników; kaskada z pewnością; zdaniowe goldeny | trafność na korpusie zdań z akt syntetycznych; sygnały sprzeczne → „nieustalony" | nie |
| **W4** plan substytucji + rozwiązanie na czterech ujściach (§8.2) | struktura planu i decyzji, zgodność wsteczna (`deanonymizeText` = plan pusty), snapshot per wynik | golden: bez decyzji wynik bajt w bajt jak dziś; test hashy C-VER-4 | tak (dotyka wszystkich ujść A9; O-10) |
| **W5** checkery poziomu 1 (N-1…N-10) | czyste funkcje tekst → findings; katalog otwarty | testy na `test-data/synthetic/` + przypadki syntetyczne per checker; zero fałszywych blokad (findings nie blokują niczego) | nie |
| **W6** kontrola krzyżowa NER (poziom 2) | osobna konfiguracja przebiegu w workerze: bez tokenizacji, bez cache, bez debug; mapowanie wyników na findings; Web Lock | testy izolacji (legenda/cache/debug nietknięte, C-VER-5); `npm run eval` bez regresji | tak (A9 w workerze; O-4, O-5) |
| **W7** UI panelu weryfikacji + pigułki sugestii + decyzje | §9; `textContent`-only; liczniki przy Kopiuj/Eksportuj | e2e: zatwierdź/odrzuć/zbiorczo; eksport przed akceptacją = stan dzisiejszy (C-VER-3); C-VER-7 | tak (ujścia + rendering treści LLM-a) |
| **W8** asercje artefaktów + checklista + dokumenty | C-VER-1…C-VER-9; aktualizacje §10.3 | asercje w obu buildach zielone; istniejące smoke'i bez zmian | tak (domknięcie całości) |
| **W9** *(opcjonalny, po decyzji P-3, osobny mini-projekt)* | benchmark modeli WASM (jakość/latencja/pamięć na sprzęcie kancelaryjnym), tryb werdyktów strukturalnych, komponent opcjonalny instalatora | raport z pomiarów przed jakąkolwiek implementacją produkcyjną | tak (O-6; nowy artefakt wykonujący się na PII) |

Kolejność: W1 → W2 → W3 → W4 (fleksja end-to-end na formach poświadczonych
i regułach), równolegle W5; potem W6, W7, W8. W9 wyłącznie po osobnej
decyzji. Ścieżka ręczna (iv) to drobny element W7 (przycisk + szablon
promptu), bez osobnego modułu.

Proponowane umiejscowienie kodu (dla spójności repo, do dyspozycji Sonneta):
`src/verifier/` (morfologia, detektor przypadka, plan, checkery, rescan),
`src/ui/verify-panel/`, skrypt kompilacji danych w `scripts/`.

---

## §12. Rejestr pozycji DO WERYFIKACJI PRZEZ OPUSA

Numeracja lokalna tego dokumentu (niezależna od O-1…O-12 mostu). Każda
pozycja dotyka kanału, PII albo air-gap.

| ID | Kwestia | Propozycja projektu | Ryzyko przy błędzie |
|---|---|---|---|
| **O-1** | zakres v1: fleksja regułowa + poziomy 1–2, zero kanału, zero nowego runtime'u | przyjąć jako rozstrzygnięcie architektoniczne | przewymiarowanie (LLM tam, gdzie zbędny) albo niedowiezienie „drugiej pary oczu" |
| **O-2** | formy poświadczone: nowa struktura RAM obok legendy, snapshot per wynik | jak §2.2; zero trwałości, zero serializacji przez kanały | nowa ścieżka wycieku wariantów odmiany (sąsiedztwo A1) |
| **O-3** | integralność i łańcuch dostaw danych morfologicznych | asar/fuse dla małych, `manifest.json`+runtime dla dużych; pinowanie źródeł, suma w repo, licencje | podmieniony słownik = podmieniona treść pisma (A10); powtórka TOFU z C-INT-7/8 |
| **O-4** | przepływ A9 (tekst po deanonimizacji) do workera na potrzeby poziomu 2 | ten sam proces co dziś; izolacja od legendy, cache i tokenizacji | nowa kopia realnych danych w niekontrolowanym miejscu |
| **O-5** | debug: przebieg weryfikacyjny z wyłączonym debug; nic do panelu C-PERS-8 | jak §4.2/§6.3 | realne PII w debug JSON dostępnym z panelu (eskalacja S7) |
| **O-6** | poziom 3 WASM: nowy duży artefakt wykonujący się na PII, bez kanału | osobny mini-projekt (W9) przed jakąkolwiek implementacją | wciągnięcie generatywnego modelu bez modelu zagrożeń |
| **O-7** | LM Studio (§5.2): wykluczenie w A; warunki brzegowe dla B; albo zakaz na stałe | nie w v1; w B najwyżej po osobnym projekcie, C-NET-6c, bramka z jawnym ostrzeżeniem | kanał TCP z jawnym PII w produkcie air-gap; erozja C-NET-6/S5 |
| **O-8** | ścieżka ręczna (iv): granica odpowiedzialności przy „Kopiuj pakiet weryfikacyjny" | parytet ze schowkiem (C-PERS-9/R5); opis w UI i dokumentacji | użytkownik nieświadomy, że przenosi dane jawne do cudzego procesu |
| **O-9** | wskazówki przypadka od LLM (`[PERSON_NAME_1\|D]`, §3.6) | nie w v1; jeśli wraca: parser ścisły, dane niezaufane, tylko głos w kaskadzie | rozszczelnienie kontraktu tokenów; sterowanie treścią przez dane |
| **O-10** | gwarancje V2 na czterech ujściach (§8.2): nic bez akceptacji, pokazane = wyeksportowane | plan substytucji jako jedyne źródło prawdy + testy hashy | cicha zmiana treści pisma procesowego (złamanie sedna produktu) |

---

## §13. Decyzje produktowe do potwierdzenia przez Alana

| ID | Decyzja | Rekomendacja projektu |
|---|---|---|
| P-1 | zakres fleksji v1 (§3.5) | `PERSON_NAME` pełny potok; `ORGANIZATION_NAME`/`PERSON_ALIAS` wyłącznie formy poświadczone; miejscowości (`LOCATION`) w v1.1 |
| P-2 | zbiorcze „Zatwierdź wszystkie pewne (N)" | tak: jeden jawny gest człowieka; sugestie niepewne zawsze per sztuka |
| P-3 | czy budować poziom 3 (wbudowany LLM WASM) i kiedy | decyzja **po** doświadczeniu z v1; jeśli tak, to W9 (benchmark) przed implementacją; komponent opcjonalny, nie w domyślnym instalatorze |
| P-4 | LM Studio: (a) wcale · (b) ścieżka ręczna przez schowek z gotowym promptem · (c) integracja API w wariancie B | **(b) od zaraz** (zero kanału, duże modele użytkownika); (c) najwyżej po v1, osobny projekt i bramka; (a) pozostaje domyślnym stanem wariantu A |
| P-5 | wskazówki przypadka w tokenach od LLM-a (§3.6) | nie w v1; wrócić po zmierzeniu skuteczności kaskady K2 na realnych pismach |
| P-6 | start poziomu 2: automatycznie po wklejeniu czy na przycisk | przycisk w v1 (koszt inferencji zauważalny, użytkownik kontroluje moment); auto jako opcja później |
| P-7 | nazwa funkcji w UI | do decyzji brzmieniowej; robocze propozycje: „Weryfikacja pisma", „Korekta odmiany i nieścisłości" |

---

*Koniec projektu. Następny krok: bramka Opusa nad §12 (O-1…O-10), decyzje
Alana nad §13 (P-1…P-7), potem implementacja wg §11 (W1…W8), moduł po
module; W9 wyłącznie po osobnej decyzji P-3.*
