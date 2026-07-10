# SECURITY.md — model bezpieczeństwa aplikacji desktopowej „Lokalny anonimizator"

Aplikacja przetwarza materiał objęty tajemnicą zawodową radcy prawnego. Zasada
nadrzędna: **air-gap by construction** — aplikacja nie ma żadnej ścieżki
wysłania danych do sieci, a każde zabezpieczenie jest domyślne, nie opcjonalne.

**Precyzyjnie, czym ta gwarancja jest (i czym nie jest).** To nie jest izolacja
na poziomie systemu operacyjnego ani zapory sieciowej: proces Electrona ma
gniazda sieciowe jak każdy proces. Gwarancję realizują cztery współdziałające
warstwy, każda wystarczająca sama w sobie w normalnym działaniu:

1. **Brak kodu wywołującego sieć** — cała aplikacja czyta modele i zasoby
   z dysku (§2, §4); moduł `net` Electrona nie jest nawet importowany.
2. **Blokada żądań w procesie** — `webRequest.onBeforeRequest` anuluje każdy
   schemat spoza allow-listy, w tym `http:`, `https:`, `ws:`, `wss:` (§3).
3. **Content-Security-Policy** bez jakiegokolwiek źródła zdalnego, z osobną
   dyrektywą `webrtc 'block'` (§6).
4. **Wyłączone kanały omijające warstwę URL-loadera** — WebRTC i usługi
   fonujące Chromium, wyłączone przełącznikami przed startem (§3).

Jedyny sankcjonowany kanał na zewnątrz to `shell.openExternal` dla linków
pomocy, ograniczony do **zbioru dokładnych URL-i** (§5).

Ten dokument mapuje każde zabezpieczenie na miejsce w kodzie i uzasadnienie.
Numery sekcji (§) są przywoływane w komentarzach w kodzie. Dokument jest
podstawą przyszłego, twardego audytu (etap 2) — sekcja §14 zbiera świadomie
odłożone decyzje.

---

## §1. Izolacja renderera

**Gdzie:** `electron/main.mjs` → `createMainWindow()` → `webPreferences`.

| Ustawienie | Wartość | Po co |
|---|---|---|
| `contextIsolation` | `true` | kod strony nie ma dostępu do świata preloadu |
| `nodeIntegration` | `false` | zero Node.js w rendererze |
| `nodeIntegrationInWorker` / `InSubFrames` | `false` | jw., także w workerach i ramkach |
| `sandbox` | `true` | proces renderera w sandboksie OS |
| `webSecurity` | `true` | same-origin policy egzekwowana |
| `allowRunningInsecureContent` | `false` | brak mieszanych treści |
| `spellcheck` | `false` | Chromium nie pobiera słowników z sieci |
| `devTools` | tylko poza buildem spakowanym (lub `PII_DEBUG=1`) | brak konsoli w produkcji |

Dodatkowo `app.on('web-contents-created')` hartuje **każdy** powstały
`webContents` (`hardenWebContents()`), a `will-attach-webview` odrzuca
`<webview>` w całości.

## §2. Protokół `app://` — jedyne źródło treści

**Gdzie:** `electron/app-protocol.mjs` (rejestracja + handler), instalacja w
`electron/main.mjs`.

Renderer jest serwowany wyłącznie z własnego, uprzywilejowanego schematu
`app://app/` (`standard: true, secure: true, supportFetchAPI: true,
stream: true, allowServiceWorkers: false`). Dzięki temu:

- strona ma stabilny, bezpieczny origin (działają module workery, `fetch()`,
  `CacheStorage`, Web Locks, `localStorage` — jak na https),
- **service workery są wyłączone** (mniejsza powierzchnia ataku),
- handler serwuje wyłącznie trzy drzewa plików, tylko `GET`/`HEAD`, z ochroną
  przed path traversal (`safeJoin()`):
  - `app://app/<asset>` → `dist-desktop/` (zbudowany renderer),
  - `app://app/local-models/<f>` → `resources/models/ner/<f>` (modele NER),
  - `app://app/ocr-models/<f>` → `resources/models/ocr/<f>` (modele OCR),
- każda odpowiedź niesie `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-origin` oraz COOP/COEP
  (`same-origin` / `credentialless`) — te same nagłówki, które wdrożenie
  webowe serwuje przez `public/_headers`; bez nich wielowątkowy WASM
  ONNX Runtime (SharedArrayBuffer) nie działa,
- dokumenty HTML dostają nagłówek CSP (§6).

