# THREAT-MODEL.md — „pii.tools Desktop" / Lokalny anonimizator

**Wersja:** przebieg 1 (audyt po szkielecie Electrona), 2026-07-10
**Zakres:** build desktopowy (Electron 43 / Chromium 150), Windows x64.
**Metoda:** przegląd kodu ze świeżym kontekstem, cztery niezależne osie audytu
(sinki DOM i parsery, łańcuch dostaw i egress, trwałość lokalna, WebMCP),
skonfrontowane z istniejącym `SECURITY.md` i zweryfikowane przeze mnie punktowo
w kodzie.

**Relacja do `SECURITY.md`:** tamten dokument opisuje, **co zbudowano**. Ten
opisuje, **przed czym to ma bronić, gdzie nie broni i co z tego wynika**.
Sprzeczności między nimi zaznaczam jawnie.

## §0. Założenia (jeśli któreś jest fałszywe, model traci ważność)

| # | Założenie | Status |
|---|---|---|
| Z1 | Maszyna użytkownika nie jest już skompromitowana w momencie instalacji. | przyjęte, niesprawdzalne przez aplikację |
| Z2 | Użytkownik (radca) jest zaufany, ale nie jest ekspertem bezpieczeństwa i kliknie „Uruchom mimo to" w SmartScreen. | przyjęte, realistyczne |
| Z3 | Dokumenty wejściowe są **niezaufane**: pochodzą od przeciwnika procesowego, komornika, klienta, ze skanera. | przyjęte, to sedno modelu |
| Z4 | Atakujący może wykonać kod na koncie użytkownika **bez podniesienia uprawnień** (typowy malware, złośliwy instalator, makro). | przyjęte, to najważniejszy atakujący |
| Z5 | Dysk jest szyfrowany BitLockerem. | **NIEZWERYFIKOWANE**, kontrola organizacyjna, patrz R3 |
| Z6 | `EnableEmbeddedAsarIntegrityValidation` faktycznie działa na Windows w tej wersji electron-buildera. | **DO WERYFIKACJI**, patrz C-INT-3 w checkliście |

## §1. Aktywa

| ID | Aktyw | Gdzie żyje | Skutek utraty |
|---|---|---|---|
| **A1** | **Legenda** (token → dane osobowe) | wyłącznie RAM renderera, `src/main.js:44` `let legend = {}` | **Katastrofalny.** Legenda plus tekst tokenizowany rekonstruuje pełne akta. |
| **A2** | Oryginalna treść dokumentu | RAM renderera (`sources[].text`), oryginał na dysku użytkownika | Katastrofalny, tajemnica zawodowa (art. 3 u.r.p.) |
| **A3** | **Poprawność detekcji PII** | modele ONNX w `resources/models/` | **Katastrofalny i cichy.** Awaria fail-open: użytkownik wkleja „zanonimizowany" tekst z PESEL-em do LLM-a w chmurze. |
| A4 | Tekst tokenizowany (wynik) | RAM, schowek, eksport | Niski. Z założenia przeznaczony do wyniesienia. |
| A5 | Integralność binarki i modeli | katalog instalacji | Wysoki, jest nośnikiem A3. |
| A6 | Metadane pracy (nazwy plików) | UI, `mcpLabel` | Średni. Nazwa pliku `Pozew_Kowalski_vs_mBank.pdf` sama jest PII. |

Hierarchia: **A3 przed A1**. Wyciek legendy wymaga, żeby atakujący był już
w procesie. Cicha degradacja detekcji sprawia, że **użytkownik sam wynosi dane
na zewnątrz**, dobrowolnie i bez żadnego alertu. To jest specyficzne dla tego
produktu i dlatego steruje priorytetami poprawek.

## §2. Granice zaufania

```
 [ Internet ]  <-- brak jakiejkolwiek ścieżki, poza (G4)
      |
 ═════╪══════════════════════ G4: shell.openExternal (jedyne sankcjonowane wyjście)
      |                            electron/main-links.mjs:33 (allowlista dokładnych URL-i)
      |
 ┌────┴──────────────────────────────────────────────────┐
 │ PROCES GŁÓWNY (Node, pełne uprawnienia OS)            │
 │  electron/main.mjs, network-guard.mjs, app-protocol   │
 │  NIE importuje node:net/http/https/dns/tls/dgram      │ <-- zweryfikowane
 └────┬──────────────────────────────────────────────────┘
 ═════╪══════════════════════ G2: IPC. Jeden kanał: 'pii:desktop-info'
      │                            electron/preload.cjs:21 (zamrożony obiekt)
 ┌────┴──────────────────────────────────────────────────┐
 │ RENDERER (sandbox OS, contextIsolation, bez Node)     │
 │  ┌──────────────────────────────────────────────────┐ │
 │  │ WORKER: NER + OCR, WASM (ORT, OpenCV, libheif)   │ │
 │  └──────────────────────────────────────────────────┘ │
 │  A1 legenda, A2 tekst  <-- tu żyją najcenniejsze aktywa│
 └────┬──────────────────────────────────────────────────┘
 ═════╪══════════════════════ G1: parsery dokumentów. NAJWAŻNIEJSZA GRANICA.
      │                            pdf.js / mammoth / heic-to / PaddleOCR
 [ NIEZAUFANY PLIK: PDF, DOCX, HEIC, skan ]

 ═════ G3: granica zasobów: app.asar (chroniony fuse'em) vs resources/models/ (NIECHRONIONY)
```

