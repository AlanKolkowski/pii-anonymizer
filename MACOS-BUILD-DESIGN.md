# MACOS-BUILD-DESIGN.md – projekt buildu macOS (wariant A „air-gap", grunt pod wariant B)

**Wersja:** 1.0 (projekt do akceptacji)
**Data:** 2026-07-12
**Autor:** Fable (architekt aplikacji desktopowej)
**Status:** PROJEKT. Zero kodu implementacji. Dokument czeka na bramkę Opusa,
implementacja (Sonnet) nie startuje przed akceptacją **i przed spełnieniem
warunku wejścia z §2 (dostęp do maszyny macOS)**.
**Odbiorca:** Opus jako bramka bezpieczeństwa; wtórnie Alan (decyzje produktowe
§15, decyzja o sprzęcie §2) i Sonnet (plan implementacji §13).

**Relacja do istniejących dokumentów:** `SECURITY.md` opisuje, co zbudowano
w wariancie A na Windows; `THREAT-MODEL.md` – przed czym to broni;
`SECURITY-CHECKLIST.md` – jak to bramkować (sekcja 8 „Windows" jest wzorem dla
sekcji macOS z §12); `MCP-BRIDGE-DESIGN.md` – wariant B (most), którego
transport §4 wymaga na macOS odpowiednika (§10 tego dokumentu);
`SHARED-FOUNDATION-DESIGN.md` §7.4 – mapa faz, w którą ten projekt się wpina
(§13). Ten dokument rozstrzyga TODO(macos) z `electron-builder.yml` i pozycję
„Build macOS" z rejestru `SECURITY.md` §14.

**Konwencja oznaczeń:** jak w projektach poprzednich. Każde miejsce dotykające
sieci, izolacji, integralności albo podpisu jest oznaczone **[DO WERYFIKACJI
PRZEZ OPUSA: O-MAC-n]** i zebrane w §14. Decyzje produktowe dla Alana:
**P-MAC-n**, zebrane w §15. Tezy wymagające uruchomienia na prawdziwym macOS:
**[DO ZMIERZENIA NA SPRZĘCIE]**, zebrane w §16. Fragmenty konfiguracji w tym
dokumencie to schematy i nazwy opcji, nie kod implementacji.

---

## §0. Streszczenie decyzji architektonicznych

| # | Decyzja | Rozstrzygnięcie (skrót) |
|---|---|---|
| 1 | Główna warstwa egress wariantu A na macOS | **App Sandbox z zerowymi uprawnieniami sieciowymi** (brak `com.apple.security.network.client` i `.server`) – blokada gniazd egzekwowana przez jądro; webRequest/CSP/polityka WebRTC zostają jako obrona w głąb (§4) |
| 2 | Odpowiednik reguły zapory C-NET-8 | App Sandbox (jak wyżej). Application Firewall macOS odpada: **blokuje wyłącznie ruch przychodzący** (§4.2) |
| 3 | Podpis + odpowiednik SmartScreen | Developer ID Application + Hardened Runtime + notaryzacja (`notarytool`) + **stapling** (pierwszy start działa offline) – bramka twarda jak B4 (§6) |
| 4 | Izolacja przed wstrzyknięciem kodu | Hardened Runtime z **domyślną library validation** (żadnych `disable-library-validation`, `allow-dyld-environment-variables`) – odpowiednik C-WIN-3, mocniejszy (§5, §9) |
| 5 | Instalacja | **dmg** (rekomendacja, P-MAC-2) do `/Applications`; integralność pakietu: pieczęć codesign + kotwica asar w `Info.plist` + TCC „App Management" (macOS 13+) + **B1 w runtime bez zmian** (§7) |
| 6 | Fuses | Ten sam zestaw, ten sam hook (`afterpack-fuses.cjs` już obsługuje darwin); kolejność: fuses → codesign → notaryzacja (§3.4) |
| 7 | Wariantowość A/B | Dwa targety jak na Windows; **entitlements stają się elementem wariantowości** (A: sandbox network-off; B: do rozstrzygnięcia pomiarem AF_UNIX × App Sandbox, §10) |
| 8 | Most na macOS (grunt) | named pipe → **gniazdo AF_UNIX** w katalogu 0700 wewnątrz kontenera; HMAC i plik sesyjny bez zmian koncepcyjnych; pełny projekt dopiero w fazie 3 (§10) |
| 9 | Wykonalność | Build, podpis i notaryzacja **wymagają maszyny macOS** – warunek wejścia implementacji, opcje i koszty w §2 |

---

## §1. Cel, zakres, wymagania

### 1.1 Cel

Zaprojektować build macOS wariantu A tak, żeby **każda** gwarancja
bezpieczeństwa z `SECURITY.md` §1–§8 i §12/§12a była na macOS spełniona –
przez ten sam mechanizm, jeśli jest cross-platformowy, albo przez jawnie
wskazany odpowiednik macOS – oraz przygotować grunt (nie implementację) pod
wariant B. Miarą sukcesu jest §11: tabela warstw, w której żadna pozycja nie
ma statusu „nie wiadomo".

### 1.2 Wymagania nienegocjowalne (przeniesione z wariantu A)

- **WM1 – parytet warstw.** Blokada sieci (§3 `SECURITY.md`), CSP (§6),
  protokół `app://` (§2), integralność modeli w runtime (B1), polityka WebRTC,
  fuses (§8), izolacja renderera (§1) – wszystkie aktywne w buildzie macOS,
  z weryfikacją per warstwa (§11).
- **WM2 – brak nowych kanałów.** Build macOS nie dodaje żadnego kodu
  sieciowego, telemetrii, auto-update (Sparkle i `electron-updater` pozostają
  zakazane; `publish: null` obowiązuje oba systemy).
- **WM3 – fail-closed.** Każdy mechanizm integralności (podpis, notaryzacja,
  kotwica asar, B1) w razie niezgodności odmawia startu, nigdy nie degraduje
  po cichu.
- **WM4 – wariant A na macOS jest tym samym produktem** co na Windows: ten sam
  renderer, te same modele, te same testy dymne (przeportowane), ta sama
  obietnica. Różni się wyłącznie warstwą OS.
- **WM5 – pełna bramka Opusa** dla każdego modułu planu §13 (wszystkie dotykają
  izolacji, integralności albo podpisu).

### 1.3 Poza zakresem

- **Mac App Store (target `mas`)** – kanał dystrybucji z własnym reżimem
  (recenzja Apple, MAS-owe entitlements, brak stapled ticket). Dystrybucja
  bezpośrednia (Developer ID) jest właściwa dla produktu kancelaryjnego.
  Decyzja o MAS, jeśli kiedyś padnie, to osobny projekt.
- **Implementacja mostu (wariant B) na macOS** – faza 3 mapy
  `SHARED-FOUNDATION` §7.4; tu wyłącznie grunt i rozstrzygnięcia kierunkowe
  (§10).
- **Aktualizacje automatyczne** – brak, jak na Windows (WM2).
- **Wsparcie Intel/x64** – rekomendacja arm64-only (P-MAC-3); jeśli Alan
  zdecyduje inaczej, projekt się nie zmienia, rośnie tylko matryca pomiarów.

---

## §2. Ograniczenie wykonawcze: maszyna macOS (WARUNEK WEJŚCIA)

**Bez maszyny macOS ten projekt jest gotowy, ale niewykonalny.** To nie jest
niuans, tylko brama: `electron-builder` buduje target `mac` wyłącznie na
macOS, a `codesign`, `xcrun notarytool`, `xcrun stapler` i `spctl` to
narzędzia systemowe macOS. Nie istnieje ścieżka zbudowania i podpisania
artefaktu macOS na Windowsie, na którym pracuje Alan. Co więcej, **pomiary
z §5.4 i §11 wymagają fizycznego uruchomienia** – połowa tego projektu to
tezy do zmierzenia, nie do wydedukowania.

Wymagany sprzęt: Apple Silicon (rekomendacja arm64-only, P-MAC-3), z macOS
w wersji co najmniej równej progowi z P-MAC-4 (rekomendacja: macOS 14+ na
maszynie testowej, żeby zmierzyć zachowanie TCC i Gatekeepera w wersji, którą
realnie mają docelowi użytkownicy).

### 2.1 Opcje dostępu do macOS

| Opcja | Koszt (orientacyjny, do potwierdzenia przy decyzji) | Zalety | Wady |
|---|---|---|---|
| **(a) Własny Mac** (np. Mac mini, bazowa konfiguracja wystarcza) | jednorazowo rząd 3 000 zł brutto | klucz Developer ID i cały łańcuch podpisu zostają lokalnie (spójnie z tym, jak Alan podpisuje Windows przez Azure na własnej maszynie); pomiary §11 i ręczne testy Gatekeepera na tym samym sprzęcie; maszyna przydaje się też do przyszłego wsparcia użytkowników macOS | koszt wejścia; druga maszyna do utrzymania |
| (b) GitHub Actions, runner macOS | repo publiczne: darmowe; repo prywatne: minuty macOS liczone z mnożnikiem ×10 względem Linuksa | zero sprzętu; powtarzalny build z `npm ci` (domyka C-PKG-4) | **certyfikat Developer ID i sekrety notaryzacji trafiają do sekretów CI** – istotne rozszerzenie powierzchni S9 (kompromitacja maszyny budującej), patrz §2.2; pomiarów §11 i testów ręcznych nadal nie ma gdzie wykonać, więc CI **nie zastępuje** sprzętu, najwyżej go uzupełnia |
| (c) Chmurowy Mac (np. EC2 Mac, MacStadium) | EC2: dedykowany host z minimalną alokacją 24 h, rząd kilkudziesięciu USD za dobę; abonamenty od ok. 100 USD/mies. | pełny macOS bez zakupu | koszt bieżący szybko przebija cenę Maca mini; klucze na cudzej infrastrukturze; interaktywne testy GUI przez zdalny pulpit są uciążliwe |
| (d) Pożyczony Mac (jednorazowo) | 0 zł | wystarcza na pomiary §5.4/§11 | nie wystarcza na powtarzalny proces wydawniczy; klucz podpisu na cudzej maszynie to antywzorzec |

**Rekomendacja:** (a) własny Mac jako maszyna budująco-pomiarowa, z opcją
dołożenia (b) później wyłącznie jako automatyzacji builda (bez podpisu albo
z podpisem – osobna decyzja z pełną świadomością §2.2). Decyzja: **P-MAC-5**.

### 2.2 CI a łańcuch dostaw (rozszerzenie S9)