Ścieżki `/local-models/` i `/ocr-models/` celowo odwzorowują prefiksy znane z
konfiguracji webowej (`vite.config.js`), więc kod renderera jest identyczny
w obu wydaniach.

## §3. Blokada sieci na poziomie procesu (kluczowa)

**Gdzie:** `electron/network-guard.mjs` → `installNetworkGuard()`, instalacja
na `session.defaultSession` w `electron/main.mjs`.

`webRequest.onBeforeRequest` odrzuca **każde** żądanie, którego schemat nie
znajduje się na liście dozwolonych: `app:`, `blob:`, `data:`, `devtools:`,
`chrome:`, `about:`. W szczególności odrzucane są `http:`, `https:`, **a także
`ws:` i `wss:`** (WebSocket WebMCP — patrz §10). Lista jest pozytywna
(allow-list), więc nowe/egzotyczne schematy są domyślnie blokowane.

**Licznik zablokowanych żądań**: strażnik zlicza odrzucenia globalnie i per
origin (`getNetworkBlockStats()`), loguje pierwsze trafienia verbatim, a stan
licznika jest dostępny w rendererze przez `window.desktopApp.getInfo()` (§4).
To pozwala **udowodnić** „zero wyjścia do sieci": w teście dymnym
(`e2e/desktop-smoke.mjs`) licznik po pełnym przebiegu anonimizacji + OCR +
eksportu musi wynosić `0` — czyli nic nawet nie *próbowało* wyjść.

**Uwaga o zakresie `webRequest`:** widzi on wyłącznie ruch idący przez
URL-loader Chromium. **Nie widzi WebRTC** (surowy UDP/ICE). Zmierzone na
Electronie 43: przy domyślnej polityce zbieranie kandydatów ICE zwraca
kandydata `srflx`, czyli pakiety STUN **naprawdę opuszczają maszynę**.
Dlatego `hardenWebContents()` w `electron/main.mjs` ustawia na każdym
`webContents`:

```js
contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
```

Bez skonfigurowanego proxy daje to **zero kandydatów ICE** — żaden pakiet UDP
nie wychodzi. To jest właściwa kontrola. Warstwy uzupełniające:
- `electron/preload.cjs` usuwa `RTCPeerConnection` i pokrewne z głównego świata
  strony (świeży realm, np. ramka `about:blank`, wciąż je ma — dlatego to
  tylko głębia obrony, nie kontrola podstawowa),
- CSP niesie `webrtc 'block'` — w Chromium 150 **jeszcze nieegzekwowane**,
  zadeklarowane na przyszłość (§6).

Test dymny sprawdza jedno i drugie: brak API w głównym świecie **oraz** zero
kandydatów ICE nawet po odzyskaniu konstruktora z ramki.

Żeby licznik faktycznie pokazywał zero, build desktopowy usuwa z HTML jedyne
odwołania zdalne aplikacji webowej (Google Fonts, skrypt i slot
Buy-Me-a-Coffee) — `vite.config.electron.js` → `desktopHtmlTransform()`.
Reguły są **fail-fast**: jeśli upstream zmieni HTML tak, że wzorzec przestanie
pasować, build pada zamiast po cichu przemycić odwołanie zdalne. Dodatkowo
`assertNoRemoteUrls()` skanuje cały `dist-desktop/` po buildzie i **przerywa
build**, gdy jakikolwiek automatycznie pobierany zasób (`<link href>`, `src=`,
CSS `url()`) wskazuje na zdalny origin. Linki nawigacyjne (`<a href>`) są
raportowane i w runtime podlegają §5.

Uzupełnienia:
- `setSpellCheckerEnabled(false)` — brak pobierania słowników,
- przełączniki Chromium przed startem: `disable-background-networking`,
  `disable-component-update`, `disable-domain-reliability`,
- moduł `net` Electrona **nie jest importowany** w kodzie aplikacji,
- brak jakiegokolwiek klienta auto-update i telemetrii (§11).

## §4. Preload i IPC — minimalna powierzchnia

**Gdzie:** `electron/preload.cjs`, rejestracja kanału w `electron/main.mjs`.

Preload (sandboksowany, CommonJS) wystawia przez `contextBridge` **jeden**
zamrożony obiekt `window.desktopApp` z dwoma polami:
- `isDesktop: true`,
- `getInfo()` → `ipcRenderer.invoke('pii:desktop-info')` — jedyny kanał IPC,
  wyłącznie do odczytu (wersje, licznik blokad §3).

