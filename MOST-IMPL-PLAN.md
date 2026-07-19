# MOST-IMPL-PLAN.md – finalizacja mostu MCP (M1–M8) do stanu implementacyjnego

**Wersja:** 1.0 (plan implementacyjny do bramki Opusa)
**Data:** 2026-07-18
**Autor:** Fable (architekt aplikacji desktopowej)
**Status:** PLAN IMPLEMENTACYJNY. Zero kodu. Finalizuje `MCP-BRIDGE-DESIGN.md`
(v1.0, zbramkowany co do kierunku) do stanu, w którym Sonnet może implementować
moduł po module bez decyzji architektonicznych po drodze. Dokument czeka na
bramkę Opusa; implementacja nie startuje przed akceptacją.
**Odbiorcy:** Opus (bramka bezpieczeństwa), Alan (decyzje O-MOST-*, §9),
Sonnet (karty modułów §3 i pułapki §10).

**Relacja do dokumentów:**

- `MCP-BRIDGE-DESIGN.md` – projekt bazowy (architektura, model zagrożeń wariantu
  B, rejestr O-1…O-12). Ten plan go NIE powtarza – rozstrzyga to, co projekt
  zostawił otwarte, i koryguje to, co się od tego czasu zmieniło. Przy
  sprzeczności co do szczegółu implementacyjnego wygrywa ten plan; przy
  sprzeczności co do zasady bezpieczeństwa – projekt plus niniejsze zaostrzenia.
- `PRODUCT-DECISIONS.md` decyzje 1–5 – wiążące; wszystkie wchłonięte niżej.
- `SECURITY.md`, `THREAT-MODEL.md`, `SECURITY-CHECKLIST.md`, `SECURITY-FIXES.md`
  – fundament wariantu A; niezmienniki A pozostają nadrzędne.
- `SHARED-FOUNDATION-DESIGN.md` / `GATE-PHASE0.md` – S1 (gramatyka tokenów
  w `src/tokens.js`) i S2 (substytucja) są JUŻ na main; plan z tego korzysta.

**Konwencja:** fragmenty JSON/tekstu ramek to schematy komunikatów i przykłady,
nie kod. Rozstrzygnięcia implementacyjne tego planu oznaczone **R-n** (§2),
decyzje produktowe dla Alana **O-MOST-n** (§9), kryteria bramki końcowej
**G-M-n** (§8).

---

## §0. Co się zmieniło od projektu (stan repo na 2026-07-18, main)

Fakty zastane, które modyfikują litery projektu – każda różnica jawnie:

1. **Decyzja 2 (most domyślnie WSTRZYMANY)** unieważnia §5.5 projektu w części
   „stan startowy: aktywny". Bootstrap mostu (nazwa potoku, bind, plik sesyjny)
   przenosi się ze startu aplikacji do jawnego kliknięcia „Włącz most" (§2 R-1).
2. **Decyzja 5 (timeout 180 s + keep-alive)** nadpisuje O-8/§6.4 projektu
   (120 s). Mechanizm keep-alive doprecyzowany w §3 M6.
3. **S1 już istnieje.** Projekt (§12 M4) zakładał „wyniesienie TOKEN_PATTERN do
   wspólnego modułu" – to zrobione niezależnie: `src/tokens.js` jest jedynym
   źródłem gramatyki tokenów (z adnotacją przypadka `[TYP_N|D]` z decyzji 17),
   a `src/mcp/listings.js` już z niego korzysta (`containsToken`). M4 się
   upraszcza: zero nowej konsolidacji, wyłącznie konsumpcja.
4. **B4 (podpis kodu) jest zamknięty** (Azure Artifact Signing, C-WIN-2 PASS).
   Warunek projektu „B nie wychodzi przed B4" jest spełniony po stronie
   infrastruktury; wariant B wymaga jedynie objęcia drugiej binarki tym samym
   profilem podpisu (§3 M7).