Jeśli kiedykolwiek podpis przeniesie się do CI: certyfikat Developer ID
(`.p12` w sekretach), hasło i poświadczenia notaryzacji (klucz App Store
Connect API) stają się aktywami w infrastrukturze GitHuba, a każdy, kto
przejmie workflow (złośliwy PR do workflow, kompromitacja konta), może
podpisywać artefakty jako Kancelaria. `THREAT-MODEL.md` S9 dziś obejmuje
maszynę Alana; wariant CI dopisuje do niego cudzą chmurę. Nie blokuję tej
drogi, ale wymaga ona osobnej pozycji w checkliście i osobnej zgody
(ujęte w O-MAC-11).

---

## §3. Architektura buildu

### 3.1 Miejsce w konfiguracji: sekcja `mac` w istniejącym `electron-builder.yml`

Target macOS dokłada się do **tego samego** pliku `electron-builder.yml`
(electron-builder scala sekcje per platforma), zgodnie z zapowiedzią
w komentarzu TODO(macos) na końcu pliku. Wariant B, gdy powstanie, dokłada
sekcję `mac` do swojego `electron-builder.bridge.yml` (§10.1). Elementy
wspólne (files, extraResources, asar, afterPack, electronDist, publish: null)
**nie są duplikowane ani zmieniane** – obowiązują obie platformy.

Nowe elementy konfiguracji (nazwy opcji electron-buildera, wartości docelowe):

| Opcja | Wartość | Uzasadnienie |
|---|---|---|
| `mac.target` | `dmg` (+ `zip` opcjonalnie, wyłącznie jako artefakt techniczny do testów) | P-MAC-2; §7.1 |
| `mac.arch` | `arm64` | P-MAC-3; §2 |
| `mac.category` | `public.app-category.business` | kosmetyka LaunchServices |
| `mac.icon` | `build/icon.icns` | nowy zasób graficzny (konwersja istniejącej ikony) |
| `mac.hardenedRuntime` | `true` | wymóg notaryzacji; §5 |
| `mac.gatekeeperAssess` | `false` | nie odpalać `spctl` w trakcie builda (ocena Gatekeepera to test §11, nie krok builda) |
| `mac.entitlements` | `build/entitlements.mac.plist` | §5.2 |
| `mac.entitlementsInherit` | `build/entitlements.mac.inherit.plist` | §5.3 |
| `mac.minimumSystemVersion` | wartość z P-MAC-4 (rekomendacja: `13.0`) | §7.4, §9 |
| `mac.notarize` | `true` (poświadczenia z środowiska, nigdy z repo) | §6.3 |
| `dmg.*` | układ z symlinkiem do `/Applications`; artefakt `LokalnyAnonimizator-<wersja>-arm64.dmg` | §7.1 |

Zasada identyczna jak przy `azureSignOptions`: **żadne poświadczenia w repo**,
wszystko ze środowiska maszyny budującej (§6.3).

### 3.2 Co się NIE zmienia (i jest to twierdzenie projektowe, nie przeoczenie)

- `files` / `extraResources`: identyczne. Kotwica `manifest.json` w korzeniu
  asara i modele poza asarem działają na macOS bez zmian ścieżek –
  `process.resourcesPath` wskazuje `<app>.app/Contents/Resources`,
  `app.getAppPath()` wskazuje `Contents/Resources/app.asar`, więc
  `MODELS_ROOT` i `MODEL_MANIFEST_PATH` z `electron/main.mjs` rozwiązują się
  poprawnie **bez ani jednej linii warunkowej per platforma**.
- `afterPack: scripts/afterpack-fuses.cjs`: bez zmian – hook już rozgałęzia
  ścieżkę binarki dla `darwin` i ustawia `resetAdHocDarwinSignature` (§3.4).
- `publish: null`, `npmRebuild: false`, brak `node_modules` w paczce: bez
  zmian.
- Cały `electron/` i `src/`: **zero zmian kodu w tym projekcie**. Jedyny
  wyjątek dopuszczalny w implementacji: drobne poprawki testów dymnych
  (ścieżka binarki `.app/Contents/MacOS/...` zamiast `.exe`), §13 MM4.

### 3.3 Modele: jeden manifest, dwie platformy

Modele ONNX/WASM są niezależne od architektury procesora – te same pliki,
te same sumy SHA-256. `models/manifest.json` (śledzony w repo) pozostaje
**jedynym źródłem prawdy dla obu platform**: `desktop:fetch-models` na Macu
pobiera te same artefakty, `desktop:verify-models` bramkuje je tą samą
kotwicą, a B1 w runtime weryfikuje identyczne sumy. Rozjazd sum między
platformami jest niemożliwy z konstrukcji (jeden manifest), co domyka pytanie
o „drugą prawdę" zanim powstało. Znane ograniczenie C-INT-7/C-INT-8 (TOFU
przy pobraniu) pozostaje wspólne i niezmienione – ten projekt go nie dotyka.

### 3.4 Kolejność: fuses → podpis → notaryzacja → stapling

Kolejność jest wymuszona technicznie i musi zostać zakodowana w wiedzy zespołu,
bo odwrócenie któregokolwiek kroku unieważnia poprzedni:

1. **`afterPack` (fuses).** `flipFuses` modyfikuje binarkę → unieważnia każdy
   istniejący podpis. Hook działa **przed** krokiem podpisu electron-buildera,
   więc kolejność jest z natury poprawna. `resetAdHocDarwinSignature: true`
   pozostaje: na Apple Silicon binarka bez ważnego podpisu (choćby ad-hoc)
   w ogóle się nie uruchomi, więc reset jest konieczny dla buildów
   deweloperskich bez tożsamości; przy buildzie z prawdziwym podpisem krok
   jest nadmiarowy, ale nieszkodliwy – codesign i tak zaraz nadpisze podpis.
   **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-5]**
2. **Podpis (electron-builder → codesign).** Cały pakiet `.app` – binarka
   główna, helpery, frameworki, **wszystkie zasoby łącznie z modelami
   w `Contents/Resources`** – zostaje objęty pieczęcią podpisu
   (`_CodeSignature/CodeResources`). Z Hardened Runtime i entitlements z §5.
3. **Notaryzacja (`notarytool`).** Artefakt jedzie do Apple, wraca ticket.
4. **Stapling (`stapler`).** Ticket zostaje **doszyty do artefaktu** – dzięki
   temu pierwszy start działa w trybie samolotowym (§7.3). Dla produktu
   sprzedawanego jako air-gap stapling nie jest opcją, tylko obowiązkiem.

Weryfikacja po buildzie (odpowiednik `Get-AuthenticodeSignature`):
`codesign --verify --deep --strict`, `codesign -dvv` (obecność flagi
`runtime`), `codesign -d --entitlements :-` (dokładnie zestaw z §5.2, niczego
więcej), `spctl -a -vv` (akceptacja Gatekeepera), `xcrun stapler validate`.
Wszystkie wchodzą do checklisty §12.

### 3.5 Kotwica integralności asara na macOS: `Info.plist`

Na Windows fuse `EnableEmbeddedAsarIntegrityValidation` czyta oczekiwany hash
z zasobu PE. Na macOS ten sam fuse czyta hash z klucza **`ElectronAsarIntegrity`
w `Info.plist`** pakietu. Konsekwencje:

- `Info.plist` jest objęty pieczęcią codesign → podmiana `app.asar` wymaga
  przepisania plistu, a przepisanie plistu łamie podpis. Łańcuch:
  fuse → plist → podpis → Gatekeeper/TCC (§7.5).
- electron-builder w używanej wersji (26.x) wylicza ten klucz automatycznie
  przy buildzie mac – **[DO ZMIERZENIA NA SPRZĘCIE]**: obecność klucza
  w plist i odmowa startu po podmianie bajtu w asarze (odpowiednik C-INT-3;
  na Windows wciąż `?`, na macOS test wchodzi do matrycy §12 jako C-MAC-13).
- Uczciwa uwaga (lustrzana wobec analizy S1): na Apple Silicon atakujący,
  który **może pisać** w pakiecie, może po modyfikacji podpisać całość
  ad-hoc na nowo – wtedy plist i asar znów są „spójne". Dlatego kotwica asara
  nie jest samodzielną obroną, tylko ogniwem: pisanie w pakiecie blokuje TCC
  i uprawnienia katalogu (§7.5), a wykrycie podmiany modeli pozostaje przy B1.
  To jest dokładnie ta sama logika „trzy mechanizmy naraz albo żaden nie
  wystarcza", którą THREAT-MODEL opisał dla B1/B3/B4.

---

## §4. Warstwa egress: App Sandbox jako kontrola główna (kwestia d)

### 4.1 Teza główna

Wariant A na macOS dostaje warstwę, której Windows nie ma i mieć nie może:
**App Sandbox z zerowymi uprawnieniami sieciowymi**. Entitlements
`com.apple.security.network.client` i `com.apple.security.network.server`
są **nieobecne** w profilu aplikacji, więc jądro (seatbelt) odmawia procesom
aplikacji operacji na gniazdach sieciowych. To zmienia klasę gwarancji:

| Właściwość | Reguła zapory Windows (C-NET-8) | App Sandbox network-off |
|---|---|---|
| Kto egzekwuje | usługa zapory (user-space, polityka systemowa) | jądro macOS, per proces |
| Kto może zdjąć | każdy administrator, jednym poleceniem, bez śladu w aplikacji | **nikt bez przepisania entitlements w pakiecie** – a to łamie podpis i notaryzację; „zdjęcie" wymaga redystrybucji zmodyfikowanej aplikacji, nie zmiany ustawienia |
| Zakres | jedna binarka po ścieżce instalacji | wszystkie procesy pakietu (main, helpery, GPU) przez dziedziczenie (§5.3) |
| Widoczność dla audytu | trzeba odpytać zaporę | `codesign -d --entitlements` na artefakcie – dowód **statyczny**, z samego pliku dystrybucyjnego |

Obietnica z `SECURITY.md` („to nie jest izolacja na poziomie OS") przestaje
być zastrzeżeniem: na macOS **to już jest izolacja na poziomie OS**. Sekcja
wstępna SECURITY.md dostanie po implementacji piątą warstwę w opisie
(aktualizacja dokumentów: §13 MM5). **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-1]**

### 4.2 Alternatywy odrzucone

| Alternatywa | Dlaczego odrzucona |
|---|---|
| **Application Firewall macOS** (`socketfilterfw`) jako główna warstwa | **Kontroluje wyłącznie połączenia przychodzące.** Nie blokuje ruchu wychodzącego w ogóle, więc nie jest odpowiednikiem C-NET-8, tylko fałszywym przyjacielem o znajomej nazwie. Odpada z definicji, nie z oceny. |
| Reguły PF (`pfctl`) zakładane przy instalacji | PF filtruje po adresach/portach, nie po aplikacji (filtrowanie per proces wymaga NetworkExtension, czyli osobnego produktu systemowego); wymaga roota; reguły globalne psują sieć użytkownikowi; instalator dmg nie ma naturalnego kroku uprzywilejowanego. Kruche i nieproporcjonalne, skoro App Sandbox daje właściwość mocniejszą za darmo. |
| NetworkExtension / content filter własny | pisanie systemowego rozszerzenia sieciowego, żeby blokować ruch własnej aplikacji, to odwrócona logika: dokłada uprzywilejowany komponent (nową powierzchnię) zamiast odebrać uprawnienia. |
| Little Snitch / LuLu jako wymóg | narzędzia obserwacyjne firm trzecich – świetne do **pomiaru** (§4.4), nie do egzekwowania obietnicy produktu na maszynie klienta. |