Zero surowego `ipcRenderer`, zero `send`/`on`, zero dynamicznych nazw kanałów.
W procesie głównym obsługiwany jest wyłącznie `ipcMain.handle('pii:desktop-info')`.

## §5. Nawigacja, nowe okna, linki zewnętrzne

**Gdzie:** `electron/main.mjs` → `hardenWebContents()`; polityka linków w
`electron/main-links.mjs` (testy: `electron/main-links.test.js`).

- `will-navigate`: dozwolona wyłącznie nawigacja wewnątrz originu aplikacji
  (`app://app/…`, np. narzędzie ↔ strona informacyjna); wszystko inne
  `preventDefault()` — dotyczy to też upuszczenia pliku na okno.
- `setWindowOpenHandler`: **zawsze** `deny`. Wyjątek: URL-e z listy
  `EXTERNAL_LINK_ALLOWLIST` są otwierane w przeglądarce systemowej przez
  `shell.openExternal`, wyłącznie w reakcji na kliknięcie użytkownika. Nic nie
  jest otwierane automatycznie.

**`shell.openExternal` to jedyna ścieżka aplikacji do internetu** (przeglądarka
systemowa działa poza strażnikiem §3), dlatego dopasowanie jest **dokładne, na
zbiorze pełnych URL-i**, a nie prefiksowe:

- `startsWith('https://nodejs.org/')` przepuściłby `https://nodejs.org/leak?d=<PESEL>`,
- nawet reguła origin + prefiks ścieżki przepuściłaby
  `https://github.com/wjarka/pii-anonymizer/<PESEL>` — **ścieżka niesie dane
  równie dobrze jak query**.

Dodatkowo odrzucane są URL-e z `?query`, poświadczeniami i schematem innym niż
`https:`. Każdy link, który UI potrafi wygenerować, jest stałym ciągiem, więc
zbiór jest kompletny; dopisanie wpisu poszerza jedyny sankcjonowany kanał
wyjścia i wymaga świadomej decyzji.

## §6. Content-Security-Policy renderera

**Gdzie:** `electron/app-protocol.mjs` → stała `CSP` (dokumenty HTML z
`app://`); w trybie dev dokłada ją `onHeadersReceived` w `electron/main.mjs`.

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'report-sample';
worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:;
font-src 'self' data:; connect-src 'self' blob: data:; media-src 'none';
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';
webrtc 'block'
```

- **żadnych źródeł zdalnych** w żadnej dyrektywie, w tym `connect-src`
  (brak `ws:`/`wss:` — patrz §10). To `connect-src` (a nie strażnik §3)
  zatrzymuje `fetch()` z renderera do zdalnego originu — żądanie ginie, zanim
  dotrze do `webRequest`,
- `webrtc 'block'` — w Chromium 150 **nieegzekwowane**; realną blokadą jest
  polityka UDP z §3. Dyrektywa zostaje na przyszłość,
- `'wasm-unsafe-eval'` — kompilacja WASM (ONNX Runtime, OpenCV),
- **`'unsafe-eval'` — udokumentowane odstępstwo:** SDK PaddleOCR inicjalizuje
  OpenCV.js także na głównym wątku, a jego glue Emscripten/embind buduje
  funkcje przez `new Function` — bez tego OCR (funkcja krytyczna) umiera z
  naruszeniem CSP. Ryzyko jest ograniczone: `script-src 'self'` nie dopuszcza
  żadnego obcego kodu, a blokada §3 wyklucza eksfiltrację. TODO(etap-2):
  przenieść OpenCV wyłącznie do workera SDK albo załatać glue i usunąć
  `'unsafe-eval'` ze strony,
- skrypty `.js`/`.mjs` dostają **osobny nagłówek CSP dla workerów**
  (`WORKER_CSP` w `electron/app-protocol.mjs`): workery biorą politykę z
  odpowiedzi, która dostarczyła ich skrypt, dokumenty ten nagłówek ignorują,
- `worker-src blob:` — heic-to tworzy worker z `blob:`; `connect-src blob:
  data:` — PaddleOCR czyta tary modeli z `blob:`, OpenCV ładuje WASM z
  `data:`,
- `style-src 'unsafe-inline'` — istniejące atrybuty `style=""` w UI forka
  (TODO(etap-2): rozważyć zaostrzenie po refaktorze UI).

CSP jest drugą warstwą — pierwszą jest blokada §3.

## §7. Uprawnienia

**Gdzie:** `electron/network-guard.mjs` (`setPermissionRequestHandler`,
`setPermissionCheckHandler`).

Domyślnie odrzucane jest **wszystko** (kamera, mikrofon, geolokalizacja,
powiadomienia, HID, midi, …). Świadomy, udokumentowany wyjątek:
`clipboard-read` i `clipboard-sanitized-write`, wyłącznie dla originu
aplikacji. Uzasadnienie: własne przyciski aplikacji („Kopiuj" tokenizowany
tekst, „Wklej" wynik LLM w zakładce Deanonimizuj) działają na lokalnym
schowku po jawnym kliknięciu — to parytet z aplikacją webową i zero ruchu
sieciowego. Bez tego wyjątku zakładka Deanonimizuj traci główny przepływ.

## §8. Electron Fuses — hartowanie samej binarki

**Gdzie:** `scripts/afterpack-fuses.cjs` (hook `afterPack` electron-buildera,
konfiguracja w `electron-builder.yml`).

| Fuse | Wartość | Po co |
|---|---|---|
| `RunAsNode` | off | `ELECTRON_RUN_AS_NODE` nie zmieni aplikacji w node.exe |
| `EnableNodeCliInspectArguments` | off | brak `--inspect` na produkcyjnej binarce |
| `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` ignorowane |
| `OnlyLoadAppFromAsar` | on | kod aplikacji tylko z archiwum asar |
| `EnableEmbeddedAsarIntegrityValidation` | on | asar walidowany kryptograficznie |
| `EnableCookieEncryption` | on | magazyn cookies szyfrowany kluczem OS |
| `GrantFileProtocolExtraPrivileges` | off | `file://` bez przywilejów (używamy `app://`) |

