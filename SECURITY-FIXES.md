# SECURITY-FIXES.md — poprawki dla implementatora

Priorytetyzowana lista dla kolejnego modelu, który robi implementację.
Każda pozycja: **co**, **gdzie** (plik:linia), **dlaczego** (odsyłacz do
`THREAT-MODEL.md`), **jak** (szkic, do dopracowania w kodzie, nie wklejać
na ślepo). Szkice pokazują kierunek, nie są gotowym patchem.

Kolejność: **BLOKER** (bez tego build nie wychodzi) → **SHOULD** (przed
dystrybucją poza maszynę autora) → **NICE** (kolejny etap).

---

## BLOKERY

### B1 — Weryfikacja integralności modeli w runtime — NAPRAWIONE
**Status:** naprawione (2026-07-10). Kotwica: `electron-builder.yml` `files`
(`from: models, filter: [manifest.json]`, `to: .`) kopiuje `models/manifest.json`
do korzenia `app.asar` jako `manifest.json`, chronione fuse'em
`EnableEmbeddedAsarIntegrityValidation`. Modele **zostają** poza asarem
(`extraResources`, jak wcześniej), `manifest.json` nadal wykluczony stamtąd
(`!manifest.json`). Bramka: nowy plik `electron/model-integrity.mjs`
(`verifyModelIntegrity`) liczy SHA-256 każdego pliku modelu **strumieniowo**
(`createReadStream` + `crypto.createHash`, nigdy `readFileSync`) i porównuje
z kotwicą; brak/uszkodzona/pusta kotwica, brak pliku, zła suma, zły rozmiar —
wszystko fail-closed. Wpięta w `electron/main.mjs` w `app.whenReady()`, po
sprawdzeniu istnienia katalogu modeli, **przed** `createMainWindow()`.

**Zweryfikowane empirycznie (2026-07-10):**
- `electron/model-integrity.test.js` — 8 testów jednostkowych na syntetycznych
  plikach (dopasowanie, podmiana bajtu przy tym samym rozmiarze, obcięcie
  rozmiaru, brak pliku, brak kotwicy, uszkodzony JSON, pusta lista wpisów,
  wielokrotne rozbieżności naraz). Wszystkie przechodzą.
- **Podmiana bajtu w modelu, spakowana binarka:** jeden bajt nadpisany w
  `release/win-unpacked/resources/models/ner/wjarka/eu-pii-anonimization-pl/
  onnx/model_quantized.onnx` (rozmiar bez zmian) → uruchomienie `.exe` kończy
  się `[main] Naruszona integralność modeli: … zła suma SHA-256
  ner/wjarka/eu-pii-anonimization-pl/onnx/model_quantized.onnx: d04c42c8… ≠
  49f6dad1…` w `stderr`, okno nigdy nie powstaje (potwierdzone przez CDP:
  `context.pages()` pozostaje puste). Bajt przywrócony, suma ponownie zgodna
  z oryginałem.
- **Brak kotwicy, tryb repo:** `models/manifest.json` czasowo przeniesiony →
  `[main] Naruszona integralność modeli: … Brak kotwicy integralności modeli:
  …\models\manifest.json`, brak startu. Przywrócone.
- **Brak/uszkodzona kotwica w asarze, spakowana binarka:** usunięcie pliku
  z `app.asar` i przepakowanie (`npx asar extract` → usuń → `npx asar pack`)
  wywołało natywny `FATAL` fuse'a `EnableEmbeddedAsarIntegrityValidation`
  (`asar_util.cc:143 Integrity check failed`) **zanim** kod z tego PR-a
  w ogóle się wykonał — osobna, wcześniejsza warstwa obrony. Silna poszlaka
  dla `C-INT-3` (wciąż `?` w checkliście — to nie był test „jednego bajtu"
  w niezmienionym pliku, tylko zmiana struktury archiwum). `app.asar`
  przywrócony z kopii zapasowej.
- `npm run desktop:build:renderer && npm run desktop:smoke` (tryb repo) oraz
  `npm run desktop:smoke:packaged` (spakowana binarka) przechodzą w całości
  z nienaruszonymi modelami, łącznie z nową bramką działającą po cichu
  (brak rozbieżności → brak dialogu, normalny start).
- Narzut startowy zmierzony bezpośrednio: **~2,3 s** dla pełnego zestawu modeli
  (~576 MB), zgodne z oczekiwanym „~1-2 s na NVMe". Budżet oczekiwania na
  pierwsze okno w `e2e/desktop-smoke.mjs` (tryb `--packaged`) poszerzony
  z 10 s do 30 s, żeby uwzględnić ten legalny narzut — CDP staje się dostępne
  szybko (Chromium wiąże `--remote-debugging-port` niezależnie od
  `app.whenReady()`), więc stary budżet był już ciasny przed tą zmianą.

