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

## WERDYKT BRAMKI, stan na 2026-07-10

> ## ❌ **BUILD NIE MOŻE WYJŚĆ JAKO INSTALATOR DYSTRYBUCYJNY.**
>
> Blokery: **B1** (brak weryfikacji integralności modeli w runtime),
> **B2** (WebMCP w paczce), **B3** (instalacja do katalogu zapisywalnego przez
> użytkownika), **B4** (brak podpisu kodu).
>
> **Dopuszczone warunkowo:** build wewnętrzny na maszynie autora, po naprawie
> **B2** (koszt: kilkanaście linii). B2 jest jedynym blokerem, który nie
> wymaga certyfikatu ani przebudowy instalatora, a jednocześnie jest jedynym,
> który sprawia, że deklaracja „air-gap by construction" jest dziś nieprawdziwa
> dosłownie, a nie tylko z ostrożności.
>
> Uzasadnienie i scenariusze: `THREAT-MODEL.md` §4 (S1, S2).
> Poprawki: `SECURITY-FIXES.md`.

---

## 1. Izolacja renderera

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-ISO-1 | `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false` | **PASS** | `electron/main.mjs:115-118` |
| C-ISO-2 | `sandbox: true` na oknie głównym | **PASS** | `electron/main.mjs:119` |
| C-ISO-3 | `app.enableSandbox()` wymusza sandbox na **każdym** przyszłym `webContents` | **FAIL(S)** | `grep -rn "enableSandbox" electron/` → brak trafień. `webPreferences` nie da się dopiąć w `web-contents-created`, więc dzisiejszy `hardenWebContents` nie ochroni okna utworzonego przez przyszły kod. |
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
| C-NET-5 | Brak egress kanałami, których `webRequest` nie widzi: mDNS/DIAL, PAC/proxy | **`?` → FAIL(S)** | Brak `--no-proxy-server`, brak `session.setProxy({mode:'direct'})`, brak `--disable-features=MediaRouter`. Sprawdzić Wiresharkiem na świeżym profilu: `udp.port==5353 or udp.port==1900` przez 60 s od startu. |
| C-NET-6 | Proces główny nie importuje `node:net|http|https|dns|tls|dgram|child_process` | **PASS (bez egzekucji)** | `grep -rn "node:\(net\|http\|https\|dns\|tls\|dgram\|child_process\)" electron/` → brak. **Nie jest to nigdzie egzekwowane testem**, patrz S-NET-4. |
| C-NET-7 | Trwały tryb samolotowy w binarce: `--host-resolver-rules=MAP * ~NOTFOUND` | **FAIL(S)** | `grep -n "host-resolver-rules" electron/main.mjs` → brak. Dziś tylko test go używa (`e2e/desktop-smoke.mjs:80`). |
| C-NET-8 | Reguła zapory Windows blokuje ruch wychodzący binarki | **FAIL(S)** | Brak w `electron-builder.yml` / skrypcie NSIS. Po instalacji: `Get-NetFirewallApplicationFilter -Program "<ścieżka>.exe"` |
| C-NET-9 | Brak auto-update, telemetrii, analityki, crash-reportera, `sendBeacon` | **PASS** | `publish: null` (`electron-builder.yml:45`); `grep -rniE "autoUpdater|electron-updater|crashReporter|sentry|posthog|mixpanel|telemetry|sendBeacon" src/ electron/ scripts/` → brak |
| C-NET-10 | Build wywraca się, gdy renderer pobierałby cokolwiek zdalnie | **PASS** | `assertNoRemoteUrls`, `vite.config.electron.js:203-298` |
| C-NET-11 | `dist-desktop/` nie zawiera `new WebSocket(`, `RTCPeerConnection`, `sendBeacon` | **PASS** | `grep -rn "new WebSocket(" dist-desktop/` → zero trafień. Naprawione w B2: `src/main.js:1436-1699` (instancja WebMCP i wszystkie rejestracje narzędzi za `window.desktopApp?.isDesktop`), `vite.config.electron.js:170` (tag `<script src="webmcp.js">` usuwany z `tool.html`, fail-fast jak przy bmc-button), `vite.config.electron.js:196-209` (`desktopStripWebmcpAsset` kasuje skopiowany z `public/` `dist-desktop/webmcp.js` w `closeBundle`, bo samo usunięcie tagu nie usuwa pliku). |
| C-NET-12 | `shell.openExternal` tylko dla dokładnych URL-i z allowlisty, bez query i poświadczeń | **PASS** | `electron/main-links.mjs:33-48`; `npm test` → `electron/main-links.test.js`; `e2e/desktop-smoke.mjs:313` |
| C-NET-13 | `will-navigate` blokuje nawigację poza origin aplikacji | **PASS (z zastrzeżeniem)** | `electron/main.mjs:79-86`. W trybie dev `startsWith(DEV_SERVER_URL)` bez końcowego ukośnika przepuści `http://localhost:5183.evil.com`. Patrz S-NET-5. |
| C-NET-14 | `will-redirect` obsłużone | **FAIL(S)** | `grep -n "will-redirect" electron/main.mjs` → brak |
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
| C-INP-7 | `isEvalSupported: false` w `getDocument` | **FAIL(S)** | `src/file-import/pdf.js:99` → `getDocument({ data, wasmUrl })`, brak flagi |
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
| C-IPC-4 | Handler waliduje nadawcę (`event.senderFrame`) | **FAIL(S)** | `electron/main.mjs:188` ignoruje `event`. Ryzyko niskie (kanał zwraca tylko wersje i licznik), ale wzorzec musi być poprawny, zanim dojdzie drugi kanał. |
| C-IPC-5 | Żaden kanał IPC nie przenosi legendy ani treści dokumentu | **PASS** | jedyny kanał zwraca `{appVersion, electron, chrome, packaged, networkBlock}` |
| C-IPC-6 | `getNetworkBlockStats()` nie wynosi PII do renderera | **PASS** | zwraca originy, nie pełne URL-e (`electron/network-guard.mjs:26-31`) |