## §9. Legenda deanonimizacji (klucz token → dane)

**Stan obecny (etap podwalin):** legenda i oryginały żyją wyłącznie w pamięci
JavaScript sesji renderera (stan `src/main.js` + pamięciowy cache workera
`src/worker-cache.js` — LRU, 20 wpisów, nietrwały). Aplikacja niczego nie
zapisuje na dysk: zamknięcie okna = utrata legendy (świadomie; `main.mjs`
zamyka aplikację przy zamknięciu ostatniego okna, także na macOS).
Deanonimizacja wykonuje się wyłącznie lokalnie w UI (`src/ui/deanon-workspace`).

**Co trwale zapisuje Chromium:** `localStorage` originu `app://app` trzyma
wyłącznie preferencje UI (`pii.selected-entities`, `pii.allow-gpu`,
`pii.preload-*`) oraz — po użyciu WebMCP — `webmcp_token` (sesja mostka,
wygasa po 5 min). Nie zawiera ani legendy, ani treści dokumentów.

**TODO(etap-2, decyzja produktowa):** jeżeli trwałość legendy okaże się
potrzebna (np. wznowienie pracy nad paczką dokumentów), dopuszczalna jest
wyłącznie trwałość lokalna i szyfrowana (Electron `safeStorage` → klucz w
magazynie OS), z czyszczeniem przy zamknięciu. Do tego czasu: pamięć ulotna.

## §10. WebMCP / transport MCP na desktopie — decyzja odłożona

