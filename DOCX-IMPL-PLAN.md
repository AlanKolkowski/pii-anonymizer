# DOCX-IMPL-PLAN.md – pełna rekonstrukcja .docx (MD3–MD5): finalizacja implementacyjna

Status: **wersja 1.1 – finalizacja implementacyjna** (zero kodu w tej sesji;
plik UNTRACKED, czeka na bramkę Opusa, commit wykonuje Opus).
Autor: Fable (architekt). Data: 2026-07-19.
Wzorzec formatu: FLEKSJA-IMPL-PLAN.md (finalizacja: diagnoza → kontrakt →
kryterium akceptacji → test dowodzący → koszt → bramka).
Wszystkie fakty o kodzie i gałęziach w tym dokumencie zweryfikowane
odczytem repo w tej sesji (2026-07-19), nie z pamięci.

**Rodzice (zbramkowane; ten plan ich NIE renegocjuje, tylko domyka do wdrożenia):**

- `DOCX-REBUILD-DESIGN.md` – architektura chirurgicznej edycji OOXML
  (moduły MD1–MD6, rejestr O-1…O-9, checklista C-DOCX-1…10, scenariusze
  S-DOCX-1…6, szew fleksji §8);
- `PRODUCT-DECISIONS.md` decyzje 6–12 – nazwa funkcji (6), twarda blokada
  odwołań zewnętrznych bez override (7), komentarze/zmiany śledzone
  raport-only (8), blokada przy zerze podmian (9), podgląd zawsze i tylko do
  odczytu (10), kanał binarny przez most nie w v1 (11), fleksja: v1 forma
  bazowa, odmiana dochodzi przez szew `resolveReplacement` (12); oraz
  decyzja 17 (anotacja przypadka `[TYP_N|D]` od LLM, parser ścisły, dane
  niezaufane);
- `GATE-PHASE0.md` – MD1/MD2 scalone do `main` i PASS bezpieczeństwowo;
  decyzje 2.3 (okno kontekstu ±40, „do potwierdzenia przy pierwszym module
  czytającym kontekst – W3/MD4"), 2.5 (`extractRaw`), 2.6 (metoda kompresji
  wpisu zmodyfikowanego = metoda oryginału);
- `FLEKSJA-IMPL-PLAN.md` – §6 (kontrakt konsumpcji szwu przez MD4);
  rdzeń fleksji scalony na `main` (merge `f88bc9f`): `src/verifier/morph/**`
  (analyze/generate/paradigms/load), `src/verifier/case-detector/**`
  (detect + tabele przyimków/rekcji/ról), `src/verifier/attested.js`,
  `src/verifier/flexion-resolver.js` (`createFlexionResolver`);
- `GATE-SCOPE.md` – rejestr defektów poz. 5: „DOCX main.js:553" (pole `docx`
  gubione w projekcji eksportu, rekonstrukcja martwa z UI, ominięte bramki
  egress i zero-podmian) NAPRAWIONY commitem `5f82ed7`; wiersz przeglądu
  per-branch: „docx-rebuild | PASS po naprawie main.js:553".

**Czego ten plan dostarcza ponad rodziców:** (i) inwentarz stanu faktycznego
– MD3–MD5 SĄ zaimplementowane na gałęzi `feature/docx-rebuild` (tip
`5f82ed7`, 10 commitów nad bazą `4705b93`), nie na `main`; plan przestaje
być „co zbudować", a staje się „co scalić, co dorobić, czym to udowodnić";
(ii) rozstrzygnięcie bazy scalenia (gałąź, nie `integration/sprint`)
z dowodem bezkonfliktowości WYKONANYM na dzisiejszym `main`; (iii) delty
FD-1…FD-5 integrujące fleksję z rekonstrukcją przez istniejący szew, w tym
**nowe znalezisko tej sesji: odmowa resolvera (`undefined`) wywala dzisiejszy
`rebuildPart`** (§3.2 pkt 0); (iv) polityka pewności odmiany (fail-closed po
`confidence`); (v) podział laptop-safe vs wymagające realnego Worda;
(vi) bramka GATE-DOCX i rejestr decyzji O-DOCX dla Alana.

---

## §0. Werdykt i mapa życzenia Alana na stan repo

Alan chce: kod w pełni odtwarzający dokument .docx przygotowany przez AI –
zachowane formatowanie, sformatowany nagłówek i stopka (papier firmowy),
tokeny anonimizacji zamienione z powrotem na dane osobowe, łącznie
z odmianą przez przypadki.