### 4.3 Obrona w głąb: pełen stos egress wariantu A na macOS

Wszystkie istniejące warstwy zostają – App Sandbox wchodzi **pod** nie, nie
zamiast nich:

1. brak kodu wywołującego sieć (bez zmian, cross-platform),
2. strażnik `webRequest` + licznik + kanarek (bez zmian, Chromium),
3. CSP bez źródeł zdalnych (bez zmian),
4. polityka WebRTC `disable_non_proxied_udp` + usunięcie API w preloadzie
   (bez zmian),
5. przełączniki Chromium: `disable-background-networking`,
   `disable-features=MediaRouter,...`, `host-resolver-rules=MAP * ~NOTFOUND`
   (spakowany), `no-proxy-server`, `setProxy({mode:'direct'})` (bez zmian –
   to flagi Chromium, nie Windows),
6. **NOWE: App Sandbox network-off** – nawet gdyby warstwy 1–5 padły
   jednocześnie (błąd Chromium, regresja konfiguracji), `socket()`/`connect()`
   kończy się odmową jądra.

Uwaga porządkująca: warstwa 6 broni **procesów aplikacji**. Nie obejmuje
(i nie ma obejmować) `shell.openExternal` – przeglądarka systemowa to inny
proces z własnymi uprawnieniami, dokładnie jak na Windows (S8/R5, bez zmian).

### 4.4 Jak to zweryfikować (odpowiednik pomiaru Wiresharkiem z C-NET-5)

Dwie klasy dowodów, obie wchodzą do §12:

**Dowody statyczne (z artefaktu, bez uruchamiania):**
- `codesign -d --entitlements :- "<app>"` → w wydruku **nie ma** żadnego
  klucza `com.apple.security.network.*`; jest `com.apple.security.app-sandbox`.
- porównanie zestawu entitlements z listą wzorcową z repo (§5.2) –
  automatyczna asercja w skrypcie weryfikacyjnym buildu (odpowiednik
  `assertNoRemoteUrls`: rozjazd = build FAIL).

**Dowody dynamiczne (na sprzęcie, podczas pełnego przebiegu smoke):**
- `lsof -a -i -p <pid...>` dla wszystkich procesów drzewa aplikacji → pusta
  lista przez cały przebieg (anonimizacja + OCR + eksport). To jest
  bezpośredni odpowiednik „licznik = 0", tyle że z poziomu OS.
- `tcpdump 'udp port 5353 or udp port 1900'` z filtrem po adresie źródłowym
  maszyny – metodologia identyczna jak pomiar Alana z C-NET-5 (włącznie
  z pułapką „Wi-Fi widzi całą sieć"): zero pakietów mDNS/DIAL z hosta
  w czasie życia aplikacji.
- test dymny offline (`desktop:smoke:offline`) bez zmian koncepcyjnych.
- kanarek testu dymnego (`SECURITY.md` §13: `net.fetch` z procesu głównego
  w trybie repo): pod App Sandbox
  oczekiwany wynik to odmowa **zanim** żądanie osiągnie sieć; licznik
  strażnika §3 nadal rośnie (webRequest widzi żądanie przed warstwą gniazd).
  Jeżeli pomiar pokaże inny kształt błędu niż na Windows
  (`ERR_BLOCKED_BY_CLIENT` vs odmowa sandboxa), smoke dostaje asercję
  per platforma – różnica kształtu błędu jest oczekiwana i nieszkodliwa.
  **[DO ZMIERZENIA NA SPRZĘCIE]**

Ważne rozgraniczenie dowodowe: kanarka jądra (celowej próby otwarcia gniazda
z pominięciem Chromium) **nie wbudowujemy w produkt** – wymagałby importu
`node:net` w aplikacji, co łamie C-NET-6. Dowodem na warstwę jądra jest
kombinacja dowodu statycznego (brak entitlements) i obserwacji zewnętrznej
(`lsof`), nie kod w binarce. **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-6]**

---

## §5. App Sandbox + Hardened Runtime: entitlements (kwestia b)

### 5.1 Dwa mechanizmy, jeden plik

Porządkując pojęcia, bo mylą się nagminnie: **App Sandbox** (rodzina
`com.apple.security.*` bez prefiksu `cs.`) ogranicza, **co proces może zrobić
w systemie** (pliki, sieć, urządzenia). **Hardened Runtime** (rodzina
`com.apple.security.cs.*`) ogranicza, **co można zrobić procesowi**
(wstrzyknięcie bibliotek, debugger, modyfikacja pamięci wykonywalnej).
Notaryzacja wymaga Hardened Runtime; App Sandbox jest naszym wyborem
architektonicznym. Oba wyraża ten sam plik entitlements przy podpisie.

### 5.2 Zestaw minimalny dla aplikacji (wariant A)

**Obecne (i nic ponadto):**

| Entitlement | Wartość | Po co |
|---|---|---|
| `com.apple.security.app-sandbox` | true | izolacja + air-gap jądra (§4) |
| `com.apple.security.files.user-selected.read-only` | true | import dokumentów: panel otwarcia (powerbox) i drag&drop nadają aplikacji jednorazowy dostęp do wskazanych plików |
| `com.apple.security.files.user-selected.read-write` | true | eksport wyników (DOCX/TXT): panel zapisu; obejmuje read-only funkcjonalnie, wpis wyżej zostaje dla czytelności intencji |
| `com.apple.security.cs.allow-jit` | true | JIT V8 i kompilacja WASM (ONNX Runtime, OpenCV) pod Hardened Runtime |

**Jawnie nieobecne (lista kontrolna – obecność któregokolwiek to FAIL buildu):**

| Entitlement | Dlaczego nieobecny |
|---|---|
| `com.apple.security.network.client` | **sedno §4** – brak gniazd wychodzących |
| `com.apple.security.network.server` | brak gniazd nasłuchujących (wariant A niczego nie nasłuchuje; wariant B: §10) |
| `com.apple.security.cs.allow-dyld-environment-variables` | zmienne `DYLD_*` mają być ignorowane – odpowiednik wyłączonych `NODE_OPTIONS`/`RunAsNode`, tylko na poziomie loadera systemowego |
| `com.apple.security.cs.disable-library-validation` | library validation **zostaje włączona**: proces ładuje wyłącznie biblioteki podpisane tą samą tożsamością (albo Apple) – odpowiednik C-WIN-3, egzekwowany zawsze, nie „gdy podpisane". Aplikacja nie ma natywnych modułów firm trzecich, więc nie ma czego wyłączać |
| `com.apple.security.cs.allow-unsigned-executable-memory` | historycznie wymagany przez stare Electrony; współczesny V8 używa MAP_JIT (pokrywa go `allow-jit`). Startujemy **bez**; jeśli pomiar MM2 pokaże twardą konieczność, dopisanie wymaga ponownej bramki Opusa, nie decyzji Sonneta |
| `com.apple.security.cs.debugger`, `get-task-allow` | żadnego debugowalnego artefaktu dystrybucyjnego (§9.3) |
| `com.apple.security.files.downloads.read-write` | zbędny: zapis idzie przez panel (powerbox), nie po stałej ścieżce |
| `com.apple.security.device.*`, `com.apple.security.personal-information.*` | aplikacja nie dotyka kamery, mikrofonu, lokalizacji, kontaktów – spójnie z deny-all §7 SECURITY.md |
| `com.apple.security.temporary-exception.*` | wyjątki tymczasowe to dziury wycinane ręcznie w sandboxie; ich pojawienie się w jakiejkolwiek wersji wymaga osobnego projektu |

**[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-2 – oba zestawy jako kontrakt]**

### 5.3 Helpery i dziedziczenie

Procesy pomocnicze Electrona (renderer, GPU, utility) podpisywane są plikiem
inherit: `com.apple.security.app-sandbox` + `com.apple.security.inherit`
(+ `cs.allow-jit` tam, gdzie pomiar wykaże konieczność – renderer wykonuje
WASM). Dokładny podział entitlements per binarka pomocnicza jest zadaniem
pomiarowym MM2, nie przedmiotem zgadywania tutaj; zasada pozostaje: **każdy
helper w sandboxie, żaden z uprawnieniami sieciowymi**. Sandbox Chromium
(seatbelt per typ procesu, `app.enableSandbox()` z C-ISO-3) działa wewnątrz
App Sandbox – to warstwy komplementarne, nie wykluczające się.

### 5.4 Zgodność funkcjonalna: matryca pomiarowa (de-ryzykowanie głównego insightu)

App Sandbox to najmocniejsza warstwa tego projektu i zarazem jego największe
ryzyko wykonawcze: jeśli coś z rdzenia produktu pod nim nie działa, trzeba
świadomie wybrać kompromis (§5.5). Profil aplikacji jest sandbox-przyjazny
(zero natywnych modułów, zero `node_modules` w paczce, całe I/O przez
`app://` i panele), więc oczekiwania są dobre, ale **oczekiwanie to nie
pomiar**. Matryca do wykonania w MM2, wynik per wiersz: DZIAŁA / NIE DZIAŁA /
DZIAŁA Z ZASTRZEŻENIEM:

| # | Funkcja | Co konkretnie sprawdzić | Oczekiwanie |
|---|---|---|---|
| 1 | Start + okno + `app://` | boot do UI, wszystkie zasoby z `app://app/` | działa (main czyta własny pakiet – dozwolone w sandboxie) |
| 2 | Modele NER z `Contents/Resources` | pełna anonimizacja tekstu wklejonego | działa (odczyt własnego pakietu przez proces główny, streaming do renderera przez `app://`) |
| 3 | **SharedArrayBuffer / wielowątkowy WASM** | `crossOriginIsolated === true`, ORT wielowątkowy | działa (COOP/COEP z handlera `app://`, niezależne od OS) |
| 4 | JIT WASM pod Hardened Runtime | kompilacja ORT/OpenCV bez crasha | działa z `allow-jit`; jeśli crash → pomiar z `allow-unsigned-executable-memory` i powrót do bramki (§5.2) |
| 5 | OCR (PaddleOCR + OpenCV, tary z CacheStorage) | skan PDF → tekst | działa (CacheStorage w kontenerze) |
| 6 | Import plikiem: picker | PDF/DOCX/PNG/HEIC przez dialog | działa (powerbox) |
| 7 | Import drag&drop | upuszczenie pliku na okno | działa (rozszerzenie sandboxa z pasteboardu przeciągania); zmierzyć, bo to najczęstszy przepływ Alana |
| 8 | Eksport DOCX/TXT | zapis przez panel | działa (powerbox read-write) |
| 9 | Schowek (kopiuj tokenizowane / wklej wynik) | oba kierunki po kliknięciu | działa; na macOS 15+ możliwy systemowy monit przy odczycie schowka – zanotować UX, nie obchodzić |
| 10 | **`requestSingleInstanceLock`** | druga instancja ustępuje pierwszej | **niepewne**: implementacja Chromium używa gniazda unix w `userData`; jeśli seatbelt bez uprawnień sieciowych odmówi bindu, lock może zawsze zwracać sukces albo zawsze porażkę. Wynik tego pomiaru jest **podwójnie cenny**: rozstrzyga też pytanie AF_UNIX × sandbox dla mostu (§10.3). Plan awaryjny: start przez LaunchServices i tak jest jednoinstancyjny per użytkownik; polityka „druga instancja kończy się natychmiast" do zachowania w innym mechanizmie – decyzja przy pomiarze |
| 11 | GPU (WebGPU/WebGL, przełącznik `pii.allow-gpu`) | inferencja z GPU włączonym | działa (Metal w sandboxie to codzienność MAS); przy problemach ścieżka CPU zostaje domyślna |
| 12 | Web Locks (`background-lock`) | długi job przy zminimalizowanym oknie | działa (API renderera, bez OS) |
| 13 | `safeStorage`/keychain (fuse cookie encryption) | brak monitów, brak błędów przy starcie | działa (dostęp do własnych wpisów pęku kluczy jest dozwolony) |
| 14 | Dialog błędu startowego (`fatalStartupError`) | celowo uszkodzony model → dialog + exit | działa |
| 15 | `shell.openExternal` (link z allowlisty) | otwarcie przeglądarki systemowej | działa (LaunchServices z sandboxa jest dozwolone) |

**[DO ZMIERZENIA NA SPRZĘCIE – cała matryca; DO WERYFIKACJI PRZEZ OPUSA:
O-MAC-3 – akceptacja matrycy jako warunku zamrożenia entitlements]**

### 5.5 Kompromis, gdyby App Sandbox coś złamał

Jeżeli MM2 wykaże, że funkcja krytyczna (2, 3, 5, 6, 8) nie działa pod App
Sandbox i nie da się jej naprawić w granicach §5.2, dopuszczalny kompromis
brzmi: **wariant A na macOS bez App Sandbox, z pełnym Hardened Runtime** –
czyli dokładnie model Windows (warstwy 1–5 z §4.3) plus library validation
i notaryzacja. Wtedy: sekcja §4 wraca do brzmienia „izolacja procesowa, nie
systemowa", checklista traci pozycje C-MAC-10/15, a dokumentacja produktu
**nie może** twierdzić, że macOS ma blokadę jądra. Kompromis wymaga zgody
Opusa i Alana (to zmiana obietnicy, nie szczegół). Wariant pośredni
(sandbox z `temporary-exception`) jest zakazany (§5.2). Nie przewiduję
konieczności – profil aplikacji jest jak z podręcznika MAS – ale uczciwy
projekt nazywa wyjście awaryjne, zanim będzie potrzebne.

---

## §6. Podpis i notaryzacja (kwestia a; odpowiednik B4)

### 6.1 Łańcuch formalny

| Element | Windows (stan: zamknięte B4) | macOS (ten projekt) |
|---|---|---|
| Tożsamość | Azure Artifact Signing, CN=Kancelaria… | **Apple Developer Program** → certyfikat **Developer ID Application** (podpis `.app` i `.dmg`); **Developer ID Installer** tylko przy wyborze pkg (P-MAC-2) |
| Koszt | subskrypcja Azure | **99 USD/rok** (w PLN rząd 400–500 zł, do potwierdzenia przy rejestracji) – P-MAC-1 |
| Zaufanie systemu | SmartScreen (reputacja narastająca) | **Gatekeeper + notaryzacja** – decyzja binarna: artefakt notaryzowany otwiera się z jednym potwierdzeniem, nienotaryzowany jest blokowany (na współczesnym macOS bez prostego obejścia dla użytkownika). **Zaleta względem Windows: zero okresu budowania reputacji** |
| Znakowanie czasem | RFC 3161 | ticket notaryzacji (trwały; stapling czyni go offline) |
| Wpięcie w builder | `win.azureSignOptions` | `mac.hardenedRuntime` + `mac.notarize` + tożsamość z pęku kluczy maszyny budującej |

Rejestracja w programie Apple: **individual** (szybka, nazwa na certyfikacie:
„Alan Kolkowski") albo **organizacja** (wymaga numeru D-U-N-S dla działalności,
trwa dłużej; nazwa: „Kancelaria Radcy Prawnego K-Law Alan Kolkowski", spójna
z CN certyfikatu Windows). Rekomendacja: organizacja, jeśli terminarz zniesie
tygodnie oczekiwania na D-U-N-S; individual jako ścieżka szybka. **P-MAC-1**.

### 6.2 Status blokera

B4 na Windows brzmiał „podpis kodu". Na macOS pozycja jest **twardsza**:
bez notaryzacji dystrybucja praktycznie nie istnieje (Gatekeeper zablokuje
start u klienta), a notaryzacja wymusza Hardened Runtime. Dlatego
**C-MAC-2/3/4 (podpis, hardened runtime, notaryzacja + stapling) są blokerami
wydania od pierwszego builda dystrybucyjnego** – nie ma etapu „na razie bez
podpisu", który Windows przeszedł w fazie wewnętrznej. Buildy deweloperskie
(ad-hoc, bez notaryzacji) działają wyłącznie na maszynie budującej.

### 6.3 Poświadczenia notaryzacji

`mac.notarize: true` każe electron-builderowi wykonać notaryzację po podpisie.
Poświadczenia wyłącznie ze środowiska maszyny budującej (nigdy repo, nigdy
yml): identyfikator Apple ID + hasło aplikacyjne + Team ID **albo** klucz App
Store Connect API (rekomendowany: rewokowalny, o wąskim zakresie). Zasada
identyczna jak z `AZURE_*` – sekrety na żądanie, poza kodem. Szczegółowy
przebieg pierwszej rejestracji i konfiguracji spisze implementacja w
`docs/code-signing-apple.md`, lustrzanie do `docs/code-signing-azure.md`
(gotowce do wklejenia, zgodnie ze stylem pracy Alana).

### 6.4 Weryfikacja podpisu (wchodzi do §12)

- `codesign --verify --deep --strict "<app>"` → OK,
- `codesign -dvv` → `flags=0x10000(runtime)`, tożsamość Developer ID,
- `spctl -a -vv -t exec` → `accepted`, źródło „Notarized Developer ID",
- `xcrun stapler validate` na `.app` **i** na `.dmg`,
- test negatywny: podmiana jednego bajtu w dowolnym pliku pakietu →
  `codesign --verify` FAIL (pieczęć obejmuje zasoby, w tym modele).

---

## §7. Instalacja, quarantine, integralność pakietu (kwestia c; odpowiedniki B3+B1)

### 7.1 dmg vs pkg

| Kryterium | dmg (przeciągnij do /Applications) | pkg (instalator) |
|---|---|---|
| UX na macOS | kanoniczny, znany każdemu użytkownikowi Maca | znany, ale cięższy; kojarzy się z oprogramowaniem korporacyjnym |
| Wymuszenie miejsca instalacji | **brak** – użytkownik może uruchomić z DMG/Pobranych albo wrzucić do `~/Applications` | tak: instalacja do `/Applications` z uwierzytelnieniem administratora; pliki należą do roota |
| Odpowiednik `perMachine + allowToChange…: false` | częściowy (konwencja + symlink w oknie dmg) | pełny |
| Podpis/notaryzacja | Developer ID Application na `.app` i `.dmg` | dodatkowo certyfikat Developer ID Installer |
| Złożoność wydania | najniższa | wyższa (drugi certyfikat, skrypty produktu) |

**Rekomendacja: dmg w v1 (P-MAC-2).** Uzasadnienie: różnica bezpieczeństwa,
którą pkg miał domykać (katalog niezapisywalny dla procesu bez uprawnień),
na współczesnym macOS jest w dużej mierze domknięta systemowo – modyfikacja
pakietu innej aplikacji podlega TCC „App Management" (§7.5), podpis pieczętuje
zasoby, a B1 i tak weryfikuje modele przy każdym starcie. Gdy użytkownik
uruchomi aplikację spoza `/Applications`, żadna gwarancja **aplikacyjna** nie
znika (B1, sandbox, podpis działają niezależnie od ścieżki). Jeżeli Opus uzna
gwarancję instalacyjną za konieczną (pełny parytet z B3), ścieżką jest pkg –
projekt tego nie wyklucza, zmienia się tylko sekcja `mac.target` i dochodzi
drugi certyfikat. **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-7]**

### 7.2 Quarantine i pierwszy start

Pobrany dmg niesie atrybut `com.apple.quarantine`; aplikacja skopiowana
z niego dziedziczy go. Pierwszy start: Gatekeeper ocenia podpis i notaryzację
(ze staplem – bez sieci), użytkownik potwierdza jednorazowy dialog
„pobrano z internetu". To jest odpowiednik C-WIN-4, z lepszą mechaniką
(zero reputacji do zbudowania).

### 7.3 App Translocation (osobliwość macOS, do udokumentowania)

Aplikacja w kwarantannie uruchomiona **bez przeniesienia przez Findera**
(np. prosto z otwartego dmg albo z Pobranych) działa z losowego,
tylko-do-odczytu punktu montowania (Gatekeeper Path Randomization).
Dla tej aplikacji to niegroźne (pakiet jest tylko-do-odczytu z założenia,
dane żyją w kontenerze), ale ścieżki `process.resourcesPath` będą wtedy
egzotyczne. Do zrobienia w implementacji: (1) test smoke na aplikacji
uruchomionej z translokacji – pełny przebieg musi przejść, (2) instrukcja
użytkownika w dokumentacji: „przenieś do Aplikacji" (układ dmg z symlinkiem
robi to naturalnym gestem). **[DO ZMIERZENIA NA SPRZĘCIE]**

### 7.4 Minimalna wersja macOS

Rekomendacja: **macOS 13 (Ventura)** jako `minimumSystemVersion` – pierwsza
wersja z TCC „App Management" (§7.5), czyli z systemową ochroną pakietu przed
cichą modyfikacją. Górne ograniczenie narzuca i tak Electron 43 (wspierane
wersje macOS do potwierdzenia w dokumentacji Electrona przy implementacji).
Wybór progu to decyzja produktowa (odcina użytkowników starszych systemów):
**P-MAC-4**.