Cztery granice, cztery różne poziomy dojrzałości:

- **G1 (niezaufany plik → renderer):** dobrze zamknięta na poziomie DOM,
  otwarta na poziomie WASM. Patrz S4.
- **G2 (IPC):** wzorcowa. Jeden kanał, tylko odczyt, zamrożony obiekt.
  Brakuje walidacji nadawcy, patrz F-IPC-1.
- **G3 (integralność zasobów):** **dziurawa.** Modele leżą poza asarem,
  bez weryfikacji w runtime. Patrz S1, to główne znalezisko tego audytu.
- **G4 (egress):** bardzo dobra, ale oparta w większości na jednym mechanizmie
  Chromium. Patrz S5 i decyzja D4.

## §3. Wektory według STRIDE, mapowane na granice

| STRIDE | Wektor | Granica | Stan |
|---|---|---|---|
| **S**poofing | Fałszywy instalator podszywa się pod aplikację | G3 | **OTWARTE**, brak podpisu kodu (`electron-builder.yml:56-60`) |
| **T**ampering | Podmiana `resources/models/*.onnx` | G3 | **OTWARTE**, patrz S1 |
| **T**ampering | Podmiana `app.asar` | G3 | częściowo, fuse `EnableEmbeddedAsarIntegrityValidation` (Z6) |
| **T**ampering | DLL sideloading w katalogu instalacji | G3 | **OTWARTE**, `perMachine: false` |
| **R**epudiation | (nie dotyczy: brak kont, brak audytu, jednoosobowa kancelaria) | – | świadomie poza zakresem |
| **I**nfo disclosure | Egress siecią z renderera | G4 | zamknięte: CSP + webRequest + polityka UDP |
| **I**nfo disclosure | Egress kanałem niewidzialnym dla `webRequest` | G4 | **CZĘŚCIOWO**, patrz S5 |
| **I**nfo disclosure | PII w logach / dumpach / pliku wymiany | G3 | **OTWARTE**, patrz S6 |
| **I**nfo disclosure | Legenda → schowek przez `?debug=1` | wewn. | **OTWARTE**, patrz S7 |
| **I**nfo disclosure | Fałszywy negatyw NER przechodzi przez MCP | G4 | **NIEUSUWALNE**, patrz S3 i R1 |
| **D**oS | Bomba dekompresyjna / encje XML w DOCX | G1 | ograniczone limitem 25 MB (`src/file-import/index.js:10`) |
| **E**levation | RCE przez parser dokumentu | G1 | patrz S4 |
| **E**levation | Ucieczka z sandboxa renderera | G2 | zależna od Chromium, `sandbox: true` |

## §4. Scenariusze ataku

Skala skutku: **K**atastrofalny, **W**ysoki, **Ś**redni, **N**iski.
Prawdopodobieństwo przy założeniu Z4 (atakujący wykonuje kod jako użytkownik).

---

### S1. Cicha podmiana modelu NER → detekcja PII przestaje działać
**Skutek: K. Prawdopodobieństwo: średnie. Ryzyko: KRYTYCZNE. Status: OTWARTE (bloker B1/B3/B4).**

Łańcuch:
1. `electron-builder.yml:23-28` wypycha modele do `extraResources`, czyli
   **poza `app.asar`**. Fuse `EnableEmbeddedAsarIntegrityValidation`
   (`scripts/afterpack-fuses.cjs:30`) chroni **wyłącznie archiwum asar**.
   Modele nie są objęte niczym.
2. `electron-builder.yml:27-28` jawnie **wyklucza `manifest.json`** z paczki.
   Spakowana aplikacja nie zawiera więc żadnych referencyjnych sum SHA-256.
   `scripts/verify-models.mjs` jest bramką **czasu budowania**, nie runtime.
3. `nsis.perMachine: false` instaluje do `%LOCALAPPDATA%\Programs\…`, katalogu
   **zapisywalnego przez zwykły proces użytkownika**, bez UAC.