## 5. Integralność zasobów i fuses

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-INT-1 | Fuses ustawione: `RunAsNode:false`, `EnableNodeCliInspectArguments:false`, `EnableNodeOptionsEnvironmentVariable:false`, `OnlyLoadAppFromAsar:true`, `EnableCookieEncryption:true` | **PASS** | `scripts/afterpack-fuses.cjs:24-33` |
| C-INT-2 | Fuses **faktycznie zapisane w binarce** (nie tylko w konfiguracji) | **`?`** | `npx @electron/fuses read --app "release/win-unpacked/Lokalny anonimizator.exe"` |
| C-INT-3 | Zmiana jednego bajtu w `app.asar` uniemożliwia start | **`?`** | Skopiować `win-unpacked`, nadpisać bajt w `resources/app.asar`, uruchomić. Aplikacja **musi** odmówić startu. Dopóki to nie jest zmierzone, `EnableEmbeddedAsarIntegrityValidation` jest deklaracją. |
| C-INT-4 | Modele w `resources/models/` weryfikowane **w runtime** | **FAIL(B)** | `electron/app-protocol.mjs:200` strumieniuje bez sprawdzenia. Modele są poza asarem (`electron-builder.yml:23-28`), więc fuse ich nie obejmuje. Patrz B1. |
| C-INT-5 | `manifest.json` z sumami SHA-256 dostępny w runtime | **FAIL(B)** | `electron-builder.yml:27-28` → `!manifest.json`. Spakowana aplikacja **nie ma żadnej referencji** do porównania. |
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
| C-PERS-5 | Brak zrzutów awaryjnych z PII | **`?` → FAIL(S)** | `crashReporter.start()` nigdzie nie wołany (PASS), ale brak `app.setPath('crashDumps', …)`. Wymusić crash renderera, sprawdzić `%APPDATA%\<app>\Crashpad\reports\`. **Windows Error Reporting działa niezależnie od aplikacji** (ryzyko R3). |
| C-PERS-6 | Czyszczenie cache przy wyjściu | **FAIL(nice)** | brak `session.clearStorageData`/`clearCache` w `electron/` |
| C-PERS-7 | Żaden runtime'owy `console.*` nie drukuje treści dokumentu, `entity.word`, legendy ani nazwy pliku | **FAIL(S)** | `electron/network-guard.mjs:81` loguje **pełny URL** zablokowanego żądania. Reszta czysta. Narzędzia `src/eval/*`, `bench/*` drukują tekst, ale nie trafiają do paczki. |
| C-PERS-8 | Panel debug (legenda → schowek) niedostępny w buildzie desktopowym | **FAIL(S)** | `src/main.js:1391-1393` wrzuca do schowka `JSON.stringify({anonymized, legend, debug})`. Dostępny po nawigacji na `app://app/tool.html?debug=1`, którą `will-navigate` przepuszcza. |
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
| C-PKG-5 | Zależności runtime bez skryptów instalacyjnych | **FAIL(S)** | `onnxruntime-node`, `sharp`, `protobufjs` mają `hasInstallScript: true` i siedzą w `dependencies`. `onnxruntime-node` jest używany wyłącznie przez `src/eval/*` → powinien być `devDependency`. |
| C-PKG-6 | ORT WASM vendorowany lokalnie, nie z jsDelivr | **PASS** | `vite.config.electron.js:44-61` |
| C-PKG-7 | Modele NER lokalne, `env.allowRemoteModels = false` | **PASS** | `src/worker.js:20-32` |
| C-PKG-8 | Google Fonts i widget Buy-Me-a-Coffee usunięte z builda desktopowego, z fail-fast przy zmianie upstreamu | **PASS** | `vite.config.electron.js:150-188` |
| C-PKG-9 | THIRD_PARTY_NOTICES / NOTICE / LICENSE w paczce (Apache-2.0 §4) | **PASS** | `electron-builder.yml:29-34` |
| C-PKG-10 | WebMCP nieobecny w paczce desktopowej | **PASS** | `dist-desktop/webmcp.js` nie istnieje po buildzie (usuwany w `closeBundle`, `vite.config.electron.js:196-209`); `grep -n webmcp dist-desktop/tool.html` nie znajduje `<script>` (zostaje tylko pusty, nigdy niewypełniany `<div id="webmcp-control-root">`). Web (`dist/`) nietknięty: `dist/webmcp.js` nadal obecny, `dist/tool.html:169` nadal ma tag. Patrz B2. |

## 8. Windows

| ID | Pozycja | Status | Jak sprawdzić |
|---|---|---|---|
| C-WIN-1 | Instalacja do katalogu **niezapisywalnego** przez zwykłego użytkownika | **FAIL(B)** | `electron-builder.yml:64-65` → `perMachine: false` + `allowToChangeInstallationDirectory: true`. Instaluje do `%LOCALAPPDATA%\Programs\…`. Zwykły proces użytkownika podmienia exe, DLL i **modele**. Patrz B3. |
| C-WIN-2 | Binarka i instalator podpisane certyfikatem | **FAIL(B)** | `electron-builder.yml:56-60`, `signtoolOptions` zakomentowane. `Get-AuthenticodeSignature "<exe>"` → `NotSigned`. Patrz B4. |
| C-WIN-3 | Ochrona przed DLL sideloading / wstrzyknięciem do renderera | **`?`, zależne od C-WIN-1 i C-WIN-2** | Windows Renderer Code Integrity ładuje do renderera wyłącznie podpisane DLL, **ale wymaga podpisanej binarki**: do weryfikacji. Bez tego jedyną obroną jest niezapisywalny katalog instalacji. |
| C-WIN-4 | SmartScreen nie ostrzega przy instalacji | **FAIL(B)** | konsekwencja C-WIN-2. Ostrzeżenie uczy radcę klikać „Uruchom mimo to", co niszczy wartość podpisu na przyszłość. |
| C-WIN-5 | Brak rejestracji protokołu/deep-linku | **PASS** | `grep -rn "setAsDefaultProtocolClient" electron/` → brak; `app://` jest wewnętrznym schematem Chromium, nie protokołem OS |
| C-WIN-6 | `second-instance` nie interpretuje `argv` (brak wstrzyknięcia deep-linkiem) | **PASS** | `electron/main.mjs:50-55`, podnosi okno i nic więcej |
| C-WIN-7 | Upuszczenie pliku na okno nie powoduje nawigacji do `file://` | **PASS (do potwierdzenia ręcznie)** | `will-navigate` (`electron/main.mjs:79-86`) + fuse `GrantFileProtocolExtraPrivileges:false`. Test: przeciągnąć `.html` i `.exe` na okno, nic się nie dzieje. |
| C-WIN-8 | Pojedyncza instancja | **PASS** | `electron/main.mjs:46-49` |
| C-WIN-9 | Dysk szyfrowany BitLockerem (kontrola organizacyjna, nie aplikacyjna) | **`?`** | `manage-bde -status C:`. Wymagane, bo ryzyko R3 (plik wymiany, hibernacja) jest inaczej nieusuwalne. |

---

## Testy, które muszą przejść przed każdym wydaniem

```bash
npm test                        # m.in. electron/main-links.test.js
npm run desktop:verify-models   # sumy SHA-256, brak plików .part
npm run desktop:build:renderer  # wywraca się na zdalnym zasobie (assertNoRemoteUrls)
npm run desktop:smoke           # tryb repo: pełny przebieg + kanarek strażnika
npm run desktop:smoke:packaged  # ten sam zestaw na spakowanej binarce
npm run desktop:smoke:offline   # spakowana binarka bez DNS (MAP * ~NOTFOUND)
```

Po naprawie B1–B4 dopisać do zestawu:

```bash
npx @electron/fuses read --app "release/win-unpacked/Lokalny anonimizator.exe"
# + test podmiany bajtu w app.asar (C-INT-3)
# + test podmiany modelu ONNX: aplikacja musi odmówić startu (C-INT-4)
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
