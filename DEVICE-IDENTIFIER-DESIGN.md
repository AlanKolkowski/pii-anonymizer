# DEVICE-IDENTIFIER-DESIGN.md – deterministyczna detekcja identyfikatorów urządzeń (rodzina R-DEV)

**Data:** 2026-07-19. **Autor:** Fable (architekt), na zlecenie Alana. **Status:** projekt do bramki GATE-DEVICE, zero kodu produkcyjnego w tym dokumencie. **Baza:** `main` (czysty), implementacja w stylu R-CARD/R-DATE/HC-2.

**Kanwa:** `IDENTIFIER-COVERAGE-AUDIT.md` §2: `DEVICE_IDENTIFIER` ma ~0% recall, łapie go wyłącznie model (`multilang-fp32`), prawie nigdy skutecznie. Komentarz w `src/pipeline/configs/entity-rules.js` (przy `DEVICE_IDENTIFIER`) potwierdza pomiarem: „pure detection-layer gap (0% recall at EVERY threshold on synthetic, no adversarial examples at all)" – to luka warstwy detekcji, nie progu. Typ jest W1 (maskowany) i domyślnie włączony (kategoria `technical-identifiers`), więc każde chybienie to realny wyciek danej identyfikującej (art. 4 pkt 1 RODO, motyw 30: identyfikatory internetowe/urządzeń).

## 1. Zmierzony wyciek (dyscyplina domu: nigdy spekulacyjnie)

Korpus syntetyczny zawiera 3 goldeny `DEVICE_IDENTIFIER`, wszystkie dziś gubione:

| # | Dokument | Wartość | Kontekst w tekście | Klasa |
|---|---|---|---|---|
| 1 | `pismo_06_reklamacja_konsumencka` (768–787) | `WW90-2024-081234-PL` | „nr seryjny urządzenia: WW90-2024-081234-PL" | numer seryjny, kotwica bezpośrednio przed |
| 2 | `pismo_05_wypowiedzenie_umowy_o_prace` (2312–2322) | `5CD3001XYZ` | „nr seryjny:\r\n␣␣␣␣5CD3001XYZ" | numer seryjny, kotwica przed łamaniem linii (CRLF + wcięcie) |
| 3 | `pismo_05_wypowiedzenie_umowy_o_prace` (2367–2382) | `354871234567890` | „telefon służbowy Samsung Galaxy S23, IMEI: 354871234567890" | IMEI, kotwica literalna |

Dwa fakty projektowo rozstrzygające, oba zweryfikowane w tej sesji:

1. **2 z 3 zmierzonych wycieków to numery seryjne, nie IMEI/MAC** – zakres nie może pominąć kotwiczonego S/N, mimo że intuicyjnie wygląda na „za szeroki".
2. **Korpusowy IMEI `354871234567890` NIE przechodzi Luhna** (suma ważona 65, policzona `luhnValid`-ową arytmetyką). Autor korpusu wpisał 15 losowych cyfr – dokładnie tak, jak robi to strona przepisująca IMEI z pudełka z literówką albo OCR ze skanu. Wniosek: ścieżka kotwiczona NIE może bramkować Luhnem (identyczna decyzja jak ścieżka B w R-DOW: kotwica licencjonuje number z zepsutą sumą).

## 2. Zakres v1: co w, co poza i dlaczego

### 2.1 W zakresie