4. `electron/app-protocol.mjs:200` strumieniuje plik z dysku bez żadnej
   weryfikacji: `Readable.toWeb(createReadStream(filePath))`.

Skutek: proces bez uprawnień administratora podmienia `model_quantized.onnx`
na model, który zwraca zero encji dla nazwisk i PESEL-i. UI zachowuje się
normalnie, licznik zablokowanych żądań dalej pokazuje zero, testy dymne
przechodzą. Użytkownik kopiuje „zanonimizowany" tekst i wkleja go do Claude'a.
**Aplikacja zawodzi w trybie fail-open i nie ma jak tego zauważyć.**

To jest najgroźniejszy scenariusz w całym modelu, bo omija cały misternie
zbudowany air-gap: dane wychodzą kanałem, który jest z założenia dozwolony,
czyli schowkiem użytkownika.

**Mitigacja:** patrz poprawki B1 (integralność w runtime), B3 (`perMachine`),
B4 (podpis kodu). Bez wszystkich trzech naraz każda z osobna jest do obejścia:
podpis bez ochrony katalogu nie broni modeli, a integralność asara bez podpisu
nie broni niczego, bo atakujący przepisze też zasób PE z oczekiwanym hashem.

---

### S2. Uśpiony klient WebMCP budzi się
**Skutek: K. Prawdopodobieństwo: niskie dziś, rosnące. Status: OTWARTE (bloker B2).**

`tool.html:168` ładuje `webmcp.js` także w buildzie desktopowym, a
`src/main.js:1430` tworzy instancję **bezwarunkowo**, bez `if (!window.desktopApp)`.
Kod klienta (`public/webmcp.js:83-113`) przy każdym starcie strony sam
próbuje wznowić połączenie WebSocketem, **bez interakcji użytkownika**, pod
adres zdekodowany z base64 tokenu w `localStorage` (`public/webmcp.js:1022-1034`).
Adres serwera pochodzi w całości z tokenu, więc aplikacja połączy się tam,
gdzie każe jej token.

Dziś to nie strzela, bo blokują to **dwie** warstwy: CSP `connect-src` bez `ws:`
(`electron/app-protocol.mjs:66`) i strażnik sieci (`electron/network-guard.mjs:11-18`).
Ale to jest air-gap **z konfiguracji**, nie **z konstrukcji**. W paczce
dystrybucyjnej leży gotowy, samoczynnie uruchamiany klient eksfiltracji.
Regresja w jednej linii CSP go budzi.

**Mitigacja:** usunąć z builda desktopowego (B2). To jest tania poprawka
i domyka obietnicę produktu dosłownie, a nie tylko skutkowo.

---

### S3. Fałszywy negatyw NER wynosi surowy PESEL przez MCP
**Skutek: W. Prawdopodobieństwo: wysokie. Status: NIEUSUWALNE, do zarządzenia produktowo (R1).**

`src/mcp/listings.js` faktycznie egzekwuje, że przez granicę idzie wyłącznie
`applyTokens(...)` i syntetyczny `mcpLabel`, nigdy prawdziwa nazwa pliku.
Bramka odrzuca też źródła z zerową liczbą encji.

Ale `applyTokens` (`src/anonymizer.js:173-193`) podmienia **tylko te przedziały,
które NER wykrył**. Dane, których model nie znalazł, przechodzą jako **surowy
tekst**. Bramka „co najmniej jedna encja" nie mówi nic o kompletności.
Dokument z jednym wykrytym nazwiskiem i trzema przeoczonymi przejdzie.