### 7.5 Łańcuch integralności na macOS (odpowiednik B1+B3, per ogniwo)

Windows: `%ProgramFiles%` (UAC) + zasób PE z hashem asara + B1. macOS:

1. **Pieczęć codesign obejmuje cały pakiet**, w tym `Contents/Resources/models`
   – na Windows modele nie były objęte podpisem w ogóle. Ograniczenie
   (uczciwie): pieczęć zasobów jest weryfikowana przy ocenie Gatekeepera
   i na żądanie (`codesign --verify`), **nie przy każdym otwarciu pliku
   w runtime** – więc nie zastępuje B1, tylko go poprzedza.
2. **Kotwica asara w `Info.plist`** (§3.5) – chroni kod aplikacji.
3. **TCC „App Management" (macOS 13+)**: proces bez nadanego przez
   użytkownika uprawnienia (albo Full Disk Access) nie zmodyfikuje pakietu
   innej aplikacji. To jest macOS-owa odpowiedź na atak Z4 z S1 (podmiana
   modelu przez proces bez uprawnień) – inna mechanika niż `%ProgramFiles%`,
   ten sam skutek: **cicha podmiana pliku w pakiecie wymaga czegoś więcej niż
   kodu na koncie użytkownika**. Zakres i szczelność do zmierzenia na
   docelowej wersji systemu (są to mechanizmy młodsze i mniej zbadane niż
   ACL-e NTFS). **[DO ZMIERZENIA NA SPRZĘCIE]**
4. **B1 w runtime – bez żadnych zmian.** `electron/model-integrity.mjs`
   działa na macOS tak samo (node:crypto/fs, ścieżki z §3.2). Test podmiany
   bajtu w modelu na spakowanej aplikacji wchodzi do checklisty jako
   C-MAC-14 – to jest **ostateczny** detektor niezależny od łask OS.
5. **Okno TOCTOU** (model podmieniony po starcie): na Windows domyka je
   niezapisywalność katalogu; na macOS domyka je (3) + fakt, że modele są
   czytane strumieniowo z pakietu chronionego pieczęcią. Ryzyko rezydualne
   opisane w §9.4 – atakujący z uprawnieniem App Management jest poza
   modelem, jak administrator na Windows (R4).

**[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-4 – cały łańcuch 1–5 jako odpowiednik
B1/B3/B4]**

---

## §8. Ścieżki, zrzuty, trwałość (kwestia f)

### 8.1 Mapa ścieżek

| Rola | Windows | macOS (z App Sandbox) |
|---|---|---|
| `userData` (profil Chromium, localStorage preferencji) | `%APPDATA%\Lokalny anonimizator` | `~/Library/Containers/<appId>/Data/Library/Application Support/Lokalny anonimizator` – **kontener**; system mapuje standardowe ścieżki do wnętrza kontenera bez zmian w kodzie |
| temp | `%TEMP%` | `$TMPDIR` wewnątrz kontenera (per użytkownik, 0700) |
| crashDumps | `userData\Crashpad` (zmierzone: pusty bez `crashReporter.start()`) | `<userData>/Crashpad` w kontenerze – oczekiwanie: tak samo pusty; **[DO ZMIERZENIA NA SPRZĘCIE]** (C-MAC-17) |
| profil roamingowy | istnieje (`%APPDATA%` wędruje w domenie) – stąd czujność przy pliku sesyjnym mostu | **nie istnieje**; kontener jest lokalny i nieobjęty iCloud Drive. Jedna pułapka mniej dla mostu (§10.4) |

Zawartość profilu bez zmian: preferencje UI i cache tarów OCR (publiczne
modele), zero treści dokumentów, zero legendy (C-PERS-1/2 obowiązują
niezmienione – to właściwości kodu, nie OS).

### 8.2 Zrzuty awaryjne: ReportCrash zamiast WER

- **Crashpad Electrona**: nieuzbrojony bez `crashReporter.start()` –
  zmierzone na Windows (C-PERS-5), do powtórzenia pomiaru na macOS (ten sam
  kod, inna platforma crashpada). C-MAC-17.
- **ReportCrash (poziom OS)**: przy awarii procesu macOS zapisuje raport
  `.ips` do `~/Library/Logs/DiagnosticReports` – stosy wątków, rejestry,
  fragmenty otoczenia wskaźników; **nie** pełny zrzut sterty, więc klasa
  ryzyka niższa niż pełny minidump WER, ale nie zerowa. Wyłączenie per
  aplikacja nie istnieje jako wspierany mechanizm; wyłączenie globalne jest
  ingerencją w system użytkownika, której nie robimy. Kwalifikacja: **R3-mac,
  ryzyko rezydualne, kontrola organizacyjna** (jak WER na Windows) –
  dokumentujemy, nie udajemy, że rozwiązane.
- **Pamięć wymieniana na dysk**: macOS domyślnie **szyfruje swap** na
  współczesnych systemach, a FileVault (odpowiednik BitLockera, Z5-mac)
  szyfruje wolumen – łącznie R3 na macOS jest **łagodniejsze** niż na Windows
  bez BitLockera. Status FileVault wchodzi do checklisty jak C-WIN-9
  (`fdesetup status`).

### 8.3 Osobliwość macOS: Saved Application State (NOWY wektor do zmierzenia)

macOS potrafi utrwalać stan okien aplikacji (funkcja wznawiania,
`~/Library/Saved Application State/<bundleId>.savedState`), w tym – zależnie
od wersji systemu i zachowania aplikacji – **migawkę zawartości okna**.
Okno tej aplikacji pokazuje legendę i treść dokumentów, więc migawka na dysku
byłaby artefaktem klasy A1/A2 poza kontrolą kodu. Dla aplikacji w sandboxie
stan ląduje w kontenerze, co zawęża ekspozycję, ale nie usuwa problemu.
Do zmierzenia na sprzęcie (C-MAC-18): czy po pełnym przebiegu i zamknięciu
aplikacji katalog savedState zawiera cokolwiek poza metadanymi geometrii
okna; jeżeli zawiera migawkę – mitygacja do zaprojektowania w implementacji
(wyłączenie restorable na oknie / odpowiedni klucz Info.plist przez
`extendInfo` / czyszczenie przy wyjściu), z powrotem do bramki Opusa, bo
dotyka trwałości A1. **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-10]**

### 8.4 Pozytyw macOS, żeby nie malować samych zagrożeń

- Odczyt ekranu/okien innej aplikacji jest na macOS bramkowany TCC (Screen
  Recording) – na Windows dowolny proces użytkownika robi zrzut ekranu bez
  pytania. Scenariusz „malware fotografuje okno z legendą" jest na macOS
  trudniejszy.
- Debugowanie/odczyt pamięci procesu z Hardened Runtime (bez `get-task-allow`)
  jest dla procesu bez specjalnych uprawnień systemowych **zablokowane** –
  atakujący Z4 na macOS co do zasady nie zrzuci sterty renderera z legendą
  tak, jak zrobiłby to `ReadProcessMemory` na Windows. To realnie podnosi
  ochronę A1 (legendy w RAM). Granice tego twierdzenia (root, SIP off,
  narzędzia developerskie) opisze THREAT-MODEL przy aktualizacji.

---

## §9. Model zagrożeń macOS: różnice względem Windows

### 9.1 Założenia (delta wobec Z1–Z6)

| # | Założenie | Status |
|---|---|---|
| Z1–Z4 | bez zmian (maszyna niezainfekowana przy instalacji; użytkownik zaufany, nieekspercki; dokumenty niezaufane; atakujący = kod na koncie użytkownika) | przyjęte |
| Z5-mac | dysk szyfrowany **FileVault** (zamiast BitLocker) | kontrola organizacyjna, checklista C-MAC-9 |
| Z6-mac | kotwica asara: `ElectronAsarIntegrity` w `Info.plist` działa w tej wersji electron-buildera | **DO WERYFIKACJI** (C-MAC-13), lustrzane Z6 |
| **Z7-mac** | użytkownik docelowy jest **administratorem swojego Maca** (typowa konfiguracja jednoosobowa) – więc mechanizmy „admin może" nie są dla niego barierą, barierą są monity TCC i łamanie podpisu | przyjęte, realistyczne |
| **Z8-mac** | docelowy macOS ≥ próg z P-MAC-4 (rekomendacja 13+), więc TCC App Management jest w modelu | przyjęte, egzekwowane przez `minimumSystemVersion` |

### 9.2 Mechanizm po mechanizmie (mapa różnic)

| Wektor / kontrola | Windows | macOS | Delta bezpieczeństwa |
|---|---|---|---|
| Fałszywy instalator (STRIDE S, S1 pkt „Spoofing") | podpis Authenticode + SmartScreen (reputacja) | Developer ID + notaryzacja + Gatekeeper (binarnie) | macOS ≥ Windows; brak okresu „świeżego certyfikatu" |
| Podmiana modeli (S1) | `%ProgramFiles%` + kotwica PE + B1 | pieczęć codesign na zasobach + TCC App Management + kotwica plist + B1 | porównywalne; inna mechanika, ten sam skutek; pomiar TCC wymagany |
| Podmiana binarki | jak wyżej + RCI (C-WIN-3 `?`) | Hardened Runtime + library validation (zawsze) + na Apple Silicon obowiązkowy ważny podpis | macOS ≥ Windows (RCI na Windows wciąż niezmierzone) |
| Wstrzyknięcie biblioteki | DLL sideloading; RCI `?` | `DYLD_INSERT_LIBRARIES` ignorowane (brak entitlementu), library validation odrzuca obce dyliby | macOS ≥ Windows |
| Egress mimo blokad aplikacyjnych | reguła zapory (zdejmowalna przez admina) | **App Sandbox network-off (jądro, w podpisie)** | macOS > Windows – główny zysk projektu |
| Zrzuty pamięci OS | WER (pełny minidump możliwy) | ReportCrash (`.ips`, bez pełnej sterty) + szyfrowany swap | macOS ≥ Windows |
| Odczyt pamięci procesu przez malware Z4 | możliwy (ten sam użytkownik) | blokowany przez Hardened Runtime (bez `get-task-allow`) | macOS > Windows dla A1 |
| Zrzut ekranu okna przez malware Z4 | bez przeszkód | TCC Screen Recording | macOS > Windows |
| Trwałość stanu okien | brak odpowiednika | **Saved Application State – nowy wektor** (§8.3) | macOS < Windows, do zmierzenia i domknięcia |
| Kanał OS „do producenta systemu" | telemetria Windows, WER | Gatekeeper/OCSP/XProtect łączą się z Apple przy ocenie aplikacji | neutralne; patrz §9.3 |
| Deep-linki / drugi kanał wejścia | C-WIN-5/6 (brak protokołu; `second-instance` nie czyta argv) | dodatkowo zdarzenia `open-file`/`open-url` LaunchServices – aplikacja ich **nie rejestruje**; checklista pilnuje, żeby tak zostało (C-MAC-6) | parytet po domknięciu |

### 9.3 Uczciwe doprecyzowanie obietnicy „air-gap" na macOS

Obietnica produktu dotyczy **procesów aplikacji**: aplikacja nie ma żadnej
ścieżki wysłania danych (a na macOS dodatkowo nie ma prawa otworzyć gniazda).
Natomiast **sam system operacyjny** wykonuje własne połączenia do Apple
w związku z aplikacją (ocena notaryzacji przy pierwszym starcie, odświeżanie
list zaufania). To ruch systemu, nie aplikacji, nie zawiera treści dokumentów
i zachodzi także bez naszej aplikacji – ale dokumentacja użytkownika musi to
zdanie zawierać, żeby obietnica była precyzyjna (dokładnie w duchu §4.5
projektu mostu: nazywamy nieścisłość, zamiast powtarzać slogan). Stapling
(§3.4) gwarantuje przy tym, że **pierwszy start w trybie samolotowym
przechodzi** – test C-MAC-19. **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-8 –
brzmienie tego doprecyzowania w dokumentacji]**