| Wzorzec | Identyfikator | Gdzie występuje w pismach | Mechanizm precyzji |
|---|---|---|---|
| **R-IMEI** | IMEI (15 cyfr, Luhn) + IMEISV (16 cyfr) | sprawy karne (dowody rzeczowe, retencja danych telekom), spory z operatorami, protokoły zatrzymania rzeczy, pisma pracownicze (zwrot sprzętu) | ścieżka A: arytmetyka (Luhn + anty-IIN); ścieżka B: kotwica literalna `IMEI`/`IMEISV` |
| **R-MAC** | adres MAC (6 oktetów hex) | cyberprzestępczość, opinie biegłych informatyków, logi dostępowe w dowodach | kształt bezwarunkowy (jak VIN/KW): sylwetka 6×2 hex z jednolitym separatorem nie występuje nigdzie indziej |
| **R-ICCID** | ICCID karty SIM (19–20 cyfr, prefiks 89) | sprawy karne (dane retencyjne), spory z operatorami | wyłącznie kotwiczone (`ICCID`, „kart\* SIM") + długość + prefiks 89 (ITU-T E.118, MII telekom) |
| **R-SN** | numer seryjny urządzenia | reklamacje konsumenckie (rdzeń praktyki!), pisma pracownicze (zwrot sprzętu), umowy leasingu/najmu sprzętu | wyłącznie wąska kotwica ogonowa (tight-tail, wzór `KRS_CONTEXT_RE`): token bezpośrednio po „nr seryjny/fabryczny…:" |
| **R-IMSI** *(flaga O-DEV-8, decyzja Alana)* | IMSI (14–15 cyfr) | wyłącznie materiały z retencji danych w sprawach karnych | wyłącznie kotwica literalna `IMSI` |

Wszystkie emitują `DEVICE_IDENTIFIER`, `score: 1.0`, `source: 'regex'` – deterministyczna podłoga W1, model pozostaje sufitem.

### 2.2 Poza zakresem (świadomie)

- **Goły numer seryjny bez kotwicy** – niestrukturalny (dowolny alfanumeryk), bezwarunkowy wzorzec maskowałby oznaczenia modeli, numery ofert, kody produktów. S/N istnieje TYLKO przez kotwicę ogonową.
- **Kotwica „SN"/„SN:" dla numeru seryjnego** – w polskim piśmie prawnym „SN" to Sąd Najwyższy. Kolizja czołowa z cytowaniami orzecznictwa („uchwała SN…"). Zostaje `S/N` (z ukośnikiem) oraz formy słowne. Dopisać „SN:" wolno dopiero po zmierzonym wycieku, z pułapką na cytowania.
- **MAC w notacji Cisco `xxxx.xxxx.xxxx`** – grupy 4-znakowe czysto cyfrowe kolidują z numeracją wewnętrzną dokumentów („2024.0123.4567"); brak zmierzonego wycieku; polskie dowody sieciowe używają notacji dwukropkowej. v2 po wycieku.
- **EUI-64 (8 oktetów)** – nie zmierzono, dopisanie to jedna linia w przyszłości.
- **Bare ICCID (89… + Luhn, bez kotwicy)** – arytmetycznie kuszące, ale bez zmierzonego wycieku; v2.
- **IMEISV bez kotwicy** – 16 cyfr BEZ własnej cyfry kontrolnej (ostatnie 2 cyfry to wersja software, nie suma – 3GPP TS 23.003), a 16-cyfrowy Luhn-valid ciąg to domena kart. Zakaz twardy: żadnej „wymyślonej" walidacji IMEISV (ta sama zasada, co odmowa zmyślenia sumy paszportu w R-PASZ).
- **UDID/Android ID, hostname, cookie/device fingerprint** – nie występują w polskich pismach procesowych w formie strukturalnej; fingerprinty łapie model.
- **Numer licznika (energia/gaz/woda)** – identyfikuje punkt poboru, pośrednio osobę; realny kandydat na przyszłe R-METER z kotwicą „nr licznika", ale to inna rodzina dokumentów (spory z dostawcami mediów) i inny typ ryzyka – odnotowane, poza R-DEV.

## 3. Wzorce i walidacja per typ

Konwencje wspólne (odziedziczone po rodzinie A1/HC-2, bez zmian): krawędzie słowa `WORD_EDGE_BEFORE/AFTER`, pojedynczy separator `[  -]` wewnątrz tokenu (bez `\n` – identyfikator jest jednoliniowy, jak w R-CARD), OCR-fold `l→1`, `O→0` przez `digitPositions`/`toDigitChar` TYLKO w ścieżkach czysto cyfrowych, okna kotwic przez `hasContextAnchor` + `paragraphSafeWindow`, kotwice kompilowane `compileAnchors` z flagami `iu`.

### 3.1 R-IMEI (dwuścieżkowy, wzór strukturalny R-DOW)

Kandydat: maksymalny klaster cyfrowo-separatorowy (styl `CARD_CLUSTER_RE`: lookaround blokujący styk z alfanumerykami), OCR-fold, długości i grupowania z listy zamkniętej:

- IMEI (15 cyfr): grupowania `{15}`, `{2,6,6,1}` (TAC-dzielony), `{8,6,1}` (TAC-SNR-CD);
- IMEISV (16 cyfr, tylko ścieżka B): `{16}`, `{2,6,6,2}`, `{8,6,2}`.

Lista grupowań pełni tę samą rolę, co `cardGroupingValid`: dwa sąsiednie pola tabeli rozdzielone jedną spacją nie skleją się w „IMEI", nawet gdyby konkatenacja przeszła Luhna.

**Ścieżka A (bare, bez kotwicy) – precyzja z arytmetyki:**
1. dokładnie 15 cyfr (całego klastra, nie okna w dłuższym ciągu),
2. `luhnValid(digits)` – **reuse istniejącej funkcji z `src/anonymizer.js` bez żadnych zmian** (cyfra kontrolna IMEI to ten sam Luhn mod-10 co w kartach, liczona po 14 cyframi TAC+SNR; walidacja pełnej 15-tki działa identycznie jak walidacja pełnego PAN),
3. **anty-IIN:** `!hasCardIin(digits)` – deferencja do R-CARD, patrz macierz §4 (przy 15 cyfrach wyklucza to prefiksy 34/37, czyli kształt Amex),
4. zakaz znaku `+` bezpośrednio przed klastrem (odcina pełne numery E.164, które sięgają 15 cyfr),
5. grupowanie z listy, czyste granice.

**Ścieżka B (kotwiczona):** 15 lub 16 cyfr, grupowanie z listy, kotwica w oknie wstecznym 40 znaków (paragraph-safe): `\bIMEI\b`, `\bIMEISV\b`. **Bez wymogu Luhna** – uzasadnienie w §1 pkt 2 (zmierzony wyciek korpusowy jest Luhn-invalid; OCR i ręczne przepisanie psują sumę, a dana nie przestaje być daną). Słowo „IMEI" w polszczyźnie prawniczej nie znaczy nic innego – kotwica sama niesie precyzję, jak „prawo jazdy" w R-PJ.

### 3.2 R-MAC (kształt bezwarunkowy, wzór R-KW/VIN)

Dwa warianty, oba: dokładnie 6 grup po dokładnie 2 znaki hex `[0-9A-Fa-f]`, JEDNOLITY separator w całym adresie (mieszane separatory odrzucane), krawędzie słowa + lookaround blokujący sąsiedni separator tego samego rodzaju (żeby nie wycinać 6 oktetów z dłuższego łańcucha):

- **wariant dwukropkowy** `XX:XX:XX:XX:XX:XX` – bezwarunkowy bez dodatkowych wymogów: sylwetka „6 grup po 2, pojedyncze dwukropki" nie występuje w żadnym innym artefakcie pism (czas to 2–3 grupy, IPv6 ma grupy 1–4-znakowe i `::`),
- **wariant myślnikowy** `XX-XX-XX-XX-XX-XX` – dodatkowy wymóg: **co najmniej jedna litera `[A-Fa-f]` w całym adresie**. Zabija klasę FP „6 dwucyfrowych grup liczbowych z myślnikami" (numeracje, daty składane, fragmenty numerów seryjnych) kosztem ~0,3% losowych MAC-ów czysto cyfrowych; czysto cyfrowy myślnikowy MAC pozostaje do złapania przez model albo przyszłą ścieżkę kotwiczoną („adres MAC", „adres fizyczny") po zmierzonym wycieku.

Bez OCR-foldu (hex ma legalne litery; fold `O→0`/`l→1` wymagałby poszerzenia klasy znaków dla marginalnego zysku – MAC-i w pismach pochodzą z wydruków cyfrowych: logów, opinii biegłych).

### 3.3 R-ICCID (wyłącznie kotwiczony)

Klaster cyfrowy z OCR-foldem, `digits.length ∈ {19, 20}`, **prefiks `89`** (ITU-T E.118: Major Industry Identifier telekomunikacji – standard, nie heurystyka), kotwica w oknie 40: `\bICCID\b`, `kart\p{L}*\s+SIM` (obejmuje „karta/karty/kartą SIM"). Luhn NIE bramkuje (ICCID formalnie ma Luhna, ale zapisy bywają ucinane do 19 cyfr i przepisywane – kotwica + długość + prefiks wystarczą przy FP=0). Grupowanie: dowolne pojedyncze separatory (ICCID drukuje się i ciągiem, i po 4) – rygor listy grupowań nie jest tu potrzebny, bo emisję i tak licencjonuje kotwica.

### 3.4 R-SN (wyłącznie wąska kotwica ogonowa)

Jedyny wzorzec rodziny, w którym LUŹNE okno (`hasContextAnchor`) byłoby błędem: „nr seryjny" w oknie 30–40 znaków wstecz licencjonowałoby też sąsiednie tokeny („nr zamówienia: EM/2024/09876" stoi 20 znaków za serialem w pismo_06). Zamiast tego **tight-tail à la `KRS_CONTEXT_RE`**: kotwica musi się dopasować do KOŃCA okna wstecznego (kończyć się bezpośrednio przed kandydatem):

- okno: 50 znaków wstecz od startu kandydata, przycięte paragraph-safe,
- kotwice ogonowe (regex z `$`): `(?:\bnr\.?|\bnumer)\s+(?:seryjn\p{L}*|fabryczn\p{L}*)(?:\s+\p{L}+){0,2}\s*[:.]?\s*$` oraz `\bS\/N\s*[:.]?\s*$`,
- `(?:\s+\p{L}+){0,2}` dopuszcza wtrącenia dopełniaczowe („nr seryjny **urządzenia**:"), `\s*` na końcu przeżywa CRLF + wcięcie (zmierzony przypadek `5CD3001XYZ`),
- kandydat: token 6–24 znaków `[A-Za-z0-9/-]`, zaczyna i kończy się alfanumerycznie, **zawiera ≥2 cyfry** (odrzuca słowa: „nieczytelny", „następujący"), krawędzie słowa. Bez OCR-foldu (litery są znaczące). All-digit dozwolone (przy kotwicy ogonowej „nr seryjny: 12345678" to serial; ewentualna równoległa emisja PESEL/REGON z `findNumericIdentifierEntities` jest nieszkodliwa – oba typy W1, dedup scala).

**Znane ograniczenie (zapisane, nie ukrywane):** szyk „nr seryjny <model alfanumeryczny>: <serial>" (np. „nr seryjny pralki Samsung WW90T984DSH/S3: WW90-…") może zamaskować oznaczenie modelu zamiast/obok serialu – wtrącenie nie jest `\p{L}+`. To nadmaskowanie W1 (odwracalne, zero wycieku) w szyku nie zmierzonym w korpusie; akceptowane w v1, wektor dokumentacyjny w testach.

### 3.5 Uwaga przekrojowa: CRLF

`normalizeWhitespace` (preprocess) to no-op, a `paragraphSafeWindow` tnie na literalnym `\n\n` – w tekstach CRLF (`\r\n\r\n`) cięcie akapitowe de facto nie działa (istniejący quirk całej rodziny HC-2, nie pogarszany przez R-DEV). Wzorce R-DEV używają `\s` w szwach kotwic (przeżywa `\r`), a okna są krótkie (40–50 znaków), więc praktyczny wpływ jest zerowy. Odnotowane, żeby przyszła naprawa quirku (normalizacja EOL w preprocess) nie zaskoczyła testów R-DEV.

## 4. Macierz rozgraniczeń (dyscyplina FP=0)

| Para | Punkt styku | Rozgraniczenie |
|---|---|---|
| **IMEI bare vs PAYMENT_CARD** | jedyna wspólna długość: **15** (Amex); obie strony Luhn-valid | rozłączność deterministyczna przez IIN: R-CARD **wymaga** `hasCardIin` (34/37@15), R-IMEI bare **wymaga** `!hasCardIin`. Ten sam ciąg trafia zawsze do dokładnie jednego wzorca. Koszt: realny IMEI z TAC 34…/37… nie wejdzie ścieżką A (wejdzie kotwicą B); zysk: typy nigdy się nie kłócą. Europejskie TAC zaczynają się niemal wyłącznie od 35 (BABT) – 35@15 nie jest żadną wspieraną kartą (JCB 3528–3589 ma 16–19 cyfr i świadomie NIE jest w `hasCardIin`) |
| IMEI bare vs PESEL / NIP / REGON / KRS | brak | długości rozłączne: 15 vs 11/10/9-14/10 (i REGON-14 vs IMEISV-16 też się nie styka, bo IMEISV nie ma ścieżki bare) |
| IMEI bare vs telefon | E.164 dopuszcza do 15 cyfr | polskie regexy telefonu w `findRegexEntities` mają 11–12 cyfr (rozłączne); pełny zagraniczny E.164 z `+` odcina zakaz poprzedzającego `+`; goły 15-cyfrowy numer zagraniczny bez `+` w polskim piśmie to unikat, a z p=0,9 obleje Luhna – ryzyko rezydualne odnotowane, pułapkownik pilnuje |
| IMEI bare vs NRB/IBAN | brak | klaster maksymalny: 15 ≠ 26; okno wewnątrz dłuższego klastra nie jest kandydatem (styl R-CARD, nie A1) |
| IMEI bare vs gołe 15-cyfrowe numery umów/szkód | losowy 15-cyfrowy ciąg przechodzi Luhna z p≈0,1 | to samo rezydualne ryzyko, które dom zaakceptował w R-DOW ścieżce A (R-HC-3, ~1/10) i PESEL; 15 to „wolna długość" w polskim ekosystemie identyfikatorów, gołe 15-cyfrowe ciągi w pismach są rzadkie; pułapkownik dostaje wektory, decyzja o utrzymaniu ścieżki A po ewentualnym zmierzonym FP należy do Alana (O-DEV-2) |
| IMEISV (16) vs PAYMENT_CARD (16) | pełny styk długości | IMEISV istnieje TYLKO kotwiczone (`IMEISV`/`IMEI` w oknie); karta przy słowie „IMEI" w pismie nie występuje; a jeśli ciąg przy kotwicy IMEI jest jednocześnie Luhn+IIN-valid, R-CARD też go wyemituje – dwa kandydaty W1 na tym samym spanie, dedup arbitrażuje, wyciek zerowy |
| ICCID vs Visa-19 | wspólna długość 19 | prefiksy rozłączne: ICCID wymaga `89`, Visa wymaga `4`; dodatkowo ICCID wymaga kotwicy |
| ICCID vs NRB | brak | 19–20 vs 26 |
| MAC vs czas / daty / UUID / IPv6 / ISBN | myślniki i dwukropki | liczba grup (6) × szerokość grupy (2) × jednolitość separatora: czas ma 2–3 grupy, data 3, UUID grupy 8-4-4-4-12, IPv6 grupy 1–4 znaków, ISBN grupy zmiennej szerokości; all-digit myślnikowy dodatkowo wymaga litery hex (§3.2) |
| S/N vs sygnatury SN (Sąd Najwyższy) | skrót „SN" | gołe „SN" poza zakresem (O-DEV-7); kotwica `S/N` z ukośnikiem; token po kotwicy musi mieć ≥6 znaków i ≥2 cyfry („III", „CZP" odpadają) |
| S/N vs numer faktury / zamówienia | sąsiedztwo w tych samych nagłówkach pism | tight-tail: „nr zamówienia:"/„Faktura VAT nr" nie kończy się frazą seryjną, więc nie licencjonuje; luźnego okna nie ma (§3.4) |
| S/N vs R-DOW (3L+6C) | serial o kształcie `ABC123456` | możliwa podwójna emisja (DEVICE + PERSON_IDENTIFIER, jeśli suma dowodu przypadkiem przejdzie) – oba W1, dedup scala, wyciek zerowy; odnotowane, bez przeciwdziałania |
| S/N vs VIN (17 znaków) | serial 17-znakowy przy kotwicy | podwójna emisja DEVICE + VEHICLE – oba W1, dedup arbitrażuje; nieszkodliwe |
| R-IMSI vs IMEI bare | wspólne 15 cyfr | oba emitują `DEVICE_IDENTIFIER` – kolizja bezprzedmiotowa (ten sam typ, ten sam tier) |

Zasada nadrzędna (utrzymana z R-CARD): każda para, w której obie strony są W1-maskowane, może się „pomylić co do typu" bez wycieku – dyscyplina FP=0 dotyczy relacji **maskuj vs nie-maskuj** (kwoty bez maskowania rat, faktury, daty spraw, sygnatury cytowań, oznaczenia modeli tylko w opisanym wyżej szyku).

## 5. Warstwa (tier) – rekomendacja i flaga dla Alana

Stan dzisiejszy (sprawdzony w kodzie): `DEVICE_IDENTIFIER` = `'mask'` (W1) w `src/pipeline/configs/type-tiers.js`, waga **4** w `type-weights.js`, wpis w `ZAKRES-ANONIMIZACJI.md` („MAC / IMEI / serial – unikalny identyfikator techniczny", W1, waga 4).

**Rekomendacja: zostawić W1 bez zmian.** Goły IMEI/MAC/ICCID rozwiązuje się na osobę tak samo pośrednio-ale-wprost jak tablica przez CEPiK czy KW przez ekw.ms.gov.pl: IMEI przez CEIR/operatora, MAC przez logi dostawcy, ICCID przez rejestr prepaid (obowiązek rejestracji kart SIM od 2016 r.). Numer seryjny wiąże egzemplarz z nabywcą przez dokument sprzedaży, który w reklamacji leży obok. To klasa „bezpośrednie namiary przez rejestr" = waga 4 = W1, spójnie z VEHICLE/LAND_REGISTER.

**Flaga (decyzja Alana, niewymagana do startu implementacji):** czy numer seryjny URZĄDZENIA w piśmie reklamacyjnym traktujemy tak samo twardo jak IMEI (W1), czy jako pół-osobowy (W2, kosz przeglądu po aktywacji warstwowości)? Rekomendacja: W1 dla całego typu (rozdzielanie tieru wewnątrz jednego `entity_group` wymagałoby per-entity `forceTier` i nie jest warte złożoności); all-mask i tak śpi, więc dziś decyzja nic nie zmienia w bajtach wyjścia, a po aktywacji ST nadmaskowanie jest odwracalne.

## 6. Wpięcie w konfigurację

1. **`ENTITY_SOURCES` (OBOWIĄZKOWE):** `DEVICE_IDENTIFIER: ['multilang-fp32', 'regex']` + komentarz w stylu wpisów R-DATE/R-CARD. Uzasadnienie twarde: waga 4 = dokładnie próg siatki A8 (`SAFETY_NET_WEIGHT_THRESHOLD = 4` w `src/pipeline/steps/source-filter.js`), więc bez wpisu kandydat regex (score 1.0 ≥ 0.95) przeszedłby **mis-flagowany `unauthoritativeSource`** – dokładnie błąd, który R-CARD popełnił jako pierwszy, i jedna zmiana wagi od cichej martwej podłogi. Reguła domu z nagłówka `ENTITY_SOURCES`: „we do not lean on the A8 net".
2. **Strażnik samo-walidujący:** `REGEX_FLOOR_FIXTURE` w `src/pipeline/configs/entity-sources.test.js` MUSI dostać wektor(y) R-DEV (np. linia z `IMEI: 354871234567890` i `00:1A:2B:3C:4D:5E`) – dopiero wtedy strażnik realnie pilnuje pkt 1 (jego zasięg = pokrycie fixture, to jest udokumentowany kontrakt tego testu). Wpis + wektor idą w tym samym commicie co implementacja.
3. **`entity-rules.js`: bez zmian.** `DEVICE_IDENTIFIER` już ma `IDENTIFIER_RULE` (trym nawiasów, bez progu – regexy emitują 1.0, bez `maxLength` – nic nie utnie 17-znakowego MAC ani 24-znakowego serialu, puste listy merge – strażnicy tier-safety HC-1 nietknięci).
4. **`requiredSources` bez zmian** – `'regex'` nie jest modelem do pobrania; test „adds no new model source" w `entity-sources.test.js` przechodzi bez modyfikacji.
5. **Dedup/arbitraż: zero zmian.** `isPreciseRegexEntity` jest generyczne (`source === 'regex' && score === 1.0`), więc kandydaci R-DEV automatycznie wygrywają z nakładającym się, mylnym typem modelowym (np. `DOCUMENT_REFERENCE` na IMEI) na zasadach wprowadzonych przy domknięciu H-3.
6. **`ENTITY_LABELS`:** obecna etykieta „MAC, IMEI" jest OK; opcjonalnie rozszerzyć na „MAC, IMEI, nr seryjny" (kosmetyka UI, decyzja przy implementacji).

## 7. Dane wzorców: `identifier-patterns.json`

Nowe klucze w `src/pipeline/data/identifier-patterns.json`, ta sama dyscyplina co reszta pliku (listy zamknięte, rozszerzane wyłącznie przez zmierzony wyciek + test):

```json
"imei": {
  "contextAnchors": ["\\bIMEI\\b", "\\bIMEISV\\b"],
  "contextWindow": 40
},
"iccid": {
  "contextAnchors": ["\\bICCID\\b", "kart\\p{L}*\\s+SIM"],
  "contextWindow": 40
},
"numerSeryjny": {
  "tailAnchors": [
    "(?:\\bnr\\.?|\\bnumer)\\s+(?:seryjn\\p{L}*|fabryczn\\p{L}*)(?:\\s+\\p{L}+){0,2}\\s*[:.]?\\s*$",
    "\\bS\\/N\\s*[:.]?\\s*$"
  ],
  "tailWindow": 50
},
"imsi": {
  "contextAnchors": ["\\bIMSI\\b"],
  "contextWindow": 40
}
```

Uwaga implementacyjna: `tailAnchors` to NOWA odmiana kotwicy (dopasowanie do końca okna, semantyka `KRS_CONTEXT_RE`), nie `contextAnchors` (obecność gdziekolwiek w oknie) – komentarz `_comment` w JSON musi tę różnicę nazwać wprost, a mały helper (np. `hasTailAnchor`) staje obok `hasContextAnchor`. R-MAC i ścieżka A R-IMEI nie mają wpisu (bezwarunkowe/arytmetyczne – jak R-KW, które też nie ma klucza w tym pliku).

## 8. Wektory testowe (syntetyczne, sumy policzone w tej sesji arytmetyką `luhnValid`)

Żaden wektor nie jest prawdziwym IMEI/MAC/ICCID – cyfry kontrolne wyliczone Luhnem od zmyślonych baz, TAC-i nie muszą istnieć w GSMA (testujemy arytmetykę i bramki, nie rejestr):

| Wektor | Luhn | Oczekiwanie |
|---|---|---|
| `351234567890124` | ✅ | ścieżka A: emituje bare (35 nie jest IIN) |
| `35 123456 789012 4` | ✅ | ścieżka A: emituje (grupowanie 2-6-6-1, span z separatorami) |
| `359998887776666` | ✅ | ścieżka A: emituje |
| `351234567890125` | ❌ (popsuta ostatnia cyfra) | bare: ZERO; z kotwicą „IMEI:" – emituje (ścieżka B) |
| `354871234567890` (korpus, pismo_05) | ❌ (suma 65) | bare: ZERO; „IMEI: 354871234567890" – emituje (golden #3) |
| `370000000000002` | ✅ (kształt Amex 15) | R-IMEI bare: ZERO (anty-IIN); R-CARD: emituje PAYMENT_CARD – test pary typów |
| `4111111111111111` | ✅ (Visa 16) | R-IMEI: ZERO (długość ≠ 15, kotwicy brak) |
| `3512345678901234` (16 cyfr) | n/d | bare: ZERO zawsze; „IMEISV: …" – emituje (ścieżka B) |
| `00:1A:2B:3C:4D:5E`, `00-1a-2b-3c-4d-5e` | n/d | R-MAC: emituje bezwarunkowo |
| `00-11-22-33-44-55` | n/d | R-MAC: ZERO (myślnikowy all-digit bez litery hex, O-DEV-5) |
| `12:30:45`, `2024-07-19`, `550e8400-e29b-41d4-a716-446655440000` | n/d | R-MAC: ZERO (pułapki: czas, data, UUID) |
| `89480212345678901234` (20 cyfr, prefiks 89) | n/d (nie bramkuje) | „ICCID: …" / „karta SIM …" – emituje; bare: ZERO |
| `WW90-2024-081234-PL` po „nr seryjny urządzenia: " (korpus) | n/d | R-SN: emituje (golden #1) |
| `5CD3001XYZ` po „nr seryjny:" + CRLF + wcięcie (korpus) | n/d | R-SN: emituje (golden #2) |
| „uchwała SN: III CZP 6/21" | n/d | R-SN: ZERO (gołe „SN" poza zakresem + token bez 2 cyfr/6 znaków) |
| „nr zamówienia: EM/2024/09876" | n/d | R-SN: ZERO (kotwica ogonowa nie pasuje) |

Do pułapkownika `test-data/traps/h3-pulapki.txt` wchodzą wektory negatywne bez legalnej emisji innego typu; wektory produkujące legalny inny typ (np. `370000000000002` → PAYMENT_CARD, REGON-14, NRB) idą inline w teście, wzorem sekcji R-CARD.

## 9. Rejestr decyzji

| Nr | Decyzja | Status |
|---|---|---|
| O-DEV-1 | Zakres v1: R-IMEI + R-MAC + R-ICCID + R-SN; wszystkie emitują `DEVICE_IDENTIFIER` score 1.0 source 'regex' | propozycja Fable |
| O-DEV-2 | IMEI dwuścieżkowy jak R-DOW: A bare (15, Luhn, anty-IIN, zakaz `+`, grupowania z listy), B kotwiczony (15–16, BEZ wymogu Luhna – zmierzony wyciek korpusowy jest Luhn-invalid) | propozycja Fable; rezydualne p≈0,1 na gołych 15-cyfrowych ciągach do akceptacji Alana |
| O-DEV-3 | IMEISV wyłącznie kotwiczony: 16 cyfr nie ma cyfry kontrolnej (SVN to wersja software) – nie zmyślamy walidacji (dyscyplina R-PASZ) | twarde |
| O-DEV-4 | Deferencja IIN: bare-IMEI odrzuca każdy prefiks `hasCardIin` – rozłączność z R-CARD z konstrukcji; koszt (IMEI z TAC 34/37 tylko przez kotwicę) zapisany | propozycja Fable |
| O-DEV-5 | MAC bezwarunkowy tylko przy jednolitym separatorze `:` lub `-`; wariant myślnikowy wymaga ≥1 litery hex; Cisco-dot i EUI-64 poza v1 | propozycja Fable |
| O-DEV-6 | ICCID wyłącznie kotwiczony + długość 19–20 + prefiks 89; Luhn nie bramkuje; bare-89 to v2 po zmierzonym wycieku | propozycja Fable |
| O-DEV-7 | R-SN wyłącznie tight-tail (nowy helper obok `hasContextAnchor`); gołe „SN"/„SN:" POZA zakresem (kolizja z Sądem Najwyższym) | propozycja Fable |
| O-DEV-8 | **IMSI: decyzja Alana.** Za: kotwica `IMSI` jednoznaczna, FP≈0, koszt jednej linii JSON, mechanizm i tak powstaje. Przeciw: zero zmierzonego wycieku – wejście łamie literę dyscypliny „nigdy spekulacyjnie". Rekomendacja Fable: wpuścić razem z rodziną (jedyny świadomy wyjątek, odnotowany tutaj), ale wycięcie nic nie psuje | **ODRZUCONE (decyzja bramki, 2026-07-19).** Brak zmierzonego wycieku przeważa nad rekomendacją Fable – zasada „nigdy spekulacyjnie" bez wyjątku. Sonnet pominął klucz `imsi` w `identifier-patterns.json` i wzorzec IMSI w całości (gałąź `feature/r-dev-floor`). MAC/ICCID zostają w zakresie bez zmian. |
| O-DEV-9 | Tier: `DEVICE_IDENTIFIER` zostaje W1/'mask', waga 4 bez zmian (potwierdzenie status quo `ZAKRES-ANONIMIZACJI.md`); pytanie pomocnicze o W2 dla samych seriali odrzucone na rzecz jednolitego typu | **POTWIERDZONE (decyzja bramki, 2026-07-19).** W1 bez zmian – zero modyfikacji w `src/pipeline/configs/type-tiers.js` (zweryfikowane: `git diff main --stat` na tym pliku pusty w całej implementacji, gałąź `feature/r-dev-floor`). |
| O-DEV-10 | OCR-fold `l→1`/`O→0` tylko w ścieżkach czysto cyfrowych (IMEI/IMEISV/ICCID/IMSI); R-MAC i R-SN bez foldu (litery znaczące) | propozycja Fable |
| O-DEV-11 | Kotwice w `identifier-patterns.json` (klucze `imei`, `iccid`, `numerSeryjny`, warunkowo `imsi`); `tailAnchors`/`tailWindow` jako nowa, nazwana odmiana obok `contextAnchors` | propozycja Fable |

## 10. GATE-DEVICE – warunki odbioru (sprawdza Fable)

1. `npm test` zielony w całości na laptopie (unit testy bez modeli – laptop-safe).
2. **Goldeny korpusowe:** test jednostkowy `findRegexEntities` trafia wszystkie 3 zmierzone wycieki z §1 dokładnym spanem (w tym `5CD3001XYZ` przez CRLF + wcięcie i Luhn-invalid `354871234567890` przez kotwicę).
3. **Pułapkownik:** describe „R-DEV pułapkownik (zero DEVICE_IDENTIFIER)" przechodzi po WSZYSTKICH liniach `h3-pulapki.txt` (także dotychczasowych – daty, kwoty, sygnatury, faktury, KRS, telefony muszą zostać device-free), plus nowe wektory z §8; wektory z legalną emisją innego typu inline z asercją podwójną (zero DEVICE + obecny typ właściwy), wzór sekcji R-CARD.
4. **Rozgraniczenie kart:** `370000000000002` → PAYMENT_CARD i zero DEVICE; `351234567890124` → DEVICE i zero PAYMENT_CARD (test symetryczny pary).
5. **`ENTITY_SOURCES`:** `DEVICE_IDENTIFIER` listuje `'regex'`, a `REGEX_FLOOR_FIXTURE` zawiera wektor R-DEV (strażnik realnie przechodzi przez nowy typ – `emitted` zawiera `DEVICE_IDENTIFIER`); bez podnoszenia się na A8.
6. **Niezmienniki:** żadnych zmian w `src/pipeline/steps/`, regułach merge, progach ani tierach; `luhnValid` nietknięty bajt w bajt (reuse, nie kopia i nie modyfikacja); testy tier-partition-invariance i HC-1 nietknięte i zielone.
7. **Interpunkcja:** dokumenty kancelaryjne (ten plik, wpisy w audycie) trzymają en-dash; w komentarzach KODU em-dash jest dozwolony (ustalenie Alana 2026-07-18), więc Sonnet nie czyści istniejących komentarzy i nie jest z tego rozliczany.
8. **Eval:** przebieg tagowany `--label=r-dev-floor` + `eval:score` wyłącznie na PC stacjonarnym albo po uprzedzeniu Alana (laptop 15,4 GB: zakaz odpalania korpusu z modelami bez zgody). Oczekiwanie: DEVICE_IDENTIFIER recall 0%→3/3 na syntetyku, zero regresu w pozostałych typach. Brak przykładów adversarial to luka KORPUSU, nie detekcji – dopisanie przypadków device do korpusu adversarial 2.0 wychodzi poza R-DEV (odnotować w audycie).
9. Dokumentacyjne domknięcie: `IDENTIFIER-COVERAGE-AUDIT.md` §2 (DEVICE_IDENTIFIER → ZAMKNIĘTE z datą), `ZAKRES-ANONIMIZACJI.md` (dopisek o podłodze deterministycznej), krótka nota w `docs/entity-categories.md` jeśli opisuje źródła per typ.

## 11. Plan test-first dla Sonneta (kolejność commitów)

Baza: `main`, gałąź `feature/r-dev-floor`. Zasada z R-CARD/R-DATE: najpierw czerwona linia, potem wzorzec. Bez dotykania `src/pipeline/steps/` i bez odpalania eval.

1. **Commit 1 – czerwone goldeny + baseline pułapkownika:** (a) describe „R-DEV (device identifiers, deterministic floor)" z goldenami §1 (3 wektory korpusowe, dokładne spany) i pozytywami §8 – CZERWONE; (b) describe pułapkownika R-DEV iterujący po `h3-pulapki.txt` – ZIELONY od razu (wzorca nie ma, emisji zero) jako baseline; (c) nowe wektory-pułapki do `h3-pulapki.txt` (sekcja komentowana „R-DEV", wzór sekcji R-CARD): `351234567890125`, `00-11-22-33-44-55`, `12:30:45`, `2024-07-19`, UUID, „nr zamówienia: EM/2024/09876", „uchwała SN: III CZP 6/21", goły `89480212345678901234`.
2. **Commit 2 – implementacja + wpis źródeł (RAZEM, wymusza to strażnik):** `findImeiEntities`, `findMacEntities`, `findIccidEntities`, `findNumerSeryjnyEntities` (+ helper `hasTailAnchor`) w `src/anonymizer.js`, wpięte do `findRegexEntities`; klucze w `identifier-patterns.json` (§7); `ENTITY_SOURCES.DEVICE_IDENTIFIER` + `'regex'` z komentarzem; wektor R-DEV do `REGEX_FLOOR_FIXTURE`. Po commicie: goldeny ZIELONE, pułapkownik ZIELONY, strażnik ZIELONY.
3. **Commit 3 – testy rozgraniczeń i bramek:** pary typów (Amex↔IMEI, karta 16↔IMEISV-kotwica, ICCID↔Visa-19 prefiksowo), bramki jednostkowo (Luhn gate, anty-IIN gate, grupowanie, zakaz `+`, jednolitość separatora MAC, wymóg litery hex, tight-tail vs luźne okno – w tym anty-wektor „nr zamówienia" 20 znaków za serialem), emisja `{score: 1.0, source: 'regex'}`.
4. **Commit 4 – dokumenty:** odhaczenia z GATE pkt 9 + wpis decyzji Alana (O-DEV-8/9), jeśli już zapadły.
5. **Poza commitami Sonneta:** eval tagowany na PC (pkt 8 GATE), decyzja Alana o scaleniu.

Szacunek złożoności: ~4 nowe funkcje find* w konwencji istniejącej rodziny, 1 mały helper okna ogonowego, dane JSON, zero zmian w pipeline – ciężar leży w testach, dokładnie tam, gdzie ma leżeć.
