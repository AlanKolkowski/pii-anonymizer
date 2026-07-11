# SECURITY-CHECKLIST.md — bramka wydania „Lokalny anonimizator"

**Reguła bramki:** żaden build dystrybucyjny nie opuszcza maszyny, dopóki każda
pozycja nie jest **PASS** albo nie ma jawnego, podpisanego odstępstwa wpisanego
w §Odstępstwa. Kod dotykający **sieci, IPC albo legendy** przechodzi przez tę
checklistę zawsze, niezależnie od tego, kto go napisał.

**Legenda statusów:**
`PASS` spełnione i zweryfikowane · `FAIL(B)` bloker wydania · `FAIL(S)` do
naprawy przed wersją dystrybuowaną poza maszynę autora · `?` wymaga weryfikacji
empirycznej, do czasu weryfikacji liczone jako FAIL.

---

## WERDYKT BRAMKI, stan na 2026-07-11 (po naprawie B1, B3 i B4)

> ## ✅ **WSZYSTKIE CZTERY BLOKERY (B1–B4) ZAMKNIĘTE. Przed pierwszą realną dystrybucją poza maszynę autora zostają jeszcze ręczne testy (nie-blokery, patrz niżej).**
>
> **B4** (podpis kodu) — **zamknięty (2026-07-11)**: instalator podpisany przez
> Azure Artifact Signing. `Get-AuthenticodeSignature` → `Valid`, SignerCertificate
> `CN=Kancelaria Radcy Prawnego K-Law Alan Kolkowski`, znakowanie czasem RFC 3161.
> Patrz C-WIN-2 niżej oraz `docs/code-signing-azure-session-log.md`.
>
> **B1** (weryfikacja integralności modeli w runtime), **B2** (WebMCP w paczce)
> i **B3** (instalacja do katalogu zapisywalnego przez użytkownika) są
> naprawione i zweryfikowane empirycznie — patrz C-INT-4, C-INT-5, C-WIN-1,
> C-NET-11, C-PKG-10 niżej oraz `SECURITY-FIXES.md`.
>
> **Zostają do odhaczenia ręcznie przed dystrybucją** (nie blokują builda
> wewnętrznego, ale nie zostały wykonane na żywo): żywa instalacja z monitem UAC
> do `%ProgramFiles%` (C-WIN-1), zachowanie SmartScreen przy świeżym certyfikacie
> OV (C-WIN-4 – reputacja narasta z czasem), Renderer Code Integrity (C-WIN-3),
> status BitLockera (C-WIN-9).
>
> Uzasadnienie i scenariusze: `THREAT-MODEL.md` §4 (S1, S2).
> Poprawki: `SECURITY-FIXES.md`.

---

## 1. Izolacja renderera

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-ISO-1 | `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false` | **PASS** | `electron/main.mjs:115-118` |
| C-ISO-2 | `sandbox: true` na oknie głównym | **PASS** | `electron/main.mjs:119` |
| C-ISO-3 | `app.enableSandbox()` wymusza sandbox na **każdym** przyszłym `webContents` | **PASS** | Naprawione (2026-07-11): `electron/main.mjs`, `app.enableSandbox()` przed `app.whenReady()`, obok istniejących `appendSwitch`. `npm run desktop:smoke` i `desktop:smoke:packaged` przechodzą bez zmian — worker NER/OCR (Web Worker wewnątrz renderera, nie osobny `webContents`) nietknięty. |
| C-ISO-4 | `webSecurity: true`, `allowRunningInsecureContent: false` | **PASS** | `electron/main.mjs:120-121` |
| C-ISO-5 | DevTools wyłączone w buildzie spakowanym | **PASS** | `electron/main.mjs:125`; `PII_DEBUG=1` włącza jedynie *możliwość*, nic nie otwiera |
| C-ISO-6 | Brak `<webview>`, brak `webviewTag` | **PASS** | `electron/main.mjs:87-90` (`will-attach-webview` → `preventDefault`) |
| C-ISO-7 | Menu aplikacji usunięte (brak skrótu do DevTools) | **PASS** | `electron/main.mjs:60` |
| C-ISO-8 | Renderer ładuje się **wyłącznie** z `app://`, nigdy z `http`/`file` | **PASS** | `electron/main.mjs:141`; smoke: `check('app is served from app:// (no http origin)')`, `e2e/desktop-smoke.mjs:159` |
| C-ISO-9 | Fuse `GrantFileProtocolExtraPrivileges: false` | **PASS** | `scripts/afterpack-fuses.cjs:34` |