To jest właściwość każdego anonimizatora opartego na NER, nie błąd tego kodu.
Ale w dokumentacji (`CLAUDE.md`, `docs/webmcp.md`) brzmi to jak gwarancja
(„document bodies cross the boundary only as tokenized text"), co jest
**nadmierną obietnicą wobec radcy związanego tajemnicą zawodową**.

**Mitigacja:** patrz D1 i poprawka S-MCP-1: zanim źródło stanie się czytelne
dla LLM-a, użytkownik musi zobaczyć **dokładnie ten tekst, który wyjdzie**,
i potwierdzić. Plus korekta języka w dokumentacji.

---

### S4. RCE przez spreparowany dokument
**Skutek: K. Prawdopodobieństwo: niskie. Status: dobrze ograniczone, ryzyko rezydualne R2.**

Sprawdziłem całą ścieżkę i **nie znalazłem ścieżki XSS**. To jest solidnie
zrobione i warto to zapisać:

- Tekst wyekstrahowany trafia do DOM wyłącznie przez `textContent`
  i `createTextNode` (`src/ui/annotation-editor/index.js:102,116,124,149`).
- Tabela legendy i encji escapuje przez `escHtml` (`src/main.js:1372,1410`).
- Nazwy plików idą przez `textContent` (`src/ui/sources-list/index.js:272`),
  nigdy do budowy ścieżki: pliki czyta się przez `File.arrayBuffer()`.
- **SVG nie jest akceptowanym formatem** (`src/file-import/index.js:12-31`),
  więc nie ma wstrzyknięcia skryptu przez obraz.
- DOCX: `mammoth.extractRawText` (nigdy `convertToHtml`), XML przez
  `@xmldom/xmldom`, który nie ma I/O, **więc nie ma XXE**.
- PDF: XFA domyślnie wyłączone, brak `cMapUrl`/`standardFontDataUrl`,
  worker same-origin, osadzony JavaScript PDF nigdy nie jest wykonywany.
- Path traversal w `app://` domknięty przez `safeJoin`
  (`electron/app-protocol.mjs:143-148`).

Co zostaje: **błąd pamięciowy w natywnym parserze skompilowanym do WASM**:
`jbig2`/`openjpeg` w pdf.js, `libheif` w `heic-to`, OpenCV i ORT w PaddleOCR.
WASM ma własną piaskownicę pamięci, więc pojedynczy overflow nie daje od razu
RCE na hoście, ale daje pełną kontrolę nad wynikiem parsowania, a w połączeniu
z błędem w silniku daje ucieczkę. Renderer jest w sandboxie OS
(`electron/main.mjs:119`), bez Node, więc atakujący ląduje w najciaśniejszym
miejscu, jakie mu przygotowano, i nadal nie ma jak wysłać danych (G4).

Pomniejsze: `src/file-import/pdf.js:99` nie ustawia `isEvalSupported: false`,
więc worker pdf.js może kompilować funkcje typu 4 przez `new Function`.
To wąskie, numeryczne wykonanie, nie dowolny kod z pliku, ale to właśnie ono
(obok glue OpenCV) trzyma `'unsafe-eval'` w CSP strony.

---

### S5. Eksfiltracja kanałem, którego `webRequest` nie widzi
**Skutek: K. Prawdopodobieństwo: niskie. Status: CZĘŚCIOWO otwarte, patrz D4.**

`session.webRequest.onBeforeRequest` widzi stos sieciowy Chromium. Nie widzi:

| Kanał | Stan |
|---|---|
| WebRTC / ICE / STUN (surowy UDP) | **zamknięte**, `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`, `electron/main.mjs:76`. Zmierzone: zero kandydatów ICE. |
| `node:net`, `node:dns`, `node:dgram` z procesu głównego | zamknięte **przez dyscyplinę, nie przez mechanizm**: dziś `electron/` nie importuje tych modułów (zweryfikowałem). Nic tego nie egzekwuje. |
| mDNS / DIAL (Media Router Chromium), multicast UDP w LAN | **DO WERYFIKACJI**, brak `--disable-features=MediaRouter` |
| Pobranie pliku PAC / proxy systemowe | **OTWARTE**, brak `--no-proxy-server`, brak `session.setProxy({mode:'direct'})` |
| Połączenie na literalny adres IP (bez DNS) | widzi je `webRequest`, ale nic poza nim |
| `shell.openExternal` | **z założenia otwarte**, patrz S8 |

`sendBeacon`, `<a ping>`, `<link rel=prefetch>`, `EventSource` idą przez stos
Chromium, więc łapie je i CSP, i `webRequest`. Nie ma ich zresztą w bundlu.

**Mitigacja:** D4. Kluczowa obserwacja: cała obrona sieciowa poza WebRTC
opiera się dziś na jednym mechanizmie (`webRequest`) i na jednym procesie
(Chromium). Trzeba dołożyć warstwę **spoza Electrona**.

---

### S6. PII w logach, zrzutach pamięci i pliku wymiany
**Skutek: W. Prawdopodobieństwo: średnie. Status: OTWARTE (S-LOG-1, S-LOG-2), rezydualne R3.**

Trzy odrębne ścieżki:

1. **`chrome_debug.log`.** `electron/network-guard.mjs:81` loguje **pełny URL**
   zablokowanego żądania, razem ze ścieżką i query. Skompromitowany renderer
   (S4) może wstrzyknąć PII do URL-a, którego i tak nie wyśle, ale który
   **zostanie zapisany na dysk**, jeśli ktoś kiedyś uruchomi aplikację z
   `--enable-logging`. Kanał niski, ale realny i darmowy do zamknięcia.
   Poza tym pierwsza strona kodu jest czysta: żaden runtime'owy `console.*`
   w `src/` ani `electron/` nie drukuje treści dokumentu, encji ani legendy.
   Drukują je narzędzia `src/eval/*` i `bench/*`, które nigdy nie trafiają do paczki.
2. **Zrzuty awaryjne.** `crashReporter.start()` nie jest nigdzie wywoływany
   (zweryfikowałem: zero trafień w repo), więc Electron nie zbiera minidumpów.
   Brak jednak jawnego `app.setPath('crashDumps', …)` ani sprawdzenia, czy
   Chromium nie zakłada mimo to katalogu `Crashpad` w `userData`.
   **DO WERYFIKACJI empirycznej.** Niezależnie od tego **Windows Error Reporting
   działa na poziomie OS** i potrafi zrzucić stertę procesu, w której leży A1.
3. **Plik wymiany i hibernacja.** Legenda to zwykłe stringi JS. Nie da się ich
   wiarygodnie wyzerować (niezmienne stringi, kopie GC, kompaktowanie sterty).
   Strona pamięci ze stertą renderera może trafić do `pagefile.sys`.

---

### S7. Legenda do schowka jednym kliknięciem
**Skutek: W. Prawdopodobieństwo: niskie. Status: OTWARTE (S-LOG-3).**

`src/main.js:1391-1393` montuje przycisk „Kopiuj JSON debug", który wrzuca
do schowka `JSON.stringify({ anonymized, legend, debug })`, czyli **całą legendę
w jawnym tekście**. Panel powstaje tylko przy `isDebug`, a `isDebug` czyta
`?debug=1` z URL-a (`src/main.js:58`). Okno ładuje `app://app/tool.html`
bez query (`electron/main.mjs:141`), więc domyślnie przycisku nie ma.

Ale `will-navigate` (`electron/main.mjs:80`) przepuszcza **każdy** URL
zaczynający się od `app://app/`, więc `location.search = '?debug=1'` przeładuje
stronę z włączonym panelem. Wymaga to wykonania skryptu w rendererze, czyli
sytuacji po S4, albo otwartego DevTools w trybie `PII_DEBUG=1`. Nie podnosi
uprawnień atakującego, ale zamienia „mam kod w rendererze" w „mam legendę
w schowku", i to na maszynie, gdzie schowek czyta wszystko.

Zamknięcie kosztuje jedną linię: panel debug nie istnieje, gdy `window.desktopApp`.

---

### S8. `shell.openExternal` jako jedyne sankcjonowane wyjście
**Skutek: K, gdyby był otwarty. Prawdopodobieństwo: bardzo niskie. Status: ZAMKNIĘTE, dobrze.**

`electron/main-links.mjs:33-48` porównuje **cały URL** ze zbiorem dokładnych
stringów, odrzuca nie-https, poświadczenia w URL-u i jakiekolwiek query.
Prefiksowa allowlista przepuściłaby `https://nodejs.org/leak?d=<PESEL>`,
a nawet allowlista origin+ścieżka przepuściłaby PESEL w ścieżce. Autor to
zauważył i zamknął. Testy w `electron/main-links.test.js` to pilnują.

Ryzyko rezydualne: to nadal jedyne miejsce, gdzie aplikacja może uruchomić
proces sięgający do internetu, i reguła firewalla z D4 go **nie obejmie**,
bo przeglądarka to inny proces. Każde poszerzenie tego zbioru to poszerzenie
kanału eksfiltracji i wymaga osobnej decyzji.

---

### S9. Kompromitacja maszyny budującej
**Skutek: K. Prawdopodobieństwo: niskie. Status: OTWARTE (S-SUP-1, S-SUP-2).**

Dwa niezależne problemy:

1. **Skrypty instalacyjne w drzewie runtime.** `onnxruntime-node`, `sharp`
   i `protobufjs` mają `hasInstallScript: true` i siedzą w `dependencies`,
   a nie w `devDependencies`. Wykonują dowolny kod przy `npm install` i pobierają
   natywne binaria z sieci. Do paczki nie trafiają (`electron-builder.yml:17`
   wyklucza `node_modules`), ale **wykonują się na maszynie, która podpisuje
   i pakuje produkt**. `onnxruntime-node` jest używany wyłącznie przez `src/eval/*`,
   więc nie ma powodu, żeby był zależnością runtime.
2. **Modele pobierane z niezakotwiczonej referencji.** `scripts/fetch-models.mjs:56`
   ciągnie z `https://huggingface.co/${repo}/resolve/main/${file}`, czyli
   z **gałęzi `main`**, nie z niezmiennego SHA commita. `verify-models.mjs`
   sprawdza pobrane pliki względem `models/manifest.json`, który sam powstał
   z tego pobrania. To jest **trust-on-first-use**: co HF poda w momencie
   pobrania, to zostanie pobłogosławione sumą kontrolną i wjedzie do instalatora.

## §5. Ryzyka rezydualne (zostają nawet po wszystkich poprawkach)

| ID | Ryzyko | Dlaczego nieusuwalne | Co z tym zrobić |
|---|---|---|---|
| **R1** | NER nie wykryje części PII, tokenizacja jest niekompletna | granica jakości modelu, nie kodu | nie obiecywać kompletności; wymusić podgląd tekstu przed wysyłką (S-MCP-1); framework ewaluacyjny (`npm run eval:score`) jako miara, nie gwarancja |
| **R2** | Błąd pamięciowy w WASM parsera (pdf.js, libheif, ORT, OpenCV) | zależność zewnętrzna, C/C++ | sandbox OS + brak Node w rendererze + G4 ograniczają skutek do „atakujący siedzi w rendererze i nie może nic wysłać"; aktualizować zależności |
| **R3** | A1/A2 w `pagefile.sys`, hibernacji, zrzucie WER | własność OS i runtime JS | BitLocker (Z5), wyłączenie hibernacji, wykluczenie aplikacji z WER; **przyjąć i zapisać, nie udawać, że rozwiązane** |
| **R4** | Atakujący z uprawnieniami administratora | poza modelem | żadna aplikacja użytkownika tego nie odeprze |
| **R5** | `shell.openExternal` uruchamia przeglądarkę poza kontrolą aplikacji | z definicji | utrzymać allowlistę dokładnych URL-i; nigdy wildcard |
| **R6** | Zaufanie do wag modelu jako artefaktu binarnego | model to nieprzejrzysta tablica liczb | pinowanie do SHA commita + suma kontrolna zakotwiczona w repo; nie da się „przejrzeć" modelu |

## §6. Decyzje otwarte: rozstrzygnięcia

### D1. Transport MCP na desktopie

**Rekomendacja: (1) w v1.0 usunąć WebMCP z builda desktopowego. (2) Jeśli
automatyzacja wróci, to jako natywny transport w procesie głównym po
**nazwanym potoku Windows** (`\\.\pipe\…`) z DACL ograniczonym do bieżącego
użytkownika, albo po stdio. Nigdy WebSocketem, nigdy przez gniazdo TCP,
nigdy przez wyjątek w CSP.**

Uzasadnienie, opcja po opcji:

- **(a) Wyjątek `ws://127.0.0.1:<port>` w blokadzie §3 + CSP.** Najgorsza
  z trzech i pozornie najtańsza. Zamienia „renderer nie ma dostępu do stosu
  sieciowego" na „renderer ma dostęp do stosu sieciowego, ograniczony
  porównaniem stringa". Trzy konkretne wady, wszystkie wynikające z kodu:
  adres serwera pochodzi z **base64 tokenu wklejonego przez użytkownika**
  (`public/webmcp.js:1022-1034`), więc to nie aplikacja decyduje, dokąd dzwoni;
  klient **wznawia połączenie sam przy starcie** (`public/webmcp.js:83-113`);
  a `127.0.0.1` to tylko pierwszy hop, każdy lokalny proces może być relayem.
  Dziura w CSP jest trwała i nieodwracalna dla wszystkich przyszłych wersji.
- **(b) Natywny transport lokalny.** Poprawna, ale wymaga precyzji. Serwer
  **HTTP na loopbacku byłby błędem**: dokłada nasłuchujące gniazdo TCP do
  maszyny, której zasadą jest brak sieci, i zmusza proces główny do zaimportowania
  `node:http`, co łamie zweryfikowany dziś niezmiennik „`electron/` nie importuje
  modułów sieciowych". **Nazwany potok jest ściśle lepszy**: nie jest gniazdem
  IP, nie ma portu, nie dotyka stosu sieciowego, `webRequest` nigdy go nie
  zobaczy (i nie musi), a system operacyjny egzekwuje kontrolę dostępu listą
  DACL zamiast bearer tokenem wymyślonym przez nas.
- **(c) Brak MCP na desktopie.** Rekomendowane na v1.0.

Co tracimy przy (c), realnie: niewiele. Przepływ „skopiuj tekst tokenizowany
→ wklej do Claude'a → wklej odpowiedź do zakładki deanonimizacji" **już istnieje
i działa** (`src/ui/deanon-workspace/index.js:282,293`). MCP oszczędza dwa
kliknięcia, a kosztuje: uśpiony klient WebSocket w paczce, most `npx -y
@jason.today/webmcp@latest` pobierany z sieci przy każdym uruchomieniu (paczka
niepinowana, poza granicą audytu, poza air-gapem), oraz ryzyko R1 na kanale,
którego użytkownik nie ogląda.

Uwaga wiążąca dla wariantu (b): niezależnie od transportu, **R1 zostaje**.
Dlatego każde źródło udostępniane LLM-owi musi przejść przez jawne potwierdzenie
z podglądem dokładnego tekstu, który wyjdzie.

### D2. Trwałość legendy i klucza deanonimizacji

**Rekomendacja: pamięć ulotna, bez opcji zapisu, także w kolejnych wersjach.
Zapis dopuścić dopiero, gdy pojawi się realna potrzeba produktowa, i wtedy
z kluczem wyprowadzonym z hasła użytkownika, nie z samego `safeStorage`.**

Uzasadnienie:

- Dziś legenda żyje wyłącznie w RAM (`src/main.js:44`), a zamknięcie okna kończy
  proces (`electron/main.mjs:208-212`). To jest **zerowy artefakt na dysku**:
  najmocniejsza właściwość, jaką ten produkt ma. Zapis zamienia narzędzie
  bez śladów w narzędzie wytwarzające plik o wartości akt sprawy.
- `safeStorage` na Windows to **DPAPI zakotwiczone w koncie użytkownika**.
  Chroni przed kradzieżą dysku, nie chroni przed atakującym z Z4, bo ten sam
  atakujący, który mógłby odczytać legendę z RAM, wywoła `CryptUnprotectData`.
  Przed kradzieżą dysku lepiej i taniej broni BitLocker (Z5). Czyli:
  `safeStorage` sam z siebie **nie dokłada obrony przed atakującym z modelu**.
- Legenda jest **odtwarzalna**: ten sam dokument plus ten sam model daje ten
  sam wynik. Scenariusz „wznowię pracę jutro" domyka się ponownym wczytaniem
  pliku, a nie plikiem klucza.

Gdyby zapis kiedyś był konieczny: `safeStorage.encryptString` **plus** klucz
wyprowadzony z hasła (Argon2id), włączane per dokument, z jawnym terminem
ważności. Sam DPAPI to za mało.

**Panic wipe: tak, ale nazwijmy rzecz po imieniu.** Przycisk „wyczyść"
w JavaScripcie **nie usuwa danych z RAM**: stringi są niezmienne, GC zostawia
kopie, sterta bywa kompaktowana, strona może być w pliku wymiany. Jedyny
wiarygodny wipe to zakończenie procesu. Dlatego proponuję kontrolkę
**„Zakończ i wyczyść"**, która: zeruje referencje stanu, woła
`session.clearStorageData()` i `clearCache()`, po czym `app.exit(0)`.
Sprzedawanie użytkownikowi przycisku „wyczyść pamięć" bez wyjścia z aplikacji
byłoby obietnicą, której kod nie dotrzyma.

### D3. Polityka logów

**Rekomendacja: zero plików dziennika w produkcji. Logowanie do konsoli
zostaje, ale z twardą regułą redakcji. Diagnostyka wyłącznie opt-in, do pliku
tymczasowego, z widocznym ostrzeżeniem w UI, kasowana przy następnym starcie.**

Konkretnie:

1. **Produkcja:** brak `crashReporter.start()` (stan obecny, zachować).
   Dołożyć `app.setPath('crashDumps', <katalog tymczasowy>)` i czyścić go
   przy starcie. **Zweryfikować empirycznie**, czy mimo braku `start()`
   powstaje `%APPDATA%\<app>\Crashpad\` (C-LOG-2).
2. **Reguła redakcji, wiążąca dla każdego przyszłego kodu:** żaden `console.*`
   nie interpoluje treści dokumentu, wartości `entity.word`, wpisu legendy ani
   nazwy pliku użytkownika. Egzekwować testem, nie dobrą wolą.
   Pierwsza poprawka z tej reguły: `electron/network-guard.mjs:81` ma logować
   **origin i `resourceType`**, nigdy pełny URL ze ścieżką i query.
3. **Tryb diagnostyczny:** `PII_DEBUG=1` pisze do
   `%TEMP%\lokalny-anonimizator\diag-<pid>.log`, UI pokazuje czerwony pasek
   „TRYB DIAGNOSTYCZNY: dziennik może zawierać dane osobowe", plik ginie przy
   następnym uruchomieniu. Nigdy domyślnie.
4. **Retencja:** zero. Nie ma logów, nie ma czego retencjonować. To także
   właściwa odpowiedź na pytanie RODO o rejestr czynności: aplikacja nie
   prowadzi żadnego dziennika przetwarzania.
5. **Brak logów zdalnych, dowód a nie deklaracja:** (i) `electron/` nie importuje
   `node:net|http|https|dns|tls|dgram` (zweryfikowane, do zakucia w test
   C-NET-6), (ii) strażnik sieci anuluje wszystko poza `app:`/`blob:`/`data:`,
   (iii) `assertNoRemoteUrls` wywraca build, (iv) w repo nie ma Sentry,
   telemetrii, analityki, `sendBeacon` ani auto-update (zweryfikowane).
6. Wyłączyć panel debug na desktopie (S7).

### D4. Czy dokładać warstwę sieciową ponad `webRequest`

**Rekomendacja: tak, i przynajmniej jedna warstwa musi leżeć poza Chromium.**

Dziś obrona to: CSP (Chromium) + `webRequest` (Chromium) + polityka WebRTC
(Chromium) + `assertNoRemoteUrls` (build) + dyscyplina importów (człowiek).
Trzy z pięciu warstw padają razem z jednym błędem w Chromium, a piąta nie jest
mechanizmem.

Dokładam cztery, w kolejności stosunku korzyści do kosztu:

1. **`--host-resolver-rules=MAP * ~NOTFOUND` w builds spakowanych.**
   Trwały tryb samolotowy wbudowany w binarkę. **Wiemy, że działa**, bo tym
   właśnie przełącznikiem `desktop:smoke:offline` symuluje brak DNS
   (`e2e/desktop-smoke.mjs:80`). Nie psuje `app://` (brak rozwiązywania nazw),
   nie psuje trybu dev (bramkować na `app.isPackaged`), nie psuje przyszłego
   loopbacku (literalne IP nie przechodzi przez resolver). Koszt: jedna linia.
2. **`--no-proxy-server` + `session.setProxy({ mode: 'direct' })`.** Zamyka
   pobranie pliku PAC i użycie proxy systemowego, czyli egress **zanim
   cokolwiek się wyrenderuje**. Dodatkowo czyni jednoznaczną semantykę
   `disable_non_proxied_udp`: skoro nie ma proxy, nie ma nieproxowanego UDP.
3. **Reguła zapory Windows blokująca ruch wychodzący dla zainstalowanego exe,
   zakładana przez instalator NSIS.** To jedyna proponowana warstwa **spoza
   Electrona i spoza Chromium**, i dlatego najcenniejsza. Ograniczenia, uczciwie:
   użytkownik z prawami administratora może ją zdjąć, nie obejmuje
   `shell.openExternal` (inny proces), a przy `perMachine: false` ścieżka
   programu bywa ruchoma, co jest kolejnym argumentem za B3.
4. **Niezmienniki zakute w test, nie w komentarz:** (i) `electron/**` nie
   importuje modułów sieciowych Node, (ii) `dist-desktop/**` nie zawiera
   `new WebSocket(`, `RTCPeerConnection`, `sendBeacon`. Punkt (ii) po B2
   przechodzi na zielono i **pilnuje, żeby WebMCP nie wrócił niepostrzeżenie**.

Do rozważenia i **świadomie odrzucone**: `--disable-features=MediaRouter,
DialMediaRouteProvider,CastMediaRouteProvider` (mDNS/DIAL to multicast UDP,
niewidzialny dla `webRequest`) warto dodać, **ale najpierw zmierzyć**, czy
Electron w ogóle uruchamia Media Router (C-NET-5, do weryfikacji).
Nie rekomenduję natomiast usuwania WebRTC przez własny build Chromium:
koszt utrzymania nieproporcjonalny do zysku, skoro polityka UDP daje zero
kandydatów ICE, co zmierzono.

## §7. Co pozostaje do zweryfikowania empirycznie

Nie zmyślam wyników, których nie mam. Ten audyt jest przeglądem kodu.
Następujące tezy wymagają uruchomienia, zanim wpiszemy je jako PASS:

1. Czy `EnableEmbeddedAsarIntegrityValidation` faktycznie blokuje start po
   zmianie jednego bajtu w `app.asar` (Z6, C-INT-3).
2. Czy powstaje `%APPDATA%\<app>\Crashpad\` mimo braku `crashReporter.start()`
   (C-LOG-2).
3. Czy Chromium w Electronie uruchamia Media Router i emituje mDNS (C-NET-5).
4. Czy `GPUCache`/`DawnCache` zawiera fragmenty rasteryzowanych stron PDF
   (C-PERS-4).
5. Czy podpis kodu włącza na Windows ochronę Renderer Code Integrity
   (blokada ładowania niepodpisanych DLL do renderera) (C-WIN-3).
6. Czy `isEvalSupported` w `pdfjs-dist` 5.7 domyślnie jest `true`
   (wynik audytu, potwierdzić w źródle zależności).
