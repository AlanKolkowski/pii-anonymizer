# SHARED-FOUNDATION-DESIGN.md – wspólna warstwa i zunifikowany plan implementacji

**Wersja:** 1.0 (projekt do akceptacji)
**Data:** 2026-07-11
**Autor:** Fable (architekt aplikacji desktopowej)
**Status:** PROJEKT. Zero kodu implementacji. Dokument czeka na bramkę Opusa,
implementacja (Sonnet) nie startuje przed akceptacją.
**Odbiorca:** Opus jako bramka bezpieczeństwa (rejestr §8); Sonnet jako
wykonawca (plan §7); Alan wyłącznie do potwierdzeń kolejności i istniejących
decyzji P (§9 – ten dokument nie tworzy żadnej nowej decyzji produktowej).

**Relacja do istniejących dokumentów:** to jest warstwa **nad** trzema
projektami: `MCP-BRIDGE-DESIGN.md` (moduły M1–M8), `DOCX-REBUILD-DESIGN.md`
(MD1–MD6), `LOCAL-VERIFIER-DESIGN.md` (W1–W9). **Niczego w nich nie zmienia**:
ich wymagania, kontrakty, rejestry O-n i P-n pozostają w mocy. Dokument robi
dwie rzeczy, których żaden z nich nie mógł zrobić sam:

1. wydziela kod wspólny (gramatyka tokenów, plan substytucji, test
   „pokazane = wysłane", crc32) do modułów S1–S4, tak by istniała **jedna**
   wersja zamiast trzech kopii i trzech niezależnych implementacji;
2. scala trzy plany implementacji w jedną kolejność z grafem zależności,
   listą pracy „w tle" (bez decyzji produktowych) i mapą moduł → decyzja.

Tam, gdzie projekty zawierają klauzule warunkowe („konsolidację gramatyki
wykonuje ten, kto pierwszy wejdzie do implementacji" – DOCX §4.3 pkt 1,
most §12 M4), ten dokument je **rozstrzyga** przydziałem do modułów S.
To nie jest zmiana projektów, tylko wykonanie ich wspólnej klauzuli.

**Konwencja oznaczeń:** rejestry trzech projektów używają lokalnych numeracji
O-n / P-n, więc w tym dokumencie odwołania są kwalifikowane: `O-MOST-n`,
`P-DOCX-n`, `O-WER-n` itd. Własny rejestr tego dokumentu: **O-SF-n** (§8).
Fragmenty JSON i sygnatury to schematy kontraktów, nie kod implementacji.
Każde miejsce dotykające legendy albo tokenów jest oznaczone
**[DO WERYFIKACJI PRZEZ OPUSA: O-SF-n]**. `SECURITY.md` i `THREAT-MODEL.md` –
bez zmian, wyłącznie kontekst.

---

## §1. Cel, zasady, granice

### 1.1 Problem

Trzy projekty, projektowane niezależnie, dotykają tych samych miejsc repo
i (nie wiedząc o sobie nawzajem w szczegółach implementacyjnych) planują
trzy razy tę samą pracę:

- **gramatyka tokenów** istnieje dziś w trzech kopiach o różnej ścisłości
  (§2.1); potrzebują jej: silnik DOCX (MD4), checkery weryfikatora (W5),
  skan kontrolny mostu (M4) – każdy z projektów zakłada „wspólny moduł",
  żaden go nie posiada;
- **rozwiązanie substytucji per wystąpienie** (`resolveReplacement`)
  jest zdefiniowane w DOCX §8 i potrzebne w identycznym kształcie
  weryfikatorowi (§8 tamtego dokumentu) – dwa projekty, jeden szew;
- **gwarancja „pokazane = wysłane/skopiowane/wyeksportowane"** jest
  wymagana trzykrotnie (most §6.8 / C-BR-7, weryfikator §8.2 / C-VER-4,
  DOCX §4.7 / C-DOCX-10) – trzy testy o tym samym kryterium, które bez
  wspólnego narzędzia rozjadą się w definicji porównania;
- **crc32** jest planowany do wyniesienia przez MD2, a już istnieje
  w `src/export/zip.js:15`.

Jeśli Sonnet zacznie kodować trzy funkcje osobno, powstaną czwarta kopia
gramatyki, dwa niekompatybilne resolvery i trzy różne definicje „tożsamości
payloadu". Ten dokument temu zapobiega.

### 1.2 Zasady nadrzędne warstwy wspólnej

- **Z-SF-1 – zero zmiany zachowania.** Każdy moduł S jest refaktorem
  zachowawczym: po jego wdrożeniu web, wariant A, wariant B (przyszły)
  i eval zachowują się identycznie jak przed nim. Dowodem są istniejące
  testy (`npm test`), goldeny wskazane per moduł i tagowany `npm run eval`
  tam, gdzie dotykany jest kod importowany przez pipeline.
- **Z-SF-2 – jedna wersja, zero magii buildowej.** Konsolidacja oznacza
  jeden moduł źródłowy w `src/`; tam, gdzie fizyczne współdzielenie jest
  niemożliwe (proces główny wariantu B nie importuje `src/` w runtime,
  §3.5), stosuje się jawnie wzorzec „lustro + test zgodności" już przyjęty
  przez most (§7.2 tamtego dokumentu) – nigdy ciche kopiowanie.
- **Z-SF-3 – gramatyka osobno, legenda osobno.** Moduł gramatyki (S1) nie
  wie, czym jest legenda: operuje wyłącznie na tekście. Cała styczność
  z legendą jest skoncentrowana w warstwie substytucji (S2). Dzięki temu S1
  może być konsumowany wszędzie (także w procesie głównym) bez poszerzania
  powierzchni legendy, a przegląd Opusa ma jedno miejsce styku z A1.
- **Z-SF-4 – testy wchodzą z modułem.** Jak we wszystkich trzech projektach.
- **Z-SF-5 – bramka Opusa przed merge** dla S1 i S2 (dotykają tokenów
  i legendy); S3 i S4 nie dotykają żadnego aktywa i przechodzą zwykły
  przegląd z pierwszym konsumentem.

### 1.3 Poza zakresem

- Scalenie morfologii **dopasowującej** (`INFLECTION_SUFFIXES`,
  `ADJECTIVAL_SURNAME_FAMILIES`, `src/anonymizer.js:1-66`) z generacyjną
  (W2) – świadomie odłożone przez weryfikator §3.1 („efekt uboczny,
  nie cel v1"); tu tylko odnotowane jako przyszły kierunek.
- Jakiekolwiek zmiany kontraktu tokenów (np. wskazówki przypadka
  `[PERSON_NAME_1|D]`) – poza v1, rejestr O-WER-9 / P-WER-5 bez zmian.
- Wszystko, co którykolwiek z trzech projektów wyklucza ze swojego zakresu.

---

## §2. Inwentarz duplikacji i zbiegów (stan repo na dziś)

### 2.1 Gramatyka tokenów – trzy kopie, dwie semantyki

| Miejsce | Wzorzec | Flagi | Grupa | Konsument |
|---|---|---|---|---|
| `src/anonymizer.js:139` (`TOKEN_LITERAL_RE`) | `\[[A-Z][A-Z0-9_]*_\d+\]` | `g` | brak | `collectReservedTokens` (rezerwacja literałów tokenów obecnych w źródłach, :141-148) |
| `src/mcp/listings.js:28` (`TOKEN_PATTERN`) | `\[[A-Z][A-Z0-9_]*_\d+\]` | brak | brak | `hasAnonymizationToken` (:30) – warunek czytelności wyniku przez MCP |
| `src/ui/deanon-workspace/index.js:9` (`TOKEN_RE`) | `\[([A-Z_]+_\d+)\]` | `g` | id tokenu | `tokenParts` (:29-43) – pigułki, liczniki, podgląd |

Różnica semantyczna (kopia UI jest **ciaśniejsza i zarazem luźniejsza**):

- typ z cyfrą po pierwszym znaku (np. `[X2_FOO_1]`): łapią kopie 1–2,
  **nie łapie** kopia 3 (`[A-Z_]+` nie dopuszcza cyfr w nazwie typu);
- typ zaczynający się podkreślnikiem (np. `[_FOO_1]`): łapie kopia 3,
  **nie łapią** kopie 1–2 (wymagany pierwszy znak `[A-Z]`).

Żaden rzeczywisty typ encji (`src/pipeline/configs/entity-sources.js`) nie
zawiera dziś cyfry ani nie zaczyna się podkreślnikiem, więc rozjazd jest
niewidoczny na danych produktowych – ale to dokładnie ten rodzaj uśpionej
niespójności, który O-DOCX-4 nazywa ryzykiem („token podmieniony w tekście,
a niewidoczny dla skanu rezyduów, albo odwrotnie").

Dodatkowy hazard: kopie 1 i 3 to **mutowalne obiekty RegExp z flagą `g`**.
Kopia 3 jest używana przez `exec()` w pętli (stanowy `lastIndex` na
obiekcie modułowym); jest to dziś bezpieczne tylko dlatego, że każda pętla
biegnie do wyczerpania. Współdzielenie jednego obiektu RegExp między trzy
projekty zamieniłoby to w bombę zegarową – stąd kontrakt S1 §3.2
(wyłącznie czyste funkcje, zakaz eksportu mutowalnego wzorca).

### 2.2 Deanonimizacja – jedna funkcja, cztery ujścia, dwie semantyki

`deanonymizeText(text, legend)` (`src/anonymizer.js:425-431`): sekwencyjny
`replaceAll` po wpisach legendy, z **funkcyjnym replacerem** (ochrona przed
interpretacją `$&`/`$$` w wartościach – przybite goldenami
`src/anonymizer.test.js:151,165`).

Cztery ujścia (zamknięta lista, zgodna z weryfikatorem §8.2):

| Ujście | Miejsce | Mechanizm dziś |
|---|---|---|
| podgląd wyjścia | `src/ui/deanon-workspace/index.js:141-152` (`renderParts`) | **jednoprzebiegowy** podział `tokenParts` + `part.orig` z legendy |
| „Kopiuj" | `src/ui/deanon-workspace/index.js:293` | `deanonymizeText` |
| karty wyników | `src/ui/outcomes-list/index.js:65,209` | `deanonymizeText` |
| eksport DOCX/PDF | `src/export/deanon.js:76` (`buildDeanonExportEntries`) | `deanonymizeText` |

Uśpiona niespójność nr 2: podgląd jest jednoprzebiegowy (wartości wstawione
nie są ponownie skanowane), a `deanonymizeText` re-skanuje tekst przy każdym
kolejnym wpisie legendy – wartość legendy zawierająca literał innego tokenu
skaskadowałaby w „Kopiuj"/eksporcie, ale nie w podglądzie. Analiza
osiągalności i rozstrzygnięcie: §4.4.

### 2.3 Reguła legendy efektywnej – trzy kopie

`effectiveOutcomeLegend(outcome, liveLegend)` = `legendSnapshot ?? żywa
legenda ?? {}` istnieje w trzech miejscach:
`src/ui/deanon-workspace/index.js:49-51`, `src/export/deanon.js:61-63`,
`src/ui/outcomes-coordinator.js:13`. Na tej regule polegają wprost DOCX §3.4
(„istniejąca reguła `effectiveOutcomeLegend` (snapshot ▸ żywa legenda)")
i weryfikator §2.2 (wejście „legendaEfektywna"). Trzy kopie reguły
pierwszeństwa to realne ryzyko dryfu – wchodzi do S2 (§4.6).

### 2.4 „Pokazane = wysłane" – trzy specyfikacje tego samego testu

- most §6.8 + O-MOST-9 + C-BR-7: hash tekstu w oknie bramki == hash tekstu
  w ramce na potoku;
- weryfikator §8.2 + O-WER-10 + C-VER-4: hash podglądu == hash schowka ==
  hash treści eksportu;
- DOCX §4.7 + C-DOCX-10: liczniki raportu wyłącznie z silnika; części bez
  podmian bajt-w-bajt; złote pliki.

Bez wspólnego narzędzia każdy test zdefiniuje „hash tekstu" inaczej
(normalizacja końców linii, ekstrakcja z DOM przez `innerText` zamiast
`textContent`, kodowanie) i gwarancje przestaną być porównywalne. Wchodzi
do S3 (§5).

### 2.5 Drobne

- `crc32` (`src/export/zip.js:15-21`, tabela :3-13): MD2 planuje wyniesienie
  do modułu współdzielonego – S4 (§6).
- `findRegexEntities` (`src/anonymizer.js:318-341`): **już jednoźródłowe**;
  konsumenci: `src/pipeline/steps/regex.js`, przyszłe M4 (skan §6.3 mostu)
  i W5 N-2. Nic do konsolidacji; uwaga środowiskowa dla M4 objęta tą samą
  decyzją co gramatyka (§3.5, O-SF-3).
- `tokenParts`/liczniki UI (`countRestored`, `countTokenStats`,
  `src/ui/deanon-workspace/index.js:45-64`): konsumenci S1+S2 po migracji;
  bez zmiany zachowania.

### 2.6 Zbiegi planów (kto miał to zrobić)

| Praca | Rości sobie | Rozstrzygnięcie tego dokumentu |
|---|---|---|
| konsolidacja gramatyki tokenów | most M4 („wyniesienie `TOKEN_PATTERN` do modułu współdzielonego") i DOCX MD4 („wykonuje ten, kto pierwszy") | wykonuje **S1**, przed oboma; M4 i MD4 stają się konsumentami |
| szew `resolveReplacement` | DOCX §8 (definicja) i weryfikator §8 (ten sam szew od strony planu substytucji) | kontrakt scala **S2**; MD4 i W4 konsumują, żaden nie definiuje własnego |
| wyniesienie `crc32` | DOCX MD2 | wykonuje **S4** (może wejść jako pierwszy commit MD2 – §6) |
| test tożsamości payloadu | M8, W4/W7, MD5/MD6 – każdy własny | kryterium i helper definiuje **S3**; trzy projekty piszą swoje testy na tym helperze |

---

## §3. S1 – moduł gramatyki tokenów

**[DO WERYFIKACJI PRZEZ OPUSA: O-SF-1, O-SF-2, O-SF-3 – całość sekcji;
moduł definiuje, co jest tokenem, czyli rdzeń kontraktu W1 mostu,
dopasowań DOCX §4.3 i checkerów N-1/N-10]**

### 3.1 Miejsce

Nowy moduł `src/tokens.js` (płaski plik obok `anonymizer.js`, zgodnie ze
stylem repo; nazwa do dyspozycji Sonneta, kontrakt nie). Czysty ESM, zero
zależności, zero DOM, zero API Node – importowalny w rendererze (web,
wariant A, wariant B), w workerze, w testach vitest, w Node (eval) i –
technicznie – w procesie głównym (praktycznie: §3.5).

### 3.2 Kontrakt

Kanoniczna gramatyka: **szersza** z kopii 1–2, z grupą przechwytującą
identyfikator (grupa jest przezroczysta dla dzisiejszych konsumentów 1–2,
którzy grup nie używają):

```
token  := "[" TYP "_" INDEKS "]"
TYP    := [A-Z][A-Z0-9_]*        (pierwszy znak: wielka litera)
INDEKS := \d+
całość := \[([A-Z][A-Z0-9_]*_\d+)\]
```

Eksportowane API – **wyłącznie czyste funkcje**; moduł nie eksportuje
żadnego obiektu RegExp (hazard współdzielonego `lastIndex`, §2.1); każde
wywołanie tworzy/używa własnej instancji wzorca:

| Funkcja | Kontrakt |
|---|---|
| `containsToken(text)` | true, gdy tekst zawiera ≥ 1 token; zamiennik `hasAnonymizationToken` z `listings.js` |
| `findTokens(text)` | lista `{ token, tokenId, type, index }` w kolejności wystąpień; zamiennik pętli po `TOKEN_LITERAL_RE` i sterownik dla skanów DOCX/checkerów |
| `splitTokenParts(text)` | naprzemienne segmenty `{ text }` \| `{ token, tokenId, type }` pokrywające cały tekst; zamiennik `tokenParts` **bez** dostępu do legendy (mapowanie `orig` zostaje po stronie konsumenta – Z-SF-3) |
| `isTokenLiteral(str)` | dokładne dopasowanie całego napisu do gramatyki |
| `tokenType(tokenId)` | typ z identyfikatora (obcięcie `_\d+` z końca); zamiennik `entityTypeFromTokenId` |

Własności gwarantowane kontraktem i przybite testami:

1. **Literalność / domknięcie `]`:** `[PERSON_NAME_1]` nigdy nie dopasuje
   się wewnątrz `[PERSON_NAME_10]` (prefiks bez `]` nie jest trafieniem) –
   własność, na której DOCX §4.3 opiera rozłączność trafień, a §4.4 tego
   dokumentu bezkolizyjność kolejności iteracji legendy.
2. **Nieprzenikalność sentinela:** gramatyka nie może dopasować napisu
   zawierającego `U+FFFC` wewnątrz tokenu (klasy znaków tego nie dopuszczają)
   – własność wymagana przez DOCX §4.2 pkt 4; test jednostkowy wprost.
3. **Bezstanowość:** dwa przeploty dowolnych wywołań dają te same wyniki,
   co wywołania izolowane (brak współdzielonego `lastIndex`).
4. **Determinizm i liniowość** po długości tekstu.

### 3.3 Migracja trzech kopii (bez zmiany zachowania)

Kolejność wewnątrz S1: najpierw moduł + testy, potem trzy podmiany,
każda osobno uruchamiająca pełny `npm test`.

| Krok | Miejsce | Zmiana | Ryzyko behawioralne |
|---|---|---|---|
| 1 | `src/anonymizer.js:139-148` | `collectReservedTokens` iteruje po `findTokens(text)`; stała `TOKEN_LITERAL_RE` znika | zero – identyczna gramatyka; goldeny rezerwacji w `anonymizer.test.js` (sekcja `applyTokens`/`buildTokenMap`, :711-806) |
| 2 | `src/mcp/listings.js:28-32` | `hasAnonymizationToken` deleguje do `containsToken` | zero – identyczna gramatyka; zachowanie `buildOutcomeListing`/`buildReadOutcomeContent` bez zmian |
| 3 | `src/ui/deanon-workspace/index.js:9-43` | `tokenParts` przepisany na `splitTokenParts` + mapowanie legendy po stronie UI; `entityTypeFromTokenId` → `tokenType` | **dwie zmiany brzegowe, obie zamierzone** (niżej) |

Zamierzone zmiany brzegowe kroku 3 (jedyne w całym S1):

- `[X2_FOO_1]` (cyfra w typie): dotąd zwykły tekst w UI, po migracji
  pigułka „token nierozwiązany" – **spójnie** z tym, jak ten sam napis
  traktują dziś rezerwacja i listingi MCP;
- `[_FOO_1]` (typ od podkreślnika): dotąd pigułka, po migracji zwykły
  tekst – **spójnie** z rezerwacją i listingami; tokenizer nigdy takich
  tokenów nie generuje (typ pochodzi z `entity_group`).

Obie klasy są nieosiągalne z danych produkowanych przez aplikację
i dotyczą wyłącznie tekstu ręcznie spreparowanego. Test dokumentujący
(tabela przypadków z komentarzem „celowa zmiana, ujednolicenie do gramatyki
kanonicznej") wchodzi razem z krokiem 3. **[O-SF-1]**

### 3.4 Testy strażnicze S1

- nowy `src/tokens.test.js`: korpus **rzeczywistych typów encji**
  (importowanych z `src/pipeline/configs/entity-sources.js`, żeby lista
  nie dryfowała od kodu) × round-trip `[TYP_n]` przez wszystkie funkcje;
  przypadki brzegowe: `[TYP_1]` vs `[TYP_10]` (własność 1), sentinel
  `U+FFFC` (własność 2), `[lowercase_1]`, `[TYP_]`, `[TYP1]`, `[[TYP_1]]`,
  token na początku/końcu tekstu, dwa tokeny stykające się;
- istniejące bez modyfikacji: `anonymizer.test.js`,
  `deanon-workspace.test.js`, pełny `npm test`;
- `npm run eval -- --label=s1-token-grammar` + `npm run eval:score` bez
  regresji: `anonymizer.js` jest importowany przez kroki pipeline'u
  (`dedup`, `backfill`, `ner`, `segment`, `regex`, `snap`, `tokenize`),
  więc obowiązuje dyscyplina eval z `CLAUDE.md`, mimo że S1 nie zmienia
  detekcji.

### 3.5 Konsument w procesie głównym (most M4) – jedyne miejsce, gdzie „jedna wersja" wymaga decyzji

Asar pakuje `dist-desktop/**` + `electron/**` + `package.json`
(`electron-builder.yml:37-45`) – **`src/` nie istnieje w spakowanej
aplikacji**, więc `electron/bridge/outbound-checks.mjs` (M4) nie może
w runtime zaimportować `src/tokens.js`. Dwie uczciwe opcje:

- **(rekomendowana) lustro + test zgodności:** M4 trzyma własny literał
  gramatyki (jedna linia) i regexy PII, a test jednostkowy uruchamiany
  z repo (gdzie oba pliki są importowalne) porównuje je z `src/tokens.js`
  i `findRegexEntities` – rozjazd = czerwony test. To dokładnie wzorzec,
  który most już przyjął dla opisów narzędzi (§7.2 tamtego dokumentu:
  „zamiast magii buildowej – test jednostkowy porównujący oba zestawy").
  Zaleta: zero zmian w pakowaniu, asercje artefaktów C-BR-13/14 bez
  dodatkowych pozycji, jeden wzorzec zamiast dwóch.
- (dopuszczalna) dopisanie `src/tokens.js` do `files` w **nowym**
  `electron-builder.bridge.yml` (wariant A nietknięty) i import względny
  z asara. Zaleta: fizycznie jedna wersja; koszt: nowa ścieżka w asarze B,
  nowy wpis w asercjach artefaktów, precedens „main importuje z src/",
  którego most świadomie unikał.

Decyzja zapada w bramce M4 (most jest ostatnią fazą, §7.4) – dziś wystarczy,
że kontrakt S1 jej nie przesądza ani nie blokuje. **[O-SF-3]**

---

## §4. S2 – warstwa substytucji (plan + `resolveReplacement`)

**[DO WERYFIKACJI PRZEZ OPUSA: O-SF-4, O-SF-5, O-SF-6, O-SF-7 – całość
sekcji; to jedyny nowy kod dotykający legendy (A1)]**

### 4.1 Miejsce i zakres

Nowy moduł `src/substitution.js` (nazwa do dyspozycji Sonneta). Obejmuje
**wyłącznie kierunek deanonimizacji** (token → wartość). Kierunek
tokenizacji (`buildTokenMap`, `applyTokens`) pozostaje w `anonymizer.js`
bez zmian – S2 go nie dotyka.

S2 realizuje **część wspólną** W4 (weryfikator) i MD4 (DOCX): kontrakt
rozwiązania per wystąpienie plus zgodna wstecznie fasada. Nie realizuje:
przechowywania decyzji, snapshotów planu, unieważniania decyzji po edycji
(to zostaje w W4), ani enumeracji strumienia XML (to zostaje w MD4).
Kryteria akceptacji W4 i MD4 pozostają w mocy – po prostu oba moduły
zaczynają od gotowego szwu zamiast go definiować.

### 4.2 Kontrakt rozwiązania

Schemat (nie kod):

```
resolveOccurrences(text, { legend, decisions?, resolveReplacement? })
  → [ { occurrenceIndex, index, token, tokenId, type,
        baseValue | undefined,          // legend[token]
        finalText,                       // patrz warstwy niżej
        source: "decyzja" | "resolver" | "baza" | "nierozwiązany" } ]

renderResolvedText(occurrences, originalText) → string
```

- Enumeracja wystąpień: `splitTokenParts` z S1 – **ta sama** dla wszystkich
  ujść tekstowych, więc `occurrenceIndex` (n-te trafienie gramatyki
  w tekście) jest stabilnym kluczem decyzji między podglądem, kopią,
  kartami i eksportem.
- Warstwy wartości (kolejność rozstrzygania, zgodna z weryfikatorem §8.1
  i DOCX §8):

```
finalText(wystąpienie) =
  decyzjaCzłowieka(wystąpienie)                         // W4; w v1 brak
  ?? resolveReplacement({ token, baseValue,
       contextBefore, contextAfter, occurrence, sink }).text
                                                        // DOCX §8; v1: tożsamość
  ?? baseValue                                          // legend[token]
token bez wpisu w legendzie → finalText = token (pozostaje widoczny)
```

- Kontrakt `resolveReplacement` (scalenie DOCX §8 z potrzebą W4):
  funkcja **czysta i lokalna** (zero I/O, zero sieci, zero DOM); dostaje
  kontekst ±N znaków **tekstu stokenizowanego** wokół trafienia; zwraca
  `{ text, note? }`; `note` trafia do raportu ujścia (raport DOCX §6.2,
  panel weryfikacji §9 weryfikatora). Implementacja v1 obu projektów:
  tożsamość (`text = baseValue`).
- **Wynik nie jest ponownie skanowany** (single-pass, DOCX §4.5) – wartość
  zawierająca przypadkiem literał tokenu nie wywoła kaskady; szczegóły §4.4.
- **Sanityzacja po stronie ujścia**, nie w silniku: DOCX stosuje §4.6
  (C0 → spacja, `xml:space`), ujścia tekstowe przekazują wartości verbatim
  (tak jak dziś – znak nowej linii w wartości jest legalny w tekście,
  a byłby zgubiony w `w:t`). Silnik zwraca dane, dyscyplinę wyjścia
  definiuje konsument. **[O-SF-5]**

### 4.3 Fasada zgodności: `deanonymizeText` zostaje

`deanonymizeText(text, legend)` pozostaje eksportem `src/anonymizer.js`
(żaden z czterech konsumentów nie zmienia importów), ale jego ciało staje
się fasadą: `renderResolvedText(resolveOccurrences(text, { legend }))`
z pustymi decyzjami i tożsamościowym resolverem. Skutek:

- wszystkie cztery ujścia przechodzą na wspólny silnik **bez zmiany
  jednej linii po swojej stronie** – to jest krok S2;
- przełączenie ujść na wywołania świadome planu (decyzje per wystąpienie,
  pigułki sugestii) to późniejszy W4; do tego czasu zachowanie jest
  identyczne z dzisiejszym z definicji fasady;
- MD4 konsumuje z S2 wyłącznie kontrakt `resolveReplacement` (enumerację
  wystąpień robi na własnym strumieniu XML z S1) – zero sprzężenia
  z ujściami tekstowymi.

### 4.4 Zgodność wsteczna: analiza trzech subtelności

1. **Ochrona `$` w wartościach.** Dzisiejszy `replaceAll` używa replacera
   funkcyjnego właśnie po to, by `$&`/`$$` w wartości nie były
   interpretowane (goldeny `anonymizer.test.js:151,165`). Silnik budujący
   wynik z części nie ma w ogóle pojęcia wzorca podstawienia – własność
   zachowana z konstrukcji; te same goldeny muszą przejść bez modyfikacji.
2. **Sekwencyjny `replaceAll` vs single-pass.** Dzisiejsza implementacja
   re-skanuje tekst po każdym wpisie legendy, więc wartość legendy
   zawierająca literał **innego** tokenu skaskadowałaby („Kopiuj",
   eksport), czego podgląd (jednoprzebiegowy `renderParts`) by nie pokazał
   – istniejący dziś, teoretyczny rozjazd „pokazane ≠ skopiowane".
   Osiągalność kaskady: wymaga, by wartość legendy zawierała literał
   tokenu wygenerowanego; mechanizm rezerwacji
   (`collectReservedTokens`, `src/anonymizer.js:141-148,155,167`) zbiera
   literały tokenów ze **wszystkich** tekstów źródłowych i wyklucza je
   z puli generatora, więc token, którego literał występuje w jakimkolwiek
   źródle (a wartości legendy są wycinkami źródeł), nie zostanie nigdy
   nadany – stan **nieosiągalny produktowo**, osiągalny wyłącznie przy
   legendzie skonstruowanej ręcznie w teście. Decyzja S2: **single-pass
   wszędzie** (spójnie z DOCX §4.5 i dzisiejszym podglądem). Skutek uboczny:
   dotychczasowy teoretyczny rozjazd podgląd↔kopia **znika**, a gwarancja
   „pokazane = skopiowane" staje się konstrukcyjna, nie przypadkowa.
   Test własnościowy dokumentuje różnicę na legendzie patologicznej jako
   zamierzoną. **[O-SF-4]**
3. **Kolejność iteracji legendy.** Nieistotna dla wyniku: literały tokenów
   są wzajemnie nie-podłańcuchowe (własność 1 z §3.2 – wymóg `]`
   bezpośrednio po indeksie), więc żadne dwa wpisy legendy nie konkurują
   o ten sam fragment tekstu.

Golden zgodności S2: na korpusie istniejących przypadków testowych
(`anonymizer.test.js`, `deanon-workspace.test.js`, `export/deanon.test.js`)
oraz na `test-data/synthetic/*` po pełnym przebiegu anonimizacji:
`stary deanonymizeText ≡ nowy` **bajt w bajt**. Dodatkowo
`npm run eval -- --label=s2-substitution` + `eval:score` bez regresji
(anonymizer.js dotknięty).

### 4.5 Granice bezpieczeństwa S2

- Silnik czyta legendę wyłącznie przez argument wywołania; **nie tworzy
  żadnej nowej ścieżki serializacji**: zero logów interpolujących wartości
  (reguła C-PERS-7/D3 obowiązuje moduł wprost), zero struktur trwałych,
  zero kanałów (WebMCP/most/IPC nie widzą tego modułu). Wynik życia planu:
  RAM, dokładnie jak dziś wynik `deanonymizeText`.
- Formy poświadczone (O-WER-2) i magazyn decyzji (W4) są **poza** S2 –
  S2 definiuje tylko miejsce ich konsumpcji (parametr `decisions`).
- `renderResolvedText` produkuje string; rendering do DOM pozostaje przy
  konsumentach i ich dyscyplinie `textContent` (C-INP-1).

### 4.6 Konsolidacja `effectiveOutcomeLegend`

Trzy kopie z §2.3 zastępuje jeden eksport w S2 (reguła pierwszeństwa:
`legendSnapshot ▸ żywa legenda ▸ {}`); `outcomes-coordinator.js`,
`deanon-workspace`, `export/deanon.js` importują. Zachowanie identyczne,
goldeny: `outcomes-coordinator.test.js`, `deanon-workspace.test.js`,
`export/deanon.test.js`. **[O-SF-6]**

### 4.7 Odnotowany konflikt przyszłości (nie materializuje się w v1)

DOCX §8 przewiduje, że moduł fleksji podłączony do `resolveReplacement`
zwraca odmienioną formę z adnotacją do raportu – czyli formę zastosowaną
**bez decyzji per wystąpienie**. Weryfikator V2 wymaga, by żadna zmiana
tekstu nie weszła bez jawnej akceptacji radcy, a jego przepływ decyzji (§9)
istnieje tylko dla wyników **tekstowych** – wyniki DOCX mają podgląd
zablokowany do edycji (DOCX §3.4), więc nie mają dziś UI, w którym dałoby
się zatwierdzać sugestie per wystąpienie. W v1 konflikt nie istnieje
(resolver tożsamościowy po obu stronach), ale **przed podłączeniem fleksji
do przepływu DOCX** trzeba rozstrzygnąć: albo przepływ DOCX dostaje własny
widok decyzji, albo fleksja w DOCX działa wyłącznie w trybie
raportowanych adnotacji za osobną, jawną zgodą (co wymaga uzgodnienia
z V2). Zapisane, żeby nie wypłynęło jako niespodzianka w v1.1.
**[O-SF-7]**

---

## §5. S3 – wspólne narzędzie testowe „pokazane = wysłane/skopiowane/wyeksportowane"

Kod wyłącznie testowy (nie wchodzi do żadnego artefaktu produkcyjnego),
dlatego bez własnej bramki Opusa – ale **kryterium porównania**, które
definiuje, jest przedmiotem O-SF-8, bo to ono operacjonalizuje W2 mostu
i V2 weryfikatora.

### 5.1 Miejsce i API

Proponowane: `test/content-identity.mjs` (nowy katalog `test/` na helpery
wspólne dla vitest i e2e; alternatywa `e2e/helpers/` – do dyspozycji
Sonneta). Czysty ESM, WebCrypto (`crypto.subtle` dostępne w Node i w
przeglądarce), zero zależności.

| Funkcja | Kontrakt |
|---|---|
| `sha256HexUtf8(string)` | SHA-256 z bajtów UTF-8 stringa, hex małymi literami – kanoniczna definicja „hasha tekstu" dla C-BR-7 i C-VER-4 |
| `sameBytes(a, b)` | porównanie `Uint8Array` bajt w bajt – dla C-DOCX-10 (części nietknięte) |
| `assertShownEqualsSent({ shown, sent, label })` | porównuje surowe stringi **i** hashe; przy rozjeździe raportuje indeks pierwszej różnicy z kontekstem ±20 znaków |

### 5.2 Reguły kryterium (ważniejsze niż kod)

1. **Zero normalizacji.** Żadnego trimowania, ujednolicania końców linii,
   NFC/NFD – cała wartość gwarancji polega na równości surowej.
2. **Ekstrakcja z DOM wyłącznie przez `textContent`** hosta podglądu
   (nigdy `innerText`, który normalizuje białe znaki wg layoutu).
   Porównania krzyżowe (schowek, plik, ramka potoku) zawsze na stringach
   źródłowych, nie na tym, co przeglądarka wyrenderowała.
3. Kontekst rozjazdu w komunikacie błędu może zawierać treść dokumentu –
   helper wolno stosować **wyłącznie na korpusie syntetycznym**
   (`test-data/synthetic/`, złote pliki DOCX); adnotacja w nagłówku modułu.
4. Konsumenci i mapowanie: C-BR-7 (M3/M8: bramka vs ramka), C-VER-4
   (W4/W7: podgląd vs schowek vs eksport), MD5/MD6 (raport silnika vs
   ponowny skan strumienia wyniku; `sameBytes` dla części nietkniętych).

**[DO WERYFIKACJI PRZEZ OPUSA: O-SF-8 – akceptacja kryterium jako wspólnej
operacjonalizacji trzech gwarancji]**

---

## §6. S4 – `crc32` i higiena drobnych współdzieleń

Bez bramki własnej (nie dotyka legendy, tokenów ani niezaufanego wejścia
w sensie parsowania); wchodzi jako pierwszy, mechaniczny commit MD2 albo
samodzielnie – oba warianty dopuszczalne, byle przed właściwym zip-writerem.

- Wydzielenie `CRC32_TABLE` + `crc32(bytes)` z `src/export/zip.js:3-21`
  do `src/export/crc32.js`; `zip.js` importuje; zachowanie i eksporty
  `zip.js` bez zmian (`npm test` – w tym `export/deanon.test.js` – jako
  strażnik).
- **Rozszerzenie kontraktu o formę strumieniową**: `createCrc32()` →
  `{ update(chunk), digest() }`. Uzasadnienie: MD1/MD2 liczą CRC i limity
  na strumieniach `DecompressionStream`/`CompressionStream` (DOCX §9.2:
  „licznik w strumieniu dekompresji, przekroczenie = natychmiastowe
  przerwanie") – jednorazowe `crc32(bytes)` wymagałoby materializacji
  całego bufora, wbrew limitom. Forma jednorazowa zostaje (zip.js).
- Test: znane wektory CRC-32 (m.in. `"123456789"` → `0xCBF43926`),
  zgodność `createCrc32` z `crc32` na tych samych danych dzielonych
  w losowych miejscach.

Odnotowane bez działania: `findRegexEntities` (już jednoźródłowe, §2.5);
morfologia dopasowująca vs generacyjna (poza zakresem, §1.3).

---

## §7. Zunifikowany plan kolejności

### 7.1 Węzły i krawędzie (graf zależności)

Oznaczenia: `→` = „blokuje" (krawędź twarda), `(P-…)` = wymagana decyzja
produktowa, `(rek.)` = decyzja z gotową rekomendacją w projekcie źródłowym,
`[G]` = bramka Opusa przed merge.

**Warstwa wspólna:**

| Moduł | Zależy od | Decyzje | Bramka |
|---|---|---|---|
| **S1** gramatyka tokenów (§3) | – | żadnych | [G] |
| **S2** substytucja (§4) | S1 | żadnych | [G] |
| **S3** test tożsamości (§5) | – | żadnych | z pierwszym konsumentem |
| **S4** crc32 (§6) | – | żadnych | z MD2 |

**DOCX (rejestr P-DOCX z §14 tamtego dokumentu):**

| Moduł | Zależy od | Decyzje | Bramka |
|---|---|---|---|
| **MD1** zip-reader | – | żadnych | [G] |
| **MD2** zip-writer | MD1, S4 | żadnych | [G] |
| **MD3** ooxml-inspect | MD1 | P-DOCX-2 (rek.: twarda blokada) | [G] |
| **MD4** token-engine | MD1, **S1**, **S2** | P-DOCX-3 (rek.), P-DOCX-7 (rek. = tożsamość, czyli dokładnie v1 S2) | [G] |
| **MD5** orkiestrator + UI | MD2, MD3, MD4, S3 | P-DOCX-1, P-DOCX-4, P-DOCX-5 (wszystkie z rekomendacjami) | [G] |
| **MD6** dowody całości | MD5 | potwierdzenie kompletu P-DOCX | [G] |

**Weryfikator (rejestr P-WER):**

| Moduł | Zależy od | Decyzje | Bramka |
|---|---|---|---|
| **W1** dane morfologiczne | – (warunek wejścia: licencje, O-WER-3) | P-WER-1 (rek.: PERSON_NAME pełny potok) | [G] |
| **W2** silnik fleksji | W1 | P-WER-1 (rek.) | nie |
| **W3** detektor przypadka | W2 (kolejność wg projektu W) | – | nie |
| **W4** plan substytucji + ujścia | **S2**, W2, W3, S3 | – | [G] |
| **W5** checkery N-1…N-10 | **S1** (tylko N-1/N-10; reszta bez zależności) | żadnych | nie |
| **W6** kontrola krzyżowa NER | W5 (kolejność wg projektu W) | – | [G] |
| **W7** UI panelu weryfikacji | W4, W5, W6, S3 | P-WER-2, P-WER-4 (rek.: (b)), P-WER-6, P-WER-7 | [G] |
| **W8** asercje + dokumenty | W7 | – | [G] |
| **W9** poziom 3 (opcjonalny) | decyzja | **P-WER-3** (bez rekomendacji „tak" – po doświadczeniu z v1) | [G] |

**Most (rejestr P-MOST):**

| Moduł | Zależy od | Decyzje | Bramka |
|---|---|---|---|
| **M1** session-file | – | żadnych | [G] |
| **M2** potok + auth | M1 | żadnych | [G] |
| **M4** outbound-checks | **S1** (+ decyzja O-SF-3: lustro vs pakowanie) | żadnych | [G] |
| **M3** bramka człowieka | M4, S3 | P-MOST-3 (rek.), P-MOST-5 (rek.) | [G] |
| **M5** renderer tools + IPC | M3; warunek wejścia: S-IPC-1 (wygląda na wdrożone commitem 42d5b95 „IPC sender check" – potwierdzić przy starcie M5) | żadnych | [G] |
| **M6** adapter MCP stdio | M2 (wg planu mostu po M5) | żadnych | [G] |
| **M7** wariantowość buildów | M1–M6 | **P-MOST-1 (nazwy handlowe, appId – realna decyzja Alana, nie potwierdzenie)** | [G] |
| **M8** e2e + matryca klientów | M7, S3; wydanie B: **B4 (podpis)** | P-MOST-2 (rek.), potwierdzenia P-MOST | [G] |

Krawędzie krzyżowe w postaci zwartej:

```
S1 ──┬─→ S2 ──┬─→ MD4 ──→ MD5 ──→ MD6
     │        └─→ W4  ──→ W7  ──→ W8
     ├─→ W5 (N-1/N-10) ──→ W6 ──→ W7
     └─→ M4 ──→ M3 ──→ M5 ──→ M6 ──→ M7 ──→ M8
S4 ──→ MD2 ──→ MD5          S3 ──→ {M3/M8, W4/W7, MD5/MD6}
MD1 ──→ {MD2, MD3, MD4}     W1 ──→ W2 ──→ W3 ──→ W4
B4 (podpis, praca Alana, nie Sonneta) ──→ wydanie A i B; twardo: M8/wydanie B
```

### 7.2 Praca „w tle" dla Sonneta – start natychmiast, zero decyzji produktowych

Kolejność wewnątrz listy = malejąca wartość odblokowująca. „Start" oznacza:
implementacja + testy mogą powstawać od razu; merge nadal za bramką Opusa
tam, gdzie oznaczono [G].

1. **S1** – odblokowuje MD4, W5 (komplet), M4 i usuwa trzy kopie gramatyki. [G]
2. **S2** – zaraz po S1; odblokowuje MD4 i W4. [G]
3. **MD1 → MD2** (para kontenerowa; S4 jako pierwszy commit MD2) –
   czysta mechanika ZIP + fixture'y złote i wrogie. [G]
4. **W5** – checkery N-2…N-9 od razu (czyste funkcje na korpusie
   syntetycznym); N-1 i N-10 dopinane po S1.
5. **W1** – wybór i kompilacja słowników; bez decyzji produktowej, ale
   z warunkiem wejścia „licencje potwierdzone" (O-WER-3) wewnątrz modułu. [G]
6. **S3** – kryterium i helper; mały, a wyrównuje trzy przyszłe testy.
7. **S4** – jeśli nie wszedł jako commit MD2.

Nie startują mimo braku twardych blokerów: MD3 (polityka egress powinna
wejść w bramkę razem z potwierdzeniem P-DOCX-2, żeby nie kodować dwa razy),
M1/M2 (kolejność faz §7.4: most ostatni – zaczynanie go teraz rozprasza
bramki Opusa na dwa fronty).

### 7.3 Mapa moduł → decyzja (co czeka na Alana, z rekomendacjami projektów)

| Decyzja | Blokuje | Charakter |
|---|---|---|
| P-DOCX-1 (nazwy w UI), P-DOCX-4 (blokada przy zerze podmian), P-DOCX-5 (podgląd zawsze) | merge MD5 | potwierdzenia rekomendacji |
| P-DOCX-2 (twarda blokada egress) | merge MD3/MD6 | potwierdzenie rekomendacji |
| P-DOCX-3 (komentarze/zmiany śledzone raport-only), P-DOCX-7 (fleksja v1 = mianownik) | merge MD4 | potwierdzenia rekomendacji |
| P-WER-1 (zakres fleksji) | W2/W3 | potwierdzenie rekomendacji |
| P-WER-2, P-WER-4, P-WER-6, P-WER-7 | merge W7 | potwierdzenia rekomendacji (P-WER-4: wariant (b) – ścieżka ręczna) |
| **P-WER-3 (poziom 3 / W9)** | start W9 | realna decyzja, celowo **po** doświadczeniu z v1 |
| **P-MOST-1 (nazwy handlowe, appId)** | M7 | realna decyzja |
| P-MOST-2 (most aktywny od startu), P-MOST-3 (bramki dla list_*), P-MOST-5 (timeouty) | wydanie B / kalibracja w M8 | potwierdzenia rekomendacji |
| **B4 – podpis kodu** | wydanie A; twardo wydanie B (C-BR: „B nie wychodzi przed B4") | praca organizacyjna Alana, równoległa do całości |

Warstwa wspólna S1–S4: **zero pozycji w tej tabeli** – żadna decyzja
produktowa nie jest potrzebna (wyłącznie rozstrzygnięcia Opusa z §8).

### 7.4 Proponowana kolejność całości (spójna z rekomendacją Opusa: B4 → DOCX + fleksja → most i poziom 3 później)

**Faza 0 – fundament (od zaraz, równolegle z B4 po stronie Alana):**
S1 → S2; równolegle S3, S4, MD1 → MD2, W5, W1.
Wyjście z fazy: jedna gramatyka w trzech starych miejscach, fasada
substytucji, kontener DOCX czytany i składany na goldenach, checkery
gotowe, słowniki wybrane i zakotwiczone.

**Faza 1 – DOCX (wartość produktowa nr 1: pisma od AI z zachowanym
papierem firmowym):** MD3, MD4 (po S1+S2), MD5, MD6.
Wymaga: potwierdzeń P-DOCX-1…5, P-DOCX-7 (wszystkie mają rekomendacje).

**Faza 2 – fleksja i weryfikator:** W2 → W3 → W4, potem W6 → W7 → W8.
Wymaga: potwierdzeń P-WER-1, P-WER-2, P-WER-4, P-WER-6, P-WER-7.

**Faza 3 – most (wariant B):** M1 → M2 → M4 → M3 → M5 → M6 → M7 → M8
(kolejność wewnętrzna wg projektu mostu; M4 przed M3, bo bramka konsumuje
wyniki skanu). Wymaga: P-MOST-1 przed M7; B4 przed wydaniem B; S-IPC-1
potwierdzone przy M5; decyzja O-SF-3 w bramce M4.

**Faza 4 – poziom 3 weryfikatora (W9):** wyłącznie po P-WER-3, jako osobny
mini-projekt z benchmarkiem (zgodnie z O-WER-6).

Punkty, w których kolejność zależy od Alana (poza decyzjami z §7.3):

- **DOCX przed fleksją czy odwrotnie:** rekomendacja – DOCX pierwszy
  (natychmiastowa wartość: pismo od AI do podpisu; fleksja podnosi jakość
  tych samych pism zaraz potem). Odwrócenie jest technicznie bezpieczne
  (oba stoją na S1+S2), kosztuje tylko przełożenie bramek.
- **Moment startu fazy 3:** rekomendacja – po zebraniu doświadczeń
  z DOCX + weryfikatorem, nie równolegle (jedna kolejka bramek Opusa,
  mniejsze ryzyko konfliktów w `src/main.js` – niżej).
- **Czy fazy 1 i 2 mogą się przeplatać:** tak, z jednym szwem (niżej).

### 7.5 Punkty styku plików (koordynacja, nie blokada)

- `src/ui/deanon-workspace/` i `src/export/deanon.js`: dotykane przez
  S1/S2 (faza 0), MD5 (faza 1) i W4/W7 (faza 2). Sekwencja faz załatwia
  konflikt; przy przeplocie faz 1–2 obowiązuje reguła: **MD5 przed W4**
  (W4 przepina ujścia na plan – niech zastanie ostateczny kształt eksportu
  z gałęzią DOCX).
- `src/main.js`: MD5 (import/eksport DOCX) i M5 (refaktor ciał narzędzi
  WebMCP do `src/mcp/tools.js`) – rozłączne obszary pliku, ale kolejność
  faz (DOCX → most) i tak je rozdziela.
- `src/anonymizer.js`: dotykany wyłącznie w fazie 0 (S1: `TOKEN_LITERAL_RE`;
  S2: ciało `deanonymizeText`). Później nikt go nie zmienia.
- Weryfikator na wynikach DOCX: **świadoma luka v1** – sugestie fleksji
  i decyzje per wystąpienie dotyczą wyników tekstowych; wyniki DOCX mają
  podgląd zablokowany (DOCX §3.4), a mapowanie decyzji na strumień XML to
  przyszły temat z O-SF-7. Checkery W5/W6 mogą natomiast czytać podgląd
  tekstowy wpisu DOCX (tylko flagi, zero zmian tekstu) – do potwierdzenia
  w W7 jako drobne rozszerzenie zakresu, nie nowa funkcja.

### 7.6 Dyscyplina dowodowa całości

- `npm test` po każdym module; moduły S mają dodatkowo goldeny wskazane
  w §3.4/§4.4/§6.
- Tagowany `npm run eval` + `eval:score` po każdym module dotykającym
  `src/anonymizer.js` albo `src/pipeline/**`: S1, S2 (i nic poza nimi
  w warstwie wspólnej).
- Istniejące smoke'i desktopowe (`desktop:smoke`, `:packaged`, `:offline`)
  bez modyfikacji przez całe fazy 0–2 (nic nie dotyka `electron/`);
  rozszerzenia wchodzą dopiero z MD6 (przebieg DOCX) i fazą 3 (most,
  wg planów źródłowych).

---

## §8. Rejestr pozycji DO WERYFIKACJI PRZEZ OPUSA (O-SF)

Numeracja lokalna tego dokumentu. Pozycje O-SF-1…O-SF-7 dotykają tokenów
albo legendy; O-SF-8 definiuje kryterium gwarancji W2/V2.

| ID | Kwestia | Propozycja | Ryzyko przy błędzie |
|---|---|---|---|
| **O-SF-1** | kanoniczna gramatyka = szersza (z `anonymizer.js`/`listings.js`) z grupą przechwytującą; migracja kopii UI zmienia dwa przypadki brzegowe (§3.3) | przyjąć; zmiany brzegowe udokumentowane testem | ciche rozszerzenie/zwężenie tego, co UI uznaje za token; rozjazd z DOCX §4.3 i skanem rezyduów |
| **O-SF-2** | API modułu gramatyki: wyłącznie czyste funkcje, zakaz eksportu mutowalnego RegExp (§3.2) | przyjąć | współdzielony `lastIndex` = niedeterministyczne dopasowania między konsumentami |
| **O-SF-3** | konsument w procesie głównym (M4): lustro + test zgodności vs pakowanie `src/tokens.js` do asara B (§3.5); obejmuje też regexy PII (`findRegexEntities`) | rekomendacja: lustro + test (wzorzec §7.2 mostu); decyzja w bramce M4 | dryf gramatyki/regexów między rendererem a skanem kontrolnym mostu (dokładnie ryzyko O-DOCX-4) |
| **O-SF-4** | `deanonymizeText` jako fasada na silniku single-pass; usunięcie re-skanowania wartości (§4.4 pkt 2) z analizą nieosiągalności kaskady przez niezmiennik rezerwacji | przyjąć; goldeny bajt-w-bajt na wejściach osiągalnych + test własnościowy na patologicznych | niezauważona zmiana treści pisma przy legendzie zawierającej literały tokenów; albo odwrotnie – utrzymanie kaskady jako rozjazdu podgląd↔eksport |
| **O-SF-5** | scalony kontrakt `resolveReplacement` i warstwy wartości: decyzja ?? resolver ?? baza; czystość i lokalność; sanityzacja po stronie ujścia (§4.2) | przyjąć jako jedyny szew dla MD4 i W4 | dwa niekompatybilne resolvery = dwie semantyki podmiany w jednym produkcie |
| **O-SF-6** | `effectiveOutcomeLegend` z trzech kopii do jednej (§4.6) | przyjąć | dryf reguły pierwszeństwa snapshot ▸ żywa legenda między ujściami |
| **O-SF-7** | semantyka fleksji w przepływie DOCX (V2 wymaga decyzji człowieka, wyniki DOCX nie mają UI decyzji) – konflikt odroczony, nie materializuje się w v1 (§4.7) | odnotować; rozstrzygnięcie obowiązkowe przed podłączeniem fleksji do DOCX | auto-odmiana w piśmie DOCX bez akceptacji radcy = złamanie V2 |
| **O-SF-8** | kryterium „pokazane = wysłane": SHA-256/UTF-8, zero normalizacji, ekstrakcja DOM wyłącznie `textContent`, helper tylko na danych syntetycznych (§5) | przyjąć jako wspólną operacjonalizację C-BR-7, C-VER-4 i porównań MD5/MD6 | trzy nieporównywalne definicje tożsamości payloadu; test przechodzi mimo realnego rozjazdu |

---

## §9. Potwierdzenia i pytania do Alana

Warstwa wspólna (S1–S4) **nie tworzy żadnej nowej decyzji produktowej**:
nic nie zmienia się w UI, obietnicach ani zachowaniu produktu. Do Alana
należą wyłącznie:

1. **Kolejność:** potwierdzenie fazowania z §7.4 (DOCX → fleksja → most;
   most nie startuje równolegle) oraz zgody na listę pracy „w tle" z §7.2.
2. **Potwierdzenia istniejących decyzji P** wg mapy §7.3 – każda ma
   rekomendację w swoim projekcie źródłowym; realnie otwarte pozostają:
   P-MOST-1 (nazwy handlowe wariantów) i – dopiero po v1 – P-WER-3
   (poziom 3).
3. **B4 (podpis kodu):** jedyna pozycja, która biegnie po stronie Alana
   równolegle do całej fazy 0 i warunkuje wydania (twardo: wariant B).

---

*Koniec projektu. Następny krok: bramka Opusa nad §8 (O-SF-1…O-SF-8)
i nad rejestrami trzech projektów źródłowych; potwierdzenia Alana z §9;
potem Sonnet wchodzi w fazę 0 wg §7.2 – moduł po module, każdy z testami,
S1 i S2 przez pełną bramkę.*