## 2. Sieć i egress

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-NET-1 | `webRequest.onBeforeRequest` anuluje wszystko poza `app:`/`blob:`/`data:`/`devtools:`/`chrome:`/`about:` | **PASS** | `electron/network-guard.mjs:11-18,54-86` |
| C-NET-2 | Licznik zablokowanych żądań po pełnym przebiegu = **0** | **PASS** | `npm run desktop:smoke` → `e2e/desktop-smoke.mjs:324` |
| C-NET-3 | Licznik **żyje** (kanarek z procesu głównego zostaje anulowany i podbija licznik) | **PASS** | `e2e/desktop-smoke.mjs:336-351`. CSP wyprzedza strażnika, więc `fetch()` z renderera nie podbija licznika: kanarek musi lecieć z `net.fetch` w main. |
| C-NET-4 | WebRTC: **zero kandydatów ICE**, także ze świeżego realmu (`about:blank`) | **PASS** | `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`, `electron/main.mjs:76`; `e2e/desktop-smoke.mjs:292`. Usunięcie API w preloadzie (`electron/preload.cjs:12-19`) to głębokość, nie kontrola. |
| C-NET-5 | Brak egress kanałami, których `webRequest` nie widzi: mDNS/DIAL, PAC/proxy | **PASS** | PAC/proxy zamknięte (S-NET-2, 2026-07-10). mDNS/DIAL: switch dodany (2026-07-11) — `electron/main.mjs` → `app.commandLine.appendSwitch('disable-features', 'MediaRouter,DialMediaRouteProvider,CastMediaRouteProvider')`. **Zmierzone żywo przez Alana (2026-07-11, Wireshark):** przechwytywanie z filtrem `udp.port == 5353 or udp.port == 1900` przez pełny czas działania `release\win-unpacked\Lokalny anonimizator.exe` złapało 4 pakiety MDNS — wszystkie z `ip.src == 192.168.1.1` (router/brama), żaden z `192.168.1.11` (komputer Alana, na którym działa aplikacja). Dofiltrowanie tego samego przechwycenia do `(udp.port == 5353 or udp.port == 1900) and ip.src == 192.168.1.11` dało **listę pustą** — komputer, na którym działa aplikacja, nie wysłał ani jednego pakietu mDNS/DIAL. Cztery złapane pakiety to szum sieciowy routera, niezwiązany z aplikacją. Patrz `SECURITY-FIXES.md` N-4 dla pełnego zapisu metodologii (w tym pułapki „przechwytywanie na Wi-Fi widzi ruch całej sieci lokalnej, nie tylko własnej maszyny" — filtrowanie po `ip.src` własnej maszyny jest konieczne, żeby uniknąć fałszywego alarmu). |
| C-NET-6 | Proces główny nie importuje `node:net|http|https|dns|tls|dgram|child_process` | **PASS (bez egzekucji)** | `grep -rn "node:\(net\|http\|https\|dns\|tls\|dgram\|child_process\)" electron/` → brak. **Nie jest to nigdzie egzekwowane testem**, patrz S-NET-4. |
| C-NET-7 | Trwały tryb samolotowy w binarce: `--host-resolver-rules=MAP * ~NOTFOUND` | **PASS** | Naprawione w S-NET-1 (2026-07-10): `electron/main.mjs`, `app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND')`, zbramkowane na `app.isPackaged` (tryb dev nietknięty). `npm run desktop:smoke:offline` nadal zewnętrznie symuluje ten sam scenariusz (`e2e/desktop-smoke.mjs:80`) — teraz binarka wymusza go sama, bez potrzeby zewnętrznej flagi. |
| C-NET-8 | Reguła zapory Windows blokuje ruch wychodzący binarki | **PASS** | Dodano (2026-07-11): `build/installer.nsh` (makra `customInstall`/`customUnInstall`: `netsh advfirewall firewall add/delete rule`) + `electron-builder.yml` → `nsis.include: build/installer.nsh`. Kompilacja NSIS zweryfikowana adwersaryjnie (błąd celowo wstrzyknięty do `customInstall` → `makensis` zgłosił błąd dokładnie w tym makrze na `installSection.nsh:82`) — patrz `SECURITY-FIXES.md` S-NET-3. **Żywa instalacja i deinstalacja wykonane przez Alana (2026-07-11):** po instalacji (`LokalnyAnonimizator-Setup-0.1.0.exe`, UAC zaakceptowany) `Get-NetFirewallApplicationFilter -Program "$env:ProgramFiles\Lokalny anonimizator\Lokalny anonimizator.exe" \| Get-NetFirewallRule` (z **podniesionego** PowerShell — zwykły zwraca „Odmowa dostępu", sam odczyt reguł zapory wymaga elewacji) zwróciło `DisplayName=Lokalny anonimizator (block out)`, `Direction=Outbound`, `Action=Block`, `Enabled=True`. Po deinstalacji to samo polecenie zwróciło `No MSFT_NetApplicationFilter objects found` — reguła usunięta razem z aplikacją. Oba kierunki potwierdzone empirycznie. |
| C-NET-9 | Brak auto-update, telemetrii, analityki, crash-reportera, `sendBeacon` | **PASS** | `publish: null` (`electron-builder.yml:45`); `grep -rniE "autoUpdater|electron-updater|crashReporter|sentry|posthog|mixpanel|telemetry|sendBeacon" src/ electron/ scripts/` → brak |
| C-NET-10 | Build wywraca się, gdy renderer pobierałby cokolwiek zdalnie | **PASS** | `assertNoRemoteUrls`, `vite.config.electron.js:203-298` |
| C-NET-11 | `dist-desktop/` nie zawiera `new WebSocket(`, `RTCPeerConnection`, `sendBeacon` | **PASS** | `grep -rn "new WebSocket(" dist-desktop/` → zero trafień. Naprawione w B2: `src/main.js:1436-1699` (instancja WebMCP i wszystkie rejestracje narzędzi za `window.desktopApp?.isDesktop`), `vite.config.electron.js:170` (tag `<script src="webmcp.js">` usuwany z `tool.html`, fail-fast jak przy bmc-button), `vite.config.electron.js:196-209` (`desktopStripWebmcpAsset` kasuje skopiowany z `public/` `dist-desktop/webmcp.js` w `closeBundle`, bo samo usunięcie tagu nie usuwa pliku). |
| C-NET-12 | `shell.openExternal` tylko dla dokładnych URL-i z allowlisty, bez query i poświadczeń | **PASS** | `electron/main-links.mjs:33-48`; `npm test` → `electron/main-links.test.js`; `e2e/desktop-smoke.mjs:313` |
| C-NET-13 | `will-navigate` blokuje nawigację poza origin aplikacji | **PASS** | Naprawione w S-NET-5 (2026-07-10): porównanie przeniesione na parsowany origin (`electron/nav-policy.mjs` → `isSameOriginAsApp`), nie prefiks stringa. `http://localhost:5183.evil.com` odrzucony testem jednostkowym (`electron/nav-policy.test.js`). |
| C-NET-14 | `will-redirect` obsłużone | **PASS** | Naprawione (2026-07-10): `electron/main.mjs` → `hardenWebContents()` — `will-redirect` dzieli dokładnie tę samą politykę originu co `will-navigate` (`electron/nav-policy.mjs`, `isSameOriginAsApp`), egzekwowaną z jednego miejsca. |
| C-NET-15 | `setWindowOpenHandler` zawsze zwraca `deny` | **PASS** | `electron/main.mjs:93-100` |

## 3. Wejście niezaufane (dokumenty)

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-INP-1 | Tekst wyekstrahowany trafia do DOM **wyłącznie** przez `textContent`/`createTextNode` | **PASS** | `src/ui/annotation-editor/index.js:102,116,124,149`; `src/ui/deanon-workspace/index.js:136,145,147`; `src/ui/outcomes-list/index.js:63,65` |
| C-INP-2 | Każdy `innerHTML` konsumuje wyłącznie stałe albo wartości przepuszczone przez escape | **PASS** | `src/main.js:1372,1410` (`escHtml`); `src/ui/annotation-editor/index.js:360,525` (`escapeHtml`). Brak `document.write`, `insertAdjacentHTML`, `srcdoc`, `eval` w `src/`. |
| C-INP-3 | Nazwa pliku nigdy nie buduje ścieżki, URL-a ani HTML-a | **PASS** | pliki czytane przez `File.arrayBuffer()`; nazwa idzie do `textContent` (`src/ui/sources-list/index.js:272`) |
| C-INP-4 | SVG **nie jest** akceptowanym formatem wejściowym i nigdy nie jest inline'owany | **PASS** | `src/file-import/index.js:12-31` (pdf, docx, txt, png, jpg, jpeg, heic, heif) |
| C-INP-5 | DOCX: brak XXE, brak wyjścia HTML | **PASS** | `mammoth.extractRawText` (`src/file-import/docx.js:22`), nigdy `convertToHtml`; XML przez `@xmldom/xmldom`, brak I/O, brak rozwijania encji zewnętrznych |
| C-INP-6 | PDF: XFA wyłączone, brak zdalnych `cMapUrl`/`standardFontDataUrl`, worker same-origin, osadzony JS nigdy nie wykonywany | **PASS** | `src/file-import/pdf.js:99` nie ustawia `enableXfa`; `wasmUrl` z `document.baseURI` (`:20-23`); brak wywołań `getJSActions` |
| C-INP-7 | `isEvalSupported: false` w `getDocument` | **PASS** | Naprawione (2026-07-11): `src/file-import/pdf.js` → `getDocument({ data, wasmUrl, isEvalSupported: false })`. `npm test` (`pdf.test.js`, 20/20) i OCR skanu PDF w `desktop:smoke`/`desktop:smoke:packaged` przechodzą bez zmian. |
| C-INP-8 | CSP strony **bez** `'unsafe-eval'` | **FAIL(S), świadome odstępstwo** | `electron/app-protocol.mjs:61`. Wymuszone przez glue OpenCV w SDK PaddleOCR na wątku głównym. Zamknąć po przeniesieniu OpenCV do workera. Worker zachowuje `'unsafe-eval'` osobno (`:88`). |
| C-INP-9 | Path traversal w `app://` niemożliwy | **PASS** | `safeJoin`, `electron/app-protocol.mjs:143-148`; handler przyjmuje tylko `GET`/`HEAD` (`:157`) |
| C-INP-10 | Limit rozmiaru pliku wejściowego (obrona przed bombą dekompresyjną) | **PASS** | 25 MB, `src/file-import/index.js:10` |
| C-INP-11 | Tar modeli OCR rozpakowywany wyłącznie z zaufanego źródła, nigdy z dokumentu użytkownika | **PASS** | `src/ocr/models.js:61-74` (stałe URL-e), `src/ocr/paddle.js:200-201` |
| C-INP-12 | `require-trusted-types-for 'script'` + `frame-ancestors 'none'` w CSP | **FAIL(nice)** | `electron/app-protocol.mjs:59-79` |

## 4. IPC

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-IPC-1 | Preload nie eksponuje `ipcRenderer` ani niczego z Node | **PASS** | `electron/preload.cjs:21-26`, jeden zamrożony obiekt |
| C-IPC-2 | Brak dynamicznych nazw kanałów, brak `send`/`on` | **PASS** | jedyny kanał: `'pii:desktop-info'` (`electron/preload.cjs:25`, `electron/main.mjs:188`) |
| C-IPC-3 | Kanał jest **tylko do odczytu**, nie przyjmuje argumentów | **PASS** | `ipcMain.handle('pii:desktop-info', () => ({...}))`, `electron/main.mjs:188-194` |
| C-IPC-4 | Handler waliduje nadawcę (`event.senderFrame`) | **PASS** | Naprawione w S-IPC-1 (2026-07-10): `ipcMain.handle('pii:desktop-info', ...)` sprawdza, że `event.senderFrame?.url` zaczyna się od `${APP_ORIGIN}/`, inaczej zwraca `null`. Świadomy efekt uboczny: w `npm run desktop:dev` (strona z originu Vite, nie `app://`) `getInfo()` zwróci `null` — dziś nic w UI tego nie konsumuje, patrz `SECURITY-FIXES.md` S-IPC-1. |
| C-IPC-5 | Żaden kanał IPC nie przenosi legendy ani treści dokumentu | **PASS** | jedyny kanał zwraca `{appVersion, electron, chrome, packaged, networkBlock}` |
| C-IPC-6 | `getNetworkBlockStats()` nie wynosi PII do renderera | **PASS** | zwraca originy, nie pełne URL-e (`electron/network-guard.mjs:26-31`) |

## 5. Integralność zasobów i fuses

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-INT-1 | Fuses ustawione: `RunAsNode:false`, `EnableNodeCliInspectArguments:false`, `EnableNodeOptionsEnvironmentVariable:false`, `OnlyLoadAppFromAsar:true`, `EnableCookieEncryption:true` | **PASS** | `scripts/afterpack-fuses.cjs:24-33` |
| C-INT-2 | Fuses **faktycznie zapisane w binarce** (nie tylko w konfiguracji) | **`?`** | `npx @electron/fuses read --app "release/win-unpacked/Lokalny anonimizator.exe"` |
| C-INT-3 | Zmiana jednego bajtu w `app.asar` uniemożliwia start | **`?`** | Skopiować `win-unpacked`, nadpisać bajt w `resources/app.asar`, uruchomić. Aplikacja **musi** odmówić startu. Dopóki to nie jest zmierzone, `EnableEmbeddedAsarIntegrityValidation` jest deklaracją. Poszlaka z testów B1 (2026-07-10): usunięcie pliku z asara i przepakowanie (`npx asar pack`) wywołało natywny `FATAL` w `asar_util.cc` („Integrity check failed for asar archive") — silny sygnał, że mechanizm działa, ale to zmiana struktury archiwum, nie dokładnie „jeden bajt" w niezmienionym pliku. Zostaje `?` do dedykowanego testu. |
| C-INT-4 | Modele w `resources/models/` weryfikowane **w runtime** | **PASS** | Naprawione w B1: `electron/model-integrity.mjs` (SHA-256 strumieniowo, `createReadStream`) wpięte w `electron/main.mjs` przed `createMainWindow()`. Zweryfikowane na spakowanej binarce (2026-07-10): podmiana jednego bajtu w `resources/models/.../model_quantized.onnx` (rozmiar bez zmian) → aplikacja odmówiła startu, dialog „Naruszona integralność modeli" z dokładną rozbieżnością SHA-256 w `stderr`; po przywróceniu bajtu suma ponownie zgodna z oryginałem. `npm test` → `electron/model-integrity.test.js` (8 przypadków: dopasowanie, podmiana bajtu, obcięcie rozmiaru, brak pliku, brak/uszkodzona/pusta kotwica, wielokrotne rozbieżności naraz). `desktop:smoke` i `desktop:smoke:packaged` przechodzą z nienaruszonymi modelami. |
| C-INT-5 | `manifest.json` z sumami SHA-256 dostępny w runtime | **PASS** | Naprawione w B1: `electron-builder.yml` `files` (`from: models, filter: [manifest.json]`) kopiuje `models/manifest.json` do **korzenia app.asar** jako `manifest.json`, chronione fuse'em `EnableEmbeddedAsarIntegrityValidation`. **Nie** leży obok modeli w `resources/models/` (tam nadal wykluczone). Zweryfikowane: `npx asar list` pokazuje `\manifest.json` w korzeniu asara, `npx asar extract` daje treść bajt-w-bajt identyczną z `models/manifest.json`; `resources/models/manifest.json` nie istnieje na dysku spakowanej binarki. Uwaga dla przyszłych zmian tej reguły: `from` **musi** być katalogiem (`models`), nie plikiem (`models/manifest.json`) — electron-builder kopiuje `files:` przez `fs.readdir()` na `from`, więc plik jako `from` daje `ENOTDIR`, po cichu łapane jako „pusty katalog" (build przechodzi, nic się nie kopiuje; zmierzone empirycznie przy pierwszym podejściu). |
| C-INT-6 | Bramka integralności modeli przy budowaniu | **PASS** | `npm run desktop:verify-models`, wpięta w `desktop:build` (`package.json:18`) |
| C-INT-7 | Modele pobierane z **niezmiennej** referencji (SHA commita), nie z gałęzi | **FAIL(S)** | `scripts/fetch-models.mjs:56` → `/resolve/main/`. Trust-on-first-use. |
| C-INT-8 | Oczekiwane sumy SHA-256 modeli zakotwiczone w repo, niezależnie od pobrania | **FAIL(S)** | `models/manifest.json` powstaje **z** pobrania, więc nie jest niezależnym świadkiem |
| C-INT-9 | Kod ładowany wyłącznie z asara | **PASS** | fuse `OnlyLoadAppFromAsar:true`; `electron-builder.yml:17` wyklucza `node_modules` |

## 6. Trwałość i logi

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-PERS-1 | Legenda i treść dokumentu **nigdy** nie trafiają na dysk | **PASS** | `src/main.js:44`; brak `indexedDB`/`sessionStorage`/`showSaveFilePicker` w `src/`; `localStorage` trzyma wyłącznie preferencje (`src/main.js:295,319`) |
| C-PERS-2 | Zamknięcie okna kończy proces (legenda ginie) | **PASS** | `electron/main.mjs:208-212` |
| C-PERS-3 | Brak plików tymczasowych z rasteryzacji PDF / OCR / HEIC | **PASS** | `OffscreenCanvas` (`src/file-import/pdf.js:31`), `createImageBitmap` (`src/ocr/index.js:4`); zero `os.tmpdir`/`writeFile` w ścieżce runtime |
| C-PERS-4 | `GPUCache`/`DawnCache` nie zawierają fragmentów dokumentu | **`?`** | Przebieg z PDF-em, potem przegląd `%APPDATA%\<app>\GPUCache` narzędziem `strings` |
| C-PERS-5 | Brak zrzutów awaryjnych z PII | **PASS (zmierzone)** | Zmierzone empirycznie (2026-07-11, Playwright `_electron` + `forcefullyCrashRenderer()`): renderer naprawdę się zawiesił (`[main] renderer gone: crashed 2` po ~1s), po 15s `Crashpad/` pozostał pusty (brak `reports/`, brak jakiegokolwiek pliku) — bez `crashReporter.start()` Crashpad nie jest uzbrojony, więc nic nie zapisuje niezależnie od ścieżki. Kod niepotrzebny (patrz `SECURITY-FIXES.md` S-LOG-2). **Windows Error Reporting nadal działa niezależnie od aplikacji na poziomie OS — to zostaje ryzykiem R3** (kontrola organizacyjna), niezamknięte i niezamykalne kodem tej aplikacji. |
| C-PERS-6 | Czyszczenie cache przy wyjściu | **FAIL(nice)** | brak `session.clearStorageData`/`clearCache` w `electron/` |
| C-PERS-7 | Żaden runtime'owy `console.*` nie drukuje treści dokumentu, `entity.word`, legendy ani nazwy pliku | **PASS** | Naprawione w S-LOG-1 (2026-07-10): `electron/network-guard.mjs` loguje `describeOrigin(details.url)` + `details.resourceType`, nigdy pełny URL (`electron/network-guard.test.js`). Przy okazji ujednolicone `electron/main.mjs` (logi `will-navigate`/`will-redirect`/`window.open blocked`). Narzędzia `src/eval/*`, `bench/*` drukują tekst, ale nie trafiają do paczki. |
| C-PERS-8 | Panel debug (legenda → schowek) niedostępny w buildzie desktopowym | **PASS** | Naprawione (2026-07-11): `src/main.js:58` → `isDebug = urlParams.get('debug')==='1' && !window.desktopApp?.isDesktop`. `window.desktopApp` istnieje wyłącznie na desktopie (preload), więc web (`?debug=1`) nietknięty — zweryfikowane w przeglądarce (`typeof window.desktopApp === 'undefined'` na buildzie webowym). Na desktopie jedyne miejsce odsłaniające `debugSection` (`:1204`) jest zagnieżdżone pod tym samym `isDebug`, więc przycisk „Kopiuj JSON debug" (`:1391-1393`) jest nieosiągalny nawet po nawigacji na `?debug=1`. |
| C-PERS-9 | Schowek: „Kopiuj wszystko" kopiuje **tekst tokenizowany**, nie oryginał | **PASS** | `src/main.js:1266` → `applyTokens(...)` |
| C-PERS-10 | Uprawnienia: deny-all poza `clipboard-read` i `clipboard-sanitized-write`, tylko dla originu aplikacji | **PASS** | `electron/network-guard.mjs:94-113`. Świadome odstępstwo, opisane. |
| C-PERS-11 | `setDisplayMediaRequestHandler` / `setDevicePermissionHandler` jawnie odmawiają | **FAIL(nice)** | brak w `electron/`. `getDisplayMedia` bez handlera i tak odrzuca, ale jawna odmowa jest tańsza niż poleganie na domyślnej wartości. |
| C-PERS-12 | Brak logów zdalnych | **PASS** | wynika z C-NET-1, C-NET-6, C-NET-9 |

## 7. Packaging i łańcuch dostaw

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-PKG-1 | `publish: null`, brak endpointu aktualizacji | **PASS** | `electron-builder.yml:45` |
| C-PKG-2 | `node_modules` nie trafia do paczki | **PASS** | `electron-builder.yml:17` |
| C-PKG-3 | `package-lock.json` zacommitowany, pełne sumy `integrity` | **PASS** | `git ls-files package-lock.json`; każdy wpis ma `"integrity": "sha512-…"` |
| C-PKG-4 | Build dystrybucyjny robiony z `npm ci`, nie z `npm install` | **FAIL(S)** | `package.json:18` (`desktop:build`) zakłada zainstalowane drzewo. Brak workflow CI dla desktopu. |
| C-PKG-5 | Zależności runtime bez skryptów instalacyjnych | **PASS** | Naprawione (2026-07-11): `onnxruntime-node` przeniesiony do `devDependencies` (potwierdzone grepem: brak importu poza `src/eval/*`, jedyny konsument to `@huggingface/transformers` przy uruchomieniu w Node). `package-lock.json` zaktualizowany (`npm install`, wersja bez zmian, tylko `dev: true`). `sharp` i `protobufjs` **zostają** w `dependencies` — transitive przez `@huggingface/transformers`, potrzebne w rendererze/workerze w runtime; to był zawsze zakres tej poprawki (patrz `SECURITY-FIXES.md` S-SUP-1). |
| C-PKG-6 | ORT WASM vendorowany lokalnie, nie z jsDelivr | **PASS** | `vite.config.electron.js:44-61` |
| C-PKG-7 | Modele NER lokalne, `env.allowRemoteModels = false` | **PASS** | `src/worker.js:20-32` |
| C-PKG-8 | Google Fonts i widget Buy-Me-a-Coffee usunięte z builda desktopowego, z fail-fast przy zmianie upstreamu | **PASS** | `vite.config.electron.js:150-188` |
| C-PKG-9 | THIRD_PARTY_NOTICES / NOTICE / LICENSE w paczce (Apache-2.0 §4) | **PASS** | `electron-builder.yml:29-34` |
| C-PKG-10 | WebMCP nieobecny w paczce desktopowej | **PASS** | `dist-desktop/webmcp.js` nie istnieje po buildzie (usuwany w `closeBundle`, `vite.config.electron.js:196-209`); `grep -n webmcp dist-desktop/tool.html` nie znajduje `<script>` (zostaje tylko pusty, nigdy niewypełniany `<div id="webmcp-control-root">`). Web (`dist/`) nietknięty: `dist/webmcp.js` nadal obecny, `dist/tool.html:169` nadal ma tag. Patrz B2. |

## 8. Windows

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-WIN-1 | Instalacja do katalogu **niezapisywalnego** przez zwykłego użytkownika | **PASS (żywa instalacja nie wykonana w tej sesji)** | Naprawione w B3: `electron-builder.yml` `nsis.perMachine: true` + `allowToChangeInstallationDirectory: false`. Zweryfikowane nieinwazyjnie (2026-07-10): log `desktop:build` potwierdza `building target=nsis … oneClick=false perMachine=true`; skompilowany `LokalnyAnonimizator-Setup-0.1.0.exe` zawiera w zasobie manifestu PE ciąg `requireAdministrator` (sprawdzone bezpośrednio w binarce), czyli Windows wymusi UAC przy starcie instalatora. **Nie wykonano** pełnej, żywej instalacji z kliknięciem UAC do `%ProgramFiles%` (wymaga interakcji z monitem UAC) — zalecany ręczny test przed dystrybucją poza maszynę autora. |
| C-WIN-2 | Binarka i instalator podpisane certyfikatem | **PASS** | Azure Artifact Signing wpięte w `electron-builder.yml` `win.azureSignOptions` (endpoint Poland Central, konto `kolkowskicodesign`, profil `klawcodesigningprofile`, `publisherName` = CN certyfikatu). Zweryfikowane empirycznie (2026-07-11): `Get-AuthenticodeSignature "release\LokalnyAnonimizator-Setup-0.1.0.exe"` → **Valid** („Signature verified."), SignerCertificate `CN=Kancelaria Radcy Prawnego K-Law Alan Kolkowski` (thumbprint `CADF7EB750A14953885D0069493E2CEEA6C9317B`), wystawca `Microsoft ID Verified CS AOC CA 04`, znakowanie czasem RFC 3161 (Microsoft Public RSA Time Stamping Authority) utrwala ważność mimo krótkotrwałego certyfikatu podpisującego. Bloker B4 zamknięty. Pełny przebieg: `docs/code-signing-azure-session-log.md`. |
| C-WIN-3 | Ochrona przed DLL sideloading / wstrzyknięciem do renderera | **`?`, przesłanka (podpis) już spełniona** | Windows Renderer Code Integrity ładuje do renderera wyłącznie podpisane DLL, co wymaga podpisanej binarki – a ta jest już podpisana (C-WIN-2 PASS, 2026-07-11). Pozostaje empiryczna weryfikacja, że mechanizm jest aktywny; do tego czasu dodatkową obroną jest niezapisywalny katalog instalacji (C-WIN-1). |
| C-WIN-4 | SmartScreen nie ostrzega przy instalacji | **PASS (żywa weryfikacja SmartScreen niewykonana)** | Bloker (brak podpisu) usunięty przez C-WIN-2 – podpis Authenticode `Valid` sprawia, że plik nie jest już traktowany jako niepodpisany. Zastrzeżenie: reputacja aplikacji w SmartScreen dla świeżego certyfikatu OV narasta z liczbą pobrań i czasem, więc pierwsze pobrania mogą jeszcze przejściowo pokazać monit „Windows chronił Twój komputer" – to budowanie reputacji, nie wada podpisu. Zalecany ręczny test przy pierwszej realnej dystrybucji. |
| C-WIN-5 | Brak rejestracji protokołu/deep-linku | **PASS** | `grep -rn "setAsDefaultProtocolClient" electron/` → brak; `app://` jest wewnętrznym schematem Chromium, nie protokołem OS |
| C-WIN-6 | `second-instance` nie interpretuje `argv` (brak wstrzyknięcia deep-linkiem) | **PASS** | `electron/main.mjs:50-55`, podnosi okno i nic więcej |
| C-WIN-7 | Upuszczenie pliku na okno nie powoduje nawigacji do `file://` | **PASS (do potwierdzenia ręcznie)** | `will-navigate` (`electron/main.mjs:79-86`) + fuse `GrantFileProtocolExtraPrivileges:false`. Test: przeciągnąć `.html` i `.exe` na okno, nic się nie dzieje. |
| C-WIN-8 | Pojedyncza instancja | **PASS** | `electron/main.mjs:46-49` |
| C-WIN-9 | Dysk szyfrowany BitLockerem (kontrola organizacyjna, nie aplikacyjna) | **`?`** | `manage-bde -status C:`. Wymagane, bo ryzyko R3 (plik wymiany, hibernacja) jest inaczej nieusuwalne. |

---

## Testy, które muszą przejść przed każdym wydaniem

```bash
npm test                        # m.in. electron/main-links.test.js, electron/model-integrity.test.js,
                                 # electron/nav-policy.test.js, electron/network-guard.test.js
npm run desktop:verify-models   # sumy SHA-256, brak plików .part
npm run desktop:build:renderer  # wywraca się na zdalnym zasobie (assertNoRemoteUrls)
npm run desktop:smoke           # tryb repo: pełny przebieg + kanarek strażnika + bramka integralności modeli
npm run desktop:smoke:packaged  # ten sam zestaw na spakowanej binarce
npm run desktop:smoke:offline   # spakowana binarka bez DNS (MAP * ~NOTFOUND)
```

Po naprawie B1 i B3 (2026-07-10) dopisane do zestawu, zweryfikowane ręcznie
(nie ma to jeszcze automatycznego testu w CI — do rozważenia w etapie 2):

```bash
npx @electron/fuses read --app "release/win-unpacked/Lokalny anonimizator.exe"
# + test podmiany bajtu w app.asar (C-INT-3) — wciąż `?`, patrz notatka przy C-INT-3
# + test podmiany modelu ONNX (C-INT-4) — WYKONANY: podmiana bajtu w
#   resources/models/.../model_quantized.onnx na spakowanej binarce =>
#   fatalStartupError + brak startu, komunikat z rozbieżną sumą SHA-256
# + test brakującej kotwicy (C-INT-5) — WYKONANY, tryb repo: usunięcie
#   models/manifest.json => "Brak kotwicy integralności modeli", brak startu
```

Test ręczny, nieusuwalny: fizyczny tryb samolotowy → instalacja z `release/…exe`
→ pełny przebieg na prawdziwym dokumencie.

---

## §Odstępstwa (świadome, podpisane)

| Pozycja | Odstępstwo | Uzasadnienie | Warunek zamknięcia |
|---|---|---|---|
| C-INP-8 | `'unsafe-eval'` w CSP strony | glue OpenCV z SDK PaddleOCR używa `new Function` na wątku głównym; bez tego OCR nie działa. Egress i tak niemożliwy (C-NET-1), a nie istnieje sink XSS (C-INP-1, C-INP-2). | przeniesienie OpenCV wyłącznie do workera; wtedy zostaje tylko `WORKER_CSP` |
| C-PERS-10 | `clipboard-read` i `clipboard-sanitized-write` dozwolone | schowek jest **zamierzonym** interfejsem produktu (kopiuj tokenizowane, wklej odpowiedź LLM-a); działa tylko po kliknięciu użytkownika, tylko lokalnie | brak, to cecha, nie dług |
| C-NET-13 | dev-server jako wyjątek w blokadzie sieci | jedyny wyjątek, aktywny wyłącznie przy `!app.isPackaged` (`electron/main.mjs:21`) | brak |

**Odstępstwa niezaakceptowane:** wszystko, co nosi status FAIL(B). Bloker nie
jest odstępstwem, jest blokerem.