| Życzenie | Stan | Co domyka ten plan |
|---|---|---|
| zachowane formatowanie (chirurgia, nie regeneracja) | **ZBUDOWANE** na `feature/docx-rebuild`: MD3 `ooxml-inspect.js` (184 l.), MD4 `token-engine.js` (256 l.), MD5 `rebuild-docx.js` (93 l.) + integracja UI/eksportu; goldeny + 5 plików wrogich + generator deterministyczny; C-DOCX-1…10 w checklistcie (nota: „opisują kod na gałęzi") | scalenie na `main` (D-0, §1), statusy checklisty przeniesione na `main`, MD6-dowody (§8) |
| nagłówek i stopka (papier firmowy) wracają wiernie | **ZBUDOWANE**: części header\*/footer\* rozwiązywane po relacjach i przetwarzane; części bez podmian kopiowane bajt-w-bajt; `golden-pismo.docx` ma tokeny w nagłówku i stopce (8 podmian / 0 pozostawionych, test maszynowy); ręczny protokół Worda spisany w `test-data/docx/README.md` | potwierdzenie mechanizmu §5; golden z realnego Worda (O-DOCX-4) domyka O-6 |
| tokeny → dane osobowe | **ZBUDOWANE**: podmiana literałów legendy jako węzły tekstowe DOM, fail-safe, raport §6.2 z rezyduami; bramki egress/zero-podmian egzekwowane z realnej ścieżki UI (naprawa `5f82ed7` + test `main.docx-export.test.js`: rekonstrukcja zamiast płaskiego fallbacku, obie blokady z realnego przepływu) | bez zmian; testy jadą dalej |
| **odmiana przez przypadki w .docx** | **BRAK POŁĄCZENIA**: rdzeń fleksji jest na `main`, silnik MD4 jest na gałęzi, a kontrakt szwu w `rebuildPart` nie przekazuje `type`/`case`/`tokenId`, więc `createFlexionResolver` z konstrukcji zawsze odmówi (`flexion-resolver.js:36`: `ctx.type !== 'PERSON_NAME'` → `undefined`), **a odmowa w dzisiejszym `rebuildPart` to TypeError** (`sanitizeValue(resolved.text)` bez osłony); żaden kod nie buduje resolvera i nie wpina go w eksport | **rdzeń planu**: delty FD-1…FD-5 (§3–§4), polityka pewności (§4.3), raport „odmieniono" (§3.3), decyzje O-DOCX-1/2 |

**Niezmienniki nadrzędne (dziedziczone, nie do dyskusji):**

- **Dokument od AI jest NIEZAUFANY** (Z3/S-DOCX-1…6): wrogi ZIP, wrogi XML,
  wrogie relacje. Pre-skan DOCTYPE fail-closed, zip-slip strukturalnie
  niemożliwy (klucze w pamięci, nigdy ścieżki; zero zapisu na dysk),
  wartości legendy wyłącznie jako węzły tekstowe DOM (serializator
  escapuje – zamyka wstrzyknięcie z Z3).
- **Egress zablokowany twardo** (decyzja 7): relacje zewnętrzne inne niż
  hiperłącza blokują eksport bez override; moduł niczego nie dodaje do
  dokumentu; komplet `.rels` wejścia i wyjścia bajtowo identyczny.
- **Maskowanie i most nietknięte**: zero zmian w `src/pipeline/**`,
  `applyTokens`/`buildTokenMap*`, payloadach MCP; legenda żyje wyłącznie
  w RAM renderera, czytana w chwili eksportu (O-7); bajty `docx` na wpisie
  wyniku nigdy nie wchodzą do payloadu MCP (listingi czytają wyłącznie
  `text` – komentarz kontraktowy w `outcomes-coordinator.js` na gałęzi).
- **Fail-safe, nigdy zgadywanie** (W5): token nieznany/przerwany/niepewny
  pozostaje widoczny (lub dostaje formę bazową) i jest raportowany.
- Zero nowych zależności runtime; zero kanału; eval nieuruchamiany
  (pipeline nietknięty – asercja w PR zamiast evalu).

---

## §1. Stan trzech linii kodu i baza scalenia (D-0)

### 1.1 Inwentarz (zweryfikowany odczytem, 2026-07-19)

| Linia | Co niesie | Status bramkowy |
|---|---|---|
| `main` (tip `31cadf0`) | MD1 `zip-reader.js` + MD2 `zip-writer.js` (GATE-PHASE0 PASS); S1 `tokens.js` z anotacją przypadka (`CASE_CODES = 'Ms\|M\|D\|C\|B\|N\|W'`); S2 `substitution.js` z eksportowanym `rawTokenLength` i pełnym kontekstem resolvera (`token`/`tokenId`/`type`/`baseValue`/`case`/`contextBefore`/`contextAfter`/`occurrence`); **rdzeń fleksji** (`morph/analyze.js` + `generate.js` + `paradigms.js` + `load.js`, `case-detector/detect.js` na oknach ±40 + tabele `prepositions.js`/`verbs.js`/`role-lemmas.js`, `attested.js`, `flexion-resolver.js`); PO dacie szkicu doszły merge sg-lite (gazeter) i ohc1 (R-TR bare) – nie dotykają DOCX | scalone, zbramkowane |
| `feature/docx-rebuild` (10 commitów nad bazą `4705b93`, tip `5f82ed7`) | MD3 `ooxml-inspect.js`, MD4 `token-engine.js`, MD5 `rebuild-docx.js` + `export/deanon.js` (`rebuildDocxBlob`: rekonstrukcja zamiast płaskiego generatora dla wpisów DOCX), `main.js` (`importDocxOutcome` z inspekcją przy imporcie + naprawiona projekcja `5f82ed7`), `outcomes-coordinator.js` (wpis `docx` RAM-only, edycja podglądu DOCX zablokowana), UI deanon-workspace (przycisk „Importuj pismo od AI (DOCX)", plakietka read-only, licznik hiperłączy, `reportSummary` z liczb silnika); S1 gałęzi dodaje `rawLength` do `findTokens`; goldeny + 5 plików wrogich + deterministyczny generator (`scripts/generate-docx-rebuild-goldens.mjs`); testy: unit (ooxml/token/rebuild/goldens/perf), eksport (`deanon-docx.test.js`), UI (`deanon-docx.test.js`), realna ścieżka main.js (`main.docx-export.test.js`, 261 l.); `SECURITY-CHECKLIST.md` C-DOCX-1…10 (+ pomiar §3.1: ~113 ms < 200 ms, jsdom), `THREAT-MODEL.md`, `SECURITY.md`, `docs/docx-rebuild.md`, `.gitattributes` (goldeny binarnie) | bezpieczeństwowo przejrzany w bramce sprintu (GATE-SCOPE per-branch: **PASS po naprawie main.js:553**), ale commity oznaczone „[do bramki Opusa]" i gałąź NIE jest na `main`; bramka nad SCALENIEM + deltami FD = GATE-DOCX (§9) |
| `integration/sprint` (tip `4dbf74a` = merge tej gałęzi) | zawiera `feature/docx-rebuild` w całości – moduły DOCX **identyczne co do bajta** z gałęzią (jedyna różnica: `src/main.js` niesie dodatkowo stos scope-tiers, +166 linii); do tego stos ST (aktywacja zablokowana do B6) i **starszą** morfologię (`feature/morph-w1-fleksja`, sprzed `feature/fleksja` z `main`) | zbramkowany jako sprint (2477 testów), NIE scalony na `main` (czeka na PC-eval + B6) i NIE jest bazą tego planu |

### 1.2 Rozstrzygnięcie bazy: `main` + merge `feature/docx-rebuild`

**Nie scalamy przez `integration/sprint`.** Sprint niesie stos ST czekający
na B6 i starszą wersję rdzenia fleksji; DOCX-rebuild jest od obu niezależny.
Gałąź `feature/docx-rebuild` jest czysta tematycznie (30 plików, wyłącznie
rekonstrukcja + dokumenty bezpieczeństwa), a jej kopia w sprincie stanie się
przy przyszłym scalaniu sprintu no-opem (te same bajty).

**Dowód bezkonfliktowości (WYKONANY 2026-07-19 na aktualnym main, nie
deklarowany):** zbiór plików zmienionych na `main` od bazy `4705b93`
(66 plików, w tym `substitution.js`, `verifier/**`) i zbiór plików gałęzi
(30 plików, w tym `tokens.js`) mają **puste przecięcie**;
`git merge-tree --write-tree main feature/docx-rebuild` zwraca czyste
drzewo (`1e6b309e…`, exit 0, zero CONFLICT). Git przyjmie wersję gałęzi
tam, gdzie zmieniała tylko ona (`tokens.js` z `rawLength` w `findTokens`),
i wersję `main` tam, gdzie zmieniał tylko `main` (`substitution.js`
z `case`/`occurrence` w kontekście resolvera). Dowód powtórzyć w PR D-0
(main będzie się ruszał).

### 1.3 Konflikt semantyczny (niewidoczny dla gita) – dwie prawdy o długości tokenu

Po merge w repo będą DWA źródła długości surowego dopasowania tokenu:

- `findTokens(...).rawLength` (gałąź: `match[0].length` – długość faktycznego
  dopasowania, konsumowana przez `token-engine.js` do cięcia strumienia
  i okien kontekstu),
- `rawTokenLength(entry)` w `substitution.js` (main: arytmetyka
  `tokenId.length + case.length + 3`, eksportowana dla W3 i używana przez
  `resolveOccurrences`/`renderResolvedText`).

Gramatyka S1 jest deterministyczna, więc wartości są zawsze równe – ale dwie
kopie tej samej prawdy to miejsce na przyszły dryf. Rozstrzygnięcie: **w D-0
dochodzi test równoważności** (`rawTokenLength(entry) === entry.rawLength`
na pełnej macierzy przypadków gramatyki: token goły, każdy z 7 kodów
anotacji, indeks jedno- i wielocyfrowy); konsolidacja do jednego źródła –
osobny, drobny commit poza ścieżką krytyczną (O-DOCX-3, rekomendacja:
`rawTokenLength` deleguje do `entry.rawLength`, arytmetyka znika).

---

## §2. MD3 – inspekcja OOXML: co stoi, co doprecyzowuje bramka

### 2.1 Zbudowane (referencja, zero delt)

- **Pre-skan DOCTYPE fail-closed** (`rejectDoctype`): każda część XML czytana
  przez moduł przechodzi test `<!DOCTYPE`/`<!ENTITY` PRZED jakimkolwiek
  parserem; trafienie = odrzucenie całego pliku (kod `DOCTYPE`). OOXML nigdy
  legalnie nie zawiera DTD – zero fałszywych blokad. DOMParser dopiero po
  pre-skanie; `parsererror` = twarde odrzucenie części i eksportu (kod
  `PARSE`), nigdy „pomiń część". Zamyka S-DOCX-1 dwuwarstwowo (C-DOCX-1).
- **Odmowy czytelne, nigdy ciche zero podmian** (C-DOCX-9): makra podwójnie
  (wpis `vbaproject` po nazwie + `macroEnabled` w `[Content_Types].xml`),
  Strict OOXML (marker `purl.oclc.org/ooxml`), brak struktury OOXML
  (`NOT_DOCX`), nie-ZIP (`ZipFormatError` z MD1).
- **Części po relacjach, nie po zgadywanych nazwach** (§5.1 designu):
  `_rels/.rels` → `officeDocument` → `word/_rels/document.xml.rels` → typy
  `header`/`footer`/`footnotes`/`endnotes` do `tokenParts`, `comments` jako
  część raport-only. Ścieżki normalizowane (`normalizeTarget` odporny na
  `..` ponad korzeń – pop na pustym stosie jest no-op).
- **Klasyfikacja egress** (§9.3, C-DOCX-8): KAŻDY `*.rels` kontenera
  skanowany (pokrywa też `attachedTemplate` z `settings.xml.rels`);
  `TargetMode="External"` + typ `hyperlink` → liczone i dozwolone; każde
  inne odwołanie zewnętrzne → `external.blocked` z częścią, id, typem
  i celem. Wrogie pola (`INCLUDETEXT`/`INCLUDEPICTURE`/`DDE`/`DDEAUTO`)
  w częściach tokenowych → także `blocked`.

### 2.2 Delta MD3-D1 (wymagana przed bramką): skan pól po namespace, nie po prefiksie

`HOSTILE_FIELD_RE` (`ooxml-inspect.js`) dopasowuje literały `<w:instrText`
/ `<w:fldSimple` w surowym tekście części. Prefiks `w:` jest konwencją, nie
gwarancją – ten sam dokument może legalnie zadeklarować
`xmlns:x="…wordprocessingml…"` i zapisać `<x:instrText>DDEAUTO …</x:instrText>`;
regex go nie zobaczy, a Word wykona. Sam design (§4.2 pkt 1) nakazuje
wyszukiwanie po namespace.

Kontrakt delty: dla każdej części tokenowej (i tak już parsowanej przez
silnik) skan pól przechodzi na DOM –
`getElementsByTagNameNS(W_NS, 'instrText')` + `fldSimple/@w:instr` –
z tą samą listą wrogich instrukcji. Regex może zostać wyłącznie jako
szybki pre-filtr pozytywny (trafienie regexa nadal blokuje; brak trafienia
NIE zwalnia z kontroli DOM). Koszt: mały (części tokenowe są już w DOM
w MD4; inspekcja reużywa `parseXmlPart`). Test: fixture z aliasowanym
prefiksem namespace – blokada eksportu.

### 2.3 Pozycja bramkowa MD3-D2 (decyzja, nie delta): zasięg skanu pól

Dziś pola skanowane są w częściach tokenowych; część `comments.xml`
(raport-only) jest parsowana do zliczenia tokenów (`countTokensInPart`),
ale NIE jest skanowana pod kątem wrogich pól, a jej treść też otwiera się
w Wordzie. Rekomendacja: rozszerzyć skan MD3-D1 na **wszystkie części XML
czytane przez inspekcję** (koszt pomijalny, komentarze i tak są w DOM).
Decyzja O-DOCX-6.

---

## §3. MD4 – silnik tokenów: co stoi, delty szwu i raportu

### 3.1 Zbudowane (referencja, zero delt)

- **Strumień akapitu + mapa segmentów** (§4.2): enumeracja `w:p` po
  namespace; do strumienia wchodzą wyłącznie `w:t`, których najbliższym
  przodkiem `w:p` jest bieżący akapit (pola tekstowe `w:txbxContent` –
  osobne akapity, nic podwójnie; `mc:AlternateContent` Choice/Fallback –
  oba warianty enumerowane, więc podmieniane spójnie); sentinel `U+FFFC`
  za `w:br`, `w:cr`, `w:tab`, `w:sym`, `w:noBreakHyphen`, `w:softHyphen`,
  `w:drawing`, `w:pict`, `w:object`, `w:fldChar`, odwołania
  przypisów/komentarzy; `w:instrText`/`w:delText` wykluczone ze strumienia
  podmian (sentinel), czytane do raportu.
- **Dopasowanie po wspólnej gramatyce** (O-4): `findTokens` z `src/tokens.js`
  – jedna gramatyka dla anonymizera, MCP, UI i silnika DOCX; dopasowanie
  literalne, trafienia rozłączne, jeden przebieg (wartości wstawione nigdy
  nie są ponownie skanowane – kaskada niemożliwa z konstrukcji, §4.5);
  token anotowany podmieniany w CAŁYM surowym spanie (`rawLength` obejmuje
  anotację – `|D` nie zostaje w piśmie).
- **„Pierwszy run wygrywa"** (§4.4): wartość w całości do segmentu, w którym
  token się zaczyna; środkowe fragmenty czyszczone (puste `w:t` legalne);
  ogon w segmencie końcowym. `w:rPr` nietknięte – wartość dziedziczy
  formatowanie początku tokenu.
- **Higiena zapisu** (§4.6): `xml:space="preserve"` dodawany wyłącznie przy
  białych znakach brzegowych nowej treści; sanityzacja C0 (poza `\t`)
  i `\r`/`\n` → spacja z licznikiem w raporcie; wartości wchodzą przez
  `textContent` (pojedynczy węzeł tekstowy – serializator escapuje, O-3);
  deklaracja XML przenoszona ze źródła; `changed === false` → część w ogóle
  nie reserializowana (niezmiennik §3.3 bajt-w-bajt przez
  `extractRaw`/`composeZip`).
- **Skan rezyduów PO podmianie** (naprawa `985fa1b`): gramatyka przechodzi po
  FINALNYM strumieniu części, więc raport nie może rozjechać się z plikiem;
  powody: `brak-w-legendzie`, `literał-w-wartości`, `przerwany-elementem`
  (opener bez `]` przed sentinelem); warstwy raport-only zliczane osobno
  (`kody-pól`, `tekst-usunięty`, komentarze per część).

### 3.2 Delta FD-1 (rdzeń): pełny kontrakt szwu `resolveReplacement` + osłona odmowy

**Pkt 0 – znalezisko tej sesji (blokujące, nieopisane w rodzicach):**
dzisiejszy `rebuildPart` wykonuje `sanitizeValue(resolved.text)` wprost na
wyniku resolvera. Kontrakt `createFlexionResolver` (i S2) mówi: odmowa =
`undefined`. Pierwsza odmowa (a w dzisiejszym stanie KAŻDE wywołanie, bo
ctx nie niesie `type`) to `TypeError: Cannot read properties of undefined`
– eksport z podpiętym resolverem wywala się zamiast wstawić formę bazową.
Kontrakt po delcie, wyrównany do S2 (`resolveOccurrences`:
`resolved?.text`, potem warstwa `baza`): **odmowa resolvera = wartość
bazowa**, `const value = resolved?.text ?? baseValue`, sanityzacja dopiero
na tym. Test dowodzący: resolver-odmawiacz (zawsze `undefined`) → wynik
bajt w bajt identyczny z przebiegiem bez resolvera.

Dziś `rebuildPart` woła resolver z `{ token, baseValue, contextBefore,
contextAfter, part }`. To za mało dla fleksji: `createFlexionResolver`
odmawia bez `ctx.type === 'PERSON_NAME'`, a sygnał S-T (anotacja przypadka
`[PERSON_NAME_1|D]` pisana przez LLM – decyzja 17) wchodzi przez `ctx.case`.

Kontrakt po delcie – wywołanie wyrównane do S2, z rozszerzeniem o `part`:

```
resolveReplacement({
  token,          // '[PERSON_NAME_1]' – forma kanoniczna (klucz legendy)
  tokenId,        // 'PERSON_NAME_1'
  type,           // 'PERSON_NAME' (tokenType z S1; findTokens już to zwraca)
  baseValue,      // legend[token]
  case,           // 'D' | undefined – anotacja z findTokens (S-T, dane niezaufane)
  contextBefore,  // ±40 znaków strumienia akapitu (tekst stokenizowany;
  contextAfter,   //  sentinele obecne – patrz niżej)
  occurrence,     // indeks wystąpienia w CZĘŚCI (kolejność strumienia)
  part,           // 'word/document.xml' | 'word/header1.xml' | …
}) → { text, note? } | undefined      // undefined = odmowa → forma bazowa
```

Ustalenia wiążące:

1. **Okno ±40 potwierdzone** – to jest moment „do potwierdzenia przy
   pierwszym module czytającym kontekst", zapowiedziany w GATE-PHASE0 2.3.
   `detectCase` na `main` świadomie działa na oknach resolvera (komentarz
   w `detect.js`: sygnały lokalne S-P/S-R/S-A/S-T; poszerzenie do okna
   zdaniowego 200/80 to mechaniczny follow-up W3, nie zmiana projektu).
   Sygnały mocne (przyimek bezpośrednio przed tokenem: ostatnie słowo
   `contextBefore`; rekcja: 3 słowa wstecz; rola: ±2 słowa) mieszczą się
   w ±40 z zapasem.
2. **Sentinele w kontekście zostają** (`U+FFFC` nie jest literą – `words()`
   w detektorze go ignoruje); dają uczciwą informację „twarda granica obok".
3. **`occurrence` jest per część** (licznik części narastający przez akapity
   w porządku dokumentu, trafienia od lewej) i w v1 służy raportowi;
   wiązanie z globalną enumeracją podglądu tekstowego (warstwa `decisions`
   z FL-5: asercja `tokenId` + anchor ±40, fail-closed do bazy) pozostaje
   kontraktem FL-7 – punkt zaczepienia istnieje, zakres nie wchodzi do tego
   planu.
4. Wynik resolvera przechodzi **tę samą sanityzację §4.6** co wartość
   bazowa; porównanie „odmieniono?" (§3.3) wykonuje się na wartości PO
   sanityzacji – raport opisuje to, co faktycznie stoi w pliku (R-D6).

Test dowodzący: jednostkowy na spreparowanej części – token anotowany
rozcięty między dwa runy (`[PERSON_` + `NAME_1|D]`), resolver-szpieg
rejestruje otrzymane pola; asercje na `type`/`case`/`tokenId`/`part`/
`occurrence` i na konteksty liczone od granic surowego dopasowania
(z anotacją) + test odmowy z pkt 0.

### 3.3 Delta FD-2: raport „odmieniono" (kontrakt §8 rodzica, pkt 3 §6 FLEKSJI)

Każda podmiana, w której wartość wstawiona ≠ `baseValue` (po sanityzacji),
dostaje wiersz raportu – użytkownik widzi, że wartość została ODMIENIONA,
nie podmieniona na inną:

```
parts[i].declined: [ { token: '[PERSON_NAME_1]',
                       z: 'Jan Kowalski', na: 'Janowi Kowalskiemu',
                       przypadek: 'C', zrodlo: 'słownik',
                       pewnosc: 'wysoka', part: 'word/document.xml' } ]
totals.declined: N
```

- Struktury danych niosą KOD przypadka (`'C'`); na słowa (celownik,
  dopełniacz, …) mapuje wyłącznie warstwa UI (jedna mapa `CASE_LABELS`
  w deanon-workspace) – dane silnika zostają mechaniczne, mapowanie żyje
  w jednym miejscu.
- Metadane (`przypadek`, `zrodlo`, `pewnosc`) pochodzą z `note` resolvera
  (FD-4, §4.3) – silnik ich nie wymyśla; brak `note` przy identycznym
  tekście = zwykła podmiana bazowa, zero wiersza. Źródła w silniku fleksji
  już istnieją: `generateForm` zwraca `przypadek` i `zrodlo`
  (`'poświadczona' | 'słownik' | 'reguła'`), `detectCase` zwraca
  `confidence` (`'wysoka' | 'niska'`).
- Rendering wyłącznie `textContent` (C-DOCX-4); wiersze „odmieniono" są
  informacją, nie zaporą – eksportu nie blokują (spójnie z §6.2: blokują
  wyłącznie egress i zero podmian).
- **Licznik odmów fleksji** (pętla pomiarowa O-FL-2): silnik zlicza per
  część wystąpienia `type === 'PERSON_NAME'` z wartością w legendzie, przy
  których resolver odmówił (`flexionDeclined: { count }`). Powody odmowy
  świadomie POZA v1: odmowa w kontrakcie S2 to gołe `undefined` (zmiana
  kształtu odmowy złamałaby istniejące testy resolvera i kontrakt
  `resolved?.text`); rozszerzenie o powody (np. addytywny hook `onDecline`)
  jest odnotowane jako przyszła opcja, wchodzi najwyżej z FL-5.

Test dowodzący: część z trzema tokenami – (a) odmieniony pewnie → wiersz
`declined` z kodem przypadka i metadanymi z `note`, (b) forma bazowa
(resolver odmówił) → brak wiersza + `flexionDeclined.count` podbity,
(c) token bez legendy → rezyduum jak dziś; `totals` spinają się
z zawartością pliku (asercja na wynikowym XML).

---

## §4. MD5 + fleksja: budowa resolvera i przepływ end-to-end

### 4.1 Zbudowane (referencja)

- `rebuildDocx(bytes, legend, { resolveReplacement })`: czysta funkcja
  bajty→bajty w RAM; bramki PRZED wytworzeniem bajtów: `blocked-egress`
  (lista znalezisk w raporcie, sprawdzana przed przetwarzaniem części)
  i `blocked-no-replacements` (P-4/decyzja 9); rezydua nie blokują;
  komentarze zliczane raport-only (`countTokensInPart`).
- `export/deanon.js`: wpis DOCX (`outcome.docx.bytes`) eksportuje się przez
  `rebuildDocxBlob` – ta sama ścieżka nazw i pobrania co eksport płaski;
  blokady rzucają czytelną diagnozą; `reports` w wyniku eksportu.
- `main.js` `importDocxOutcome`: inspekcja przy imporcie (odmowy
  natychmiast, ostrzeżenie egress od razu przy imporcie), podgląd mammoth
  jako tekst wyniku (read-only, decyzja 10; `updateOutcomeFields` odrzuca
  edycję wpisu z `docx`), surowe bajty w RAM na wpisie wyniku; projekcja
  eksportu przenosi `docx` (naprawa `5f82ed7`, test realnej ścieżki
  `main.docx-export.test.js` – rekonstrukcja zamiast płaskiego fallbacku
  + obie bramki dowiedzione z UI).
- UI: przycisk „Importuj pismo od AI (DOCX)" (decyzja 6), plakietka
  „DOCX · podgląd tylko do odczytu", licznik hiperłączy z inspekcji,
  blokada wklejania dla wpisu DOCX, `reportSummary` wyłącznie z liczb
  silnika (O-5).

### 4.2 Delta FD-3: kto buduje resolver i jak płynie (zero nowych ścieżek danych)

**Właścicielem danych fleksji jest `main.js`** – stan `seen` już tam żyje
(`src/main.js:45`, odbudowa w `refreshLegend`), a artefakt morfologiczny,
gdy powstanie, importuje wyłącznie `src/verifier/morph/load.js`. Przepływ:

```
main.js (eksport DOCX):
  resolver = createFlexionResolver({ morph: <load.js | null>, seen, minConfidence: 'wysoka' })
  exportDeanonOutcomes({ outcomes, legend, format, resolveReplacement: resolver })
    └► rebuildDocxBlob(outcome, legend, resolver)
         └► rebuildDocx(bytes, legend, { resolveReplacement: resolver })
              └► rebuildPart({ …, resolveReplacement })   // szew FD-1
```

- **`seen` wchodzi ŻYWE, z chwili eksportu.** Na `main` nie istnieje
  `attestedSnapshot` ani `effectiveOutcomeAttested` (FL-4/FL-5 przed nami;
  grep po `src/` pusty) – i to jest w v1 poprawne: poświadczenia służą
  wyłącznie WYBOROWI FORMY wartości, którą i tak wyznacza legenda
  (snapshot ▸ żywa, bez zmian). Dryf `seen` między utworzeniem wyniku
  a eksportem może najwyżej zmienić dostępność odmiany (więcej/mniej form
  poświadczonych), nigdy tożsamość wartości. Parytet snapshotów wraca
  z FL-5, poza tym planem.
- `seen` i `morph` **nie opuszczają renderera** i nie wchodzą do żadnej
  struktury serializowanej (raport niesie wyłącznie teksty form i metadane
  słowne) – bez zmian względem gwarancji O-7/C-VER-8.
- Ujścia płaskie (tekst, PDF, karty wyników) **nie dostają resolvera** w tym
  planie – pozostają przy formie bazowej do czasu FL-5 (warstwa decyzji
  człowieka). Odmiana wchodzi wyłącznie tam, gdzie Alan o nią prosi:
  w rekonstrukcji .docx, z raportem każdej różnicy.
- Zgodność wsteczna: `resolveReplacement` nieprzekazany (albo `null`) →
  zachowanie identyczne z dzisiejszą gałęzią, bajt w bajt (golden, G-D9).

### 4.3 Delta FD-4: polityka pewności w `createFlexionResolver` (fail-closed po confidence)

Dziś `createFlexionResolver` odmawia przy każdej fladze silnika
(`analysis.status`, `generated.status` ≠ ok), ale przyjmuje wynik
`detectCase` o pewności `niska`. Dla ujść z człowiekiem-w-pętli (przyszłe
FL-5/FL-6) to poprawne – sugestia „niska" i tak czeka na klik. W .docx nie
ma kliku per wystąpienie, więc **próg pewności musi być własnością
resolvera**:

- nowa opcja `createFlexionResolver({ morph, seen, minConfidence })`:
  `detected.confidence` poniżej progu → `undefined` (forma bazowa);
  brak opcji = zachowanie dzisiejsze (bez progu) – zero zmian dla
  istniejących testów i przyszłych konsumentów z warstwą decyzji;
- zwrot rozszerzony addytywnie o `note`:
  `{ text, note: { przypadek: generated.przypadek, zrodlo: generated.zrodlo,
  pewnosc: detected.confidence } }` – S2 czyta wyłącznie `.text`
  (dowiedzione w `resolveOccurrences`: `resolved?.text`), silnik DOCX
  konsumuje `note` do wierszy „odmieniono" (FD-2);
- semantyka progu `'wysoka'` z `detect.js` (bez zmian, zweryfikowana
  w kodzie): zbiór zawężony do JEDNEGO przypadka ORAZ co najmniej jeden
  sygnał spoza S-T. Skutki, które Alan ma świadomie kupić (przykłady
  wiążące dla testów, zgodne z tabelami w repo):
  - „zasądzenie od `[PERSON_NAME_1|D]` kwoty…" – S-P (`od` → {D},
    `prepositions.js`) + S-T zgodna → **wysoka** → wstawiamy „Jana
    Kowalskiego"; wiersz „odmieniono";
  - „`[PERSON_NAME_1|D]` nie stawił się…" – anotacja błędna (podmiot),
    zero sygnałów kontekstowych → S-T solo = **niska** → forma bazowa
    (mianownik) – **błędna anotacja LLM nie zepsuła pisma**;
  - „przeciwko `[PERSON_NAME_2]`" bez anotacji – S-P: tabela daje dla
    `przeciwko` jednoelementowy zbiór {C} → **wysoka** → „przeciwko
    Janowi Kowalskiemu" także BEZ anotacji (fleksja nie wymaga anotowanych
    tokenów; przyimki wieloznaczne jak `w`/`na` dają zbiór dwuelementowy
    i bez współsygnału pozostają przy formie bazowej);
  - anotacja sprzeczna z kontekstem („przeciwko `[PERSON_NAME_1|M]`") →
    `detectCase` zwraca `nieustalony` („adnotacja sprzeczna z kontekstem")
    → forma bazowa + podbicie `flexionDeclined.count` (FD-2).

Test dowodzący (goldeny FD): macierz czterech przykładów powyżej + próg
respektowany (`minConfidence: 'wysoka'` vs brak opcji na tym samym wejściu)
+ `note` obecny wyłącznie przy zwrocie tekstu + regresja istniejących
testów `flexion-resolver.test.js` bez opcji (kształt odmowy niezmieniony).

### 4.4 Skąd morfologia w runtime (uczciwa zależność, zweryfikowana w kodzie)

Artefakt `morph-pl.json` NIE istnieje (FL-1b/GATE-FLEKSJA-DANE przed nami).
Do tego czasu `morph = null` i fleksja w DOCX działa w trybie ograniczonym,
fail-closed – granice sprawdzone w kodzie silnika:

- **działa bez artefaktu**: sygnały S-P i S-R (tabele `prepositions.js`
  i `verbs.js` to dane w repo, nie artefakt); formy poświadczone
  end-to-end (`deriveAttested(seen)` → `buildAttestedByCase` atrybuuje
  przypadek wariantu regułowym odwracaniem nazwisk → `generateForm` bierze
  poświadczenie PRZED słownikiem, więc wariant „Jana Kowalskiego" widziany
  w źródle pokrywa wykryty dopełniacz bez żadnych danych zewnętrznych);
  nazwiska przymiotnikowe (-ski/-cka/-dzki…) regułowo, z rodzajem
  z końcówki albo z poświadczeń;
- **milczy bez artefaktu**: S-A (apozycja roli wymaga `morph.formaDoLematu`
  – bez niego sygnał po prostu nie głosuje, nigdy nie zgaduje);
- **odmawia** (→ forma bazowa): imiona bez słownika (`imię-nieznane`
  w `buildFormForCase`), nazwiska rzeczownikowe bez poświadczenia, rodzaj
  niejednoznaczny.

Plan świadomie NIE blokuje DOCX na danych morfologicznych: kontrakt i kod
integracyjny wchodzą teraz, pełna moc rośnie skokowo po GATE-FLEKSJA-DANE
bez zmiany jednej linii silnika DOCX. W `docs/docx-rebuild.md` sekcja
ograniczeń mówi to wprost (dzisiejsze zdanie „wartości wstawiane są
w mianowniku z legendy" do aktualizacji; żadnego obiecywania pełnej odmiany
przed artefaktem).

### 4.5 Delta FD-5: UI raportu odmian

Pasek stanu po eksporcie (istniejący `reportSummary`) rozszerzony
o „ · odmieniono N form"; szczegóły (lista wierszy `declined` z §3.3
+ licznik odmów §3.3) w rozwijanym raporcie pod paskiem eksportu –
wyłącznie `textContent`, przypadki słownie przez mapę `CASE_LABELS`
(M/D/C/B/N/Ms/W → mianownik/dopełniacz/celownik/biernik/narzędnik/
miejscownik/wołacz), zero HTML-interpolacji. Eksport nieblokowany; wiersze
są mapą do lektury pisma przed podpisem (kontrola ludzka jak w RD-3).

---

## §5. Nagłówek i stopka: papier firmowy wraca wiernie (potwierdzenie wprost)

Pytanie Alana: „sformatowany nagłówek i stopka (papier firmowy)". Mechanizm
i dowody:

1. **Enumeracja z relacji, nie z nazw plików**: `word/_rels/document.xml.rels`
   → KAŻDA relacja typu `header`/`footer` (więc też nagłówek pierwszej
   strony i parzysty; `header1..3.xml`/`footer1..3.xml` to tylko konwencja
   nazw – silnik jej nie zakłada).
2. **Część nagłówka z tokenami** („Sygn. akt [CASE_NUMBER_1]", adresat
   w stopce): przetwarzana identycznie jak dokument główny – podmiana
   wyłącznie treści `w:t`, `w:rPr`/`w:pPr`/tabele/grafiki nietknięte;
   wartość dziedziczy formatowanie runu początku tokenu.
3. **Część nagłówka bez tokenów**: `changed === false` → nie jest nawet
   reserializowana; jej ORYGINALNE skompresowane bajty przechodzą do wyniku
   (`extractRaw` → `composeZip` verbatim). Logo, linie, układ – bajt w bajt.
4. **Obrazy i czcionki papieru firmowego**: części `media/`/`fonts/` nigdy
   nie są dekompresowane (nie są częściami inspekcji ani tokenowymi);
   relacje obrazów wewnętrzne pozostają nietknięte; komplet `.rels` wejścia
   i wyjścia bajtowo identyczny (C-DOCX-5, test w goldens).
5. **Dowody**: `golden-pismo.docx` ma tokeny w nagłówku i stopce – test
   maszynowy przy każdym `npm test` (8 podmian, 0 pozostawionych, nagłówek
   i stopka w `tokenParts`); ręczny protokół Worda
   (`test-data/docx/README.md`) każe wzrokowo potwierdzić: nagłówek
   „Kancelaria K-LAW…" i stopka z adresem obecne, z podmienioną wartością,
   formatowanie nietknięte, kursywa zaczyna się tam gdzie w oryginale,
   hiperłącze do Legalisa dalej klika, zero monitu naprawy. Fleksja niczego
   tu nie zmienia – header/footer przechodzą przez ten sam szew (`part`
   w kontrakcie pozwala raportowi wskazać, że odmiana zaszła w nagłówku).

Granica uczciwości: wierność RENDERINGU jest własnością Worda (RD-2) –
stąd złoty plik z realnego Worda i test otwarcia bez monitu naprawy (§7).

---

## §6. Egress i model zagrożeń: potwierdzenie po deltach

| Scenariusz | Stan po planie |
|---|---|
| S-DOCX-1 XXE/bomba encji | bez zmian: pre-skan → DOMParser → `parsererror` twardo; testy + goldeny `hostile-doctype-xxe`/`hostile-billion-laughs` |
| S-DOCX-2 wrogi ZIP | bez zmian: MD1 (allow-listy, limity strumieniowe, duplikaty, ZIP64/multi-disk/patch/szyfrowanie), zero dysku |
| S-DOCX-3 egress w wyniku | **wzmocnienie MD3-D1** (skan pól po namespace); poza tym bez zmian: klasyfikacja `.rels`, twarda blokada bez override (decyzja 7), `.rels` bajtowo identyczne, moduł niczego nie dodaje; wpisy wynikowego ZIP z wyzerowanym czasem (`zip-writer.js:117-118`, O-DOCX-7) |
| S-DOCX-4 wstrzyknięcie XML przez legendę | bez zmian: wartości (także ODMIENIONE – to ta sama klasa treści: legenda/poświadczenia/słownik/reguła) wyłącznie przez `textContent` + sanityzacja §4.6; test złośliwych wartości, w tym wartości złośliwej Z ODMIANĄ (G-D8) |
| S-DOCX-5 podmiana treści przez AI | bez zmian: raport + lektura radcy; fleksja DODAJE wiersze „odmieniono", więc różnice względem legendy są jawne co do jednej |
| S-DOCX-6 DoS złożonościowy | bez zmian: limity + algorytm liniowy; fleksja jest O(1) na wystąpienie (kaskada na oknach ±40, `analyzePersonName` na wartości legendy) – perf test trzyma próg ~200 ms (pomiar na gałęzi: ~113 ms jsdom na realistycznym piśmie ~15 stron) |

Kontrakt bezpieczeństwa szwu (§8 rodzica) po FD: resolver pozostaje czystą
funkcją (zero I/O, sieci, DOM); jego wynik przechodzi sanityzację; każda
różnica względem bazy raportowana; odmowa = forma bazowa, nigdy wyjątek
(FD-1 pkt 0). Fleksja nie otwiera żadnego nowego kanału ani trwałości.

---

## §7. Podział: laptop-safe vs wymagające realnego Worda

Konwencja sprzętowa projektu: podłoga 16 GB RAM; deanonimizacja nie ładuje
modeli NER (ONNX nie startuje w żadnym teście tego planu); eval
nieuruchamiany.

| Praca | Klasa | Uzasadnienie |
|---|---|---|
| D-0 merge + test równoważności długości | laptop-safe | czysty git + vitest |
| D-1 (MD3-D1/D2 skan pól DOM) | laptop-safe | fixture syntetyczny (aliasowany prefiks), jsdom |
| D-2 (FD-1/FD-2 szew + osłona odmowy + raport) | laptop-safe | testy jednostkowe na fragmentach XML |
| D-3 (FD-4 próg pewności + note) | laptop-safe | goldeny czterech przykładów §4.3, czyste funkcje |
| D-4 (FD-3/FD-5 przewleczenie + UI) | laptop-safe | jsdom + istniejący harness `main.docx-export.test.js` |
| D-5a e2e Playwright w realnym Chromium (import → eksport → rozpakowanie wyniku w teście: podmiany, `.rels` nietknięte, rezydua zgodne z raportem) | laptop-safe | istniejący harness `test:e2e` bez modeli (strona deanonimizacji); wzorzec bench – bez inferencji |
| D-5b krok w `desktop:smoke`/`:packaged`/`:offline` (`blockedTotal === 0` obejmuje przebieg DOCX; import wrogich = odmowy) | laptop-safe | istniejące smoke'i Electrona; checklista uczciwie trzyma to jako `?` – „smoke napisany na ślepo byłby fałszywym dowodem", więc krok wchodzi dopiero teraz, z uruchomieniem |
| **D-5c golden z realnego Worda** (`golden-word-pismo.docx`: pismo na papierze firmowym zapisane PRAWDZIWYM Wordem – naturalne `rsid`/`proofErr`/`lastRenderedPageBreak`/data-descriptory) + rekonstrukcja + **otwarcie wyniku w Wordzie i LibreOffice bez monitu naprawy, papier firmowy wzrokowo nienaruszony** | **WORD (Alan, ~30 min)** | O-6/RD-2: równoważności infoset XMLSerializera nie dowiedzie żaden test bez realnego silnika renderującego; dzisiejsze goldeny są syntetyczne (generator) – potrzebny jeden plik „z życia" |
| D-5c' commit goldena real-Word + test maszynowy na nim (podmiany + części nietknięte bajt-w-bajt) | laptop-safe | po dostarczeniu pliku |

Wytworzenie goldena real-Word: protokół dla Alana (rozszerzenie README
w `test-data/docx/`): dokument z nagłówkiem/stopką K-Law, tokeny wpisane
ręcznie w treści, nagłówku i stopce (w tym jeden z anotacją `|D` po
przyimku jednoznacznym, np. „od"), zapis .docx, commit. Zero PII w pliku –
tokeny i tekst neutralny.

---

## §8. MD6 – dowody całości (stan → delta)

| Element MD6 | Stan | Delta |
|---|---|---|
| złote/wrogie fixture'y + generator deterministyczny | JEST (`test-data/docx/`, `.gitattributes` chroni binaria przed CRLF; generator odtwarza bajt w bajt – zerowe czasy ZIP) | + golden real-Word (D-5c) + fixture aliasowanego prefiksu (D-1) |
| pomiar czasu (§3.1, próg ~200 ms) | JEST (`rebuild-docx.perf.test.js`, ~113 ms jsdom – zaniża niekorzystnie, uczciwy) | bez zmian; log do werdyktu bramki |
| e2e realny Chromium | **BRAK** (`main.docx-export.test.js` to jsdom) | D-5a |
| krok w `desktop:smoke` | **BRAK** (checklista: `?`, świadomie nie dopisany na ślepo) | D-5b |
| ręczny test Worda | protokół spisany (`test-data/docx/README.md`) | wykonanie + wynik w werdykcie (D-5c) |
| `SECURITY-CHECKLIST.md` C-DOCX-1…10 | JEST na gałęzi (nota „opisują kod na gałęzi") | po merge: usunięcie noty, statusy dowodzone na `main`; nowe pozycje testowe FD (szew z osłoną odmowy, próg pewności, sanityzacja form odmienionych) dopisane do C-DOCX-6/7 jako podpunkty |
| `THREAT-MODEL.md`, `SECURITY.md` §14, `docs/docx-rebuild.md` | JEST na gałęzi | aktualizacja sekcji fleksji (tryb ograniczony §4.4, wiersze „odmieniono"; usunięcie zdania „wartości wstawiane są w mianowniku") |

---

## §9. GATE-DOCX (bramka nad gałęzią `feature/docx-fleksja`; precedens `feature/h3-hc2`)

Dyscyplina certyfikowanego `main`: D-0…D-5 wchodzą na jednej gałęzi
funkcyjnej z werdyktem przed merge. GATE-SCOPE zbramkował gałąź prototypu
bezpieczeństwowo w składzie sprintu; GATE-DOCX bramkuje SCALENIE na `main`
+ delty FD jako całość. Kryteria:

| ID | Kryterium |
|---|---|
| G-D1 | merge D-0 czysty (dowód §1.2 powtórzony w PR); pełny `npm test` zielony na `main`+gałąź; eksporty płaskie (tekst/PDF) bez regresji (goldeny istniejące) |
| G-D2 | C-DOCX-1…10 ze statusami dowiedzionymi NA GAŁĘZI PO SCALENIU (ścieżki plików aktualne, nota tymczasowa usunięta) |
| G-D3 | wszystkie fixture'y wrogie odrzucane właściwym kodem błędu; `golden-pismo` 8 podmian / 0 pozostawionych; hiperłącze liczone, nie blokuje; `attachedTemplate` blokuje; skan pól odporny na aliasowany prefiks namespace (MD3-D1) |
| G-D4 | części bez podmian bajt-w-bajt (porównanie strumieni SKOMPRESOWANYCH); komplet `.rels` wejścia i wyjścia bajtowo identyczny |
| G-D5 | zero podmian → `blocked-no-replacements` z diagnozą; oba statusy blokady osiągalne z realnej ścieżki UI (test `main.docx-export.test.js` zielony po deltach) |
| G-D6 | szew FD-1: resolver dostaje `type`/`case`/`tokenId`/`part`/`occurrence`/konteksty ±40 liczone od granic surowego dopasowania (token anotowany, rozcięty między runy); **odmowa resolvera = forma bazowa, bajt w bajt jak bez resolvera – nigdy wyjątek** |
| G-D7 | polityka pewności FD-4: macierz §4.3 zielona (odmiana przy wysokiej; S-T solo → baza; sprzeczność → baza; odmiana bez anotacji przy jednoznacznym S-P); `minConfidence` nieprzekazany = zachowanie dzisiejsze (goldeny `flexion-resolver.test.js` bez regresji) |
| G-D8 | raport odmian FD-2: każda podmiana wartością ≠ bazie ma wiersz `declined` (z, na, przypadek, źródło, pewność z `note`); `totals.declined` i `flexionDeclined.count` zgodne z zawartością pliku; formy odmienione przechodzą sanityzację §4.6 (test wartości złośliwej z odmianą); w UI przypadki słownie |
| G-D9 | zgodność wsteczna fleksji: `resolveReplacement = null` → wynik bajt w bajt identyczny z gałęzią przed FD (golden) |
| G-D10 | e2e Chromium (D-5a) + smoke'i z `blockedTotal === 0` (D-5b) zielone w trybie repo i spakowanym |
| G-D11 | golden real-Word: rekonstrukcja z odmianą; Word i LibreOffice otwierają wynik bez monitu naprawy; papier firmowy wzrokowo nienaruszony (protokół, wynik ręczny odnotowany w werdykcie) |
| G-D12 | niezmienniki: zero zmian w `src/pipeline/**` (asercja w PR); zero nowych zależności runtime (`dependencies` diff pusty); zero nowych ścieżek legendy/`seen` (przegląd: żadna nowa serializacja, IPC, storage, payload MCP); test równoważności długości (D-0) zielony; perf log ≤ progu §3.1 |

---

## §10. Rejestr decyzji O-DOCX (dla Alana)

| Nr | Decyzja | Rekomendacja | Uwagi |
|---|---|---|---|
| **O-DOCX-1** | **Automatyczna odmiana w .docx bez akceptacji per wystąpienie** – rekonstrukcja wstawia formę odmienioną, gdy pewność wysoka; kontrola człowieka = raport „odmieniono" + lektura pisma przed podpisem (jak RD-3). Alternatywa: czekać z odmianą na warstwę decyzji FL-5 (klik per wystąpienie nad podglądem) | **TAK** – to jest wprost realizacja decyzji 12 („odmiana dochodzi projektem (b) przez gotowy szew") i kontraktu §8 rodzica (raport odnotowuje każdą różnicę); reguła V2 FLEKSJI dotyczy ujść tekstowych z planem sugestii, a .docx ma własny, zbramkowany kontrakt raportowy | bez tej zgody delty FD ograniczają się do FD-1 (szew + osłona odmowy) i czekają na FL-5 |
| **O-DOCX-2** | **Próg pewności**: (a) wyłącznie `wysoka` (anotacja wymaga potwierdzenia kontekstem albo kontekst sam jednoznaczny) vs (b) anotacja niesprzeczna z kontekstem wystarcza (odmiana także przy `niska`) | **(a)** – przykład wiążący: „`[PERSON_NAME_1|D]` nie stawił się" (błędna anotacja LLM) w (a) zostaje mianownikiem, w (b) wstawiłby dopełniacz w pozycji podmiotu; koszt (a): mniej automatycznych odmian, każda odmowa policzona w raporcie (pętla pomiarowa O-FL-2) | zmiana (a)→(b) to jedna wartość opcji – może wrócić po pomiarze na realnych pismach |
| O-DOCX-3 | Konsolidacja dwóch źródeł długości tokenu (`findTokens().rawLength` vs `rawTokenLength(entry)`) | test równoważności w D-0 (wiążący); konsolidacja – `rawTokenLength` deleguje do `entry.rawLength` – osobnym drobnym commitem po bramce | nie blokuje niczego; usuwa przyszły dryf |
| O-DOCX-4 | Golden z realnego Worda: kto i kiedy wytwarza | Alan wg protokołu §7 (~30 min, zero PII – same tokeny), commit do `test-data/docx/` | domyka O-6; bez niego G-D11 wisi |
| O-DOCX-5 | PDF dla wpisów DOCX pozostaje płaski (z podglądu tekstowego) | potwierdzić jako ograniczenie v1 (już zapisane w `docs/docx-rebuild.md`) | rekonstrukcja PDF to inny projekt |
| O-DOCX-6 | Zasięg skanu wrogich pól: części tokenowe (dziś) czy wszystkie części XML czytane przez inspekcję (MD3-D2) | **wszystkie czytane** – koszt pomijalny, komentarze i tak parsowane do zliczeń | spójne z literą §9.3 („kody pól są skanowane") |
| O-DOCX-7 | Metadane czasu wpisów ZIP w wyniku: `zip-writer` ZERUJE czasy (`zip-writer.js:117-118`; deterministyczne goldeny, brak stempla czasu pracy radcy), design §3.3 mówił „kopiowane ze źródła" | zatwierdzić ZEROWANIE jako świadome, korzystniejsze odstępstwo (mocniejsza higiena metadanych niż w projekcie) | czysta formalność – zachowanie już przetestowane i opisane w README goldenów |

---

## §11. Fazy implementacyjne D-0…D-5

Rozmiary: S (≤ 1 dzień), M (2–4 dni). Kolejność: D-0 → (D-1 ∥ D-2 ∥ D-3)
→ D-4 → D-5. Wszystko na jednej gałęzi `feature/docx-fleksja`, jedna bramka
GATE-DOCX przed merge.

| Faza | Zakres (kontrakt) | Kryterium akceptacji / test dowodzący | Rozmiar |
|---|---|---|---|
| **D-0** | merge `feature/docx-rebuild` → gałąź robocza nad `main`; test równoważności długości tokenu (O-DOCX-3); asercja „pipeline nietknięty" w opisie PR | pełny `npm test` zielony; przecięcie plików puste + merge-tree czysty (dowód §1.2 powtórzony w PR); goldeny DOCX i eksporty płaskie bez regresji | S |
| **D-1** | MD3-D1: skan pól po namespace (DOM) + fixture aliasowanego prefiksu; MD3-D2 wg decyzji O-DOCX-6 | fixture z `<x:instrText>DDEAUTO` blokuje eksport; regex zostaje wyłącznie jako pre-filtr pozytywny | S |
| **D-2** | FD-1: osłona odmowy (`resolved?.text ?? baseValue`) + pełny kontrakt szwu w `rebuildPart` (tokenId/type/case/occurrence/part); FD-2: wiersze `declined` + `flexionDeclined.count` w raporcie i `totals` | testy §3.2/§3.3: resolver-szpieg na tokenie anotowanym rozciętym między runy; resolver-odmawiacz → bajt w bajt jak bez resolvera; raport spina się z plikiem | S/M |
| **D-3** | FD-4: `minConfidence` + `note` w `createFlexionResolver` (opcje addytywne, default = dzisiejsze zachowanie) | macierz §4.3 (4 przykłady) + regresja goldenów fleksji bez opcji | S |
| **D-4** | FD-3: budowa resolvera w `main.js` (morph z `load.js` albo `null`, żywe `seen`), przewleczenie przez `exportDeanonOutcomes` → `rebuildDocxBlob` → `rebuildDocx`; FD-5: UI raportu odmian (`textContent`, `CASE_LABELS` słownie) | rozszerzony `main.docx-export.test.js`: eksport z odmianą pewną (wiersz w raporcie UI), z odmową (baza + licznik), bez resolvera (bajt w bajt, G-D9) | M |
| **D-5** | MD6: e2e Chromium (D-5a), krok smoke (D-5b), golden real-Word + test (D-5c/D-5c'), aktualizacja checklisty/threat-model/docs, werdykt GATE-DOCX | G-D1…G-D12 komplet; wynik ręcznego testu Worda odnotowany w werdykcie | M |

**Poza zakresem tego planu (jawnie):** warstwa `decisions`/plan sugestii
i UI „Weryfikacja pisma" (FL-5/FL-6 – tam wraca porządek
`decyzja ?? resolver ?? baza` także dla DOCX, przez projekcję z anchorami
FL-7, oraz parytet `attestedSnapshot`), powody odmów w raporcie (hook
`onDecline` – najwyżej z FL-5), artefakt `morph-pl.json` (FL-1b +
GATE-FLEKSJA-DANE – fleksja DOCX zyskuje pełną moc bez zmiany kodu),
odmiana w ujściach płaskich, kanał binarny przez most (decyzja 11),
rekonstrukcja PDF, aktywacja scope-tiers (niezależna, czeka na B6).

---

## §12. Ryzyka

| Nr | Ryzyko | Mitygacja |
|---|---|---|
| R-D1 | późniejsze scalanie `integration/sprint` na `main` przyniesie STARSZĄ morfologię (diff sprint↔main dziś: `anonymizer.js`, `tokens.js`, `verifier/morph/analyze.js`, `load.js`, `paradigms.js`, `case-detector/role-lemmas.js`) | odnotowane TERAZ: sprint przy scalaniu musi przyjąć wersje `main` dla `src/verifier/**`, `tokens.js`, `substitution.js`, `anonymizer.js`; docx-rebuild scalamy z GAŁĘZI, więc sprintowa kopia modułów DOCX stanie się no-op (te same bajty) |
| R-D2 | oczekiwanie „pełnej odmiany" przed artefaktem morfologicznym | komunikacja: docs + licznik odmów; tryb ograniczony (poświadczone + nazwiska regułowe + S-P/S-R z tabel w repo) opisany wprost §4.4 |
| R-D3 | Word tnie token anotowany (`[PERSON_NAME_1|D]`) między runy jak każdy tekst | już obsłużone: gramatyka działa na sklejonym strumieniu; twarde przecięcie → rezyduum `przerwany-elementem` (fail-safe); test w D-2 |
| R-D4 | XMLSerializer zapisze równoważny XML minimalnie inaczej i Word zamarudzi (O-6/RD-2) | niezmiennik bajt-w-bajt dla części bez podmian + golden real-Word z testem otwarcia (G-D11) |
| R-D5 | błędna anotacja LLM w pozycji bez sygnału kontekstowego | polityka (a) z O-DOCX-2: S-T solo nigdy nie odmienia (w `detect.js` S-T bez współsygnału = `niska`); sprzeczność → `nieustalony` → baza |
| R-D6 | rozjazd raportu „odmieniono" z plikiem | wiersze budowane z TEGO SAMEGO planu podmian, który poszedł do `w:t` (wartości PO sanityzacji); skan rezyduów po podmianie bez zmian; asercja G-D8 na wynikowym XML |
| R-D7 | dwie prawdy o długości tokenu dryfują po przyszłych zmianach gramatyki | test równoważności (D-0) łamie build przy dryfie; konsolidacja O-DOCX-3 |
| R-D8 | odmowa resolvera wywala eksport (dzisiejszy kształt `rebuildPart`) | FD-1 pkt 0: `resolved?.text ?? baseValue` + test odmawiacza; bez tej osłony NIE wolno podpiąć `createFlexionResolver` |
| R-D9 | dryf żywego `seen` względem `legendSnapshot` wyniku (brak `attestedSnapshot` w v1) | poświadczenia wpływają wyłącznie na DOSTĘPNOŚĆ odmiany, nie na wartość (legenda: snapshot ▸ żywa, bez zmian); parytet snapshotów jawnie odłożony do FL-5 |

---

*Koniec planu. Następne kroki: (1) decyzje Alana O-DOCX-1…7 (próg pewności
i auto-odmiana pierwsze), (2) bramka Opusa nad tym dokumentem, (3) D-0
(merge) i delty D-1…D-4, (4) MD6/D-5 z ręcznym testem Worda, (5) werdykt
GATE-DOCX przed merge na `main`. Dokument nie zmienia żadnego werdyktu
rodziców; przy rozbieżności interpretacji wiążą: PRODUCT-DECISIONS.md,
potem DOCX-REBUILD-DESIGN.md i FLEKSJA-IMPL-PLAN.md, potem ten plan.*