5. **Regexy PII żyją w `src/anonymizer.js`** (`findRegexEntities`, w tym PESEL/
   NIP/REGON/KRS z sumami kontrolnymi, IBAN/NRB, e-mail, telefon, dowód osobisty,
   paszport, prawo jazdy, tablice, KW, kwoty, sygnatury) + dane kotwic w
   `src/pipeline/data/identifier-patterns.json`. Łańcuch importów
   `anonymizer.js → tokens.js + substitution.js + identifier-patterns.json`
   jest środowiskowo czysty (zero DOM). ALE: **`src/` nie jest pakowane do
   asara** (`electron-builder.yml` files: `dist-desktop/**`, `electron/**`,
   `package.json`) – §6.3 projektu („importowalne w procesie głównym") działa
   w repo, nie w spakowanej binarce. Rozstrzygnięcie: §2 R-3.
6. **Scope-tiers (ST-2/ST-6) są zbramkowane na `integration/sprint`, nie na
   main.** ST-6 dokłada twardy warunek `reviewComplete` na payloadach MCP
   (GATE-SCOPE GS-1). Most niczego z tego nie implementuje, ale musi być
   kompatybilny w przód: jedynym producentem payloadów pozostają buildery
   `listings.js`, więc przyszły warunek wejdzie w jednym miejscu, wspólnym dla
   WebMCP i mostu (§2 R-4).
7. **Smoke packaged steruje binarką przez CDP** (`--remote-debugging-port`),
   bo fuse `EnableNodeCliInspectArguments: false` blokuje harness Playwrighta –
   M8 dziedziczy tę technikę dla okna bramki (§3 M8).
8. `mcpLabel` źródeł/wyników i `createLabelSequence` działają jak w projekcie;
   id wyników to `crypto.randomUUID()` (syntetyczne z konstrukcji – nic z nazwy
   użytkownika nie przecieka przez `{id, success}`).

---

## §1. Wymagania nienegocjowalne – mapowanie na mechanizmy

Pięć wymagań toru bezpieczeństwa (zadanie) na tle W1–W5 projektu; każde ma
właściciela w planie:

| # | Wymaganie | Mechanizm | Gdzie w planie | Dowód w GATE |
|---|---|---|---|---|
| 1 | Most fizycznie NIEOBECNY w wariancie A (build-time strip) | wzorzec B2: wykluczenia `files` w yml A + DCE flagi Vite + asercje artefaktów obu stron | §3 M7, §6 | G-M-2, G-M-3, G-M-4 |
| 2 | Przez granicę wyłącznie tokeny + nazwy syntetyczne; „pokazane = wysłane" | buildery `listings.js` jako jedyny producent; jeden bufor; test hashy w 3 punktach | §4 | G-M-6, G-M-12 |
| 3 | Bramka człowieka na KAŻDE wywołanie (także `list_*`); most domyślnie wstrzymany | kolejka FIFO + okno bramki + brak ścieżki kodu zwracającej payload bez decyzji; bootstrap dopiero po „Włącz most" | §2 R-1, §3 M3 | G-M-5, G-M-7 |
| 4 | Kanał LOKALNY: stdio + `\\.\pipe\` z auth (losowa nazwa 128 b + sekret w `%LOCALAPPDATA%` + wzajemny HMAC); zero gniazd sieciowych; C-NET-6b wąsko | pipe-server/pipe-client jako jedyne pliki z `node:net`, twarda asercja ścieżki, 3 warstwy testów | §3 M1, M2 | G-M-8, G-M-9 |
| 5 | Skan kontrolny PII na payloadzie + wymuszony podgląd (mitygacja R1) | `findRegexEntities` z pipeline'u w procesie głównym + asercja tokenów + podświetlenia i checkbox | §5, §3 M4 | G-M-12 |

Zasada decyzyjna przy każdym szczególe niżej: „czy to może wypuścić surowe PII
albo osłabić air-gap wariantu A?" – jeśli tak, wybór pada na wariant droższy
implementacyjnie, ale fail-closed.

---

## §2. Rozstrzygnięcia implementacyjne (delta względem projektu)

### R-1. Bootstrap mostu przy „domyślnie wstrzymany" (decyzja 2)

Nowa maszyna stanów mostu w procesie głównym (moduł `electron/bridge/bootstrap.mjs`):

```
WSTRZYMANY (stan startowy, zawsze po uruchomieniu aplikacji)
   │  klik „Włącz most" (renderer → pii:bridge:set-enabled true)
   ▼
AKTYWNY: generacja nazwy potoku (128 b CSPRNG) + sekretu (256 b) → bind
   serwera (fail-closed przy EADDRINUSE: stan BŁĄD, komunikat w UI, bez
   retry automatycznego) → atomowy zapis pliku sesyjnego → broadcast statusu
   │  klik „Wstrzymaj most" / zamknięcie aplikacji (before-quit)
   ▼
WSTRZYMANY: zamknięcie połączeń → zamknięcie serwera → usunięcie pliku
   sesyjnego → wiszące bramki auto-„Odrzuć" → broadcast statusu
```

- **Stan włączenia NIE jest trwały**: każdy start aplikacji zaczyna od
  WSTRZYMANY. Zero zapisu w `localStorage`/na dysku. Ścisła interpretacja
  decyzji 2 („rusza dopiero po świadomym włączeniu") – świadomość per sesja.
  Alternatywa (zapamiętanie wyboru) osłabiałaby czujnik: użytkownik ma
  wiedzieć, że most jest otwarty, bo sam go przed chwilą otworzył.
  Do potwierdzenia: **O-MOST-2**.
- **Adapter przy braku pliku sesyjnego nie rozróżnia** „aplikacja nie działa"
  od „aplikacja działa, most wstrzymany" (oba stany = brak pliku; to celowe,
  wstrzymany most nie zostawia żadnego artefaktu na dysku). Jeden stały
  komunikat błędu: „Aplikacja «Lokalny anonimizator + AI» nie jest uruchomiona
  albo most AI jest wstrzymany. Poproś użytkownika o uruchomienie aplikacji
  i włączenie mostu AI, potem ponów wywołanie." Fail-fast, zero kolejkowania
  (§5.3 projektu bez zmian poza treścią komunikatu).
- Plik sesyjny: `%LOCALAPPDATA%\LokalnyAnonimizatorAI\bridge-session.json` –
  stały slug katalogu bez spacji i „+", niezależny od marketingowego
  `productName` (mniej pułapek cytowania; katalog tworzony przez samą
  aplikację, nie przez `app.getPath('userData')`, który wskazuje roaming –
  pułapka z §4.3 projektu podtrzymana). Kształt pliku jak w projekcie §4.3.

### R-2. Szew rendererowy: minimalny dotyk `src/main.js`, bez refaktoru ciał narzędzi

**Zmienia §8.2 projektu** („wydzielenie ciał narzędzi do `src/mcp/tools.js`").
Uzasadnienie: ciała narzędzi WebMCP (`src/main.js:1642–1707`) to cienkie
wrappery – cała logika płotków już żyje w `src/mcp/listings.js` (zaudytowana
granica egress). Refaktor wspólnych ciał dotykałby builda webowego i A dla
zysku ~40 linii, a celem nadrzędnym jest dowodliwie nietknięty wariant A (§6).

Zamiast tego:

- **Nowy moduł `src/mcp/tool-catalog.js`** – czyste dane: nazwy, opisy,
  schematy argumentów pięciu narzędzi + osobne pole `bridgeNote` (dopisek dla
  adaptera: „odpowiedź wymaga zatwierdzenia przez użytkownika w oknie
  aplikacji – może chwilę potrwać"). Jedno źródło prawdy zamiast testu
  porównawczego z §7.2 projektu (parytet z konstrukcji, nie z porównania).
  Rejestracje WebMCP w `main.js` przechodzą na literały z katalogu (zmiana
  bez wpływu na zachowanie webu – te same stringi; test snapshotowy przed/po).
- **Nowy moduł `src/mcp/bridge-ipc.js`** – cienka warstwa mostu w rendererze:
  odbiera `pii:bridge:exec` (przez zamrożone API preloadu), woła DOKŁADNIE te
  same buildery `listings.js` i te same funkcje wynikowe
  (`createOutcome`/`updateOutcomeFields` – przekazane jako uchwyty), odsyła
  `pii:bridge:result`, montuje widget stanu mostu (DOM tworzony z JS – zero
  zmian w `tool.html`). Walidacja `label`/`text` dla `write_outcome` –
  identyczna jak w bloku WebMCP (lustrzany test parytetu zachowań
  `src/mcp/bridge-ipc.test.js` na tych samych przypadkach co testy WebMCP).
- **Jedyny dotyk `src/main.js`:** jedna gałąź na końcu pliku, za flagą
  build-time: jeżeli `import.meta.env.VITE_PII_BRIDGE === '1'`, dynamiczny
  import `./mcp/bridge-ipc.js` i przekazanie uchwytów stanu:
  `{ sources, outcomes, getSeen: () => seen, createOutcome,
  updateOutcomeFields }`. **Nigdy `legend`** – uchwyt do legendy nie istnieje
  w kontrakcie szwu (I-B1 projektu egzekwowane już na poziomie sygnatury).
- Build A/web nie definiuje flagi → gałąź jest martwa i podlega DCE; bundle A
  nie może zawierać stringów `pii:bridge:` (asercja §6). Jeżeli pomiar w M5
  pokaże, że DCE nie usuwa gałęzi z bundla A – plan zapasowy opisany w §10
  P-2 (osobne entry `src/main-bridge-entry.js` + rejestr uchwytów), bez zmiany
  kontraktu bezpieczeństwa.

### R-3. Skan kontrolny i katalog narzędzi w spakowanym B: zamknięta lista plików `src/` w asarze B

Problem (nowo wykryty): §6.3 projektu każe procesowi głównemu reużyć regexy
pipeline'u, a §7.2 każe adapterowi znać opisy narzędzi – ale `src/` nie
istnieje w spakowanym asarze. Opcje: (a) duplikacja wzorców w `electron/`
z testem tożsamości – dryf dwóch kopii dokładnie tam, gdzie precyzja decyduje
o bezpieczeństwie; (b) bundling `electron/bridge/**` Vite'em – nowy toolchain
dla procesu głównego, nowa powierzchnia audytu; **(c – wybrana) zamknięta
lista plików `src/` dopisana do `files` w `electron-builder.bridge.yml`:**

```
src/anonymizer.js
src/tokens.js
src/substitution.js
src/pipeline/data/identifier-patterns.json
src/mcp/tool-catalog.js
```

Fizycznie te same bajty co w repo i w bundlu renderera (jeden commit = jedna
prawda), zero generowania kodu, zero duplikacji. `electron/bridge/
outbound-checks.mjs` i `mcp-stdio.mjs` importują względnie (`../../src/…`) –
działa identycznie w repo i w asarze B, bo względny układ katalogów jest
zachowany. Warunek trwały (test statyczny w M4): łańcuch importów tych pięciu
plików nie może wyjść poza tę listę ani dotknąć DOM/window – dziś tak jest
(zmierzone), test pilnuje regresji przy przyszłych zmianach `anonymizer.js`.

Konsekwencja dla asercji artefaktów (§6): asar **A** nie zawiera ŻADNEGO pliku
`src/**`; asar **B** zawiera dokładnie te pięć.

### R-4. Kompatybilność w przód ze scope-tiers (ST-6)

Most nie implementuje warstwowości. Gwarancja zgodności: proces główny i
adapter nie znają semantyki dokumentów – payload produkują wyłącznie buildery
`listings.js` w rendererze. Gdy scope-tiers scali się do main z warunkiem
`reviewComplete` (GS-1), warunek wejdzie w buildery/warstwę narzędzi i obejmie
oba transporty (WebMCP i most) bez zmiany jednej linii w `electron/bridge/**`.
Zapis do checklisty przyszłego mergu scope-tiers: test GS-1 („grep każdego
payloadu MCP") musi objąć także tor mostu (payloady na potoku w M8-smoke).

### R-5. Okno bramki jako zasób `app://` builda B

`§6.2` projektu („ładowane z app://") doprecyzowane: statyczne źródła okna
bramki żyją w `electron/bridge/gate-window/` (gate.html, gate.css, gate.js –
zero frameworków), a build renderera B emituje je do `dist-desktop-bridge/`
(plugin w `vite.config.electron-bridge.js`, wzorzec `desktopLocalAssets`).
Okno ładuje `${APP_ORIGIN}/gate.html` przez ISTNIEJĄCY handler `app://` –
zero zmian w `app-protocol.mjs`, CSP z handlera obowiązuje. Preload bramki:
`electron/bridge/gate-preload.cjs` (dokładnie dwie funkcje: `getPayload()`,
`decide(approved)`; wzorzec zamrożonego obiektu z `electron/preload.cjs`).

Obserwacja bez luki (odnotowana dla audytu): okno główne wariantu B mogłoby
nawigować do `app://…/gate.html` (same-origin przepuszcza `will-navigate`) –
strona jest wtedy bezwładna: bez preloadu bramki `getPayload`/`decide` nie
istnieją, a kanał `pii:bridge:decision` przyjmuje wyłącznie `webContents`
faktycznego okna bramki i wyłącznie dla oczekującego `reqId` (M3).

### R-6. Kanały IPC wariantu B – lista zamknięta (finalna)

Rozszerza §3.4 projektu o kontrolę włącznika (konsekwencja decyzji 2).
Wszystkie kanały z walidacją nadawcy wg wzorca S-IPC-1 (`senderFrame.url`
zaczyna się od `APP_ORIGIN`); istniejący `pii:desktop-info` NIETKNIĘTY.

| Kanał | Kierunek | Niesie | Nigdy nie niesie |
|---|---|---|---|
| `pii:bridge:exec` | main → renderer (event) | `{reqId, name, args}` po walidacji schematu | – |
| `pii:bridge:result` | renderer → main (invoke) | `{reqId, result}` – wynik buildera `listings.js` | legendy, oryginałów, prywatnego `label` |
| `pii:bridge:status` | main → renderer (event) | `{state: 'paused'\|'active'\|'error', connections, approved, rejected, autoDenied, exePath, error?, recent}` (`recent` = ostatnie 50 wpisów dziennika: same metadane §6.7) | treści payloadów |
| `pii:bridge:set-enabled` | renderer → main (invoke) | `boolean` | – |
| `pii:bridge:decision` | okno bramki → main (invoke) | `{reqId, approved, ackChecked?}` | – |

`exePath` (= `process.execPath`) zasila przycisk „Skopiuj konfigurację dla
klienta AI" (§7.4 projektu) – świadomie w statusie mostu, żeby nie dotykać
kontraktu `pii:desktop-info` (C-IPC-2/3 bez zmian w A). Preload B eksponuje
`window.desktopApp.bridge = Object.freeze({ onToolRequest, submitToolResult,
onStatus, setEnabled })` – bez surowego `ipcRenderer` (jak dziś).

### R-7. Keep-alive w adapterze, nie na potoku

Decyzja 5 wymaga podtrzymania wywołania przez ~180 s namysłu. Mechanizm:
adapter po wysłaniu ramki `tool` startuje timer per żądanie i co **10 s**
wysyła klientowi MCP `notifications/progress` (tylko jeśli klient przekazał
`progressToken`), z komunikatem stałym „Oczekiwanie na decyzję użytkownika
w aplikacji…". Timer gaśnie przy odpowiedzi, anulowaniu albo zerwaniu potoku
(wtedy natychmiast `isError`, zero retry). Potok NIE przenosi ramek postępu –
mniej typów ramek, mniej stanu; adapter wie sam, że czeka. Interwał 10 s to
margines ×6 wobec najkrótszych znanych timeoutów klientów; kalibracja per
klient w M8 (jeśli któryś zrywa mimo keep-alive – zejść z timeoutem bramki
dla tego klienta, zgodnie z decyzją 5).

### R-8. Stała tożsamości produktu B (propozycja do O-MOST-1)

| Pole | Wartość proponowana |
|---|---|
| `productName` | `Lokalny anonimizator + AI` (decyzja 1) |
| `appId` | `pl.kolkowski.lokalny-anonimizator-ai` |
| `executableName` | `LokalnyAnonimizatorAI` (bez spacji i „+" – ścieżka w konfiguracjach klientów MCP bez pułapek cytowania; `productName` zostaje marketingowy) |
| `artifactName` | `LokalnyAnonimizatorAI-Setup-${version}.${ext}` |
| katalog instalacji | `%ProgramFiles%\Lokalny anonimizator + AI\` (perMachine, jak A) |
| plik sesyjny | `%LOCALAPPDATA%\LokalnyAnonimizatorAI\bridge-session.json` |
| nazwa potoku | `\\.\pipe\pii-bridge-v1-<32 hex>` |

Przykład wpisu klienta (dokumentacja `docs/bridge.md`):

```json
{ "mcpServers": { "lokalny-anonimizator-ai": {
    "command": "C:\\Program Files\\Lokalny anonimizator + AI\\LokalnyAnonimizatorAI.exe",
    "args": ["--bridge-adapter"] } } }
```

---

## §3. Karty modułów M1–M8

Kolejność implementacji: **M1 → M2 → M4 → M3 → M5 → M6 → M7 → M8** (M4 przed
M3, bo bramka konsumuje wyniki skanu). Każdy moduł: osobna gałąź, testy wchodzą
z modułem, pełna bramka Opusa przed merge (W5). Zasady stałe: zero nowych
zależności runtime; żadnych zmian w plikach wariantu A poza zamkniętą listą
z §6.1; komunikaty błędów wyłącznie z zamkniętej listy M6/`errors.mjs`.

### M1 – `electron/bridge/session-file.mjs` (plik sesyjny)

**Zakres:** ścieżka `%LOCALAPPDATA%\LokalnyAnonimizatorAI\` wyprowadzona
jawnie ze zmiennej środowiskowej (NIE `app.getPath('userData')` – roaming);
brak `%LOCALAPPDATA%` = wyjątek kontrolowany (most nie startuje, stan BŁĄD);
zapis atomowy (tmp w tym samym katalogu + `rename`); kształt
`{v:1, pipe, secret, appPid, appVersion, createdAt}`; usuwanie przy
wstrzymaniu i wyjściu; nadpisywanie osieroconego pliku przy kolejnym
włączeniu. Czysty moduł: I/O wstrzykiwane przez parametry ścieżek – testowalny
bez Electrona.

**Testy** (`session-file.test.js`, vitest, katalog tymczasowy):
atomowość (symulowany crash między tmp a rename nie zostawia częściowego
pliku pod docelową nazwą), brak PII w treści (test literalny pól), fail-closed
bez `%LOCALAPPDATA%`, sprzątanie, nadpisanie osieroconego.

**Kryteria:** C-BR-4. **Laptop-safe: TAK.** Bramka Opusa: tak (dotyka dysku).

### M2 – `electron/bridge/pipe-server.mjs`, `pipe-client.mjs`, `auth.mjs`, `framing.mjs`

**Zakres:**

- `auth.mjs` – czysta kryptografia (`node:crypto`, zero I/O): generacja
  sekretu (32 B) i nonce (32 B), HMAC-SHA-256 z kontekstami domenowymi
  `'pii-b1-c2s'` / `'pii-b1-s2c'`, porównania `timingSafeEqual`. Schemat ramek
  handshake dokładnie jak §4.3 projektu (`hello`/`auth`/`auth-ok`); sekret
  nigdy w żadnej ramce.
- `framing.mjs` – NDJSON: serializacja `JSON.stringify` + `\n` (JSON escapuje
  wewnętrzne znaki nowej linii z konstrukcji – asercja testowa, nie runtime);
  parser strumieniowy z twardym limitem 4 MiB na ramkę (przekroczenie =
  rozłączenie z błędem stałym, nigdy próba parsowania); walidacja UTF-8.
- `pipe-server.mjs` – jedyny (obok pipe-client) plik z `import net from
  'node:net'`. Twarda asercja konstrukcyjna: ścieżka nasłuchu MUSI zaczynać
  się literalnie od `\\.\pipe\` – inaczej wyjątek przed jakimkolwiek `listen`.
  Bind z zachowaniem fail-closed przy EADDRINUSE (test empiryczny O-2:
  zachowanie `FILE_FLAG_FIRST_PIPE_INSTANCE` w libuv – DWA serwery node:net
  na tej samej nazwie potoku; oczekiwany błąd drugiego bindu). Limity: maks.
  4 uwierzytelnione połączenia (nadmiar: ramka błędu + rozłączenie), timeout
  handshake 5 s, throttle 1 s po nieudanym auth. Rejestr połączeń (licznik do
  statusu). Zero buforowania żądań.
- `pipe-client.mjs` – klient dla trybu adaptera: czyta plik sesyjny przy
  KAŻDEJ próbie (bez cache – §5.2 projektu), łączy się wyłącznie ze ścieżką
  z pliku (ta sama asercja `\\.\pipe\`), wykonuje handshake i weryfikuje
  `auth-ok` (wykrycie fałszywego serwera przed pierwszą ramką narzędziową),
  jedno trwałe połączenie z reconnectem przy zerwaniu, zero kolejkowania.

**Ramki po uwierzytelnieniu** (kontrakt potoku, wersja `proto: 1`):

```json
A→G: { "t": "tool",   "reqId": "r1", "name": "read_source",
        "args": { "id": "…" }, "client": { "name": "…", "version": "…" } }
G→A: { "t": "result", "reqId": "r1",
        "result": { "content": [{ "type": "text", "text": "…" }], "isError": false } }
A→G: { "t": "cancel", "reqId": "r1" }
```

(A = adapter, G = GUI/proces główny. `client` jest deklaratywny – SB-6.)

**Testy** (vitest + czysty Node, na prawdziwych `\\.\pipe\` – działa bez
Electrona): trzy warstwy z §4.6 projektu: (1) statyczna – grep po
`electron/**`: `node:net` wyłącznie w dwóch plikach; `node:http|https|dns|
tls|dgram|child_process` – zero trafień w całym `electron/` (plik
`electron/bridge/net-invariants.test.js`, czyta źródła z dysku); (2)
jednostkowa – odrzucenie ścieżek nie-potokowych, złe MAC-i obu kierunków,
przeterminowany handshake, ramka-gigant, limit połączeń, EADDRINUSE,
reconnect klienta, poprawny pełny handshake; (3) integracyjna – serwer+klient
na losowej nazwie, wymiana `tool`/`result`, test podsłuchu: trzecia strona
znająca nazwę, ale nie sekret, dostaje `hello` i rozłączenie, w przechwyconych
ramkach nie występuje sekret (asercja bajtowa).

**Kryteria:** C-BR-1, C-BR-2, C-BR-3, C-BR-5, O-2 zmierzone, O-3 wykonane
zgodnie ze schematem. **Laptop-safe: TAK** (node:net + nazwane potoki działają
w czystym Node na Windows). Bramka Opusa: tak (rdzeń sieci/IPC).

### M4 – `electron/bridge/outbound-checks.mjs` (skan kontrolny) – przed M3

**Zakres:** czysty moduł (zero I/O, zero Electrona):

- **Asercja tokenów** dla `read_source`/`read_outcome`: `containsToken(text)`
  z `src/tokens.js` (import wg R-3). Payload bez tokenu = twarde odrzucenie
  W PROCESIE GŁÓWNYM (błąd stały, bramka się nie otwiera) – lustrzane odbicie
  reguły builderów, obrona w głąb na wypadek błędu/kompromitacji renderera.
- **Skan regex**: `findRegexEntities(text)` z `src/anonymizer.js`, wynik
  dzielony na dwie klasy (kalibracja §5): twarde identyfikatory → wymuszone
  pole wyboru w bramce; miękkie wzorce → tylko podświetlenie. Zwraca listę
  `{start, end, entity_group, klasa}` dla okna bramki.
- **Walidacja kształtu wyniku**: dokładnie
  `{content:[{type:'text', text:string}], isError?:boolean}`, jeden element
  `content`, limity długości (§4.3 projektu); pola nadmiarowe = odrzucenie.
- Kierunek „do środka" (`write_outcome`): ten sam skan regex na tekście od
  LLM-a (sygnał „klient wie więcej, niż powinien"), bez asercji tokenów
  (tekst wynikowy MOŻE zawierać tokeny, ale nie musi ich mieć w każdej
  linii); zapis i tak wymaga decyzji człowieka.

**Testy** (`outbound-checks.test.js`): korpus z `test-data/synthetic/`
(payloady stokenizowane → zero trafień klasy twardej – miara fałszywych
alarmów; te same dokumenty z celowo wstrzykniętym surowym PESEL-em/IBAN-em →
trafienie klasy twardej z poprawnymi offsetami); payload bez tokenów →
odrzucenie; kształt wyniku – przypadki brzegowe. Test środowiskowej czystości
łańcucha importów R-3 (moduł ładuje się w gołym Node, lista importów
zamknięta).

**Kryteria:** C-BR-8; skan OSTRZEGA, nigdy nie blokuje automatycznie
(fałszywe pozytywy: sygnatury, KRS – §6.3 projektu); wyjątek: brak tokenów
w `read_*` blokuje twardo (to nie heurystyka, to złamanie niezmiennika W1).
**Laptop-safe: TAK.** Bramka Opusa: tak (semantyka W1).

### M3 – `electron/bridge/gate.mjs` + `gate-window/` (kolejka i okno bramki)

**Zakres:**

- `gate-queue.mjs` – czysta maszyna stanów (testowalna bez Electrona):
  FIFO, maks. 5 oczekujących (nadmiar = błąd stały „kolejka zatwierdzeń
  pełna"), na ekranie najwyżej jedno okno; **cisza po odmowie**: odcisk
  żądania = `hash(name + kanoniczne args)`, identyczne żądanie ≤ 60 s od
  „Odrzuć" = auto-odmowa bez okna (licznik `autoDenied`); duplikat żądania
  wiszącego = podpięcie pod tę samą decyzję (jedna bramka, N odpowiedzi);
  timeout decyzji **180 s** (decyzja 5) = fail-closed „Brak decyzji
  użytkownika w wyznaczonym czasie"; anulowanie przez klienta (`cancel`) =
  zamknięcie okna z adnotacją; wstrzymanie mostu/wyjście = auto-„Odrzuć"
  wszystkiego.
- `gate.mjs` – sklejenie z Electronem: tworzy `BrowserWindow` (modal-child
  okna głównego, `sandbox`, `contextIsolation`, bez Node, preload bramki
  z R-5, `hardenWebContents` z istniejącego `web-contents-created`), ładuje
  `${APP_ORIGIN}/gate.html`, rejestruje `pii:bridge:decision` z walidacją:
  nadawca === `webContents` okna bramki ORAZ `reqId` === aktualnie oczekujący.
  Okno główne zminimalizowane → `restore()` + `flashFrame`, bez kradzieży
  fokusu.
- `gate-window/gate.html|css|js` – treść wg §6.2 projektu, z konkretami:
  nagłówek („Klient AI (podaje się jako: X, połączenie nr N) prosi o:
  read_source – Źródło 2"); czerwony pasek ostrzegawczy (tekst dokładnie
  z §6.2 pkt 2); metryka payloadu (liczba znaków, liczba tokenów z
  `findTokens`, `mcpLabel`, prywatna nazwa dokumentu wyraźnie oznaczona
  „nie zostanie wysłana"); pełny podgląd payloadu w `<pre>` przez
  `textContent` + nakładka podświetleń z offsetów skanu (tokeny zielone,
  trafienia twarde czerwone, miękkie żółte; renderowanie span-ami budowanymi
  WYŁĄCZNIE z `createTextNode`/`textContent` – C-INP-1 obowiązuje);
  przyciski: „Wyślij do chmury AI" aktywny po **1,5 s** od WYRENDEROWANIA
  payloadu (nie od utworzenia okna), przy trafieniu twardym dodatkowo
  wymagane pole „widzę oznaczone fragmenty i świadomie je wysyłam"
  (`ackChecked`); „Odrzuć"; Esc = Odrzuć; Enter niczego nie zatwierdza (zero
  przycisku domyślnego); zamknięcie okna = Odrzuć. Wariant `write_outcome`:
  pasek informacyjny (nie czerwony) i przycisk „Zapisz w aplikacji" – tekst
  wg §6.6 projektu, z oznaczeniem nadpisania („zastąpi istniejący Wynik 3").
  Wariant `list_*`: układ kompaktowy, payload = dokładny zwarty JSON listingu
  (ten, który wyjdzie – §4; ŻADNEJ pomocniczej tabelki, jedna prawda).
- Dziennik sesyjny (§6.7 projektu): tablica w RAM procesu głównego
  `{czas, narzędzie, mcpLabel, liczba znaków, decyzja, połączenie}` (bufor
  200 wpisów). Do UI jedzie jako pole `recent` w `pii:bridge:status`
  (ostatnie 50, bez treści payloadów – same metadane); osobny kanał
  `pii:bridge:log` ODRZUCONY (lista kanałów R-6 zostaje zamknięta na pięciu).
  Zero plików (decyzja 4).

**Testy:** `gate-queue.test.js` (vitest, laptop): FIFO, limit 5, cisza po
odmowie (w tym granica 60 s), dedup wiszącego, timeout 180 s (fake timers),
auto-odrzut przy wstrzymaniu; teksty komunikatów błędów – literalna zgodność
z `errors.mjs`. E2e okna (PC, po M7/M8 harness): approve / reject / Esc /
zamknięcie okna / timeout / anulowanie / checkbox wymuszony – sterowane CDP.

**Kryteria:** C-BR-6, C-BR-7 (część okna), C-BR-11, C-BR-16.
**Laptop-safe: logika kolejki TAK; okno – PC.** Bramka Opusa: tak (serce W2).

### M5 – renderer: `src/mcp/tool-catalog.js`, `src/mcp/bridge-ipc.js`, szew w `src/main.js`, preload B

**Zakres:** wg R-2 i R-6. Dodatkowo:

- `electron/preload-bridge.cjs` – preload B: zawiera DOKŁADNIE to, co
  `preload.cjs` (A), plus zamrożony `window.desktopApp.bridge` (R-6).
  Mechanizm doklejenia: `session.registerPreloadScript` z bootstrapu mostu
  (O-6) – pomiar na Electronie 43 W TYM MODULE, zanim cokolwiek zależnego
  powstanie; fallback (bierny punkt rozszerzenia w `main.mjs`) WYMAGA osobnej
  zgody Opusa, bo łamie „zero zmian w plikach A" (§6.1).
- Walidacja nadawcy wszystkich kanałów R-6 (wzorzec S-IPC-1 jest warunkiem
  wejścia – jest już wdrożony na `pii:desktop-info`, kopiujemy wzorzec).
- Widget stanu mostu (montowany przez `bridge-ipc.js`): wskaźnik
  „Most AI: wstrzymany / aktywny (połączenia: N, zatwierdzone: X,
  odrzucone: Y, auto-odmowy: Z)", przycisk „Włącz most"/„Wstrzymaj most",
  przycisk „Skopiuj konfigurację dla klienta AI" (JSON z `exePath` ze
  statusu), zwijana lista `recent`. Stan błędu (EADDRINUSE, brak
  `%LOCALAPPDATA%`) – czytelny komunikat, bez retry w pętli.

**Testy:** `tool-catalog.test.js` (kształt katalogu: 5 narzędzi, schematy,
`bridgeNote` wszędzie); `bridge-ipc.test.js` (jsdom: exec→result dla
wszystkich 5 narzędzi na stanie referencyjnym – wyniki bajt w bajt równe
wynikom builderów `listings.js`; walidacja `write_outcome` lustrzana wobec
WebMCP; ŻADEN wynik nie zawiera wartości z `legend` – test z legendą-kanarkiem:
unikalny string w legendzie nie występuje w żadnym `result`); snapshot web:
rejestracje WebMCP przed/po przejściu na katalog – identyczne stringi.
Build: `npm run build` (web) i `desktop:build:renderer` (A) przechodzą;
grep `pii:bridge:` w `dist/` i `dist-desktop/` = 0 (pomiar DCE – pierwszy
twardy punkt kontrolny R-2; jeśli FAIL → plan zapasowy P-2 §10, wrócić do
bramki). `npm run eval` – bez wpływu (pipeline nietknięty), smoke A bez zmian.

**Kryteria:** C-BR-9 (legenda bez ścieżki serializacji – test kanarkowy),
C-BR-10 (schematy w main – patrz M6/M3: walidacja przed `exec`), O-6
zmierzone. **Laptop-safe: testy jednostkowe TAK; buildy i smoke – PC.**
Bramka Opusa: tak (IPC + sąsiedztwo legendy).

### M6 – `electron/bridge/adapter-main.mjs`, `mcp-stdio.mjs`, `errors.mjs`

**Zakres:**

- **`electron/main-bridge.mjs`** (punkt wejścia B; formalnie w M7, kontrakt
  tu): PIERWSZA linia logiki: `process.argv.includes('--bridge-adapter')`?
  → **dynamiczny** `import('./bridge/adapter-main.mjs')` i NIC więcej.
  W przeciwnym razie → rejestracja bootstrapu mostu (stan WSTRZYMANY,
  zero serwera – R-1) + **dynamiczny** `import('./main.mjs')`.
  Import `main.mjs` MUSI być dynamiczny: moduł wykonuje na imporcie
  `registerAppScheme`, `app.enableSandbox`, `requestSingleInstanceLock` –
  statyczny import uruchomiłby GUI-ścieżkę także w trybie adaptera (pułapka
  §5.4/§7.1 projektu, tu zoperacjonalizowana).
- `adapter-main.mjs` – tryb adaptera: NIE woła `requestSingleInstanceLock`,
  nie rejestruje schematów, nie czyta modeli, nie tworzy okien, nie czeka na
  `app.whenReady` (żadne API okienkowe nieużywane);
  `app.disableHardwareAcceleration()` + `--disable-gpu` dla kosztu RAM
  (pomiar O-10 w M8); **przekierowanie `console.log` na stderr** w tym trybie
  (stdout jest kanałem protokołu); koniec procesu przy zamknięciu stdin
  (klient sprząta – standard stdio MCP) i przy `SIGTERM`.
- `mcp-stdio.mjs` – minimalny serwer MCP (bez SDK – O-11): `initialize`
  (negocjacja `protocolVersion`: stała `SUPPORTED_PROTOCOL_VERSION`,
  odpowiedź wg specyfikacji przy niezgodności), `ping`, `tools/list`
  (katalog z R-3: `description + bridgeNote`), `tools/call` (ramka `tool`
  na potok; wynik z ramki `result`), `notifications/cancelled` (ramka
  `cancel`), `notifications/progress` co 10 s (R-7). Capabilities: wyłącznie
  `tools`. Framing stdio: NDJSON zgodny z transportem stdio MCP. Parser
  odporny: nieznana metoda = błąd JSON-RPC `-32601`; ramka niebędąca JSON =
  błąd bez echa treści.
- `errors.mjs` – ZAMKNIĘTA lista komunikatów (O-7): wszystkie stringi
  literalne, zero interpolacji treści dokumentów i nazw prywatnych;
  dozwolone interpolacje wyłącznie: `id` żądania (walidowany wcześniej,
  ≤128 znaków, `[A-Za-z0-9-]`) i liczby. Komunikaty (minimum): „aplikacja
  nieuruchomiona albo most wstrzymany" (R-1), „użytkownik odmówił" (z
  instrukcją nie-ponawiania, §6.4), „brak decyzji w wyznaczonym czasie",
  „kolejka zatwierdzeń pełna", „nieznane narzędzie", „nieprawidłowe argumenty",
  „dokument niegotowy / nie istnieje / bez encji / bez tokenów" (parytet
  z `listings.js` – te wracają z builderów), „ramka za duża", „most
  wstrzymany w trakcie oczekiwania". Test anty-interpolacyjny: żaden szablon
  nie zawiera `${` poza dozwolonymi polami; przegląd listy = pozycja bramki.
- **Walidacja żądań w procesie głównym** (konsument tych samych schematów
  z katalogu): `name` ∈ zamknięta lista 5; `args` dokładnie wg schematu
  (typy, limity: `id` ≤128, `label` ≤200, `text` ≤2 MiB; pola nadmiarowe =
  odrzucenie) – PRZED `pii:bridge:exec`, ręczna walidacja (bez ajv, zero
  zależności). C-BR-10.

**Testy:** złote transkrypty JSON-RPC (`mcp-stdio.test.js`: initialize/ping/
tools/list/tools/call happy-path + błędy + cancelled + progress; wejście i
oczekiwane wyjście jako pliki fixture); test „app-down" (brak pliku
sesyjnego → stały błąd R-1); **test czystości stdout**: pełna sesja na
strumieniach udawanych – stdout zawiera WYŁĄCZNIE poprawne ramki JSON-RPC
(parser wszystkiego, zero linii spoza protokołu); **test stderr-dyscypliny**:
payload-kanarek (unikalny string w treści narzędzia) nie występuje w stderr
(C-BR-12). Walidacja żądań: tabela przypadków złych argumentów.

**Kryteria:** C-BR-10, C-BR-12, C-BR-15 (tryb adaptera nie dotyka
single-instance – test: uruchomienie adaptera przy działającym GUI nie
podnosi okna i nie zabija procesu; wykonalny w pełni w M8, statycznie tu:
brak wywołania w grafie adaptera), C-BR-17 (nowa pozycja: stdout adaptera
niesie wyłącznie JSON-RPC). **Laptop-safe: TAK** (strumienie udawane;
prawdziwy spawn binarki – M8). Bramka Opusa: tak (granica G6).

### M7 – wariantowość buildów: `main-bridge.mjs`, konfigi, asercje artefaktów

**Zakres:**

- `vite.config.electron-bridge.js` – owija `vite.config.electron.js`
  (wszystkie transformy i asercje A dziedziczone: strip WebMCP, strip
  fontów/BMC, `assertNoRemoteUrls`), plus: `VITE_PII_BRIDGE=1`, emisja
  `gate-window/**` (R-5), `outDir: 'dist-desktop-bridge'`.
- `electron-builder.bridge.yml` – osobny target: tożsamość z R-8;
  `extraMetadata.main: electron/main-bridge.mjs`; `files`: jak A, plus
  `dist-desktop-bridge/**` zamiast `dist-desktop/**`, plus `electron/bridge/**`,
  `electron/main-bridge.mjs`, `electron/preload-bridge.cjs`, plus zamknięta
  piątka `src/**` z R-3; te same `extraResources` (modele + kotwica
  manifestu – bramka integralności modeli obowiązuje w B identycznie);
  ten sam `afterPack: scripts/afterpack-fuses.cjs` (fuses IDENTYCZNE z A –
  żadnego osłabienia w wariancie z mostem); `perMachine: true`,
  `allowToChangeInstallationDirectory: false`, `publish: null`,
  `azureSignOptions` – ten sam profil podpisu co A (B4 obejmuje obie binarki);
  reguła zapory outbound-block z `build/installer.nsh` – TAK, również w B
  (most nie potrzebuje sieci; blokada zapory nie widzi nazwanych potoków,
  więc niczego nie psuje, a trzyma obietnicę „zero ruchu wychodzącego").
- `electron-builder.yml` (A) – JEDYNA zmiana w plikach A: wykluczenia
  w `files`: `!electron/bridge/**`, `!electron/main-bridge.mjs`,
  `!electron/preload-bridge.cjs`, `!src/**` (jawnie, choć src nigdy nie było
  w `files` – asercja §6 i tak to sprawdza; wpis dokumentuje intencję).
- `scripts/assert-variant-artifacts.mjs` – asercje §6.2, wpinane na koniec
  OBU skryptów build (`desktop:build` i `desktop:build:bridge`) – build,
  który nie przejdzie asercji, wywraca się (fail-fast jak `assertNoRemoteUrls`).
- `package.json`: skrypty `desktop:build:renderer:bridge`,
  `desktop:build:bridge`, `desktop:smoke:bridge` (lustrzane), `main` bez
  zmian (A).

**Testy/kryteria:** C-BR-13, C-BR-14 (fuses B odczytane `@electron/fuses read`
i porównane automatycznie z A); oba instalatory budują się obok siebie;
`desktop:smoke`, `desktop:smoke:packaged`, `desktop:smoke:offline` na A –
zielone bez modyfikacji; asercje §6 zielone w obu kierunkach.
**Laptop-safe: NIE** (pełne buildy + modele). Bramka Opusa: tak (W4).

### M8 – e2e mostu + matryca klientów + pomiary

**Zakres:** `e2e/desktop-bridge-smoke.mjs` – fałszywy klient stdio (skrypt
Node spawnujący spakowaną binarkę B z `--bridge-adapter`) ↔ potok ↔ aplikacja
B (spakowana, sterowana CDP jak `desktop-smoke.mjs --packaged`; okno bramki
odnajdywane po tytule/URL `gate.html`):

Scenariusze obowiązkowe:

1. pełny happy-path `list_sources` → `read_source` → `write_outcome` →
   `read_outcome`, każdy przez bramkę (klik w „Wyślij"/„Zapisz" przez CDP po
   odczekaniu aktywacji przycisku);
2. **test hashy „pokazane = wysłane"** (§4): trzy punkty pomiaru zgodne;
3. reject / Esc / zamknięcie okna / timeout (skrócony konfiguracyjnie dla
   testu – jawny parametr testowy, nieobecny w produkcie) / anulowanie
   przez klienta → `isError`, zero treści;
4. cisza po odmowie: powtórka żądania ≤ 60 s → auto-odmowa bez okna;
5. app-down: adapter bez aplikacji → stały błąd R-1; wstrzymanie mostu
   w trakcie wiszącej bramki → auto-odrzut + błąd;
6. payload-kanarek: unikalny string z dokumentu źródłowego występuje
   WYŁĄCZNIE w: oknie bramki i ramce zatwierdzonej odpowiedzi; nie występuje
   w: stderr adaptera, pliku sesyjnym, statusach, dzienniku `recent`;
   drugi kanarek w legendzie nie występuje NIGDZIE poza aplikacją;
7. **licznik blokad sieci = 0 po pełnym przebiegu mostu** (strażnik §3 nie
   widzi żadnego ruchu – potok nie jest ruchem URL-loadera);
8. próba połączenia z potokiem bez sekretu (symulowany obcy proces) →
   rozłączenie, zero payloadu, wpis błędu auth;
9. fuses: `EnableNodeCliInspectArguments` OFF na B – sterowanie wyłącznie CDP
   (to samo ograniczenie co A – potwierdzenie, że hartowanie nie zelżało);
10. pomiar RAM adaptera (O-10): rezydentna pamięć procesu adaptera po
    `initialize` + 10 min bezczynności; raport do decyzji „zostawić /
    plan B Node SEA".

Matryca klientów (ręczna, raport w `docs/bridge.md`): Claude Desktop
(obowiązkowo), Cowork i Codex wg O-MOST-3; per klient: konfiguracja wg §7.4,
`tools/list` widoczny, wywołanie z bramką, zachowanie przy 180 s namysłu
(keep-alive skuteczny?), zachowanie przy odmowie i timeout'cie.

**Kryteria:** wszystkie scenariusze zielone na SPAKOWANYM B; raport matrycy;
pomiar RAM. **Laptop-safe: NIE.** Bramka Opusa: tak (dowód całości).

---

## §4. Gwarancja „pokazane = wysłane" (W2/O-9) – konstrukcja i dowód

**Tor danych odpowiedzi (`read_*`, `list_*`):**

1. Renderer (builder `listings.js`) → `pii:bridge:result` → proces główny:
   `payloadText` (jeden string).
2. Proces główny: walidacja kształtu + skan (M4) na TYM stringu; żadnych
   transformacji (zero trim, zero reformatowania, zero normalizacji końców
   linii – bajty wchodzą, bajty wychodzą).
3. Okno bramki: `getPayload()` zwraca TEN SAM string; DOM renderuje go przez
   `textContent`.
4. Po „Wyślij": ramka `result` serializuje TEN SAM string w polu
   `content[0].text` (koperta JSON-RPC jest deterministyczna i nie dotyka
   treści – `JSON.stringify` escapuje, nie modyfikuje).

**Trzy punkty pomiaru testu hashy (M8):** SHA-256 z (a) wartości `getPayload()`
w oknie bramki (evaluate przez CDP), (b) `textContent` elementu podglądu
(dowód, że DOM pokazuje całość – pilnuje regresji „skróconego podglądu"),
(c) pola `content[0].text` ramki odczytanej przez fałszywego klienta.
`hash(a) == hash(b) == hash(c)` – inaczej FAIL. Dla `list_*` payloadem jest
zwarty JSON listingu – pokazywany dosłownie (R-5/M3), te same trzy punkty.

**Tor `write_outcome` (kierunek „do środka"):** bramka PRZED wykonaniem
(payload przychodzi z zewnątrz; renderer nie jest dotykany przed decyzją):
walidacja schematu → skan M4 na `text` → bramka „Zapisz" pokazuje dokładnie
`label` + `text` od LLM-a → po zatwierdzeniu `pii:bridge:exec` wykonuje
`createOutcome`/`updateOutcomeFields` → odpowiedź stała `{id, success:true}`
(id = UUID, syntetyczny z konstrukcji). Odpowiedź nie przechodzi przez DRUGĄ
bramkę: decyzją była zgoda na zapis, a odpowiedź nie niesie treści – należy
do zamkniętej listy odpowiedzi stałych (O-7), co test literalnie sprawdza
(odpowiedź zawiera wyłącznie pola `id`, `success`).

**Domknięcie „nie istnieje ścieżka bez decyzji" (C-BR-6):** jedyne miejsce
zapisu na potok w kierunku odpowiedzi narzędziowych to funkcja wysyłki
wołana z dokładnie dwóch miejsc: (a) rozstrzygnięcie bramki, (b) generator
błędów stałych `errors.mjs`. Test e2e „odpowiedź wisi do kliknięcia" +
przegląd grafu wywołań na bramce Opusa.

---

## §5. Skan kontrolny PII – kalibracja klas (M4)

Źródło wzorców: `findRegexEntities` (R-3) – bez modyfikacji pipeline'u.
Podział trafień (propozycja do zatwierdzenia – O-MOST-4):

| Klasa | Typy (`entity_group`) | Zachowanie bramki |
|---|---|---|
| **Twarda** (identyfikatory z sumą kontrolną / jednoznaczne strukturalnie) | PESEL/NIP/REGON/KRS (`PERSON_IDENTIFIER`/`ORGANIZATION_IDENTIFIER` ze ścieżek numerycznych), `BANK_ACCOUNT_IDENTIFIER` (IBAN/NRB), `EMAIL_ADDRESS`, `PHONE_NUMBER`, dowód osobisty, paszport | czerwone podświetlenie + WYMUSZONE pole „widzę oznaczone fragmenty i świadomie je wysyłam" |
| **Miękka** (kształty wieloznaczne, częste legalnie w payloadzie) | `FINANCIAL_AMOUNT`, `DOCUMENT_REFERENCE` (sygnatury), `VEHICLE_IDENTIFIER`, `LAND_REGISTER_IDENTIFIER` | żółte podświetlenie, bez pola wyboru |

Uzasadnienie podziału: kwoty i sygnatury bywają ŚWIADOMIE pozostawione
w tekście tokenizowanym (użytkownik steruje kategoriami) – wymuszony checkbox
przy każdej kwocie wytresowałby odruch klikania (SB-4, habituacja) i zabił
wartość checkboxa tam, gdzie naprawdę chroni (surowy PESEL w payloadzie =
zawsze incydent). Kalibracja liczbowo: test M4 na korpusie syntetycznym
mierzy odsetek payloadów z trafieniem twardym (oczekiwane ≈ 0 na poprawnie
stokenizowanych) – wynik wchodzi do raportu bramki M4.

Skan działa na obu kierunkach (wyjście `read_*`/`list_*`, wejście
`write_outcome`). Trafienie NIGDY nie blokuje automatycznie (poza asercją
tokenów – §3 M4); ostatnim decydentem jest człowiek z wymuszonym podglądem
(S-MCP-1/R1: bramka jest kontrolą, nie ozdobą).

---

## §6. Wariantowość i dowód nietkniętego A

### 6.1 Zamknięta lista zmian w plikach współdzielonych/A

| Plik | Zmiana | Wpływ na artefakt A |
|---|---|---|
| `electron-builder.yml` | tylko wykluczenia `!electron/bridge/**`, `!electron/main-bridge.mjs`, `!electron/preload-bridge.cjs`, `!src/**` | żaden (wykluczenia plików, których A i tak nie miał) |
| `src/main.js` | rejestracje WebMCP czytają z `tool-catalog.js` (te same stringi) + jedna gałąź za `VITE_PII_BRIDGE` (R-2) | bundle: DCE usuwa gałąź; katalog wchodzi jak dziś literały; zachowanie identyczne (snapshot + smoke) |
| `package.json` | nowe skrypty `desktop:*:bridge` | żaden (A używa starych) |
| **`electron/main.mjs`, `preload.cjs`, `network-guard.mjs`, `app-protocol.mjs`, pozostałe `electron/**` A** | **ZERO zmian (git diff pusty)** | bajt w bajt |

Wszystko inne to NOWE pliki, nieobecne w A. Jeżeli O-6 wymusi fallback
(punkt rozszerzenia w `main.mjs`) – wyjście poza tę listę wymaga osobnej
zgody Opusa (deklarowane z góry, żeby nie „doklejało się" po cichu).

### 6.2 Asercje artefaktów (`scripts/assert-variant-artifacts.mjs`, fail-fast w obu buildach)

**A jest czysty:**

- lista plików `app.asar` NIE zawiera: `electron/bridge/`, `main-bridge.mjs`,
  `preload-bridge.cjs`, ŻADNEGO `src/**`, `gate.html`;
- zawartość asara + `dist-desktop/**` NIE zawiera stringów: `\\.\pipe\`,
  `pii:bridge:`, `bridge-session.json`, `--bridge-adapter`, `gate-preload`;
- `package.json` w asarze: `main: electron/main.mjs`;
- `dist-desktop/webmcp.js` nie istnieje (istniejąca gwarancja B2 – bez zmian).

**B jest kompletny i nieosłabiony:**

- asar zawiera dokładnie oczekiwany zestaw plików mostu + piątkę `src/**`
  z R-3 (lista zamknięta – nadmiarowy plik `src/**` = FAIL, żeby lista nie
  puchła po cichu);
- `main: electron/main-bridge.mjs`; `dist-desktop-bridge/gate.html` obecny;
  `dist-desktop-bridge/webmcp.js` NIE istnieje (strip WebMCP działa też w B);
- fuses B odczytane z binarki == fuses A (porównanie automatyczne,
  C-BR-14); `publish: null`; podpis obu binarek tym samym CN.

### 6.3 Definicja dowodu „wariant A nietknięty" (zaostrzenie O-12)

Trzy warstwy, od najtwardszej:

1. **Bajt w bajt tam, gdzie bajty są porównywalne:** wszystkie pliki
   `electron/**` używane przez A – git diff pusty (6.1), więc w asarze A
   identyczne co do bajta z main sprzed mostu. Dowód: porównanie hashy per
   plik `asar extract` A-przed vs A-po.
2. **Treściowo:** asercje 6.2 (zero symboli/stringów mostu w A).
3. **Behawioralnie:** `desktop:smoke`, `desktop:smoke:packaged`,
   `desktop:smoke:offline` – zielone bez modyfikacji testów (definicja
   z §8.3 projektu).

**Plus eksperyment determinizmu bundla (G-M-4):** zbudować `dist-desktop/`
(A) z main sprzed gałęzi mostu i z gałęzi mostu (ten sam Node, te same
`node_modules` z lockfile) i porównać file-by-file. Wynik A: identyczne
bajty → do GATE-MOST wchodzi NAJMOCNIEJSZA forma („artefakt A bajt w bajt,
łącznie z bundlem renderera") i zostaje stałym testem wydania. Wynik B:
różnice → różnice muszą być wyjaśnialne co do jednej (oczekiwane źródło:
przesunięcia minifikatora po dodaniu importu katalogu w `main.js`), żaden
chunk nie zawiera symboli mostu, i obowiązuje definicja trzywarstwowa wyżej
(zgodna z zaakceptowanym kierunkiem O-12 „behawioralnie + artefaktowo").
Eksperyment jest tani (dwa buildy renderera) i wykonany JEDNOKROTNIE w M5,
powtórzony na spakowanych artefaktach w M7.

### 6.4 Niezmienniki sieciowe (O-5)

- **C-NET-6 (wariant A):** bez zmian, wreszcie z egzekucją: test statyczny
  z M2 (zero importów modułów sieciowych w całym `electron/` A; w gałęzi
  mostu pliki `bridge/**` są poza zasięgiem builda A, co potwierdza asercja
  6.2) – domyka S-NET-4.
- **C-NET-6b (wariant B):** `node:net` wyłącznie w `pipe-server.mjs` i
  `pipe-client.mjs`; wyłącznie ścieżki `\\.\pipe\` (asercja runtime + test);
  `node:http|https|dns|tls|dgram|child_process` – zakaz w obu wariantach,
  egzekwowany tym samym testem statycznym.
- Licznik blokad strażnika po pełnym przebiegu mostu = 0 (G-M-5): most nie
  generuje ŻADNEGO ruchu widzianego przez `webRequest` – potok żyje w
  procesie głównym, poza stosem URL-loadera.

---

## §7. Podział laptop-safe vs wymagające Electrona/paczki

Konwencja sprzętowa (MEMORY): PC = stacjonarny (32 GB), laptop = 15,4 GB.
Buildy z modelami i smoke'i spakowane – tylko PC. Nic z poniższego nie
odpala evala ani modeli NER (skan M4 to czyste regexy).

| Moduł | Laptop (vitest / czysty Node) | PC (Electron / build / paczka) |
|---|---|---|
| M1 plik sesyjny | całość | – |
| M2 potok + auth + framing | całość, z prawdziwymi `\\.\pipe\` i testem O-2 | – |
| M4 skan kontrolny | całość (regexy + korpus syntetyczny) | – |
| M3 bramka | `gate-queue.mjs` (maszyna stanów, fake timers) | okno bramki e2e (CDP) |
| M5 renderer | `tool-catalog`, `bridge-ipc` (jsdom), snapshot web | buildy A/web, grep DCE, smoke A, pomiar O-6 |
| M6 adapter | złote transkrypty, stdout/stderr-dyscyplina, walidacja | spawn spakowanej binarki (w M8) |
| M7 wariantowość | przegląd konfigów | dwa pełne buildy + asercje + fuses |
| M8 e2e + matryca | skrypt fałszywego klienta (sam w sobie) | całość przebiegów, RAM, matryca klientów |

Sekwencyjnie: M1+M2+M4+M3(logika)+M6(logika) są w całości do zrobienia
i zbramkowania na laptopie; pierwszy twardy punkt PC to pomiar O-6/DCE w M5;
drugi – M7/M8.

---

## §8. GATE-MOST – bramka wydania wariantu B (kryteria, najostrzejsze)

Werdykt per wariant (§10.1 projektu): A może wyjść niezależnie; B wychodzi
wyłącznie, gdy WSZYSTKIE pozycje PASS (odstępstwa: wyłącznie jawne, podpisane,
per pozycja – jak w `SECURITY-CHECKLIST.md`).

| ID | Kryterium | Dowód |
|---|---|---|
| G-M-1 | Wariant A behawioralnie nietknięty | `desktop:smoke` + `:packaged` + `:offline` zielone bez modyfikacji testów |
| G-M-2 | Pliki A bajt w bajt | git diff `electron/**` pusty (poza nowymi plikami wykluczonymi z A); hash per plik asara A przed/po – identyczne dla wszystkich plików A |
| G-M-3 | A czysty z mostu | asercje 6.2 w buildzie A (lista plików + grep stringów) |
| G-M-4 | Determinizm bundla A zmierzony | eksperyment 6.3; wynik A → test stały „bundle bajt w bajt"; wynik B → raport różnic wyjaśnionych + zero symboli mostu |
| G-M-5 | Zero egress | licznik blokad = 0 po pełnym przebiegu mostu (M8 scenariusz 7); reguła zapory obecna w B; `assertNoRemoteUrls` zielony na `dist-desktop-bridge` |
| G-M-6 | Pokazane = wysłane | test hashy 3-punktowy (§4) zielony na SPAKOWANYM B |
| G-M-7 | Brak ścieżki bez decyzji | scenariusze reject/timeout/zamknięcie/anulowanie/wstrzymanie → `isError` bez treści; przegląd grafu wywołań funkcji wysyłki (dwa źródła: bramka, błędy stałe); „odpowiedź wisi do kliknięcia" |
| G-M-8 | Auth szczelny | testy M2 (złe MAC-i, timeout, throttle, podsłuch bez sekretu); sekret nieobecny bajtowo w ramkach; M8 scenariusz 8 na spakowanym B |
| G-M-9 | Niezmienniki sieciowe | C-NET-6 (A, z egzekucją) i C-NET-6b (B) zielone; fuses B == A (`@electron/fuses read`, porównane skryptem) |
| G-M-10 | Adapter zdyscyplinowany | złote transkrypty; stdout wyłącznie JSON-RPC (C-BR-17); kanarek treści nieobecny w stderr (C-BR-12); zero plików na dysku poza odczytem pliku sesyjnego; tryb adaptera nie dotyka single-instance (C-BR-15) |
| G-M-11 | Tylko tokeny przez granicę | kanarek legendy nieobecny we WSZYSTKICH punktach poza aplikacją (M8 scenariusz 6); asercja tokenów odrzuca payload bez tokenów (test z podstawionym wynikiem); payloady zawierają wyłącznie `mcpLabel`, nigdy `label` (test na fixture z rozbieżnymi nazwami) |
| G-M-12 | Skan kontrolny działa | korpus M4: klasy twarde/miękkie wg §5; wstrzyknięte surowe PII podświetlone + checkbox wymuszony; zero automatycznych blokad poza asercją tokenów |
| G-M-13 | Łańcuch dostaw bez zmian | `package.json` diff: zero nowych zależności runtime; zero `node_modules` w paczce B (C-PKG-2 dla B); obie binarki podpisane tym samym CN (B4) |
| G-M-14 | Dokumentacja spójna | `SECURITY.md` §10a, `THREAT-MODEL.md` (G5/G6, SB-*, RB-*), `SECURITY-CHECKLIST.md` rozdział 9 (C-BR-1…17) z profilem wariantowym, `docs/bridge.md` (konfiguracja, granica odpowiedzialności, RB-5), korekta języka S-MCP-1 w `CLAUDE.md`/`docs/webmcp.md` |
| G-M-15 | Matryca klientów + koszt | raport M8: Claude Desktop przechodzi pełny przepływ z bramką i keep-alive 180 s; pomiar RAM adaptera odnotowany z decyzją (akceptacja / plan B SEA) |

Test ręczny nieusuwalny (rozszerzenie istniejącego): fizyczny tryb samolotowy →
instalacja B → pełny przebieg dokumentu → włączenie mostu → wywołanie z
prawdziwego Claude Desktop → bramka → praca na tokenach → `write_outcome` →
deanonimizacja lokalna. Wireshark w tle: zero pakietów aplikacji.

---

## §9. Decyzje otwarte dla Alana (O-MOST-*)

Decyzje 1–5 z `PRODUCT-DECISIONS.md` pozostają wiążące i NIE są tu ponownie
otwierane. Nowe rozstrzygnięcia wymagające zdania Alana:

| ID | Decyzja | Rekomendacja planu |
|---|---|---|
| **O-MOST-1** | Tożsamość techniczna B: `executableName` bez spacji i „+" (`LokalnyAnonimizatorAI.exe`) przy marketingowym `productName` „Lokalny anonimizator + AI"; `appId` `pl.kolkowski.lokalny-anonimizator-ai`; slug `%LOCALAPPDATA%\LokalnyAnonimizatorAI` | przyjąć jak w R-8 (ścieżki w konfiguracjach klientów MCP bez pułapek cytowania; katalog instalacji może zostać marketingowy) |
| **O-MOST-2** | Trwałość stanu „most włączony" między uruchomieniami aplikacji | NIE zapamiętywać: każdy start = WSTRZYMANY (ścisła litera decyzji 2; świadome włączenie per sesja; most otwarty tylko wtedy, gdy użytkownik wie, że jest otwarty) |
| **O-MOST-3** | Zakres matrycy klientów w v1 (G-M-15) | Claude Desktop obowiązkowo (blokuje wydanie); Cowork – jeśli dostępny na maszynie testowej; Codex – opcjonalnie, po wydaniu; matryca jest rozszerzalna bez zmian w kodzie |
| **O-MOST-4** | Podział klas skanu kontrolnego (§5): które typy wymuszają pole wyboru | jak w tabeli §5 (twarde: PESEL/NIP/REGON/KRS/IBAN/e-mail/telefon/dowód/paszport; miękkie: kwoty/sygnatury/rejestracje/KW) – kalibrowane przeciw habituacji SB-4 |

Status rejestru projektowego O-1…O-12 po tym planie (dla bramki Opusa):

| O | Status w planie |
|---|---|
| O-1 (kompensacja DACL protokołem) | podtrzymane bez zmian (§4.4 projektu); do akceptacji Opusa |
| O-2 (`FIRST_PIPE_INSTANCE`) | test empiryczny wpisany w M2 (laptop-safe, przed jakąkolwiek integracją) |
| O-3 (protokół auth) | doprecyzowany w M2 (konteksty, rozmiary, timeouty, throttle); do akceptacji |
| O-4 (potoki a SMB) | opis §4.5 projektu przyjęty do `docs/bridge.md`; opcjonalny test zdalny poza zakresem v1 |
| O-5 (C-NET-6b) | egzekucja trzywarstwowa skonkretyzowana (M2 + 6.4); do akceptacji |
| O-6 (`registerPreloadScript`) | pomiar w M5 PRZED zależnymi pracami; fallback = wyjście poza listę 6.1, wymaga osobnej zgody |
| O-7 (zamknięta lista błędów) | zmaterializowana jako `errors.mjs` + test anty-interpolacyjny (M6); lista do przeglądu na bramce M6 |
| O-8 (timeout/keep-alive) | NADPISANE decyzją 5: 180 s + progress co 10 s (R-7); kalibracja per klient w M8 |
| O-9 (pokazane = wysłane) | konstrukcja + trzy punkty pomiaru (§4); test w M8 |
| O-10 (adapter = binarka B) | podtrzymane; `disableHardwareAcceleration` + pomiar RAM w M8; próg decyzyjny: brak twardego progu, decyzja Alana po liczbie (plan B: Node SEA, §7.5 projektu, architektura niezmienna) |
| O-11 (zero-dep MCP) | podtrzymane; katalog narzędzi jako jedno źródło (R-2) zastępuje test porównawczy; złote transkrypty + matryca M8 |
| O-12 (interpretacja „A jak dziś") | ZAOSTRZONE: definicja trzywarstwowa + eksperyment determinizmu (6.3); litera „bajt w bajt" osiągnięta wszędzie poza bundlem renderera, a i tam mierzona zamiast zakładana |

---

## §10. Pułapki implementacyjne dla Sonneta (zapisane, żeby nie odkrywać ich w kodzie)

- **P-1. Dynamiczny import `main.mjs`.** `electron/main.mjs` wykonuje logikę
  na imporcie (schemat `app://`, `enableSandbox`, single-instance lock).
  W `main-bridge.mjs` rozgałęzienie argv MUSI poprzedzać `await import`;
  statyczny import na górze pliku = adapter odpala GUI-ścieżkę. Test M6
  łapie to grafem importów (adapter-main nie może osiągać main.mjs).
- **P-2. Plan zapasowy dla DCE (R-2).** Jeśli grep `pii:bridge:` w
  `dist-desktop/` (A) ≠ 0 po M5: przejść na osobne entry
  `src/main-bridge-entry.js` (import `./main.js` + import `bridge-ipc.js`)
  podmieniane w HTML transformem builda B; uchwyty stanu przez malutki
  rejestr `src/mcp/bridge-registry.js` (main.js woła `publishBridgeState(...)`
  bezwarunkowo – w A nikt nie subskrybuje, stringi kanałów zostają w
  `bridge-ipc.js`, który w grafie A nie istnieje). Kontrakt bezpieczeństwa
  bez zmian; wrócić do bramki z pomiarem.
- **P-3. `app.getPath('userData')` wskazuje roaming** – plik sesyjny liczyć
  od `process.env.LOCALAPPDATA` z fail-closed (R-1/M1). Nie używać
  `app.setPath` do „przestawienia" – za szerokie skutki.
- **P-4. Stdout adaptera jest protokołem.** Każdy zabłąkany `console.log`
  (także z zależności Electrona) psuje framing. Przekierowanie console na
  stderr w trybie adaptera + test czystości stdout (M6). Chromium loguje na
  stderr; nie włączać `--enable-logging`.
- **P-5. NDJSON a treść payloadu.** Nie pisać własnego escapowania –
  `JSON.stringify` gwarantuje brak surowych `\n` w ramce. Test asercyjny,
  nie kod obronny.
- **P-6. Okno bramki a fokus.** `flashFrame(true)` + `restore()`, nigdy
  `focus()` kradnący pierwszy klik (użytkownik mógłby kliknąć „Wyślij"
  wpisując spację w innym programie – dlatego też opóźnienie 1,5 s liczy się
  od wyrenderowania payloadu, a Enter nic nie zatwierdza).
- **P-7. Timeout testowy bramki.** 180 s w e2e = wolny test; parametr
  skracający MUSI być jawnym argumentem konstrukcyjnym `gate-queue`
  (wstrzykiwanym w teście), nie zmienną środowiskową czytaną w produkcie
  (zmienna środowiskowa = wektor manipulacji timeoutem).
- **P-8. Piątka `src/**` w asarze B (R-3).** Import względny `../../src/…`
  liczy się od `electron/bridge/` – działa w repo i asarze, bo `files`
  zachowuje układ katalogów. Test statyczny pilnuje zamkniętej listy
  importów (nowy import w `anonymizer.js` sięgający poza listę = czerwony
  test w M4, decyzja świadoma zamiast cichego rozrostu paczki B).
- **P-9. Współbieżność A i B.** Oba warianty mogą działać równolegle (osobne
  `userData` przez osobne `productName` → osobne single-instance locki).
  Plik sesyjny należy wyłącznie do B; A nie zna jego ścieżki (asercja 6.2:
  string `bridge-session.json` nieobecny w A).
- **P-10. `second-instance` w B.** Uruchomienie binarki B bez flagi przy
  działającym GUI B = standardowe podbicie okna (jak A, C-WIN-6: argv nie
  jest interpretowane). Uruchomienie Z flagą nie dotyka locka w ogóle (M6).
  Nie dopisywać obsługi flagi w `second-instance` – nie ma czego obsługiwać.
- **P-11. Kolejność merge.** Prace hardeningowe A wymienione w §12 projektu
  jako warunki wstępne są na main już zamknięte (S-IPC-1, S-NET-4 domyka M2,
  S-LOG-1 obowiązuje jako dyscyplina logów mostu – origin/metadane, nigdy
  treść). Jedyna żywa kolizja to scope-tiers (R-4): jeśli `integration/sprint`
  scali się PRZED mostem, M5 musi przejść na wtedy-obowiązującą wersję
  builderów `listings.js` (kontrakt bez zmian – buildery pozostają jedynym
  producentem payloadów).

---

## §11. Definicja ukończenia

Most jest „gotowy do wydania", gdy: (1) M1–M8 scalone, każdy po bramce Opusa;
(2) GATE-MOST §8 w całości PASS z werdyktem wpisanym do
`SECURITY-CHECKLIST.md` (rozdział 9, profil wariantowy); (3) decyzje
O-MOST-1…4 rozstrzygnięte przez Alana i odnotowane w `PRODUCT-DECISIONS.md`;
(4) dokumentacja G-M-14 zaktualizowana; (5) test ręczny nieusuwalny wykonany
na fizycznej maszynie z prawdziwym Claude Desktop.

*Koniec planu. Następny krok: bramka Opusa nad §2 (R-1…R-8), §5, §6 i listą
O-1…O-12/§9; decyzje Alana O-MOST-1…4; potem implementacja kartami §3
w kolejności M1 → M2 → M4 → M3 → M5 → M6 → M7 → M8.*