Integracja WebMCP forka (5 narzędzi: `list_sources`, `read_source`,
`list_outcomes`, `read_outcome`, `write_outcome`) jest **zachowana w kodzie
i UI** (`public/webmcp.js`, `src/mcp/`, przycisk „Podłącz AI"), ale na
desktopie **połączenie jest nieaktywne**, bo:

- blokada §3 odrzuca `ws:`/`wss:` (WebMCP łączy się WebSocketem z lokalnym
  mostkiem `@jason.today/webmcp`),
- CSP §6 nie zawiera `ws:` w `connect-src`.

Uwaga zanotowana podczas mapowania: `public/webmcp.js` potrafi wznowić
połączenie **bez interakcji użytkownika** przy starcie strony (token z
`localStorage`, ważny 5 min) i łączy się z **dowolnym** adresem zaszytym we
wklejonym tokenie. To zła właściwość dla narzędzia air-gap.

**TODO(mcp-transport): projekt transportu MCP na desktopie do decyzji
architektonicznej (etap 2).** Opcje do rozważenia: (a) wyjątek w blokadzie §3
wyłącznie dla `ws://127.0.0.1:<port>` po jawnej zgodzie użytkownika,
(b) natywny transport stdio w procesie głównym zamiast WebSocketu,
(c) brak MCP w desktopie. Nie usuwać kodu WebMCP.

## §11. Telemetria i auto-update: brak

- Zero telemetrii, zero analityki, zero kont i chmury — w kodzie nie ma
  żadnego klienta ani endpointu.
- Zero auto-update: brak `electron-updater`/Squirrel, a `electron-builder.yml`
  ma `publish: null`. Aktualizacje wyłącznie ręcznie (nowy instalator).
  Ewentualny mechanizm aktualizacji w przyszłości musi przejść przez decyzję
  architektoniczną (konflikt z air-gap).

## §12. Tryb deweloperski — jedyny wyjątek od blokady

`scripts/dev-desktop.mjs` uruchamia Vite (port 5183) i Electrona z
`PII_DEV_SERVER_URL`. Wtedy — i tylko wtedy — strażnik §3 przepuszcza origin
dev-servera (log ostrzegawczy `DEV MODE`). **Build spakowany ignoruje tę
zmienną** (`app.isPackaged` w `electron/main.mjs`), więc produkcyjnej binarki
nie da się nakłonić zmienną środowiskową do załadowania originu http.

## §12a. Integralność startu i pojedyncza instancja

**Gdzie:** `electron/main.mjs`, `scripts/verify-models.mjs`.

- **Jedna instancja** (`requestSingleInstanceLock()`): dwa procesy dzielące
  profil Chromium w `%APPDATA%` ścigałyby się o `localStorage` (preferencje) i
  cache modeli OCR. Druga instancja podnosi istniejące okno i kończy pracę.
- **Twarde błędy startu są widoczne**: brak zbudowanego renderera lub katalogu
  modeli kończy się `dialog.showErrorBox` i wyjściem, a nie `console.error`
  (spakowana aplikacja GUI nie ma konsoli, a bez modeli i tak zawisłaby na
  uzgadnianiu z workerem).
- **Bramka integralności modeli** (`npm run desktop:verify-models`, wpięta w
  `desktop:build`) blokuje spakowanie przerwanego pobrania: sprawdza brak
  plików `.part`, rozmiary i sumy SHA-256 z `models/manifest.json`.

## §13. Jak to zweryfikować

1. `npm run desktop:fetch-models` (jednorazowo; jedyny moment, w którym
   *narzędzia deweloperskie* — nie aplikacja — pobierają pliki; provenance
   z sumami SHA-256 ląduje w `models/manifest.json`).
2. `npm run desktop:verify-models` — bramka integralności: brak plików `.part`,
   zgodne rozmiary i sumy SHA-256. Wpięta w `desktop:build`, więc przerwane
   pobieranie nie trafi do instalatora. `manifest.json` jest też **jedynym
   źródłem prawdy o wariancie ONNX** — `vite.config.electron.js` czyta z niego
   `dtype`, zamiast polegać na drugiej, niezależnie ustawianej zmiennej.
3. `npm run desktop:build:renderer` — build pada, jeśli reguła usuwania
   zdalnych tagów przestanie pasować albo w `dist-desktop/` zostanie
   automatycznie pobierany zasób zdalny (`assertNoRemoteUrls`).
4. `npm test` — m.in. `electron/main-links.test.js`: whitelist linków odrzuca
   pod-ścieżki, look-alike i URL-e niosące dane.
5. `npm run desktop:smoke` — test dymny w trybie produkcyjnym (app://):
   boot UI, anonimizacja wklejonego tekstu na modelach lokalnych (INT8), OCR
   skanu PDF offline, eksport DOCX, oraz dowody egress:
   - `networkBlock.blockedTotal === 0` po pełnym przebiegu (aplikacja nie
     próbowała nic wysłać),
   - kanarek z procesu głównego zostaje anulowany (`ERR_BLOCKED_BY_CLIENT`)
     i **podbija licznik** — dowód, że licznik nie jest „na sztywno zero",
   - `typeof RTCPeerConnection === 'undefined'` w głównym świecie,
   - **zero kandydatów ICE** nawet po odzyskaniu konstruktora ze świeżej ramki.
6. `npm run desktop:smoke:packaged` — ten sam zestaw, ale na **spakowanej
   binarce** (`release/win-unpacked/…exe`, `app.asar` + `resources/models`),
   czyli w układzie, który dostaje użytkownik. Uwaga: spakowana binarka ma
   wyłączony fuse `EnableNodeCliInspectArguments`, więc Playwright nie podepnie
   się przez `--inspect` — test steruje nią przez CDP, a stan procesu głównego
   czyta mostem preloadu. Kanarek §3 działa tylko w trybie repo (jawny `SKIP`).
7. `npm run desktop:smoke:offline` — **kryterium „tryb samolotowy"**: ta sama
   spakowana binarka uruchomiona z `--host-resolver-rules=MAP * ~NOTFOUND`,
   czyli przy całkowitym braku rozwiązywania DNS. Pełny przebieg (anonimizacja,
   OCR, eksport DOCX) przechodzi bez zmian — bez ruszania kartą sieciową hosta.
8. Test ręczny: fizyczny tryb samolotowy → instalacja z `release/…exe` →
   pełny przebieg.

## §14. Świadomie odłożone (rejestr dla audytu — etap 2)

- **Model zagrożeń i pełny audyt** — poza zakresem podwalin.
- **Transport MCP na desktopie** — §10.
- **Trwałość legendy** — §9 (dziś: brak trwałości).
- **Podpis kodu Windows** — miejsce przygotowane w `electron-builder.yml`
  (TODO(podpis-kodu)); bez podpisu SmartScreen będzie ostrzegał.
- **Build macOS** — architektura go nie blokuje (fuses hook obsługuje darwin);
  target świadomie nieskonfigurowany.
- **`'unsafe-eval'` w CSP strony** — wymuszone przez glue OpenCV w SDK
  PaddleOCR (§6). Do usunięcia po przeniesieniu OpenCV wyłącznie do workera.
- **Zaostrzenie CSP** (`style-src` bez `'unsafe-inline'`) po zmianach w UI.
- **`session.setProxy` na czarną dziurę / `enableNetworkEmulation`** — dziś
  zbędne (webRequest + CSP + polityka UDP + brak kodu wywołującego sieć), ale
  tanie do dołożenia jako kolejna warstwa.
- **Świeży realm omija usunięcie WebRTC z API** (ramka `about:blank`) — egress
  i tak zablokowany polityką UDP (§3); do rozważenia twardsze wyłączenie
  WebRTC na poziomie budowania Chromium.
- **Czyszczenie profilu Chromium przy zamknięciu** (cache OCR w CacheStorage
  zawiera wyłącznie publiczne tary modeli, nie dane użytkownika — mimo to do
  przeglądu).

### Zweryfikowane i naprawione w tym etapie (nie są już otwarte)

Wynik wieloagentowego przeglądu z adwersaryjną weryfikacją (4 wymiary
× refutacja każdego znaleziska):

| Znalezisko | Status |
|---|---|
| WebRTC omijał blokadę sieci (ICE wysyłał pakiety STUN — potwierdzone pomiarem) | naprawione, §3 |
| Whitelist linków na `startsWith` przepuszczała URL-e niosące dane i look-alike | naprawione, §5 (zbiór dokładnych URL-i) |
| `MODEL_DTYPE` i `VITE_MODEL_DTYPE` rozjechane → build żądał nieistniejącego wariantu | naprawione, §13 (manifest = źródło prawdy) |
| Brak bramki integralności → instalator z obciętym modelem | naprawione, §12a |
| Ciche `console.error` przy braku renderera/modeli | naprawione, §12a (dialog + exit) |
| Brak single-instance lock | naprawione, §12a |
| `desktopHtmlTransform` po cichu nic nie usuwał przy zmianie upstreamu | naprawione, §3 (fail-fast + `assertNoRemoteUrls`) |
| Test dymny nigdy nie dotykał spakowanej aplikacji | naprawione, §13 (`desktop:smoke:packaged`) |
| Martwy import `net` w `app-protocol.mjs` | usunięty |
| `fetch-models` zostawiał pliki `.part` i mylnie porównywał rozmiar skompresowany | naprawione |

Odrzucone jako fałszywe alarmy (zweryfikowane empirycznie): niespójność fuses
z walidacją asar (integralność jest osadzana **przed** hookiem `afterPack`;
na Windows zasób PE nazywa się `ElectronAsar`, nie `ElectronAsarIntegrity`),
DevTools rzekomo włączane przez `PII_DEBUG` w spakowanej binarce (flaga włącza
jedynie *możliwość*, nic ich nie otwiera), `build/icon.ico` rzekomo psujące
świeży build, oraz wzorzec `models/` w `.gitignore` rzekomo blokujący merge
z upstreamu (git nie stosuje `.gitignore` do plików śledzonych).