**Ryzyko rezydualne (udokumentowane, nie ukryte):** to bramka **przy starcie**,
nie ciągły monitoring — nie złapie podmiany modelu **w trakcie** działania
aplikacji (TOCTOU). To okno domyka B3 (katalog niezapisywalny bez UAC), nie
B1 z osobna; obie poprawki wchodzą razem.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/app-protocol.mjs:155-202`, `electron-builder.yml:23-28`, nowy plik.
**Dlaczego:** `THREAT-MODEL.md` §4 S1. Modele leżą poza asarem, fuse ich nie
chroni, `manifest.json` jest wykluczony z paczki, katalog instalacji jest
zapisywalny (B3). Podmiana modelu = cicha awaria fail-open = użytkownik sam
wynosi PESEL. To jest najgroźniejszy scenariusz w całym modelu.

**Jak:**
1. Przestać wykluczać manifest, ale **nie** kłaść go obok modeli (żeby atakujący
   nie podmienił obu naraz). Wgrać oczekiwane sumy **do asara**, który jest
   chroniony fuse'em `EnableEmbeddedAsarIntegrityValidation`:
   ```yaml
   # electron-builder.yml — dołożyć do files (trafia do asara):
   #   scripts/model-hashes.json   (skopiowany z models/manifest.json przy build)
   ```
2. Przy starcie, **przed** `createMainWindow()`, policzyć SHA-256 każdego pliku
   modelu i porównać z sumą z asara. Rozbieżność = `fatalStartupError` i `app.exit(1)`.
   ```js
   // electron/model-integrity.mjs (nowy)
   import { createHash } from 'node:crypto';
   import { createReadStream } from 'node:fs';
   // wczytaj oczekiwane sumy z asara (import JSON), przejdź MODELS_ROOT,
   // policz SHA-256 strumieniowo, zwróć listę rozbieżności.
   ```
   Wpiąć w `electron/main.mjs` obok istniejących bramek startu (`:171-184`).
   Koszt czasowy: ~kilkaset MB SHA-256 przy starcie. Jeśli za wolno, policzyć
   raz i zapisać zaufany znacznik (mtime+size) do `safeStorage`, pełne SHA
   przy pierwszym starcie i po każdej aktualizacji.
3. Test: podmienić bajt w `resources/models/ner/model_quantized.onnx`,
   uruchomić, aplikacja **musi** odmówić startu (C-INT-4).

**Uwaga:** B1 bez B3+B4 jest do obejścia (atakujący przepisze też sumy w asarze,
jeśli asar nie jest chroniony podpisem). Trzy poprawki tworzą łańcuch, muszą
wejść razem.

---

### B2 — Usunąć WebMCP z builda desktopowego — ROZWIĄZANE
**Status:** naprawione (wariant 1, build-time strip). `C-NET-11` i `C-PKG-10`
przechodzą na **PASS** w `SECURITY-CHECKLIST.md`. Trzy miejsca, wszystkie
wymagane razem (build wywala się, jeśli brakuje któregokolwiek):
1. `src/main.js:1436-1699` — instancja `new WebMCP(...)`, `mountWebMcpControl`
   i wszystkie pięć `mcp.registerTool(...)` owinięte **jednym** blokiem
   `if (!window.desktopApp?.isDesktop) { … }` (nie dwoma osobnymi — `mcp` jest
   `const` używany w obu miejscach, dwa bloki złamałyby zasięg zmiennej).
2. `vite.config.electron.js:164-170` — reguła `webmcp` w `desktopHtmlTransform()`
   usuwa `<script src="webmcp.js">` z `tool.html`, z tym samym fail-fast co
   `bmc-button`. Zbramkowana `only: '/tool.html'`, bo `index.html` (strona
   marketingowa) nigdy nie miał tego tagu — bez tego warunku reguła wywalała
   build na `index.html` (0 dopasowań < `min: 1`).
3. `vite.config.electron.js:196-209` — nowy plugin `desktopStripWebmcpAsset()`
   kasuje `dist-desktop/webmcp.js` w `closeBundle`, bo Vite kopiuje
   `public/webmcp.js` do wyjścia niezależnie od tego, czy HTML go referencuje.
   `public/webmcp.js` w repo **nietknięty** — build webowy go nadal używa.

Zweryfikowane: `desktop:build:renderer` przechodzi, `grep -rn "new WebSocket("
dist-desktop/` daje zero trafień, `grep -n webmcp dist-desktop/tool.html` nie
znajduje tagu script, `desktop:smoke` i `npm test` przechodzą, `dist/` (build
webowy) nadal ma `webmcp.js` z `new WebSocket(`.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `tool.html:168`, `src/main.js:1430-1431`, `vite.config.electron.js:150-188`.
**Dlaczego:** `THREAT-MODEL.md` §4 S2, decyzja D1. W paczce leży samoczynnie
uruchamiany klient WebSocket, który przy starcie próbuje połączyć się pod adres
z tokenu w `localStorage`. Dziś blokują go CSP i strażnik, ale to air-gap
z konfiguracji, nie z konstrukcji. **Jedyny bloker naprawialny bez certyfikatu.**

**Jak (wybrać jedno, preferowane 1):**
1. **Build-time strip.** Dołożyć regułę do `desktopHtmlTransform()`
   (`vite.config.electron.js:161-171`), która usuwa `<script src="webmcp.js">`
   dokładnie tak, jak dziś usuwa bmc-button, z tym samym fail-fast przy zmianie
   upstreamu. Plus owinąć instancję w `src/main.js:1430`:
   ```js
   if (!window.desktopApp?.isDesktop) {
     const mcp = new WebMCP({ channelName: 'pii' });
     mountWebMcpControl(mcp);
   }
   ```
   `window.desktopApp` jest wystawiane przez preload (`electron/preload.cjs:21`),
   więc rozróżnienie jest pewne.
2. Alternatywa: osobny entry point HTML dla desktopu bez tagu. Więcej pracy,
   czystszy podział.

**Test do dopisania (C-NET-11):** grep w `dist-desktop/` na `new WebSocket(`
wywraca build, jeśli WebMCP wróci. To pilnuje regresji na zawsze.

---

### B3 — Instalacja per-machine do katalogu chronionego — NAPRAWIONE
**Status:** naprawione (2026-07-10). `electron-builder.yml` `nsis`:
`perMachine: true`, `allowToChangeInstallationDirectory: false` (`oneClick:
false` bez zmian). Instalacja idzie do `%ProgramFiles%`, wymaga podniesienia
uprawnień; użytkownik nie może przekierować jej do zapisywalnego katalogu.

**Zweryfikowane (2026-07-10):**
- Log `npm run desktop:build` potwierdza konfigurację faktycznie użytą do
  budowy instalatora: `building target=nsis file=release\
  LokalnyAnonimizator-Setup-0.1.0.exe archs=x64 oneClick=false perMachine=true`.
- Skompilowany `release/LokalnyAnonimizator-Setup-0.1.0.exe` zawiera w
  zasobie manifestu PE ciąg `requireAdministrator` (sprawdzone bezpośrednio
  w bajtach binarki) — to on każe Windows pokazać monit UAC przy starcie
  instalatora.
- **Nie wykonano** w tej sesji pełnej, żywej instalacji z kliknięciem UAC do
  `%ProgramFiles%` (wymaga interakcji człowieka z monitem UAC, nie da się
  tego bezpiecznie zautomatyzować z nienadzorowanej sesji). Zalecany ręczny
  test przed dystrybucją poza maszynę autora: uruchomić
  `release/LokalnyAnonimizator-Setup-0.1.0.exe`, potwierdzić monit UAC,
  sprawdzić że `$INSTDIR` to `%ProgramFiles%\Lokalny anonimizator` i że
  zwykły użytkownik (bez admina) nie ma prawa zapisu do tego katalogu
  (`icacls "%ProgramFiles%\Lokalny anonimizator"`).
- Domyka też okno TOCTOU dla B1: skoro katalog instalacji jest niezapisywalny
  bez UAC, atakujący z Z4 (kod na koncie użytkownika, bez podniesienia
  uprawnień) nie podmieni modelu **między** bramką integralności a jego
  odczytem przez pipeline, bo nie podmieni go w ogóle.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron-builder.yml:62-68`.
**Dlaczego:** `THREAT-MODEL.md` §4 S1. `perMachine: false` instaluje do
`%LOCALAPPDATA%`, gdzie zwykły proces użytkownika (Z4) nadpisze exe, DLL i modele
bez UAC. To fundament, na którym stoi wykonalność S1.

**Jak:**
```yaml
nsis:
  oneClick: false
  perMachine: true                        # instalacja do Program Files (wymaga UAC)
  allowToChangeInstallationDirectory: false  # użytkownik nie przekieruje do zapisywalnego katalogu
```
Kompromis: instalacja wymaga podniesienia uprawnień. Dla narzędzia
kancelaryjnego to akceptowalne i pożądane, bo `%ProgramFiles%` jest
niezapisywalny dla procesów bez administratora, co odbiera atakującemu z Z4
możliwość podmiany artefaktów.

---

### B4 — Podpis kodu Windows
**Gdzie:** `electron-builder.yml:56-60`.
**Dlaczego:** `THREAT-MODEL.md` §3 (Spoofing), §4 S1. Bez podpisu: SmartScreen
straszy (i uczy klikać „mimo to"), instalator jest podmienny, a
`EnableEmbeddedAsarIntegrityValidation` broni tylko wewnętrznej spójności, nie
autentyczności całości. Podpis jest kotwicą, do której dowiązują się B1 i B3.

**Jak:** wymaga certyfikatu i uzupełnienia `signtoolOptions` albo
`azureSignOptions` w `electron-builder.yml` (miejsce już przygotowane,
komentarz `:56-60`). **Nigdy nie commitować certyfikatu ani hasła** — zmienne
środowiskowe / magazyn CI. To jedyny bloker wymagający zakupu na zewnątrz,
więc uruchomić proces pozyskania **teraz**, równolegle do reszty.

**Rekomendacja ścieżki (zrewidowana 2026-07-10 po sprawdzeniu rynku):**
zacząć od **Azure Artifact Signing** (dawniej Trusted Signing), nie EV.

- **Azure Artifact Signing Basic: 9,99 USD/mies.** (~120 USD/rok), klucz w
  chmurowym HSM Microsoftu, płatność miesięczna. Premium (99,99 USD/mies.,
  100 000 podpisów) zbędny dla jednej aplikacji.
- **Polska JDG się kwalifikuje.** FAQ Microsoftu (akt. 2026-06) wymienia
  certyfikaty Public Trust dla organizacji w USA, Kanadzie, **UE** i UK.
  Wynik „tylko US/Kanada" pochodzi z fazy public preview i jest nieaktualny.
- **Integracja już przewidziana** w `electron-builder.yml:56-60`
  (`azureSignOptions`) — wpięcie bez przebudowy packagingu.
- Warunki: **płatna** subskrypcja Azure (nie trial/darmowa) + walidacja
  tożsamości organizacji (dla JDG: dane podmiotu, wpis do rejestru).
- Zastrzeżenie: **Azure nie wydaje EV** (odpowiednik OV). Ale przewaga EV
  wygasła — reputacja SmartScreen buduje się dziś przez historię pobrań pliku
  **niezależnie od typu certyfikatu** (potwierdza FAQ Azure). Przy wąskiej
  dystrybucji narzędzia kancelaryjnego EV to nadpłata za nieistniejącą korzyść.

**Ścieżka zapasowa:** tradycyjny **OV** (klucz na tokenie sprzętowym lub
chmurowym HSM), gdy walidacja podmiotu w Azure okaże się uciążliwa albo
zależy nam na obsłudze po polsku:
- **Certum** (polski CA, Asseco) — administracyjnie najprostszy dla polskiej
  JDG: polski token, polska obsługa, weryfikacja polskiego podmiotu. Rząd
  kilkuset zł/rok.
- Sectigo / DigiCert OV: ~220–300 USD/rok. EV: ~280–500 USD/rok — nie
  rekomendowane (patrz wyżej).
- Uwaga terminowa: od **1 marca 2026** maksymalna ważność certyfikatu spadła
  z 39 mies. do ~460 dni (~15 mies.) — rabaty wieloletnie z góry zniknęły,
  odnowienie de facto co rok.

Źródła: [FAQ Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
(dostępność UE, brak EV, reputacja SmartScreen),
[cennik tierów](https://news.ycombinator.com/item?id=46654910),
[zmiana ważności od 03.2026](https://codesigncert.com/blog/code-signing-certificate-cost).

---

## SHOULD (przed dystrybucją poza maszynę autora)

### S-NET-1 — Trwały tryb samolotowy w binarce — NAPRAWIONE
**Status:** naprawione (2026-07-10). `electron/main.mjs`, obok istniejących
`appendSwitch`: `app.commandLine.appendSwitch('host-resolver-rules', 'MAP *
~NOTFOUND')`, zbramkowane na `app.isPackaged` — tryb dev (`npm run
desktop:dev`) nietknięty. Checklist: **C-NET-7 → PASS**.

**Zweryfikowane:** `npm run desktop:build:renderer`, `npm run desktop:smoke`
(tryb repo) i `npm run desktop:smoke:packaged` (świeżo przebudowana binarka)
przechodzą bez zmian. `npm run desktop:smoke:offline` nadal symuluje ten sam
scenariusz z zewnątrz (`e2e/desktop-smoke.mjs:80`) — teraz binarka wymusza go
sama, bez potrzeby przekazywania flagi z zewnątrz.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs:40-42` (obok istniejących `appendSwitch`).
**Dlaczego:** D4 pkt 1. Dołożenie warstwy niezależnej od `webRequest`.
```js
if (app.isPackaged) {
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
}
```
Wiemy, że działa: tym samym przełącznikiem `desktop:smoke:offline` symuluje brak
DNS (`e2e/desktop-smoke.mjs:80`). Bramkować na `app.isPackaged`, żeby nie zabić
trybu dev. `app://` nie rozwiązuje nazw, więc jest nietknięty; literalne IP
z przyszłego loopbacku też (nie przechodzi przez resolver).

### S-NET-2 — Twarde wyłączenie proxy — NAPRAWIONE
**Status:** naprawione (2026-07-10). `electron/main.mjs`:
`app.commandLine.appendSwitch('no-proxy-server')` obok istniejących
`appendSwitch`, oraz `await session.defaultSession.setProxy({ mode: 'direct'
})` w `app.whenReady()`, przed `installNetworkGuard`. Checklist: **C-NET-5
częściowo zamknięte** (proxy/PAC tak, mDNS/DIAL nadal otwarte — patrz uwaga
niżej).

**Zweryfikowane:** `npm test`, `npm run desktop:build:renderer`, `npm run
desktop:smoke` i `npm run desktop:smoke:packaged` przechodzą bez zmian.

**Uwaga o zakresie:** C-NET-5 w checkliście wiąże PAC/proxy (tu zamknięte)
z mDNS/DIAL przez Chromium Media Router (nadal otwarte — brak
`--disable-features=MediaRouter,...` i brak pomiaru Wiresharkiem, czy Electron
w ogóle je emituje). To osobny wektor, odłożony do N-4 w tym samym pliku;
C-NET-5 nie przechodzi w całości na PASS, dopóki mDNS/DIAL nie zostanie
zmierzone i domknięte.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs:40-42` oraz w `app.whenReady` obok `installNetworkGuard`.
**Dlaczego:** D4 pkt 2. Zamyka pobranie PAC i proxy systemowe.
```js
app.commandLine.appendSwitch('no-proxy-server');
// oraz:
await session.defaultSession.setProxy({ mode: 'direct' });
```

### S-NET-3 — Reguła zapory Windows w instalatorze — NAPRAWIONE, zweryfikowane żywo w obie strony
**Status:** naprawione i w pełni zweryfikowane (2026-07-11). Kod napisany
przeze mnie i skompilowany; żywą instalację i deinstalację z UAC wykonał Alan
(nie ja — instalacja per-machine + zmiana reguł zapory to system-wide
zmiana, której nie robię bez niego przy klawiaturze). Checklist: **C-NET-8 →
PASS**.

**Wynik żywego testu (2026-07-11, wykonał Alan):**
`LokalnyAnonimizator-Setup-0.1.0.exe` uruchomiony jako administrator (monit
UAC zaakceptowany). Pierwsza próba weryfikacji z **niepodniesionego**
PowerShell zwróciła `Odmowa dostępu` (Windows System Error 5) —
`Get-NetFirewallApplicationFilter` wymaga elewacji nawet do samego odczytu,
nie tylko zmiany; to samo polecenie z **podniesionego** okna zadziałało.
Pełny łańcuch:
```powershell
Get-NetFirewallApplicationFilter -Program "$env:ProgramFiles\Lokalny anonimizator\Lokalny anonimizator.exe" | Get-NetFirewallRule | Select-Object DisplayName, Direction, Action, Enabled
```
**Po instalacji** zwrócił dokładne dopasowanie: `DisplayName=Lokalny
anonimizator (block out)`, `Direction=Outbound`, `Action=Block`,
`Enabled=True`. Aplikacja odinstalowana, **to samo polecenie po deinstalacji**
zwróciło `No MSFT_NetApplicationFilter objects found with property 'AppPath'
equal to '...'` — reguła usunięta razem z aplikacją, `customUnInstall`
zadziałał. Obie strony (`customInstall` i `customUnInstall`) potwierdzone
empirycznie na żywej instalacji, nie tylko kompilacją skryptu.

**Co zostało zrobione:** `build/installer.nsh` definiuje `!macro
customInstall` / `!macro customUnInstall` — udokumentowane punkty rozszerzeń
electron-buildera, potwierdzone czytaniem źródła (nie zgadywaniem):
`app-builder-lib/templates/nsis/installSection.nsh:81-83` i
`uninstaller.nsh:238-240` wstawiają je przez `!ifmacrodef ... !insertmacro`.
`electron-builder.yml` → `nsis.include: build/installer.nsh` (jawnie, choć to
i tak domyślna ścieżka gdy `nsis.include` nie jest ustawione —
`packager.getResource` szuka `installer.nsh` w `buildResourcesDir`).
`${APP_EXECUTABLE_FILENAME}` to stała electron-buildera (`common.nsh:16`,
`"${PRODUCT_FILENAME}.exe"`) — ta sama, której używają własne szablony
frameworka — więc nazwa exe w regule nie może rozjechać się z `productName`.
Instalacja jest zawsze `perMachine` (B3), więc `$INSTDIR` jest stały i sekcja
instalacji już działa podniesiona (UAC wymuszony przez
`RequestExecutionLevel admin` gdy `INSTALL_MODE_PER_ALL_USERS` — patrz
`common.nsh`) — `netsh` nie potrzebuje osobnej eskalacji. Błąd `netsh` loguje
ostrzeżenie przez `DetailPrint` i **nie przerywa instalacji** — to warstwa
dodatkowa (jedyna spoza Chromium), nie ostatnia linia obrony; instalacja nie
może zależeć od tego, czy usługa Zapory Windows jest akurat włączona.

**Zweryfikowane adwersaryjnie:** żeby wykluczyć „build przechodzi po cichu,
bo `nsis.include` wskazuje w pustkę" (`!ifmacrodef` nie zgłasza błędu przy
brakującym pliku — po prostu nic nie wstawia), do `customInstall` wstrzyknięto
celowo złamany token (`THIS_IS_A_DELIBERATE_SYNTAX_ERROR_FOR_VERIFICATION`) i
uruchomiono pełny `npx electron-builder --config electron-builder.yml`.
Kompilator NSIS zgłosił:
```
Invalid command: "THIS_IS_A_DELIBERATE_SYNTAX_ERROR_FOR_VERIFICATION"
Error in macro customInstall on macroline 1
!include: error in script: "installSection.nsh" on line 82
```
— błąd nazywa dokładnie nasze makro (`customInstall`) i dokładnie tę linię w
`installSection.nsh`, w której szablon je wstawia. Dowód nie do podrobienia:
plik jest naprawdę czytany i kompilowany, nie pomijany. Token cofnięty,
`npx electron-builder --config electron-builder.yml` przeszedł ponownie bez
błędów — `release/LokalnyAnonimizator-Setup-0.1.0.exe` odbudowany w dobrym
stanie.

**Żywy test wykonany przez Alana (2026-07-11) — wszystkie trzy kroki:**
1. ~~Uruchomić `release\LokalnyAnonimizator-Setup-0.1.0.exe`, potwierdzić monit UAC.~~ **Zrobione.**
2. ~~`Get-NetFirewallApplicationFilter -Program "..." | Get-NetFirewallRule` → reguła `Lokalny anonimizator (block out)`.~~ **Zrobione, dopasowanie dokładne (patrz wyżej).**
3. ~~Odinstalować → to samo polecenie **nie powinno** już nic zwracać.~~ **Zrobione — `No MSFT_NetApplicationFilter objects found`, reguła usunięta.**

**Znane ograniczenia (już w checkliście, nie ukrywać):** lokalny administrator
może usunąć lub wyłączyć regułę w dowolnym momencie; reguła nie obejmuje
`shell.openExternal` (SECURITY.md §5) — to osobny proces, przeglądarka
systemowa.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** skrypt NSIS (`include`/`script` w `electron-builder.yml` nsis).
**Dlaczego:** D4 pkt 3. Jedyna proponowana warstwa **spoza Chromium**.
```nsis
; installer:
netsh advfirewall firewall add rule name="Lokalny anonimizator (block out)" \
  dir=out program="$INSTDIR\Lokalny anonimizator.exe" action=block enable=yes
; uninstaller: usunąć regułę
```
Ograniczenia (zapisać w dokumentacji): admin może zdjąć regułę, nie obejmuje
`shell.openExternal` (inny proces), ścieżka musi być stała → współgra z B3.

### S-NET-4 — Niezmiennik „brak modułów sieciowych" zakuty w test
**Gdzie:** nowy test w `e2e/` albo `vitest`.
**Dlaczego:** D4 pkt 4, C-NET-6. Dziś to dyscyplina, nie mechanizm.
```js
// test: żaden plik w electron/** nie importuje node:net|http|https|dns|tls|dgram|child_process
```
Plus druga asercja: `dist-desktop/**` nie zawiera `new WebSocket(`,
`RTCPeerConnection`, `navigator.sendBeacon`. Po B2 przechodzi na zielono i
pilnuje regresji WebMCP.

### S-NET-5 — Porównanie originu w `will-navigate` i `will-redirect` bez pułapki prefiksu — NAPRAWIONE
**Status:** naprawione (2026-07-10). Logika wydzielona do nowego pliku
`electron/nav-policy.mjs` (`isSameOriginAsApp`), na wzór `main-links.mjs` —
testowalna bez bootowania Electrona. Współdzielona przez `will-navigate`
**i** `will-redirect` w `electron/main.mjs` → `hardenWebContents()`, więc oba
egzekwują identycznie z jednego miejsca. Checklist: **C-NET-13 → PASS**,
**C-NET-14 → PASS** (pozycja `will-redirect` nie miała wcześniej własnego
szkicu w tym pliku — dołączona tu, bo naprawiona tą samą zmianą).

**Pułapka złapana w trakcie implementacji, warta zapisania:** pierwsza wersja
porównywała `new URL(url).origin === APP_ORIGIN`. `app:` jest schematem
**nie-specjalnym** w WHATWG URL, więc `.origin` serializuje go do literalnego
stringa `"null"` — porównanie milcząco zwracało `false` dla **każdego**
`app://` URL-a, w tym legalnej nawigacji wewnątrz aplikacji. Złapane od razu
testem jednostkowym (`electron/nav-policy.test.js`, przypadek „accepts the
app origin itself"), zanim trafiło do `main.mjs`. Poprawka: porównanie po
`protocol` + `host`, nie po `.origin` — działa poprawnie dla schematów
specjalnych (http/https) i nie-specjalnych (`app:`) jednakowo. Ta sama pułapka
była już znana w `electron/network-guard.mjs` (`isAppOrigin` dla uprawnień),
ale nie było jej udokumentowanego testu — teraz jest, w nowym module.

**Zweryfikowane:** `electron/nav-policy.test.js` (6 przypadków: origin
aplikacji, brak dev-servera, dev-server dozwolony, look-alike host odrzucony
— dokładnie błąd z tej pozycji, różny schemat/port odrzucony, URL
nieparsowalny). `npm test` w całości, `npm run desktop:build:renderer`, `npm
run desktop:smoke`, `npm run desktop:smoke:packaged` przechodzą bez zmian.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs:79-86`.
**Dlaczego:** C-NET-13. `url.startsWith(DEV_SERVER_URL)` bez końcowego ukośnika
przepuści `http://localhost:5183.evil.com`. Dotyczy tylko trybu dev, ale wzorzec
ma być poprawny.
```js
const target = new URL(url);
const sameOrigin = target.origin === APP_ORIGIN
  || (DEV_SERVER_URL && target.origin === new URL(DEV_SERVER_URL).origin);
```
Porównywać `origin`, nie prefiks stringa.

### S-LOG-1 — `network-guard` loguje origin, nie pełny URL — NAPRAWIONE
**Status:** naprawione (2026-07-10). `electron/network-guard.mjs`:
`describeOrigin` wyeksportowany (był prywatny) i log przy pierwszych trzech
trafieniach zmieniony z pełnego `details.url` na `describeOrigin(details.url)`
+ `details.resourceType`. Checklist: **C-PERS-7 → PASS**.

**Przy okazji (ta sama linia, ten sam powód):** `electron/main.mjs` — logi
`will-navigate`/`will-redirect` (S-NET-5) i `window.open blocked` też
przepisane na `describeOrigin(url)`, zgodnie z uwagą „spójność reguły warta
utrzymania" niżej.

**Zweryfikowane:** nowy `electron/network-guard.test.js` (3 przypadki:
origin bez ścieżki/query/fragmentu dla schematów specjalnych, `app:` nigdy nie
ujawnia hosta/ścieżki, fallback dla URL-i nieparsowalnych). `npm test` w
całości, `npm run desktop:smoke` przechodzi bez zmian.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/network-guard.mjs:81`.
**Dlaczego:** `THREAT-MODEL.md` §4 S6 pkt 1, C-PERS-7. Pełny URL może nieść PII,
którą `--enable-logging` zapisze na dysk.
```js
console.warn(`[network-guard] BLOCKED ${details.method} ${describeOrigin(details.url)} `
  + `(${details.resourceType}, total: ${stats.blockedTotal})`);
```
`describeOrigin` już istnieje (`:33`). Analogicznie przejrzeć `electron/main.mjs:83,97`
(logują URL nawigacji/`window.open`) — tam ryzyko mniejsze (to nie treść
dokumentu), ale spójność reguły warta utrzymania.

### S-LOG-2 — Jawne umiejscowienie i czyszczenie crashDumps — ZMIERZONE, kod niepotrzebny
**Status:** zmierzone empirycznie (2026-07-11); pomiar obalił przesłankę
szkicu, więc **kod nie został dodany**. Checklist: **C-PERS-5 → PASS**.

**Pomiar:** Playwright `_electron.launch()` uruchomił aplikację w trybie repo;
`app.evaluate` odczytał bezpośrednio z działającej aplikacji (bez zgadywania
ścieżki) `app.getPath('userData')` = `%APPDATA%\pii-anonymizer` i
`app.getPath('crashDumps')` = `%APPDATA%\pii-anonymizer\Crashpad`.
`webContents.forcefullyCrashRenderer()` wymusił prawdziwy crash renderera —
proces główny zalogował `[main] renderer gone: crashed 2` (istniejący handler
`render-process-gone` w `electron/main.mjs`) już po ~1 s, więc crash na pewno
się wydarzył, to nie było niewykonane wywołanie. Po **15 sekundach**
oczekiwania: `Crashpad/` istniał (pusty katalog, tworzony przez Chromium przy
starcie niezależnie od crasha), ale bez podkatalogu `reports/` i bez
jakiegokolwiek pliku — ani przed, ani po crashu. `%LOCALAPPDATA%\pii-anonymizer`
w ogóle nie istnieje (wykluczona alternatywna lokalizacja).

**Wniosek:** bez wywołania `crashReporter.start()` Crashpad nie jest uzbrojony
— nie instaluje handlera wyjątków — więc crash renderera nie produkuje
zrzutu do wyniesienia, niezależnie od tego, na co wskazywałby
`app.setPath('crashDumps', …)`. Dodanie przekierowania + czyszczenia katalogu,
do którego i tak nic nie pisze, byłoby atrapą sugerującą zamknięty temat —
dlatego kod ze szkicu niżej **nie został wdrożony**. Jeśli `crashReporter.start()`
zostanie kiedyś świadomie dodany (np. do lokalnej diagnostyki), ten szkic
wraca do gry i powinien wejść razem z nim, nie wcześniej.

**Ryzyko rezydualne, nieusuwalne z poziomu aplikacji:** Windows Error
Reporting (WER) działa na poziomie systemu operacyjnego niezależnie od tego,
czy aplikacja woła `crashReporter.start()`. To pozostaje ryzykiem **R3**
(kontrola organizacyjna — polityka WER, szyfrowanie dysku), nie jest i nie
może zostać zamknięte kodem tej aplikacji.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs` przy starcie.
**Dlaczego:** `THREAT-MODEL.md` §4 S6 pkt 2, C-PERS-5.
```js
app.setPath('crashDumps', join(app.getPath('temp'), 'lokalny-anonimizator-crash'));
// przy starcie: skasować zawartość tego katalogu
```
Najpierw **zweryfikować** (C-LOG-2), czy mimo braku `crashReporter.start()`
powstaje `Crashpad/`. Dopisać do dokumentacji, że WER na poziomie OS jest poza
zasięgiem aplikacji (R3) i wymaga kontroli organizacyjnej.

### S-LOG-3 — Panel debug wyłączony na desktopie — NAPRAWIONE
**Status:** naprawione (2026-07-11), dokładnie wg szkicu niżej. Checklist:
**C-PERS-8 → PASS**.

**Zweryfikowane:** w przeglądarce, na buildzie webowym (`npm run dev`,
`tool.html?debug=1`) — `typeof window.desktopApp === 'undefined'`, więc
`!window.desktopApp?.isDesktop` daje zawsze `true` na webie, zachowanie
identyczne jak przed zmianą (potwierdzone bezpośrednio w konsoli, nie tylko
wyprowadzone z kodu). Na desktopie jedyne miejsce, które odsłania
`debugSection` (`src/main.js:1204`), jest zagnieżdżone pod tym samym
`isDebug`, więc przycisk „Kopiuj JSON debug" (`:1391-1393`, wrzuca legendę do
schowka) staje się nieosiągalny — także po nawigacji na
`app://app/tool.html?debug=1` (`will-navigate` by ją przepuścił, to nawigacja
w obrębie originu, ale teraz nie ma to znaczenia, bo panel się nie odsłoni).
`npm run desktop:smoke` i `npm run desktop:smoke:packaged` przechodzą bez
zmian.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `src/main.js:58` lub `:1311` (`renderDebugPanel`).
**Dlaczego:** `THREAT-MODEL.md` §4 S7, C-PERS-8. Przycisk „Kopiuj JSON debug"
wrzuca całą legendę do schowka; dostępny po nawigacji na `?debug=1`.
```js
const isDebug = urlParams.get('debug') === '1' && !window.desktopApp?.isDesktop;
```
Zamyka też pośrednio ścieżkę „S4 → legenda w schowku".

### S-MCP-1 — Jeśli MCP wraca: jawny podgląd przed udostępnieniem
**Gdzie:** ścieżka udostępnienia źródła LLM-owi (dziś `src/mcp/listings.js`).
**Dlaczego:** `THREAT-MODEL.md` §4 S3, ryzyko R1, decyzja D1. Bramka „co najmniej
jedna encja" nie gwarantuje kompletności; przeoczone PII wychodzi surowe.
**Jak:** zanim źródło stanie się czytelne przez jakikolwiek transport MCP,
pokazać użytkownikowi **dokładnie ten tokenizowany tekst, który wyjdzie**, i
wymagać potwierdzenia. Plus poprawić język w `CLAUDE.md` i `docs/webmcp.md`:
zamiast „document bodies cross only as tokenized text" napisać, że wychodzi
tekst po tokenizacji **wykrytych** encji, a kompletność zależy od modelu.
To korekta obietnicy wobec radcy związanego tajemnicą, nie kosmetyka.

### S-SUP-1 — `onnxruntime-node` do devDependencies — NAPRAWIONE
**Status:** naprawione (2026-07-11). `package.json`: `onnxruntime-node`
przeniesiony z `dependencies` do `devDependencies` (wersja bez zmian,
`^1.24.3`); `npm install` zaktualizował `package-lock.json` (tylko flaga
`"dev": true` na istniejącym wpisie, `resolved`/`integrity` bez zmian).
Checklist: **C-PKG-5 → PASS**.

**Zweryfikowane:** grep na `onnxruntime-node` w `src/` i `electron/` przed
zmianą — zero importów poza plikami dokumentacji/configu (`package.json`,
`package-lock.json`, `SECURITY-CHECKLIST.md`, `SECURITY-FIXES.md`,
`THREAT-MODEL.md`, `CLAUDE.md`). Jedyny faktyczny konsument to
`src/eval/run.js` przez `@huggingface/transformers` (biblioteka wybiera
backend Node przy uruchomieniu w Node, `onnxruntime-web` w
przeglądarce/rendererze — `src/eval/*` nigdy nie trafia do paczki
desktopowej). `npm test` (569/569, te same 12 znanych błędów
`ERR_REQUIRE_ESM` co przed zmianą — środowiskowe, patrz `CLAUDE.md`),
`npm run build`, `npm run desktop:build:renderer`, `desktop:smoke`,
`desktop:smoke:packaged` przechodzą bez zmian. `sharp` i `protobufjs`
**zostają** w `dependencies` — transitive przez `@huggingface/transformers`,
potrzebne w rendererze/workerze w runtime, poza zakresem tej poprawki (patrz
S-SUP-3 dla `npm ci` jako warunek, żeby lockfile rządził przy buildzie
dystrybucyjnym).

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `package.json:42`.
**Dlaczego:** `THREAT-MODEL.md` §4 S9 pkt 1, C-PKG-5. Używany wyłącznie przez
`src/eval/*` (narzędzie ewaluacyjne), ma skrypt instalacyjny pobierający natywne
binaria, a siedzi w `dependencies`. Przenieść do `devDependencies`. `sharp` i
`protobufjs` są transitive przez `@huggingface/transformers`, więc zostają, ale
build dystrybucyjny ma iść przez `npm ci` (S-SUP-3), żeby lockfile rządził.

### S-SUP-2 — Pinowanie modeli do SHA commita + kotwica sum w repo
**Gdzie:** `scripts/fetch-models.mjs:40-56`.
**Dlaczego:** `THREAT-MODEL.md` §4 S9 pkt 2, C-INT-7, C-INT-8. `/resolve/main/`
to trust-on-first-use.
**Jak:** zamienić `main` na konkretny SHA commita repozytorium HF w URL-u
(`/resolve/<sha>/`), a oczekiwane sumy SHA-256 modeli zapisać do pliku
**zacommitowanego ręcznie** (`scripts/model-hashes.json`), niezależnego od
`models/manifest.json` generowanego przy pobraniu. `verify-models.mjs` ma
porównywać z tą kotwicą, nie z produktem własnego pobrania. Ta sama lista sum
zasila B1.

### S-SUP-3 — Build dystrybucyjny przez `npm ci`
**Gdzie:** `package.json:18` / dokumentacja wydania / przyszły workflow.
**Dlaczego:** C-PKG-4. `desktop:build` zakłada zainstalowane drzewo.
Udokumentować, że instalator powstaje wyłącznie po świeżym `npm ci` z
zacommitowanego lockfile.

### S-IPC-1 — Walidacja nadawcy w handlerze IPC — NAPRAWIONE
**Status:** naprawione (2026-07-10). `electron/main.mjs`, handler
`ipcMain.handle('pii:desktop-info', ...)` zaimplementowany dokładnie wg
szkicu niżej: `event.senderFrame?.url` musi zaczynać się od `${APP_ORIGIN}/`,
inaczej zwraca `null`. Checklist: **C-IPC-4 → PASS**.

**Świadomy efekt uboczny, do decyzji Alana:** sprawdzenie jest zawężone do
`APP_ORIGIN` dokładnie tak, jak proszono — bez wyjątku dla
`DEV_SERVER_URL`. W `npm run desktop:dev` strona ładuje się z originu Vite,
więc `window.desktopApp.getInfo()` zwróci tam `null`. Dziś nic w `src/`
tego nie konsumuje (jedyny konsument to `e2e/desktop-smoke.mjs`, który zawsze
ładuje z `app://`, w obu trybach repo i packaged), więc to nieszkodliwe. Jeśli
w przyszłości przyda się diagnostyka w trybie dev, wyjątek dla
`DEV_SERVER_URL` można dołożyć analogicznie do `will-navigate`
(`electron/nav-policy.mjs` już to potrafi) — celowo tego nie zrobiono bez
pytania, żeby nie poszerzać cichaczem zbioru originów akceptowanych przez
kanał IPC.

**Zweryfikowane:** `npm run desktop:smoke` (tryb repo, `app://`) —
`window.desktopApp.getInfo()` nadal zwraca poprawny obiekt (`preload bridge
exposes desktopApp` PASS), `npm run desktop:smoke:packaged` tak samo.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs:188`.
**Dlaczego:** C-IPC-4. Kanał zwraca dziś tylko wersje i licznik (ryzyko niskie),
ale wzorzec musi być poprawny, zanim dojdzie drugi kanał.
```js
ipcMain.handle('pii:desktop-info', (event) => {
  const url = event.senderFrame?.url ?? '';
  if (!url.startsWith(`${APP_ORIGIN}/`)) return null;
  return { /* ... */ };
});
```

### S-ISO-1 — `app.enableSandbox()` — NAPRAWIONE
**Status:** naprawione (2026-07-11). `electron/main.mjs`: `app.enableSandbox()`
wywołane przed `app.whenReady()`, obok istniejącego bloku `appendSwitch`.
Checklist: **C-ISO-3 → PASS**.

**Zweryfikowane:** `npm run desktop:build:renderer`, `npm run desktop:smoke`
(tryb repo) i `npm run desktop:smoke:packaged` (świeżo przebudowany
`win-unpacked`, fuses ponownie wbite) przechodzą bez zmian — worker NER/OCR
(Web Worker wewnątrz renderera, nie osobny `webContents`) nietknięty.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs`, przed `app.whenReady()`.
**Dlaczego:** C-ISO-3. Dziś `sandbox: true` jest tylko na oknie głównym.
`web-contents-created` (`:204`) nie ustawi `webPreferences` na już utworzonym
`webContents`, więc przyszłe okno mogłoby powstać bez sandboxa.
`app.enableSandbox()` wymusza go globalnie.

### S-INP-1 — `isEvalSupported: false` w pdf.js — NAPRAWIONE
**Status:** naprawione (2026-07-11), dokładnie wg szkicu niżej. Checklist:
**C-INP-7 → PASS**.

**Zweryfikowane:** `npm test` (`src/file-import/pdf.test.js`, 20/20, w tym
przypadki stron OCR-owanych), `npm run desktop:smoke` i
`npm run desktop:smoke:packaged` (OCR skanu PDF nadal wyciąga tekst) przechodzą
bez zmian.

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `src/file-import/pdf.js:99`.
**Dlaczego:** `THREAT-MODEL.md` §4 S4, C-INP-7.
```js
loadingTask = pdfjs.getDocument({ data: buf, wasmUrl: getPdfWasmUrl(), isEvalSupported: false });
```
pdf.js spadnie na interpreter funkcji typu 4. Zmniejsza zależność od
`'unsafe-eval'` i domyka jeden z dwóch powodów jego obecności.

---

## NICE (kolejny etap)

### N-1 — OpenCV wyłącznie do workera → usunąć `'unsafe-eval'` z CSP strony
**Gdzie:** SDK PaddleOCR / `electron/app-protocol.mjs:61`. `THREAT-MODEL.md` §4 S4,
C-INP-8. Największa pojedyncza poprawa czystości CSP, ale wymaga pracy w SDK.

### N-2 — Trusted Types + `frame-ancestors 'none'`
**Gdzie:** `electron/app-protocol.mjs:59-79`. C-INP-12. `require-trusted-types-for
'script'` zamienia całą klasę sinków DOM w błąd runtime. Dziś kod i tak używa
`textContent`, więc koszt wdrożenia niski.

### N-3 — Czyszczenie cache przy wyjściu + jawna odmowa mediów
**Gdzie:** `electron/main.mjs`. C-PERS-6, C-PERS-11.
`session.clearStorageData()`/`clearCache()` przy `window-all-closed`;
`setDisplayMediaRequestHandler((_r, cb) => cb())` (odmowa) i
`setDevicePermissionHandler(() => false)`.

### N-4 — `--disable-features=MediaRouter,DialMediaRouteProvider,CastMediaRouteProvider` — NAPRAWIONE, zmierzone żywo
**Status:** naprawione i zmierzone (2026-07-11). Switch dodany w
`electron/main.mjs`, obok pozostałych `appendSwitch`, zgodnie ze szkicem
niżej — dodany **niezależnie od wyniku pomiaru**, bo oryginalna instrukcja
przewidywała dodanie w obu gałęziach (emituje / nie emituje). Checklist:
**C-NET-5 → PASS**.

**Pomiar wykonany przez Alana (2026-07-11, Wireshark) — z pułapką po drodze,
warto ją zapisać:**

1. Przechwytywanie na interfejsie Wi-Fi, filtr `udp.port == 5353 or
   udp.port == 1900`, przez cały czas działania
   `release\win-unpacked\Lokalny anonimizator.exe` (uruchomiony, odczekane
   ~60 s, zamknięty). Wynik pierwszego rzutu oka: **4 pakiety MDNS** —
   wyglądało to na porażkę.
2. **Pułapka:** przechwytywanie na Wi-Fi widzi cały ruch multicast w sieci
   lokalnej, nie tylko to, co wysyła własna maszyna. Wszystkie 4 pakiety
   miały `ip.src == 192.168.1.1`. Alan sprawdził swój własny adres
   (`ipconfig`): `192.168.1.11` — **inny** niż nadawca pakietów. `192.168.1.1`
   to niemal na pewno brama/router, robiąca własne, cykliczne ogłoszenie
   `_services._dns-sd._udp.local` co ~30 sekund (odstępy pakietów: 17s, 47s,
   77s, 107s — dłużej niż aplikacja była w ogóle otwarta), zupełnie
   niezależnie od tego, czy aplikacja działa.
3. **Rozstrzygnięcie bez potrzeby nowego przechwytywania:** dofiltrowanie tego
   samego przechwycenia do `(udp.port == 5353 or udp.port == 1900) and
   ip.src == 192.168.1.11` (czyli: tylko to, co wysłał komputer, na którym
   faktycznie działała aplikacja) dało **listę pustą**. Zero pakietów mDNS/DIAL
   z maszyny uruchamiającej aplikację.

**Wniosek:** aplikacja nie emituje mDNS/DIAL — ani z powodu switcha, ani być
może nigdy tego nie robiła (nie zmierzono osobno stanu „przed", Alan pominął
ten opcjonalny krok, uznane za wystarczające, bo pomiar „po" jest tym, co
naprawdę zamyka pozycję checklisty). Cztery pierwsze pakiety to szum sieciowy
niezwiązany z aplikacją — zapisane jako metodologiczna uwaga na przyszłość:
**każdy kolejny pomiar tego typu musi filtrować po `ip.src` maszyny
testowej**, inaczej wynik jest zanieczyszczony ruchem innych urządzeń w sieci
(routery, drukarki, Chromecasty, telefony — mDNS/SSDP to zwyczajowo gęsty
ruch na każdej sieci domowej/biurowej).

**Oryginalny opis problemu i szkic (poniżej), zachowany jako zapis decyzji:**

**Gdzie:** `electron/main.mjs:40-42`. D4, C-NET-5. **Najpierw zmierzyć** (C-NET-5),
czy Electron w ogóle emituje mDNS/DIAL; jeśli tak, ten przełącznik zamyka
multicast UDP niewidzialny dla `webRequest`.

### N-5 — Kontrolka „Zakończ i wyczyść" (uczciwy panic wipe)
**Gdzie:** UI + `electron/main.mjs`. Decyzja D2. Jedyny wiarygodny wipe legendy
z RAM to zakończenie procesu: zerowanie referencji + `clearStorageData` +
`app.exit(0)`. Nie sprzedawać przycisku „wyczyść", który nie kończy procesu.

---

## Czego NIE robić

- **Nie** dodawać wyjątku `ws://127.0.0.1` do CSP/strażnika dla MCP (D1(a)):
  trwała, nieodwracalna dziura dla wszystkich przyszłych wersji.
- **Nie** wprowadzać serwera HTTP na loopbacku (nawet dla MCP): dokłada
  nasłuchujące gniazdo TCP i zmusza main do importu `node:http`, łamiąc
  zweryfikowany niezmiennik C-NET-6. Jeśli MCP wraca — nazwany potok albo stdio.
- **Nie** włączać `safeStorage` do trwałego zapisu legendy jako „zabezpieczenia"
  (D2): DPAPI nie broni przed atakującym z modelu (Z4), a tworzy artefakt
  o wartości akt tam, gdzie dziś jest zero.
- **Nie** usuwać żadnej z warstw sieciowych jako „redundantnej": defense in
  depth jest tu celem, nie przypadkiem. WebRTC-policy, CSP i `webRequest`
  łapią **różne** kanały (zmierzone w poprzednim etapie).
- **Nie** poszerzać `EXTERNAL_LINK_ALLOWLIST` wildcardem ani prefiksem
  (`electron/main-links.mjs`): to jedyne sankcjonowane wyjście do sieci, każda
  pozycja to świadoma decyzja.