### 9.4 Ryzyka rezydualne macOS (delta wobec R1–R6)

| ID | Ryzyko | Kwalifikacja |
|---|---|---|
| R1, R2, R6 | bez zmian (jakość NER; WASM C/C++; zaufanie do wag) | wspólne dla platform |
| R3-mac | ReportCrash `.ips`, savedState (do pomiaru), pamięć w RAM | łagodniejsze niż R3-Windows (szyfrowany swap domyślnie); kontrola organizacyjna: FileVault |
| R4-mac | atakujący z uprawnieniem App Management / Full Disk Access / rootem | poza modelem, jak administrator na Windows |
| R5 | `shell.openExternal` poza kontrolą aplikacji | bez zmian |
| **R7-mac** | użytkownik trzyma aplikację poza `/Applications` (dmg tego nie wymusza) | gwarancje aplikacyjne działają wszędzie (B1, sandbox, podpis); gwarancja katalogu instalacyjnego słabsza niż na Windows – akceptowane przy wyborze dmg (P-MAC-2), pkg jako opcja domykająca |

---

## §10. Wariantowość A/B na macOS i grunt pod most (kwestia e)

### 10.1 Dwa targety, jak na Windows

Wzorzec z `MCP-BRIDGE-DESIGN.md` §8 przenosi się wprost:

- **Wariant A macOS**: sekcja `mac` w `electron-builder.yml`; asercje
  czystości artefaktu (C-BR-13) obejmują artefakt mac (grep po asarze
  i `dist-desktop/` jest niezależny od platformy).
- **Wariant B macOS**: sekcja `mac` w `electron-builder.bridge.yml`
  (faza 3); osobny `appId`/`productName` („Lokalny anonimizator + AI",
  decyzja 1 z `PRODUCT-DECISIONS.md`) → osobny kontener, instalacja obok
  siebie. Fuses identyczne w obu (C-BR-14).
- **Nowość specyficzna dla macOS: entitlements są częścią wariantowości.**
  Na Windows warianty różniły się plikami w asarze i flagą Vite; na macOS
  różnią się dodatkowo profilem sandboxa (A: network-off zawsze; B: wynik
  rozstrzygnięcia §10.3). Asercja artefaktów rozszerza się o porównanie
  entitlements z wzorcem per wariant (C-MAC-21).

### 10.2 Transport mostu: named pipe → gniazdo AF_UNIX (mapowanie, nie projekt)

`MCP-BRIDGE-DESIGN.md` §4.2 odrzucił AF_UNIX na Windows jako „bez różnicy"
(Node realizuje ścieżkowe gniazda przez nazwane potoki). Na macOS relacja się
odwraca: nazwane potoki Windows nie istnieją, `net.Server.listen(<ścieżka>)`
tworzy gniazdo domeny uniksowej. Mapowanie właściwości, punkt po punkcie:

| Właściwość (Windows, §4.3–4.5 mostu) | Odpowiednik macOS |
|---|---|
| Nazwa `\\.\pipe\pii-tools-bridge-v1-<128 b hex>` | ścieżka pliku gniazda w katalogu prywatnym aplikacji; **limit długości ścieżki gniazda ~104 bajty** (`sun_path`) wymusza krótką ścieżkę – losowość może żyć w nazwie pliku, byle całość zmieściła się w limicie; kandydat: podkatalog `bridge/` w kontenerze albo `$TMPDIR` |
| DACL potoku (nieustawialny z Node → kompensacja protokołem, O-1) | **lepiej niż na Windows**: katalog gniazda `0700`, plik gniazda `0600` (chmod po bind) – klasyczne uprawnienia POSIX, ustawialne bez kodu natywnego. Kompensacja protokołem (HMAC §4.3 mostu) **zostaje mimo to** – spójność obu platform i obrona w głąb |
| `FILE_FLAG_FIRST_PIPE_INSTANCE` (bind na zajętą nazwę = błąd, O-2) | inna semantyka: gniazdo uniksowe zostawia **plik-sierotę** po awarii; ponowny bind na istniejący plik = `EADDRINUSE` nawet bez żywego nasłuchu. Wymagana jawna procedura: przy starcie mostu wykryj sierotę (próba połączenia → odmowa = martwy plik → unlink → bind). Fail-closed przy każdej niejednoznaczności. To najważniejsza różnica behawioralna transportu |
| Ekspozycja SMB `\\host\pipe\…` (§4.5 mostu) | **nie istnieje** – AF_UNIX jest z definicji lokalny. Cała sekcja ryzyka zdalnego dostępu znika na macOS |
| Plik sesyjny w `%LOCALAPPDATA%` (nie roaming) | kontener aplikacji (brak odpowiednika profilu roamingowego, §8.1); reszta bez zmian: zapis atomowy, zero PII, sprzątanie |
| Niezmiennik C-NET-6b („`node:net` tylko dla ścieżki `\\.\pipe\`") | **C-NET-6b-mac**: `node:net` wolno tym samym dwóm plikom, wyłącznie w formie `listen/connect({ path })` (nigdy host/port), z twardą asercją: ścieżka absolutna wewnątrz katalogu mostu aplikacji. Test statyczny i jednostkowy jak w §4.6 mostu, z gałęzią per platforma |
| HMAC challenge-response, limity ramek, NDJSON | bez zmian (transport-agnostyczne) |
| Adapter `--bridge-adapter` (ta sama binarka) | bez zmian koncepcyjnych; klient MCP wskazuje `<app>.app/Contents/MacOS/<binarka>` – ścieżka do dokumentacji klienta w fazie 3 |

### 10.3 Jedno prawdziwe pytanie otwarte: AF_UNIX × App Sandbox

Entitlements sieciowe App Sandbox są gruboziarniste: nie istnieje uprawnienie
„tylko gniazda uniksowe w moim kontenerze". Czy `bind`/`connect` na gnieździe
AF_UNIX **wewnątrz własnego kontenera** wymaga `network.client/server`, czy
przechodzi jako operacja plikowa – tego nie przesądzam bez pomiaru; wynik
pomiaru `requestSingleInstanceLock` (§5.4 poz. 10, ten sam mechanizm w
Chromium) będzie pierwszą odpowiedzią. Konsekwencje dla wariantu B na macOS,
obie ścieżki nazwane z góry:

- **(b1) Pomiar pokaże: AF_UNIX w kontenerze działa bez entitlements
  sieciowych.** Wariant B macOS zachowuje App Sandbox network-off – mocniejszy
  niż Windows B (kanał lokalny działa, internetu dalej zakazuje jądro).
  Scenariusz idealny.
- **(b2) Pomiar pokaże: wymagane `network.client/server`.** Nadanie ich
  otworzyłoby także gniazda IP – **niedopuszczalne** (łamie obietnicę §2
  mostu mocniej, niż Windows kiedykolwiek). Wtedy wariant B macOS idzie
  **bez App Sandbox, z pełnym Hardened Runtime** – dokładny parytet
  z Windows B (warstwy webRequest/CSP/WebRTC/fuses), a App Sandbox pozostaje
  ekskluzywną własnością wariantu A i jego argumentem produktowym.
  Do rozważenia w fazie 3 (nie tu): XPC zamiast AF_UNIX jako transport
  sandbox-natywny.

Decyzja zapada w fazie 3 na podstawie pomiaru z MM2; ten projekt jedynie
**rezerwuje obie ścieżki i zakazuje trzeciej** (entitlements sieciowe
w jakimkolwiek wariancie). **[DO WERYFIKACJI PRZEZ OPUSA: O-MAC-9]**

### 10.4 Czego ten projekt świadomie NIE robi dla mostu

Nie projektuje: protokołu (jest w moście §4.3), bramki człowieka (§6 mostu),
adaptera (§7 mostu), wariantowości plików (§8 mostu) – wszystko przenosi się
bez zmian koncepcyjnych. Jedyne macOS-owe delty do wniesienia w fazie 3 to
§10.2 (transport) i §10.3 (sandbox). Ten podział odpowiada poleceniu
„odnotuj, nie projektuj całości".

---

## §11. Weryfikacja per warstwa wariantu A (kwestia g – tabela wymagana)

Legenda statusów: **BEZ ZMIAN** – mechanizm cross-platformowy, działa
z definicji, wymaga tylko przebiegu testu na macOS; **ODPOWIEDNIK** – macOS
realizuje tę samą własność innym mechanizmem (wskazany); **DO ZMIERZENIA** –
teza wymaga sprzętu przed wpisaniem PASS.

| Warstwa (SECURITY.md) | Status na macOS | Mechanizm / co zmierzyć |
|---|---|---|
| §1 Izolacja renderera (`contextIsolation`, `sandbox`, `enableSandbox`, brak Node) | BEZ ZMIAN + wzmocnienie | seatbelt Chromium wewnątrz App Sandbox; smoke: boot + `typeof process === 'undefined'` w rendererze |
| §2 Protokół `app://` (trzy drzewa, safeJoin, nagłówki COOP/COEP/nosniff) | BEZ ZMIAN | smoke: origin `app://app`, `crossOriginIsolated === true` |
| §3 Strażnik `webRequest` + licznik + kanarek | BEZ ZMIAN | smoke: licznik 0 po pełnym przebiegu; kanarek podbija licznik (kształt błędu pod sandboxem: DO ZMIERZENIA, §4.4) |
| §3 Polityka WebRTC (`disable_non_proxied_udp`, zero ICE) | BEZ ZMIAN | smoke: zero kandydatów ICE, także ze świeżego realmu |
| §3 Przełączniki Chromium (background networking, MediaRouter, host-resolver, no-proxy) | BEZ ZMIAN | tcpdump mDNS/DIAL po `ip.src` hosta (metodologia C-NET-5) – DO ZMIERZENIA |
| §3/§13 Tryb samolotowy (`MAP * ~NOTFOUND` w spakowanym) | BEZ ZMIAN | `desktop:smoke:offline` na macOS – DO ZMIERZENIA (przebieg) |
| NOWA warstwa egress: blokada gniazd przez jądro | ODPOWIEDNIK (App Sandbox network-off) | statycznie: `codesign -d --entitlements` bez `network.*`; dynamicznie: `lsof -a -i` puste przez cały smoke – DO ZMIERZENIA |
| §4 Preload/IPC (jeden kanał, walidacja nadawcy) | BEZ ZMIAN | testy jednostkowe istniejące |
| §5 Linki zewnętrzne (zbiór dokładnych URL-i) | BEZ ZMIAN | `main-links.test.js`; smoke |
| §6 CSP (dokument + worker) | BEZ ZMIAN | smoke |
| §7 Uprawnienia (deny-all poza schowkiem) | BEZ ZMIAN + TCC systemowe ponad tym | monit schowka na macOS 15+: DO ZMIERZENIA (UX, nie bezpieczeństwo) |
| §8 Fuses (7 pozycji) | BEZ ZMIAN | `@electron/fuses read --app <ścieżka .app>` – DO ZMIERZENIA (C-MAC-12) |
| §8/§12a Kotwica asara | ODPOWIEDNIK (`ElectronAsarIntegrity` w `Info.plist`, pieczętowany podpisem) | test podmiany bajtu w asarze → odmowa startu – DO ZMIERZENIA (C-MAC-13) |
| §12a B1 integralność modeli w runtime | BEZ ZMIAN (kod i ścieżki identyczne) | test podmiany bajtu w modelu na spakowanej aplikacji → dialog + exit – DO ZMIERZENIA (C-MAC-14) |
| §12a Pojedyncza instancja | DO ZMIERZENIA | `requestSingleInstanceLock` pod App Sandbox (§5.4 poz. 10); plan awaryjny opisany |
| §12a Twarde błędy startu (dialog) | BEZ ZMIAN | test z uszkodzonym modelem |
| B3: katalog instalacji | ODPOWIEDNIK (dmg → `/Applications` + TCC App Management + pieczęć podpisu; pkg jako opcja twarda) | próba zapisu w pakiecie przez proces bez uprawnień → odmowa – DO ZMIERZENIA (C-MAC-1) |
| B4: podpis kodu | ODPOWIEDNIK (Developer ID + Hardened Runtime + notaryzacja + stapling) | `codesign --verify`, `spctl -a`, `stapler validate`, pierwszy start offline – DO ZMIERZENIA (C-MAC-2/4/19) |
| C-WIN-3: ochrona przed wstrzyknięciem | ODPOWIEDNIK (library validation + brak `DYLD_*` entitlements) | próba `DYLD_INSERT_LIBRARIES` na spakowanej aplikacji → zignorowana – DO ZMIERZENIA (C-MAC-3) |
| C-NET-8: zapora wychodząca | ODPOWIEDNIK (App Sandbox; socketfilterfw odrzucone – inbound-only) | jak wiersz „NOWA warstwa egress" |
| C-PERS-5: zrzuty awaryjne | BEZ ZMIAN (kod) + ODPOWIEDNIK ryzyka OS (ReportCrash zamiast WER) | Crashpad pusty po wymuszonym crashu renderera – DO ZMIERZENIA (C-MAC-17); ReportCrash → R3-mac |
| Trwałość stanu okien | NOWY WEKTOR macOS | savedState po pełnym przebiegu – DO ZMIERZENIA (C-MAC-18) |
| §9 Legenda ulotna, zamknięcie = wyjście | BEZ ZMIAN | `window-all-closed` już dziś jawnie obejmuje macOS (`app.quit()` bez wyjątku darwinowego) – zachowanie potwierdzić w smoke |
| §11 Zero telemetrii/auto-update | BEZ ZMIAN | grep + `publish: null` wspólne |

---

## §12. Checklista: mapowanie C-WIN-* → C-MAC-* i nowe pozycje

`SECURITY-CHECKLIST.md` zyskuje sekcję „8a. macOS" (obowiązującą build mac;
sekcje 1–7 obowiązują oba systemy bez zmian). Werdykt bramki wydania jest
wydawany **per system operacyjny** (build Windows może wyjść, gdy macOS
jeszcze nie przeszedł swojej matrycy – i odwrotnie).

| ID | Pozycja | Wzór | Jak sprawdzić (skrót) |
|---|---|---|---|
| C-MAC-1 | Pakiet w `/Applications`, modyfikacja pakietu przez proces bez uprawnień niemożliwa | C-WIN-1 | próba zapisu do `.app` z konta użytkownika bez App Management → odmowa TCC; dokumentacja instalacji |
| C-MAC-2 | `.app` i `.dmg` podpisane Developer ID, podpis ważny i ścisły | C-WIN-2 | `codesign --verify --deep --strict`; tożsamość na certyfikacie zgodna z P-MAC-1 |
| C-MAC-3 | Wstrzyknięcie bibliotek zablokowane: library validation aktywna, `DYLD_INSERT_LIBRARIES` ignorowane, brak entitlements `disable-library-validation`/`allow-dyld-environment-variables` | C-WIN-3 | `codesign -d --entitlements`; test żywy z `DYLD_INSERT_LIBRARIES` |
| C-MAC-4 | Notaryzacja + stapling; Gatekeeper akceptuje | C-WIN-4 | `spctl -a -vv`, `xcrun stapler validate` (`.app` i `.dmg`) |
| C-MAC-5 | Brak rejestracji protokołów/typów URL (`CFBundleURLTypes` nieobecne) | C-WIN-5 | inspekcja `Info.plist` |
| C-MAC-6 | Zdarzenia `open-file`/`open-url` nierejestrowane; `second-instance` nie czyta argv | C-WIN-6 | grep po `electron/`; test ręczny `open <plik> -a` |
| C-MAC-7 | Upuszczenie pliku nie nawiguje poza origin | C-WIN-7 | jak Windows (will-navigate) + test ręczny |
| C-MAC-8 | Pojedyncza instancja (mechanizm zmierzony pod sandboxem) | C-WIN-8 | §5.4 poz. 10 |
| C-MAC-9 | FileVault włączony (kontrola organizacyjna) | C-WIN-9 | `fdesetup status` |
| C-MAC-10 | **App Sandbox włączony; entitlements sieciowe nieobecne** | nowa (główny insight) | `codesign -d --entitlements :-`; asercja automatyczna w buildzie |
| C-MAC-11 | Hardened Runtime na każdej binarce pakietu | nowa | `codesign -dvv` (flaga `runtime`) na binarce głównej i helperach |
| C-MAC-12 | Fuses zapisane w binarce mac (7 pozycji, identyczne z Windows) | C-INT-2 | `@electron/fuses read --app` |
| C-MAC-13 | Kotwica `ElectronAsarIntegrity` w `Info.plist`; podmiana bajtu w asarze = brak startu | C-INT-3 / Z6-mac | test podmiany bajtu |
| C-MAC-14 | B1: podmiana bajtu w modelu na spakowanej aplikacji = dialog + brak startu | C-INT-4 | test podmiany bajtu w `Contents/Resources/models` |
| C-MAC-15 | **Zero otwartych gniazd przez cały przebieg smoke** | nowa (odpowiednik pomiaru Wireshark) | `lsof -a -i -p <drzewo pid>` w pętli podczas smoke |
| C-MAC-16 | Zero pakietów mDNS/DIAL z hosta w czasie życia aplikacji | C-NET-5 | tcpdump wg metodologii N-4 (filtr po `ip.src`) |
| C-MAC-17 | Crashpad pusty bez `crashReporter.start()` (pomiar mac) | C-PERS-5 | wymuszony crash renderera, inspekcja kontenera |
| C-MAC-18 | Saved Application State bez migawki treści okna | nowa (§8.3) | pełny przebieg → zamknięcie → inspekcja savedState |
| C-MAC-19 | **Pierwszy start świeżo pobranego dmg w trybie samolotowym przechodzi** (dowód staplingu) | nowa | fizyczny test offline na czystym koncie/maszynie |
| C-MAC-20 | Aplikacja uruchomiona z translokacji (z dmg) wykonuje pełny przebieg | nowa (§7.3) | smoke z aplikacją startowaną prosto z obrazu |
| C-MAC-21 | Zestaw entitlements identyczny z wzorcem w repo (per wariant A/B) | nowa | diff `codesign -d --entitlements` ↔ plik wzorcowy; build FAIL przy rozjeździe |

Pozycje wspólne (C-ISO, C-NET, C-INP, C-IPC, C-INT, C-PERS, C-PKG) obowiązują
build macOS bez renumeracji – przebieg ich testów na macOS jest częścią MM4.

---

## §13. Plan implementacji dla Sonneta

Zasady nadrzędne: (1) **zero kodu przed spełnieniem warunku wejścia §2**
(sprzęt + konto Apple Developer + decyzje P-MAC-1…5); (2) każdy moduł przez
bramkę Opusa przed merge (WM5); (3) żadnych zmian w `electron/` i `src/` poza
jawnie wymienionymi; (4) build Windows musi pozostać bit-w-bit niezależny –
po każdym module `desktop:build` + smoke'i Windows przechodzą bez zmian.

Umiejscowienie w mapie faz (`SHARED-FOUNDATION` §7.4): tor **równoległy** do
faz 1–2, niezależny od S1–S4/DOCX/fleksji (dotyka wyłącznie buildu i OS);
jedyny punkt styku z fazą 3 to pomiar z MM2 zasilający decyzję §10.3.
Rekomendowany start: po domknięciu fazy 0, równolegle z fazą 1 – pod
warunkiem sprzętu (P-MAC-5/6).

| Moduł | Zakres | Kryteria akceptacji (skrót) | Bramka Opusa |
|---|---|---|---|
| **MM0** warunki wejścia | zakup/dostęp do maszyny (P-MAC-5), rejestracja Apple Developer (P-MAC-1), decyzje P-MAC-2/3/4; `docs/code-signing-apple.md` – dziennik konfiguracji (gotowce do wklejenia, jak przy Azure) | konto aktywne, certyfikaty Developer ID w pęku kluczy maszyny budującej; sekrety poza repo | nie (organizacyjny) |
| **MM1** build niepodpisany | sekcja `mac` w `electron-builder.yml` (bez notaryzacji), `build/icon.icns`, build ad-hoc na Macu; `desktop:smoke` w trybie repo na macOS | aplikacja startuje, pełny przebieg repo-smoke zielony; Windows build nietknięty (porównanie artefaktów) | tak (dotyka konfiguracji buildu obu platform) |
| **MM2** sandbox + entitlements | pliki `build/entitlements.mac.plist` + `.inherit.plist` wg §5.2/§5.3; **wykonanie całej matrycy §5.4** i pomiaru single-instance/AF_UNIX; raport DZIAŁA/NIE DZIAŁA per wiersz | matryca kompletna; entitlements zamrożone albo kompromis §5.5 jawnie eskalowany; wynik pomiaru §10.3 zapisany dla fazy 3 | tak (izolacja + egress – rdzeń projektu) |
| **MM3** podpis + notaryzacja | `hardenedRuntime`, `notarize`, przebieg §3.4 end-to-end; asercja entitlements (C-MAC-21) i weryfikacje §6.4 wpięte w skrypt buildu | dmg notaryzowany i stapled; `spctl` accepted; pierwszy start offline na czystej maszynie/koncie (C-MAC-19) | tak (podpis/integralność) |
| **MM4** smoke spakowany + pomiary | port `desktop:smoke:packaged`/`offline` na ścieżki `.app`; testy integralności (C-MAC-13/14); pomiary egress (C-MAC-15/16); crash/savedState (C-MAC-17/18); translokacja (C-MAC-20) | wszystkie pozycje §12 z wynikiem PASS albo jawnym odstępstwem; licznik blokad 0 przez pełny przebieg | tak (dowód całości) |
| **MM5** dokumenty | aktualizacja `SECURITY.md` (nowa warstwa w §wstępie, sekcja macOS), `THREAT-MODEL.md` (delta §9), `SECURITY-CHECKLIST.md` (sekcja 8a, werdykt per OS), `README`/dokumentacja użytkownika (§9.3 – brzmienie obietnicy; instrukcja instalacji z §7) | dokumenty spójne; brzmienie z O-MAC-8 zatwierdzone | tak (treść obietnicy bezpieczeństwa) |

Kolejność: MM0 → MM1 → MM2 → MM3 → MM4 → MM5. MM2 jest **punktem decyzyjnym**:
jego raport wraca do Opusa i Alana przed MM3 (zamrożenie entitlements to
zamrożenie obietnicy). Wariant B na macOS nie ma tu modułów – wchodzi do
planu fazy 3 z deltami §10.2/§10.3.

---

## §14. Rejestr pozycji DO WERYFIKACJI PRZEZ OPUSA

| ID | Kwestia | Propozycja projektu | Ryzyko przy błędzie |
|---|---|---|---|
| **O-MAC-1** | App Sandbox network-off jako główna warstwa egress wariantu A (§4.1) | przyjąć; webRequest/CSP/WebRTC zostają jako obrona w głąb | fałszywe poczucie: gdyby sandbox nie obejmował któregoś procesu pomocniczego, warstwa nie jest szczelna – stąd C-MAC-11/15 |
| **O-MAC-2** | minimalny zestaw entitlements + lista jawnie nieobecnych (§5.2) jako kontrakt z asercją w buildzie | przyjąć; każde rozszerzenie wraca do bramki | pojedynczy entitlement (np. `network.client`) unieważnia całą warstwę §4 po cichu |
| **O-MAC-3** | matryca zgodności §5.4 jako warunek zamrożenia entitlements; kompromis §5.5 tylko za zgodą Opusa+Alana | przyjąć | zamrożenie bez pomiaru = ryzyko wydania niedziałającego OCR/eksportu albo cichego dopisania uprawnień |
| **O-MAC-4** | łańcuch integralności macOS: pieczęć codesign + kotwica plist + TCC App Management + B1 (§7.5) jako odpowiednik B1/B3/B4 | przyjąć z pomiarem TCC | przeszacowanie TCC (mechanizm młody) → S1-mac otwarte mimo deklaracji PASS |
| **O-MAC-5** | kolejność fuses → podpis → notaryzacja; `resetAdHocDarwinSignature` pozostaje (§3.4) | przyjąć | odwrócenie kolejności = artefakt z nieważnym podpisem albo bez fuses |
| **O-MAC-6** | brak odpowiednika reguły zapory jako osobnego bytu; dowód warstwy jądra = statyczny (entitlements) + obserwacja (`lsof`), bez kanarka gniazd w binarce (§4.4) | przyjąć | kanarek gniazd wymagałby `node:net` w aplikacji – złamanie C-NET-6 dla testu to zły handel |
| **O-MAC-7** | dmg zamiast pkg (P-MAC-2) i akceptacja ryzyka R7-mac (§7.1, §9.4) | dmg w v1; pkg jako ścieżka domknięcia, gdyby Opus wymagał twardej gwarancji katalogu | użytkownik z aplikacją w `~/Downloads`: gwarancje aplikacyjne działają, gwarancja katalogu nie |
| **O-MAC-8** | brzmienie doprecyzowania obietnicy: ruch OS do Apple przy ocenie aplikacji nie jest ruchem aplikacji; stapling gwarantuje pierwszy start offline (§9.3) | przyjąć tekst do dokumentacji użytkownika | nadmierna obietnica („nic na tej maszynie nie łączy się z niczym") – dokładnie klasa błędu, którą S-MCP-1 kazał tępić |
| **O-MAC-9** | grunt pod most: AF_UNIX z uprawnieniami POSIX + HMAC; dwie ścieżki §10.3 (b1/b2), zakaz entitlements sieciowych w każdym wariancie; C-NET-6b-mac | przyjąć kierunek; decyzja b1/b2 po pomiarze MM2, w fazie 3 | przedwczesne przesądzenie = albo złamana obietnica B, albo niepotrzebna utrata sandboxa |
| **O-MAC-10** | polityka trwałości macOS: ReportCrash jako R3-mac (organizacyjne), savedState do pomiaru z mitygacją wracającą do bramki (§8.2/§8.3) | przyjąć | migawka okna z legendą na dysku = artefakt A1 poza kodem – najpoważniejszy potencjalny odkrycie pomiarów |
| **O-MAC-11** | łańcuch dostaw buildu macOS: podpis lokalnie na maszynie Alana (rekomendacja); wariant CI z kluczami w sekretach wymaga osobnej zgody i pozycji w checkliście (§2.2) | przyjąć rekomendację | klucz Developer ID w CI = rozszerzenie S9 na infrastrukturę zewnętrzną |

Założenia przyjęte bez osobnej weryfikacji: Z1–Z4 bez zmian; Z5-mac
(FileVault), Z7-mac (użytkownik-administrator), Z8-mac (próg wersji) – §9.1.

---

## §15. Decyzje produktowe do potwierdzenia przez Alana (P-MAC)

Do dopisania w `PRODUCT-DECISIONS.md` po rozstrzygnięciu – ten dokument
podaje rekomendacje, tamten plik będzie źródłem prawdy.

| ID | Decyzja | Rekomendacja projektu |
|---|---|---|
| **P-MAC-1** | Apple Developer Program: rejestracja jako osoba fizyczna („Alan Kolkowski") czy organizacja („Kancelaria Radcy Prawnego K-Law Alan Kolkowski", wymaga D-U-N-S, trwa dłużej); koszt 99 USD/rok | organizacja (spójność nazwy wydawcy z certyfikatem Windows i papierem firmowym); individual tylko, jeśli D-U-N-S nadmiernie opóźnia |
| **P-MAC-2** | dmg czy pkg | dmg w v1 (§7.1); pkg dopiero, gdyby O-MAC-7 wymusił twardą gwarancję katalogu |
| **P-MAC-3** | architektura: arm64-only czy universal (arm64+x64) | arm64-only: rynek docelowy 2026 to Apple Silicon; universal podnosi rozmiar i podwaja matrycę pomiarów bez realnego odbiorcy |
| **P-MAC-4** | minimalna wersja macOS | 13 (Ventura) ze względu na TCC App Management; rozważyć 14, jeśli statystyki docelowych klientów pozwolą |
| **P-MAC-5** | maszyna do buildu i pomiarów: własny Mac / CI / chmura (§2.1) | własny Mac (mini wystarcza); CI najwyżej później i tylko po O-MAC-11 |
| **P-MAC-6** | moment startu w mapie faz | po fazie 0, równolegle z fazą 1 (tor niezależny); przed fazą 3 na tyle, żeby pomiar §10.3 był gotowy, zanim most wejdzie na macOS |

---

## §16. Zebrane założenia i lista „do zmierzenia na sprzęcie macOS"

Poza rejestrem §14 (decyzje Opusa) – twarde tezy empiryczne, żadna nie może
przejść do PASS bez uruchomienia:

1. Cała matryca zgodności App Sandbox (§5.4, 15 pozycji) – w tym krytyczne:
   modele z `Contents/Resources`, wielowątkowy WASM (SAB), OCR, drag&drop,
   eksport przez panel, **single-instance / AF_UNIX pod sandboxem** (poz. 10,
   zasila §10.3).
2. `ElectronAsarIntegrity` w `Info.plist` + odmowa startu po podmianie bajtu
   w asarze (C-MAC-13; domyka też windowsowe `?` przy C-INT-3 metodologicznie).
3. B1 na spakowanej aplikacji: podmiana bajtu modelu → dialog + exit
   (C-MAC-14).
4. Zero gniazd (`lsof`) i zero mDNS/DIAL (tcpdump po `ip.src`) przez pełny
   przebieg (C-MAC-15/16).
5. Kształt błędu kanarka `net.fetch` pod App Sandbox (§4.4) – asercja smoke
   per platforma.
6. Crashpad pusty bez `crashReporter.start()` na macOS (C-MAC-17).
7. Saved Application State: czy zawiera migawkę okna (C-MAC-18) – przy wyniku
   pozytywnym mitygacja wraca do bramki (O-MAC-10).
8. Pierwszy start offline świeżo pobranego, stapled dmg (C-MAC-19).
9. Pełny przebieg z translokacji (C-MAC-20).
10. Próba zapisu w pakiecie `/Applications` przez proces bez App Management →
    odmowa TCC (C-MAC-1; kalibruje O-MAC-4).
11. `DYLD_INSERT_LIBRARIES` ignorowane na spakowanej aplikacji (C-MAC-3).
12. Zachowanie monitu schowka na macOS 15+ przy „Kopiuj/Wklej" (§5.4 poz. 9,
    UX).
13. Minimalna wersja macOS wspierana przez Electron 43 (dokumentacja) –
    warunek brzegowy dla P-MAC-4.

---

*Koniec projektu. Następne kroki: (1) decyzje Alana P-MAC-1…6, w tym decyzja
sprzętowa §2 jako warunek wejścia; (2) bramka Opusa nad O-MAC-1…11;
(3) implementacja wg §13 (MM0…MM5), moduł po module, z raportem matrycy MM2
wracającym do bramki przed zamrożeniem entitlements.*
