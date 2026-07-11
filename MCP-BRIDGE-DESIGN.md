# MCP-BRIDGE-DESIGN.md — projekt bezpiecznego lokalnego mostu MCP (wariant B)

**Wersja:** 1.0 (projekt do akceptacji)
**Data:** 2026-07-10
**Autor:** Fable (architekt aplikacji desktopowej)
**Status:** PROJEKT. Zero kodu implementacji. Dokument czeka na bramkę Opusa,
implementacja (Sonnet) nie startuje przed akceptacją.
**Odbiorca:** Opus jako bramka bezpieczeństwa; wtórnie Alan (decyzje produktowe,
§14) i Sonnet (plan implementacji, §12).

**Relacja do istniejących dokumentów:** `SECURITY.md` opisuje, co zbudowano
w wariancie A; `THREAT-MODEL.md` — przed czym to broni; ten dokument projektuje
**nowy komponent** (most MCP) dla **nowego wariantu B** i jego wpływ na tamte
dokumenty. Rozstrzyga TODO(mcp-transport) z `SECURITY.md` §10 oraz realizuje
decyzję D1(b) i poprawkę S-MCP-1 z `THREAT-MODEL.md` / `SECURITY-FIXES.md`.

**Konwencja oznaczeń:** fragmenty JSON w tym dokumencie to schematy komunikatów
i przykłady konfiguracji użytkownika, nie kod implementacji. Każde miejsce
dotykające sieci, IPC albo legendy jest oznaczone **[DO WERYFIKACJI PRZEZ
OPUSA: O-n]** i zebrane w rejestrze §13. Decyzje produktowe dla Alana: §14.

---

## §1. Cel, zakres, wymagania nienegocjowalne

### 1.1 Dwa warianty z jednego kodu

| | Wariant A „air-gap" | Wariant B „z mostem" |
|---|---|---|
| Obietnica | aplikacja fizycznie nie łączy się z niczym | brak kanału do internetu; jeden kanał lokalny, wyłącznie tokeny, wyłącznie po zatwierdzeniu człowieka (§2) |
| Kod mostu | **fizycznie nieobecny** w artefakcie (jak strip WebMCP w B2) | obecny |
| Odbiorca | kancelarie-puryści, biegli, podmioty pod szczególnym reżimem | prawnik pracujący z klientem AI (Cowork / Claude Desktop / Codex) |
| Status | istnieje, zachowany dokładnie jak dziś | projektowany tym dokumentem |

Wariant A pozostaje osobnym produktem. Jedyne dopuszczalne zmiany w jego
łańcuchu budowania to wykluczenia gwarantujące fizyczną nieobecność mostu
(§8.4) — zachowanie artefaktu A ma być nieodróżnialne od dzisiejszego,
co potwierdzają istniejące testy dymne plus nowe asercje artefaktów (§8.3).

### 1.2 Wymagania nienegocjowalne (W1–W5)

- **W1 — tylko tokeny przez granicę.** Reużycie `src/mcp/listings.js`
  (`applyTokens`, syntetyczne `mcpLabel`). Nigdy legenda, nigdy oryginał,
  nigdy prawdziwa nazwa pliku.
- **W2 — human-in-the-loop.** Żadne narzędzie nie zwraca danych automatycznie.
  Proces główny pokazuje okno z **dokładnym** tokenizowanym payloadem i
  ostrzeżeniem; payload wychodzi dopiero po kliknięciu „Wyślij".
- **W3 — kanał lokalny, nie internetowy.** Aplikacja nadal nie ma stosu
  sieciowego do internetu; wysyłkę do chmury wykonuje klient MCP (osobny
  proces, poza granicą odpowiedzialności).
- **W4 — most tylko w wariancie B**, wykluczony w czasie budowania z wariantu A
  (wzorzec B2), nie tylko wyłączony w runtime.
- **W5 — pełna bramka Opusa** dla każdego modułu mostu (kod dotyka
  sieci/IPC/legendy).

### 1.3 Poza zakresem tego projektu

- Co klient AI robi z tokenizowanym tekstem w chmurze (retencja, trening,
  logi dostawcy) — poza kontrolą i odpowiedzialnością aplikacji; §9.4 RB-5.
- Jakość detekcji NER (ryzyko R1 z `THREAT-MODEL.md` §5) — nieusuwalna
  właściwość anonimizatora opartego na modelu; most ją **zarządza** bramką
  z podglądem (S-MCP-1), nie usuwa.
- Trwałość legendy (decyzja D2: pamięć ulotna) — most niczego tu nie zmienia.
- Build macOS, aktualizacje, telemetria — bez zmian (brak).

---

## §2. Obietnica bezpieczeństwa wariantu B (przeformułowanie air-gap)

Wariant B **nie jest air-gapem** i nigdy nie może być tak nazywany w
dokumentacji ani marketingu. Obietnica wariantu B, sformułowana jawnie:

> **Aplikacja nie ma żadnego kanału do internetu:** nie zawiera klienta HTTP,
> WebSocketu ani żadnego kodu łączącego się z siecią; wszystkie warstwy blokady
> egress wariantu A (strażnik `webRequest`, CSP bez źródeł zdalnych, polityka
> WebRTC, fuses, brak importów modułów sieciowych poza §4.6) pozostają aktywne.
> **Jedyny kanał komunikacji ze światem** to lokalny nazwany potok Windows do
> adaptera MCP na tym samym komputerze. Tym kanałem przechodzą **wyłącznie
> stokenizowane payloady**, każdy **po jawnym zatwierdzeniu przez człowieka**
> w oknie podglądu pokazującym dokładnie te dane, które wyjdą. Wysyłkę do
> chmury wykonuje klient AI — osobny program, skonfigurowany przez użytkownika,
> poza granicą odpowiedzialności aplikacji. Aplikacja niczego nie wysyła
> z automatu i niczego nie blokuje po stronie klienta.

Doprecyzowania wymagane przez S-MCP-1 (korekta nadmiernej obietnicy wobec
radcy związanego tajemnicą zawodową):

1. „Tylko tokeny" oznacza: **tekst po tokenizacji wykrytych encji**.
   Kompletność detekcji jest właściwością modelu NER (ryzyko R1), nie
   gwarancją kodu. Dlatego bramka z podgladem jest **kontrolą**, nie ozdobą:
   człowiek zatwierdza dokładnie ten tekst, który wyjdzie, i ponosi za to
   świadomą odpowiedzialność. Empiria produktowa (Alan, 2026-07-10):
   skuteczność dla danych kluczowych (PESEL, nazwiska, NIP) w praktyce pełna;
   bramka służy świadomej decyzji, nie łapaniu każdego znaku.
2. Kluczowa obserwacja uzasadniająca most: przepływ „kopiuj tokenizowane →
   wklej do chmury" **już istnieje** w obu wariantach (schowek to zamierzony
   interfejs, C-PERS-9/C-PERS-10). Most z wymuszonym podglądem jest od niego
   **nie gorszy, a bezpieczniejszy**: wymusza obejrzenie payloadu przed każdą
   wysyłką, czego schowek nie robi.
3. Nazewnictwo produktowe: wariant A — „air-gap", wariant B — „kontrolowany
   most lokalny" (finalne nazwy handlowe: §14 P-1).

---

## §3. Architektura

### 3.1 Komponenty i przepływ

```
 [ Chmura AI (Anthropic / OpenAI / …) ]
      ▲
      │  HTTPS — wykonuje KLIENT, poza aplikacją i poza jej odpowiedzialnością
      │
 ┌────┴─────────────────────────────┐
 │ KLIENT MCP                       │  Cowork / Claude Desktop / Codex
 │ (osobny proces, własne GUI)      │  konfiguracja: §7.4
 └────┬─────────────────────────────┘
      │  stdio (JSON-RPC / MCP), klient uruchamia i zarządza cyklem życia
      ▼
 ┌──────────────────────────────────┐
 │ ADAPTER pii-tools-bridge         │  ta sama podpisana binarka wariantu B,
 │ (tryb --bridge-adapter,          │  tryb bez okien; minimalny serwer MCP;
 │  bez okien, bez renderera)       │  §7
 └────┬─────────────────────────────┘
      │  nazwany potok Windows \\.\pipe\pii-tools-bridge-v1-<losowe128b>
      │  wzajemne uwierzytelnienie HMAC (sekret z pliku sesyjnego, §4.3)
 ═════╪══════════════════════════════ G5: NOWA granica zaufania (potok)
      ▼
 ┌──────────────────────────────────┐
 │ ELECTRON — PROCES GŁÓWNY (B)     │  serwer potoku (§4.6), walidacja schematu
 │  kolejka bramek + OKNO BRAMKI ───┼──► CZŁOWIEK: podgląd payloadu,
 │  skan kontrolny wyjścia (§6.3)   │    „Wyślij" / „Odrzuć" (§6)
 └────┬─────────────────────────────┘
      │  IPC (nowe, wąskie kanały pii:bridge:*, §3.4) — nigdy legenda
 ═════╪══════════════════════════════ G2: istniejąca granica IPC (poszerzona)
      ▼
 ┌──────────────────────────────────┐
 │ RENDERER (sandbox, bez Node)     │  stan dokumentów, legenda (A1),
 │  src/mcp/listings.js             │  budowa payloadów WYŁĄCZNIE przez
 │  (applyTokens, mcpLabel)         │  buildery listings.js (W1)
 └──────────────────────────────────┘
```

Zasada podziału ról:

- **Renderer** — jedyne miejsce, gdzie żyją dokumenty i legenda; buduje
  payloady istniejącymi builderami `listings.js`. Nie widzi potoku.
- **Proces główny** — transport (potok), walidacja, kolejka bramek, okno
  bramki, skan kontrolny. Nie widzi legendy; widzi wyłącznie gotowe,
  stokenizowane payloady.
- **Adapter** — głupi tłumacz protokołu: stdio (MCP) ↔ potok. Zero logiki
  domenowej, zero stanu dokumentów, zero decyzji.
- **Klient MCP** — poza granicą. Jedyny proces dotykający internetu.

### 3.2 Przepływ `read_source` krok po kroku

1. LLM w kliencie woła `tools/call read_source {id}`.
2. Klient przekazuje żądanie adapterowi po stdio.
3. Adapter (po uwierzytelnieniu z §4.3) wysyła potokiem ramkę
   `{t:"tool", reqId, name:"read_source", args:{id}, client:"<self-declared>"}`.
4. Proces główny waliduje: nazwa z zamkniętej listy 5 narzędzi, argumenty
   zgodne ze schematem (§9 E-B1), most włączony, kolejka niepełna.
5. Proces główny prosi renderer (IPC `pii:bridge:exec`) o wykonanie narzędzia.
   Renderer woła `buildReadSourceContent(sources, seen, id)` — dokładnie ten
   sam builder, który obsługiwał WebMCP — i odsyła wynik (IPC
   `pii:bridge:result`). Błędy domenowe („brak encji", „dokument niegotowy")
   wracają jako wynik z `isError` bez otwierania bramki (nie niosą treści).
6. Proces główny wykonuje **skan kontrolny wyjścia** (§6.3): obecność tokenów,
   regexy PII, limit rozmiaru.
7. Proces główny otwiera **okno bramki** (§6.2) z dokładnym payloadem.
8. Człowiek klika „Wyślij" → proces główny wypisuje na potok ramkę odpowiedzi
   z **tym samym buforem tekstu**, który był pokazany (§6.8). „Odrzuć",
   timeout albo zamknięcie okna → odpowiedź `isError` bez treści (§6.4).
9. Adapter tłumaczy ramkę na odpowiedź MCP; klient wysyła ją do chmury —
   to jest moment przekroczenia granicy internetu, **poza aplikacją**.

### 3.3 Przepływ `write_outcome` (kierunek „do środka")

Analogiczny, z odwróconym kierunkiem danych: payload (tokenizowany tekst od
LLM-a) przychodzi potokiem, proces główny pokazuje bramkę w wariancie „Zapisz"
(§6.6), po zatwierdzeniu renderer tworzy/aktualizuje dokument wynikowy
(istniejące `createOutcome` / `updateOutcomeFields`), a przez potok wraca
wyłącznie `{id, success:true}`. Deanonimizacja pozostaje wyłącznie w UI
(bez zmian względem dziś).

### 3.4 Nowa powierzchnia IPC (poszerzenie G2)

Dziś: jeden kanał `pii:desktop-info` (tylko odczyt). Wariant B dodaje **trzy**
kanały, wszystkie z walidacją nadawcy wg wzorca S-IPC-1
(`senderFrame.url` musi zaczynać się od `APP_ORIGIN`):

| Kanał | Kierunek | Niesie | Nigdy nie niesie |
|---|---|---|---|
| `pii:bridge:exec` | main → renderer | `{reqId, name, args}` po walidacji schematu | — |
| `pii:bridge:result` | renderer → main | `{reqId, result}` gdzie `result` to wynik buildera `listings.js` | legendy, oryginałów, `label` (prywatnej nazwy pliku) |
| `pii:bridge:status` | main → renderer | stan mostu do wskaźnika UI: `{active, connections, approved, rejected}` | treści payloadów |

Okno bramki ma własny, czwarty kanał `pii:bridge:decision` (§6.2), przyjmowany
wyłącznie od `webContents` okna bramki i wyłącznie dla oczekującego `reqId`.

Kontrakt **I-B1** (§9): legenda nie ma żadnej ścieżki serializacji przez IPC —
jedyny producent payloadów to buildery `listings.js`, a proces główny dodatkowo
waliduje kształt wyniku (`{content:[{type:"text",text}], isError?}`) i skanuje
tekst (§6.3). Preload wariantu B eksponuje wąskie, zamrożone API
(`window.desktopApp.bridge = { onToolRequest, submitToolResult, onStatus }`),
bez surowego `ipcRenderer` — spójnie z `electron/preload.cjs` dziś.
**[DO WERYFIKACJI PRZEZ OPUSA: O-6]**

Legenda (A1) pozostaje dokładnie tam, gdzie jest dziś: RAM renderera, zero
trwałości, zero kopii w procesie głównym.

---

## §4. Transport

### 4.1 Decyzja

**Potwierdzam rekomendację Opusa** (stdio do klienta + nazwany potok Windows
do działającej aplikacji), z dwiema korektami technicznymi opisanymi w §4.4
i §4.5. Wybór jest też spójny z wcześniejszą decyzją D1(b) w
`THREAT-MODEL.md` §6 („nazwany potok albo stdio, nigdy WebSocket, nigdy TCP,
nigdy wyjątek w CSP") oraz z listą „Czego NIE robić" w `SECURITY-FIXES.md`.

Właściwości, które przesądzają:

1. **Zero nasłuchujących gniazd sieciowych.** Nazwany potok nie jest gniazdem
   IP: nie ma portu, nie dotyka stosu TCP/UDP, nie wywołuje zapory, nie da się
   go otworzyć z przeglądarki (`fetch`/WebSocket nie mówią po `\\.\pipe\`),
   nie podlega DNS rebinding ani CSRF na loopback.
2. **Cykl życia po stronie klienta.** Standardowy transport stdio MCP: klient
   uruchamia adapter jako subproces i sprząta po nim. Aplikacja nie zarządza
   cudzym procesem, adapter nie zarządza aplikacją.
3. **Bramka człowieka wymaga otwartego GUI** — model „adapter łączy się z
   działającą aplikacją" jest jedynym, który to naturalnie wyraża: bez
   uruchomionej aplikacji nie ma komu pokazać okna, więc nie ma czego wysłać.
4. **Renderer nie zyskuje żadnej nowej zdolności.** CSP i strażnik §3 bez
   zmian; potok żyje wyłącznie w procesie głównym; `webRequest` go nie widzi
   i **nie musi** — to nie jest ruch URL-loadera, a jego jedynym ujściem jest
   proces lokalny, nie sieć.

### 4.2 Alternatywy odrzucone

| Alternatywa | Dlaczego odrzucona |
|---|---|
| WebSocket / wyjątek `ws://127.0.0.1` w CSP i strażniku | Zakazana wprost przez D1(a): trwała, nieodwracalna dziura w CSP; renderer odzyskuje stos sieciowy; adres celu pochodziłby z danych, nie z kodu. Nie wraca w żadnej formie. |
| HTTP/SSE na loopbacku (127.0.0.1:port) | Nasłuchujące gniazdo TCP dostępne dla **każdego** lokalnego procesu i dla przeglądarek (CSRF na loopback, DNS rebinding — wymagałby walidacji Origin, czyli obrony przed problemem, którego potok w ogóle nie ma); wymusza `node:http` w procesie głównym (złamanie C-NET-6 w duchu i literze); kolizje portów; monity zapory. Zakazany w „Czego NIE robić". |
| Klient MCP uruchamia **samą aplikację** z flagą stdio (bez adaptera) | Klient stawałby się właścicielem cyklu życia GUI (aplikacja znika z klientem, startuje bez intencji użytkownika); stdout procesu Electrona jest zanieczyszczany przez Chromium (psuje framing JSON-RPC); konflikt z single-instance lock; bramka wymaga GUI otwartego przez człowieka, nie przez klienta. |
| Odwrócenie ról: adapter serwerem potoku, aplikacja klientem | Cykl życia do góry nogami: adapterów może być wiele (Cowork + Claude Desktop równolegle), aplikacja jest jedna (single-instance) — naturalne jest jedno gniazdo serwerowe po stronie jedynej instancji i wiele połączeń klienckich. Odwrócenie zmusza aplikację do odpytywania nieznanej liczby potoków o nieznanych nazwach. Bez zysku bezpieczeństwa. |
| Skrzynka plikowa (katalog obserwowany, pliki żądań/odpowiedzi) | Payloady lądują na dysku (sprzeczne z filozofią zero artefaktów, §9 D2/D3), wyścigi przy sprzątaniu, polling, antywirus skanuje i potencjalnie retencjonuje treść. Gorsza od potoku na każdej osi poza importem `node:net`. |
| Gniazdo `AF_UNIX` | Na Windows wsparcie Node dla ścieżkowych gniazd i tak realizuje się przez nazwane potoki; osobny byt nie istnieje w praktyce. Bez różnicy. |

### 4.3 Szczegóły potoku

**Nazwa potoku:** `\\.\pipe\pii-tools-bridge-v1-<32 znaki hex>` — 128 bitów
losowości z CSPRNG (`node:crypto`), generowane **na każdą sesję aplikacji**.
Nazwa nie jest zgadywalna, więc podszycie się pod serwer przez wcześniejsze
zajęcie nazwy (pipe squatting) wymaga jej poznania, a jedyne miejsce publikacji
jest chronione ACL-ką (plik sesyjny niżej). Dodatkowo bind na zajętą nazwę
kończy się błędem (libuv używa `FILE_FLAG_FIRST_PIPE_INSTANCE`) — aplikacja
reaguje **fail-closed**: most nie startuje, UI pokazuje błąd, reszta aplikacji
działa. **[DO WERYFIKACJI PRZEZ OPUSA: O-2 — zachowanie libuv potwierdzić
empirycznie na Electronie 43]**

**Plik sesyjny (discovery):**
`%LOCALAPPDATA%\<produkt B>\bridge-session.json`, zapis atomowy
(tmp + rename), treść:

```json
{ "v": 1, "pipe": "\\\\.\\pipe\\pii-tools-bridge-v1-…", "secret": "<64 hex>",
  "appPid": 12345, "appVersion": "0.2.0", "createdAt": "<ISO>" }
```

- **Celowo `%LOCALAPPDATA%`, nie `%APPDATA%`:** profil mobilny (roaming)
  synchronizowałby sekret na serwer domeny. Uwaga dla implementacji: w
  Electronie `app.getPath('userData')` wskazuje na profil **roamingowy** —
  ścieżkę lokalną trzeba wyprowadzić jawnie; brak `%LOCALAPPDATA%` w
  środowisku = most nie startuje (fail-closed).
- ACL katalogu dziedziczona z profilu użytkownika (SYSTEM, Administratorzy,
  bieżący użytkownik) — **inny nieuprzywilejowany użytkownik maszyny nie
  odczyta** ani nazwy potoku, ani sekretu. Żadnych własnych wpisów ACL
  (mniej kodu, mniej błędów).
- Plik **nigdy nie zawiera PII**; jest usuwany przy czystym zamknięciu
  aplikacji i przy wyłączeniu mostu przełącznikiem (§5.5); po awarii zostaje
  osierocony — adapter wykrywa to próbą połączenia (ENOENT/odmowa) i zwraca
  klientowi czysty błąd „uruchom aplikację".

**Wzajemne uwierzytelnienie (na każde połączenie, zanim popłynie cokolwiek
innego):** challenge-response na HMAC-SHA-256 z sekretem z pliku sesyjnego,
z rozdzielonymi kontekstami dla obu kierunków i świeżymi nonce'ami po obu
stronach; porównania stałoczasowe; limit 5 s na dokończenie uwierzytelnienia,
potem rozłączenie; sekret **nigdy nie przechodzi przez potok**. Serwer po
nieudanym uwierzytelnieniu odczekuje przed przyjęciem kolejnego połączenia
(tłumienie prób siłowych, choć przy 256-bitowym sekrecie to formalność).
Schemat ramek (poglądowy):

```json
S→C: { "t": "hello",   "nonceS": "<32B hex>", "proto": 1 }
C→S: { "t": "auth",    "nonceC": "<32B hex>", "mac": "HMAC(secret, 'pii-b1-c2s'‖nonceS‖nonceC)" }
S→C: { "t": "auth-ok", "mac": "HMAC(secret, 'pii-b1-s2c'‖nonceC‖nonceS)" }
```

Adapter weryfikuje `auth-ok` — dzięki temu nawet gdyby ktoś zdołał podstawić
fałszywy serwer, adapter rozłączy się przed wysłaniem pierwszej ramki
narzędziowej, a podsłuchujący nie pozna sekretu (przechwycone nonce i HMAC-i
są bezwartościowe poza tym jednym połączeniem). **[DO WERYFIKACJI PRZEZ
OPUSA: O-3 — cały protokół uwierzytelnienia]**

**Framing i limity:** NDJSON (JSON-RPC-podobne ramki rozdzielane `\n`,
bez znaków nowej linii wewnątrz ramki — spójnie z framingiem stdio MCP);
limit ramki 4 MiB (fail z czytelnym błędem, bez bramki); limit `text`
w `write_outcome` 2 MiB; `id` ≤ 128 znaków; `label` ≤ 200 znaków;
maks. 4 równoległe uwierzytelnione połączenia (Cowork + Claude Desktop +
Codex + zapas), nadmiarowe odrzucane grzecznie; brak jakiegokolwiek bufora
żądań w adapterze (żądanie przy zerwanym potoku = natychmiastowy błąd,
nigdy kolejka do wysłania później).

### 4.4 Korekta względem szkicu Opusa: DACL potoku

Szkic zakładał „DACL = bieżący użytkownik". Rzeczywistość Node/libuv:
`net.Server.listen(<ścieżka potoku>)` **nie wystawia** możliwości podania
własnego deskryptora zabezpieczeń — potok powstaje z domyślnym DACL procesu
(pełna kontrola: twórca, SYSTEM, Administratorzy; wg dokumentacji Microsoftu
domyślny deskryptor potoku daje ponadto odczyt grupie Everyone). Opcje:

- **(wybrana)** kompensacja na poziomie protokołu: nieodgadywalna nazwa +
  sekret w pliku chronionym ACL profilu + wzajemny HMAC z §4.3. Skutek
  praktyczny jest ten sam, co przy DACL: proces innego użytkownika bez
  dostępu do pliku sesyjnego nie zestawi użytecznego połączenia (co najwyżej
  otworzy uchwyt i zobaczy `hello` z jednorazowym nonce'em, po czym zostanie
  rozłączony). Zaleta: zero kodu natywnego, zero nowych zależności.
- (odrzucona) natywny dodatek / P/Invoke ustawiający DACL wprost: dokłada
  toolchain natywny i nowy artefakt do audytu łańcucha dostaw dla własności,
  którą §4.3 już daje. Do rozważenia w przyszłości wyłącznie jako głębia
  obrony, jeśli Opus uzna protokół za niewystarczający.

**[DO WERYFIKACJI PRZEZ OPUSA: O-1 — akceptacja tej korekty; to jest jedyne
odstępstwo od litery rekomendacji transportowej]**

### 4.5 Uczciwa uwaga: nazwane potoki a dostęp zdalny (SMB)

Zdanie „nazwany potok nigdy nie dotyka sieci" jest **w ogólności fałszywe**:
Windows potrafi udostępniać potoki zdalnie przez SMB (`\\host\pipe\nazwa`).
Precyzyjna wersja obietnicy: **serwer potoku sam nie otwiera żadnego gniazda
sieciowego**, a zdalny dostęp do potoku (o ile usługi SMB/Server w ogóle
działają i port 445 jest osiągalny) wymaga uwierzytelnienia się w systemie
jako użytkownik tej maszyny — czyli atakujący musiałby już mieć konto/hasło,
a i wtedy zatrzymują go: nieodgadywalna nazwa (publikowana tylko w pliku
niedostępnym zdalnie bez tych samych poświadczeń), HMAC z §4.3 i bramka
człowieka. Anonimowy zdalny dostęp do potoków jest w Windows domyślnie
wyłączony (pusta lista `NullSessionPipes`). Wniosek: ryzyko pomijalne, ale
dokumentujemy je jawnie zamiast powtarzać nieścisły slogan.
**[DO WERYFIKACJI PRZEZ OPUSA: O-4 — akceptacja opisu; opcjonalny test
empiryczny próby zdalnego otwarcia potoku]**

### 4.6 Rozstrzygnięcie kwestii (a): kolizja z niezmiennikiem C-NET-6

**Decyzja: wąskie, jawne, egzekwowane testami odstępstwo w wariancie B;
niezmiennik wariantu A bez zmian.**

Uzasadnienie od celu, nie od litery: C-NET-6 („`electron/` nie importuje
`node:net|http|https|dns|tls|dgram|child_process`") jest **proxy** dla
własności „proces główny nie ma zdolności egress". Niebezpieczną zdolnością
`node:net` jest `connect(host, port)` / `Socket` — wychodzące połączenie TCP.
**Nasłuch na ścieżce `\\.\pipe\` nie ma żadnej zdolności egress**: przyjmuje
lokalne połączenia, niczego nie inicjuje, nie dotyka stosu IP. Dzisiejszy
C-NET-6 jest zresztą oznaczony „PASS (bez egzekucji)" — dyscyplina, nie
mechanizm. Reformulacja zamienia proxy na własność rzeczywistą **i dokłada
egzekucję**, której dziś brak (S-NET-4):

- **Wariant A:** C-NET-6 bez zmian, litera i duch: zero importów modułów
  sieciowych w całym spakowanym `electron/`. Pliki mostu są fizycznie
  nieobecne w artefakcie (§8), a test artefaktu to potwierdza.
- **Wariant B:** nowy niezmiennik **C-NET-6b**: `node:net` wolno importować
  **wyłącznie dwóm** plikom — `electron/bridge/pipe-server.mjs` (serwer,
  tryb GUI) i `electron/bridge/pipe-client.mjs` (klient, tryb adaptera) —
  i wyłącznie do ścieżek zaczynających się literalnie od `\\.\pipe\`
  (twarda asercja w runtime: inna ścieżka = wyjątek). `node:http`, `https`,
  `dns`, `tls`, `dgram`, `child_process` pozostają zakazane wszędzie,
  w obu wariantach.
- **Egzekwowanie (trzy warstwy, wszystkie automatyczne):**
  1. test statyczny: grep po `electron/**` — importy `node:net` dozwolone
     tylko w dwóch wymienionych plikach; importy pozostałych modułów
     sieciowych: zero trafień;
  2. test statyczny: te dwa pliki nie zawierają wywołań `connect(` z
     argumentem host/port ani `new Socket` poza ścieżką potoku; test
     jednostkowy: moduł odrzuca ścieżki niebędące `\\.\pipe\…`;
  3. test artefaktów (§8.3): asar wariantu A nie zawiera `bridge/`
     ani stringa `\\.\pipe\`, asar wariantu B zawiera dokładnie
     oczekiwane pliki mostu.

**Architektura alternatywna (odrzucona): potok trzyma wyłącznie proces
pomocniczy.** Electron ma własne API `utilityProcess` (import z modułu
`electron`, nie `node:child_process`), więc dałoby się wypchnąć `node:net`
do skryptu procesu pomocniczego i zachować literę „główny nie importuje".
Odrzucam, bo: (1) skrypt pomocniczy i tak leży w `electron/` wewnątrz tego
samego asara — grep-niezmiennik trzeba by obwarować identycznym wyjątkiem,
więc litera nie zyskuje nic; (2) granica procesowa nie dodaje bezpieczeństwa:
proces pomocniczy startuje z woli procesu głównego, mówi tylko do niego
i działa na tym samym koncie; (3) koszt realny: dodatkowy proces, plumbing
MessagePort, osobna obsługa awarii i cyklu życia — wszystko w kodzie, który
ma być maksymalnie audytowalny. Wąskie odstępstwo z egzekucją testową jest
uczciwsze i prostsze. **[DO WERYFIKACJI PRZEZ OPUSA: O-5 — reformulacja
C-NET-6/C-NET-6b; to jest kluczowa decyzja niezmiennikowa projektu]**

---

## §5. Cykl życia (kwestia b)

### 5.1 Kto uruchamia co

| Zdarzenie | Działanie |
|---|---|
| Użytkownik uruchamia wariant B (skrót/menu Start) | GUI startuje jak dziś (bramki integralności modeli itd.); po `whenReady` bootstrap mostu: losowa nazwa potoku, bind, zapis pliku sesyjnego, wskaźnik „Most AI: aktywny" w UI |
| Klient MCP startuje (np. Claude Desktop) | klient spawnuje adapter (`<exe wariantu B> --bridge-adapter`) jako subproces stdio i trzyma go przez czas swojego życia |
| LLM woła narzędzie | adapter łączy się z potokiem **per żądanie albo trzyma jedno połączenie** (decyzja implementacyjna; projekt zakłada jedno trwałe połączenie z reconnectem przy zerwaniu, bez kolejkowania żądań w adapterze) |
| Użytkownik zamyka aplikację | serwer potoku zamykany, plik sesyjny usuwany, wiszące bramki = automatyczne „Odrzuć", adapter przy następnym żądaniu zwraca błąd „uruchom aplikację" |
| Klient MCP kończy pracę | zabija adapter (standard stdio MCP); aplikacja nic nie zauważa poza spadkiem licznika połączeń |

### 5.2 Odnajdywanie działającej instancji

Adapter czyta plik sesyjny (§4.3) przy **każdej** próbie połączenia — nie
cache'uje nazwy potoku (aplikacja mogła zostać zrestartowana z nową nazwą
i sekretem). Kolejność: brak pliku → „aplikacja nieuruchomiona"; plik jest,
połączenie odrzucone/ENOENT → „aplikacja nieuruchomiona (pozostałość po
poprzedniej sesji)"; połączenie jest, HMAC się nie zgadza → twardy błąd
bezpieczeństwa (nie retry): „niezgodność uwierzytelnienia, zrestartuj
aplikację i klienta".

### 5.3 Brak instancji: zachowanie adaptera

Adapter jest **poprawnym serwerem MCP także bez aplikacji** — to konieczne,
bo klienci spawnują serwery przy własnym starcie, zwykle zanim użytkownik
uruchomi aplikację:

- `initialize`, `ping`, `tools/list` — obsługiwane lokalnie, zawsze.
  Lista 5 narzędzi jest statyczna (opisy zawierają dopisek „odpowiedź wymaga
  zatwierdzenia przez użytkownika w oknie pii.tools — może chwilę potrwać",
  żeby LLM rozumiał opóźnienia bramki).
- `tools/call` bez działającej aplikacji → wynik `isError` z tekstem:
  „Aplikacja pii.tools (wariant z mostem) nie jest uruchomiona. Poproś
  użytkownika o jej uruchomienie i ponów wywołanie." Fail-fast, zero
  kolejkowania.
- **Adapter nigdy nie uruchamia GUI sam.** Odrzucona wygoda (auto-start
  aplikacji przy pierwszym wywołaniu): okno wyskakujące bez intencji
  człowieka przeczy filozofii bramki (człowiek ma być obecny i świadomy,
  zanim cokolwiek się zadzieje), a proces spawnowany przez klienta w tle
  nie powinien materializować GUI. To także eliminuje całą klasę pytań
  o argumenty/ścieżki startowe.

### 5.4 Wiele klientów, pojedyncza instancja aplikacji

- Aplikacja: jedna instancja (istniejący `requestSingleInstanceLock`).
  **Tryb adaptera nie dotyka mechanizmu single-instance** — sprawdzenie
  `--bridge-adapter` następuje przed nim (§7.1); w przeciwnym razie adapter
  spawnowany przez klienta wypychałby GUI (drugi proces zwalnia lock i kończy
  się) albo podbijał cudze okno. To pułapka implementacyjna opisana wprost
  dla Sonneta.
- Adapterów może działać kilka równolegle (różni klienci); każde połączenie
  uwierzytelnia się osobno; bramki ze wszystkich połączeń trafiają do jednej
  globalnej kolejki FIFO (§6.5). Okno bramki zawsze pokazuje, od którego
  połączenia (i deklarowanego klienta) pochodzi żądanie.

### 5.5 Wyłącznik i wskaźnik

Stały element UI wariantu B (pasek stanu): „Most AI: **aktywny** · połączenia:
N · zatwierdzone: X · odrzucone: Y" + przełącznik „Wstrzymaj most". Wstrzymanie:
zamyka połączenia, zamyka serwer potoku, usuwa plik sesyjny; wywołania od
klientów dostają błąd „most wstrzymany przez użytkownika". Stan startowy mostu:
aktywny (uzasadnienie: użytkownik wybrał wariant B świadomie, a kontrolą jest
bramka per-payload, nie sam nasłuch; nasłuch bez bramki niczego nie wynosi) —
decyzja produktowa do potwierdzenia: §14 P-2.

---

## §6. Bramka człowieka (kwestia e)

### 6.1 Zasada nadrzędna

**Każda odpowiedź każdego narzędzia przechodzi przez bramkę.** Dotyczy to
także `list_sources` i `list_outcomes` (choć niosą wyłącznie syntetyczne
etykiety i liczby znaków) — wymaganie W2 mówi „żadne narzędzie", a jednolita
reguła uczy użytkownika jednego, prostego modelu mentalnego: **nic nie
opuszcza aplikacji bez mojego kliknięcia**. Bramki dla `list_*` są wizualnie
kompaktowe (§6.2). Ewentualne rozluźnienie (zgoda sesyjna dla samych listingów)
jest świadomie odłożone i wymagałoby osobnej zgody Opusa i Alana: §14 P-3.

Wyjątek niebędący wyjątkiem: błędy domenowe i walidacyjne (nieznane narzędzie,
zły schemat, dokument niegotowy, brak encji, limit rozmiaru, kolejka pełna)
wracają bez bramki, bo **nie niosą żadnej treści dokumentów** — wyłącznie
stały komunikat błędu. Lista tych komunikatów jest zamknięta i podlega
przeglądowi pod kątem kanału bocznego (żaden nie może interpolować treści
dokumentu ani prywatnej nazwy pliku). **[DO WERYFIKACJI PRZEZ OPUSA: O-7]**

### 6.2 Okno bramki

Osobne okno Electrona (modal-child okna głównego), ładowane z `app://`
(statyczny zasób w asarze), z pełnym hartowaniem jak okno główne
(`sandbox`, `contextIsolation`, bez Node, CSP §6, `hardenWebContents` —
domyka to istniejący `web-contents-created`). Payload trafia do okna przez
dedykowany preload bramki (tylko `getPayload()` i `decide(approved)`),
renderowany **wyłącznie przez `textContent`** (zgodnie z C-INP-1; żadnego
`innerHTML` na danych). Zawartość okna:

1. **Nagłówek:** co i dokąd: „Klient AI (podaje się jako: Claude Desktop,
   połączenie nr 2) prosi o: read_source — Źródło 2".
   Nazwa klienta jest **jawnie oznaczona jako deklarowana** (adapter nie ma
   silnej tożsamości klienta; §9 SB-6).
2. **Pasek ostrzegawczy (stały, nieusuwalny, czerwony), tekst dokładnie:**
   > **Kliknięcie „Wyślij" wyśle poniższe dane do chmury AI. Sprawdź, czy nie
   > zostały żadne dane osobowe.**
   To jest pop-up ostrzegawczy wymagany przez W2, zintegrowany z oknem
   podglądu (jedno okno, nie dwa: drugie okno „czy na pewno?" buduje odruch
   klikania bez czytania; kalibrowana zapora to podgląd + opóźnienie
   przycisku + rozróżnialna etykieta akcji).
3. **Metryka payloadu:** liczba znaków, liczba tokenów anonimizacji,
   etykieta syntetyczna, która wyjdzie (`mcpLabel`), oraz — wyłącznie
   informacyjnie, wyraźnie oznaczone „nie zostanie wysłane" — prywatna
   nazwa dokumentu, żeby użytkownik wiedział, o który plik chodzi.
4. **Pełny podgląd payloadu:** monospace, przewijalny, z podświetleniem
   tokenów `[TYP_N]` (zielone) i trafień skanu kontrolnego (czerwone, §6.3).
   Zawsze pełna treść — nigdy skrót, nigdy elipsa.
5. **Przyciski:** „Wyślij do chmury AI" (aktywny po ~1,5 s od otwarcia —
   tłumi odruchowe kliknięcie; jeśli skan kontrolny coś znalazł, dodatkowo
   wymaga zaznaczenia pola „widzę oznaczone fragmenty i świadomie je
   wysyłam") oraz „Odrzuć". Esc = Odrzuć. Enter **niczego nie zatwierdza**
   (brak przycisku domyślnego). Zamknięcie okna = Odrzuć.
6. Dla `list_*`: ta sama struktura w wariancie kompaktowym (payload to
   krótki JSON listingu — pokazywany w całości).

Jeśli okno główne jest zminimalizowane: przywrócenie + `flashFrame`
(mrugnięcie na pasku zadań) zamiast kradzieży fokusu.

### 6.3 Skan kontrolny wyjścia (ostatnia linia obrony w procesie głównym)

Proces główny — **niezależnie od renderera** — sprawdza każdy payload przed
pokazaniem bramki:

- **Asercja tokenów:** dla `read_source`/`read_outcome` payload musi zawierać
  co najmniej jeden token anonimizacji (wzorzec z `listings.js`,
  wyniesiony do wspólnego modułu, §12 M4) — lustrzane odbicie reguły
  rendererowej, egzekwowane po obu stronach granicy IPC (obrona w głąb na
  wypadek błędu/kompromitacji renderera).
- **Regexy PII:** PESEL, NIP, REGON, numer rachunku (NRB/IBAN), e-mail,
  telefon — reużycie wzorców regex z pipeline'u (`src/pipeline` jest
  środowiskowo-agnostyczny, importowalny w procesie głównym). Trafienie
  **nie blokuje** automatycznie (fałszywe pozytywy: sygnatury, numery KRS
  itd.), tylko podświetla na czerwono i wymusza dodatkowe pole wyboru
  (§6.2 pkt 5). Kalibracja zestawu wzorców: §12 M4.
- **Limit rozmiaru** (§4.3) i poprawność kształtu wyniku (§3.4).

Skan działa też w kierunku „do środka" (`write_outcome`): podświetla
surowe PII w tekście przychodzącym (LLM mógł zdeanonimizować coś z kontekstu
rozmowy po stronie klienta — to sygnał dla użytkownika, że klient „wie"
więcej, niż powinien).

### 6.4 Decyzje i ich skutki

| Zdarzenie | Skutek dla klienta MCP | Skutek lokalny |
|---|---|---|
| „Wyślij" | pełny wynik narzędzia | licznik zatwierdzeń +1, wpis w dzienniku sesyjnym |
| „Odrzuć" / Esc / zamknięcie okna | wynik `isError`: „Użytkownik odmówił udostępnienia tych danych. Nie ponawiaj tego wywołania, dopóki użytkownik wyraźnie o to nie poprosi." | cisza po odmowie (§6.5) |
| Timeout (domyślnie 120 s) | wynik `isError`: „Brak decyzji użytkownika w wyznaczonym czasie." | okno zamykane, fail-closed |
| Zamknięcie aplikacji z otwartą bramką | jak „Odrzuć" | — |
| Klient anulował wywołanie (MCP `notifications/cancelled`) | — (klient już nie czeka) | okno bramki zamykane z adnotacją „anulowane przez klienta" |

Timeout bramki koliduje z timeoutami narzędzi po stronie klientów (bywają
krótsze niż namysł człowieka). Adapter, jeśli klient przekazał `progressToken`,
wysyła powiadomienia postępu („oczekiwanie na decyzję użytkownika"), co w
klientach zgodnych ze specyfikacją podtrzymuje wywołanie. Zachowanie każdego
docelowego klienta do zweryfikowania w M8. **[DO WERYFIKACJI PRZEZ OPUSA:
O-8 — wartość timeoutu i mechanizm keep-alive]**

### 6.5 Kolejka i higiena odmowy

- Jedna globalna kolejka FIFO bramek; na ekranie zawsze najwyżej **jedno**
  okno bramki; maksymalnie 5 oczekujących, nadmiar odrzucany natychmiast
  (`isError` „kolejka zatwierdzeń pełna").
- **Cisza po odmowie:** identyczne żądanie (narzędzie + argumenty) w ciągu
  60 s od „Odrzuć" jest odrzucane automatycznie, bez otwierania okna
  (ochrona przed zapętlonym LLM-em i przed wytresowaniem użytkownika do
  klikania „Wyślij"). Licznik takich auto-odmów widoczny we wskaźniku §5.5.
- Duplikat żądania już wiszącego w kolejce nie tworzy drugiej bramki —
  dostaje własną odpowiedź powiązaną z tą samą decyzją.

### 6.6 `write_outcome`: bramka kierunku „do środka"

Ta sama mechanika, inna semantyka i szata: pasek informacyjny (nie czerwony):
„Klient AI chce zapisać w aplikacji dokument wynikowy «\<label\>»
(N znaków). Nic nie wychodzi z komputera — zatwierdzasz zapis do lokalnej
przestrzeni wyników." Przyciski „Zapisz" / „Odrzuć". Skan §6.3 podświetla
surowe PII. Po zatwierdzeniu przez potok wraca wyłącznie `{id, success}`.
Nadpisanie istniejącego wyniku (`write_outcome` z `id`) jest w bramce
wyraźnie oznaczone („zastąpi istniejący Wynik 3").

### 6.7 Dziennik sesyjny (zgodny z D3: zero plików)

W pamięci procesu głównego, widoczny w UI (panel „Historia mostu"): czas,
narzędzie, etykieta syntetyczna, liczba znaków, decyzja, połączenie.
**Bez treści payloadów.** Znika z zamknięciem aplikacji — spójnie z polityką
D3 („zero plików dziennika w produkcji") i z RODO-odpowiedzią „aplikacja nie
prowadzi rejestru przetwarzania". Eksport dziennika na jawne kliknięcie:
świadomie **nie** w v1 (§14 P-4).

### 6.8 Gwarancja tożsamości payloadu: pokazane = wysłane

Wymaganie W2 mówi „okno z DOKŁADNYM payloadem". Konstrukcyjnie: proces główny
trzyma **jeden** bufor tekstu wyniku; ten sam bufor (a) jedzie do okna bramki,
(b) po zatwierdzeniu jest serializowany do ramki odpowiedzi. Żadnych
transformacji między podglądem a wysyłką (żadnego trimowania, reformatowania,
obcinania). Ramka JSON-RPC dokłada wyłącznie deterministyczną kopertę
(identyfikatory, pole `content`). Test e2e (M8) porównuje hash tekstu
pokazanego w bramce z hashem tekstu w ramce na potoku — one **muszą** być
identyczne. **[DO WERYFIKACJI PRZEZ OPUSA: O-9]**

---

## §7. Adapter (kwestia d)

### 7.1 Postać: ta sama binarka w trybie `--bridge-adapter`

Adapter to **ta sama podpisana binarka wariantu B**, uruchamiana z argumentem
`--bridge-adapter`. Wybór wynika z twardych ograniczeń:

- Fuse `RunAsNode: false` (C-INT-1) słusznie zostaje w obu wariantach —
  więc nie istnieje ścieżka „użyj binarki Electrona jako node.exe dla
  skryptu adaptera". Osłabianie fuses w wariancie B jest wykluczone.
- Docelowy użytkownik (prawnik) nie ma Node.js i nie będzie go instalował —
  adapter musi być samowystarczalny i obecny po instalacji, bez pobierania
  czegokolwiek (wymóg kwestii d).
- Kod adaptera leży w `app.asar` → obejmują go **te same** mechanizmy
  integralności co resztę aplikacji: `OnlyLoadAppFromAsar`,
  `EnableEmbeddedAsarIntegrityValidation`, docelowo podpis B4 i katalog
  `%ProgramFiles%` z B3. Osobna binarka adaptera musiałaby zbudować tę
  historię od zera.

Zachowanie w trybie adaptera: wykrycie argumentu **przed** całą inicjalizacją
GUI (przed `requestSingleInstanceLock`, przed rejestracją schematu `app://`,
przed bramką integralności modeli — adapter nie czyta modeli); zero okien,
zero renderera, zero profilu Chromium; wyłącznie pętla stdio + klient potoku.
Koszt: proces Electrona jako adapter jest cięższy od „gołego" procesu
(rząd ~100 MB RAM rezydentnie przy uruchomionym kliencie MCP) — akceptowany
w v1, mierzony w M8; jeśli okaże się nieakceptowalny, plan B to pojedyncza
binarka Node SEA (§7.5). **[DO WERYFIKACJI PRZEZ OPUSA: O-10 — akceptacja
trybu argv w tej samej binarce + pomiar kosztu]**

Zderzenie z wariantem A: binarka A nie zna flagi `--bridge-adapter`
(kod nieobecny) — uruchomiona z nią zachowuje się jak zwykły start GUI.
Dokumentacja klienta zawsze wskazuje na exe wariantu B (ścieżki instalacji
są rozłączne, §8.2).

### 7.2 Minimalny MCP bez nowych zależności

Adapter implementuje **minimalny podzbiór** serwera MCP po stdio:
`initialize` (negocjacja wersji protokołu), `ping`, `tools/list` (statyczna
lista 5 narzędzi), `tools/call` (przekazanie potokiem), `notifications/cancelled`
(przekazanie anulowania do bramki), powiadomienia postępu przy oczekiwaniu na
bramkę (§6.4). Capabilities: wyłącznie `tools` — bez resources, promptów,
samplingu.

Świadomie **bez** zależności `@modelcontextprotocol/sdk`: paczka aplikacji
dziś nie zawiera żadnych `node_modules` (deklaracja w `electron-builder.yml`,
pozycje C-PKG-2/C-INT-9), a framing stdio MCP to JSON-RPC 2.0 rozdzielany
znakami nowej linii — podzbiór potrzebny adapterowi jest mały, stabilny
i w całości audytowalny. Koszt tej decyzji: ręczne nadążanie za rewizjami
protokołu (negocjujemy najnowszą obsługiwaną, odpowiadamy zgodnie ze
specyfikacją przy niezgodności wersji) oraz testy kontraktowe na złotych
transkryptach + ręczna matryca zgodności z trzema klientami docelowymi (M8).
**[DO WERYFIKACJI PRZEZ OPUSA: O-11 — zero-dep vs SDK; przy zmianie zdania
SDK musiałby wejść do asara z pinowaniem i audytem]**

Spójność opisów narzędzi: schematy/opisy istnieją w dwóch miejscach
(rejestracja WebMCP w `src/main.js` dla webu; statyczna lista adaptera).
`src/` nie jest pakowane do asara, więc adapter nie może ich importować
w runtime — zamiast magii buildowej: **test jednostkowy porównujący oba
zestawy** (uruchamiany z repo, gdzie oba są importowalne); rozjazd = czerwony
test.

### 7.3 Odpowiedzialności i twarde zakazy adaptera

Adapter WOLNO: tłumaczyć ramki, uwierzytelniać się do potoku, zwracać błędy
„aplikacja nieuruchomiona"/„most wstrzymany", wysyłać powiadomienia postępu.

Adapterowi NIE WOLNO (egzekwowane przeglądem + testami):
- logować treści payloadów — **stderr adaptera trafia do logów klienta MCP
  na dysku** (np. Claude Desktop pisze `mcp-server-*.log`); dozwolone są
  wyłącznie zdarzenia cyklu życia bez danych (połączono, błąd uwierzytelnienia,
  aplikacja niedostępna); ta sama reguła redakcji co D3 pkt 2;
- buforować/retransmitować żądania i odpowiedzi (zero kolejek, zero retry
  z danymi — retry należy do LLM-a po stronie klienta);
- dotykać dysku poza odczytem pliku sesyjnego (zero własnych plików);
- otwierać cokolwiek poza potokiem z pliku sesyjnego (jedyny cel połączeń;
  asercja ścieżki `\\.\pipe\` jak w §4.6);
- interpretować treść payloadów (przezroczystość: adapter nie parsuje tekstu
  narzędzi, tylko koperty).

### 7.4 Konfiguracja klientów MCP (bez sieci, bez pobierania)

Wszystko, czego potrzebuje klient, jest na dysku po instalacji wariantu B.
Ścieżka jest stała i przewidywalna dzięki B3 (`perMachine`,
`allowToChangeInstallationDirectory: false`). Przykłady (dokumentacja
użytkownika; nazwa produktu — §14 P-1):

Claude Desktop (`claude_desktop_config.json`):
```json
{ "mcpServers": { "pii-tools-bridge": {
    "command": "C:\\Program Files\\pii.tools Desktop Bridge\\pii.tools Desktop Bridge.exe",
    "args": ["--bridge-adapter"] } } }
```

Claude Code: `claude mcp add pii-tools-bridge -- "C:\Program Files\pii.tools
Desktop Bridge\pii.tools Desktop Bridge.exe" --bridge-adapter`
(analogiczne wpisy: Codex `config.toml`, Cowork — zgodnie z ich dokumentacją;
matryca sprawdzana w M8).

Ergonomia: w UI wariantu B (obok wskaźnika §5.5) przycisk **„Skopiuj
konfigurację dla klienta AI"** — wkłada do schowka gotowy wpis JSON z
faktyczną ścieżką instalacji. Aplikacja **nie modyfikuje** konfiguracji
cudzych programów (żadnego automatycznego wpisywania się do Claude Desktop) —
to użytkownik wkleja wpis u siebie; ingerencja w cudze pliki konfiguracyjne
to antywzorzec bezpieczeństwa i wsparcia.

Nic w tym przepływie nie dotyka sieci: bez `npx`, bez rejestrów paczek,
bez instalatorów pobieranych w locie (kontrast z usuniętym WebMCP, który
wymagał `npx -y @jason.today/webmcp@latest` przy każdym uruchomieniu).

### 7.5 Alternatywa odrzucona (na dziś): osobna binarka Node SEA

Zaleta: lżejszy proces bez Chromium, mniejsza powierzchnia. Wady, które
przeważyły w v1: eksperymentalny toolchain (single executable application),
**druga** binarka do podpisania i osobna historia integralności (poza asarem
i jego fuse'em), większy łańcuch dostaw do audytu. Wraca jako optymalizacja,
jeśli pomiar kosztu z §7.1 wypadnie źle. Ta decyzja jest odwracalna bez zmian
w architekturze (adapter to czysty tłumacz — jego nośnik jest wymienny).

---

## §8. Wariantowość buildu (kwestia c)

### 8.1 Wzorzec: B2 jako matryca

B2 nauczył nas wzorca „fizycznej nieobecności": (1) transformacja usuwa
odwołanie, (2) osobny krok usuwa sam artefakt, (3) reguły są fail-fast,
(4) grep po artefakcie pilnuje regresji na zawsze (C-NET-11, C-PKG-10).
Wariantowość mostu stosuje ten wzorzec w obu kierunkach: A musi być
**dowiedzenie czysty** z mostu, B musi **dowiedzenie zawierać** dokładnie to,
co zaprojektowano (żeby konfiguracje się cicho nie zamieniły).

### 8.2 Układ plików i konfiguracji

Nowe pliki (wszystkie wyłącznie dla wariantu B):

| Ścieżka | Rola |
|---|---|
| `electron/main-bridge.mjs` | punkt wejścia wariantu B: najpierw rozgałęzienie `--bridge-adapter` (tryb adaptera), w przeciwnym razie bootstrap mostu + import **niezmienionego** `electron/main.mjs` |
| `electron/bridge/bootstrap.mjs` | inicjalizacja mostu po stronie GUI (plik sesyjny, serwer potoku, kolejka bramek, rejestracja preloadu mostu) |
| `electron/bridge/pipe-server.mjs` | jedyny (obok pipe-client) plik z `node:net`; §4.6 |
| `electron/bridge/pipe-client.mjs` | klient potoku dla trybu adaptera; §4.6 |
| `electron/bridge/session-file.mjs` | plik sesyjny: ścieżka LOCALAPPDATA, zapis atomowy, sprzątanie |
| `electron/bridge/auth.mjs` | challenge-response HMAC (§4.3), bez I/O |
| `electron/bridge/gate.mjs` + `electron/bridge/gate-window/…` | kolejka bramek, okno bramki (HTML/CSS/preload bramki) |
| `electron/bridge/outbound-checks.mjs` | skan kontrolny (§6.3) |
| `electron/bridge/adapter-main.mjs` + `electron/bridge/mcp-stdio.mjs` | tryb adaptera: pętla stdio, minimalny MCP (§7.2) |
| `electron/preload-bridge.cjs` | dodatkowy preload z `window.desktopApp.bridge` (§3.4) |
| `vite.config.electron-bridge.js` | jak `vite.config.electron.js` (wszystkie strips i asercje zostają, łącznie z usuwaniem WebMCP), plus flaga `VITE_PII_BRIDGE=1` i `outDir: dist-desktop-bridge/` |
| `electron-builder.bridge.yml` | osobny target: własne `appId` (np. `pl.kolkowski.pii-tools-bridge`) i `productName` → **rozłączna ścieżka instalacji i rozłączny profil `%APPDATA%`**, oba warianty instalowalne obok siebie; `extraMetadata.main: electron/main-bridge.mjs`; te same fuses (wspólny `scripts/afterpack-fuses.cjs`), ten sam `perMachine`, ten sam `publish: null` |
| `scripts/assert-variant-artifacts.mjs` | asercje artefaktów §8.3, wpinane w oba skrypty build |

Zmiany w plikach istniejących — **minimalny dotyk, zamknięta lista**:

- `electron-builder.yml` (wariant A): wyłącznie wykluczenia
  `!electron/bridge/**`, `!electron/main-bridge.mjs`,
  `!electron/preload-bridge.cjs` w `files` (fizyczna nieobecność, W4).
- `src/main.js` (renderer, wspólny): wydzielenie istniejących ciał narzędzi
  (dziś zamkniętych w bloku WebMCP) do modułu transport-agnostycznego
  (np. `src/mcp/tools.js`) + rejestracja obsługi IPC mostu za flagą
  `import.meta.env.VITE_PII_BRIDGE` (Vite statycznie usuwa martwy kod
  z buildów bez flagi). Web i wariant A zachowują się identycznie jak dziś.
- `package.json`: skrypty `desktop:build:renderer:bridge`,
  `desktop:build:bridge`, `desktop:smoke:bridge` (lustrzane wobec
  istniejących).
- `electron/main.mjs`: **zero zmian.** Bootstrap mostu podpina się z
  zewnątrz: preload przez `session.registerPreloadScript` (lub równoważny
  mechanizm sesyjny), okna bramki tworzy sam, IPC rejestruje sam.
  Jeśli mechanizm rejestracji preloadu w Electronie 43 okaże się
  niewystarczający, dopuszczalny wariant zapasowy to jawny, bierny punkt
  rozszerzenia w `main.mjs` (nieaktywny w A) — wymaga osobnej zgody.
  **[DO WERYFIKACJI PRZEZ OPUSA: O-6]**

### 8.3 Asercje artefaktów (obie strony, automatyczne, fail-fast)

Po `desktop:build` (A) i `desktop:build:bridge` (B), w tym samym duchu co
`assertNoRemoteUrls`:

- **A jest czysty:** lista plików `app.asar` nie zawiera `bridge/`,
  `main-bridge.mjs`, `preload-bridge.cjs`; zawartość asara i `dist-desktop/`
  nie zawiera stringów `\\.\pipe\`, `pii:bridge:`, `bridge-session.json`,
  `--bridge-adapter`; `package.json` w asarze ma `main: electron/main.mjs`.
- **B jest kompletny:** asar zawiera dokładnie oczekiwane pliki mostu;
  `main: electron/main-bridge.mjs`; fuses odczytane z binarki B są
  **identyczne** z A (żadnego cichego osłabienia hartowania w wariancie
  z mostem).
- Istniejące testy A (`desktop:smoke`, `desktop:smoke:packaged`,
  `desktop:smoke:offline`) przechodzą bez modyfikacji — to jest definicja
  „wariant A dokładnie jak dziś".

### 8.4 Interpretacja „A zachowany DOKŁADNIE jak dziś"

Rozumiem to wymaganie behawioralnie i artefaktowo, nie „bajt w bajt w repo":
repo jest wspólne, więc źródła wspólne (jak `src/main.js`) mogą się zmieniać
refaktorem, o ile (1) artefakt A nie zawiera żadnego kodu mostu (asercje
§8.3), (2) zachowanie A jest niezmienione (istniejące smoke'i + testy),
(3) żaden plik `electron/` używany przez A nie zmienia treści poza
wykluczeniami w yml. Jeśli Opus lub Alan rozumieją to wymaganie ściślej
(zero zmian nawet w źródłach wspólnych), alternatywą jest duplikacja ciał
narzędzi zamiast refaktoru — koszt: dryf dwóch kopii. **[DO WERYFIKACJI
PRZEZ OPUSA: O-12]**

---

## §9. Model zagrożeń wariantu B

### 9.1 Co się zmienia względem modelu wariantu A

Nowe elementy: granica **G5** (potok: adapter ↔ proces główny), granica
**G6** (stdio: adapter ↔ klient MCP; dane za nią są poza kontrolą), aktywa
**A7** (sekret sesyjny mostu — utrata pozwala lokalnym procesom wołać
narzędzia, ale **nie** omija bramki) i **A8** (decyzje użytkownika w bramce —
ich integralność to sedno W2). Założenia Z1–Z6 bez zmian; szczególnie ważne
pozostaje **Z4** (atakujący wykonuje kod na koncie użytkownika, bez
podniesienia uprawnień).

**Zdanie, które musi wybrzmieć wprost:** uwierzytelnienie potoku (§4.3)
broni przed **innymi użytkownikami** tej samej maszyny i procesami na innych
kontach. **Nie broni** przed złośliwym kodem działającym na koncie
użytkownika (Z4) — taki kod przeczyta plik sesyjny i uwierzytelni się
poprawnie. Przed Z4 broni **bramka**: każda próba wyciągnięcia danych
materializuje się jako widoczne okno z payloadem, którego użytkownik się
nie spodziewał. Bramka jest więc zarazem kontrolą i **czujnikiem**
(nieoczekiwane okno = sygnał kompromitacji). To świadome przeniesienie
punktu ciężkości: z tajności kanału na jawność decyzji.

### 9.2 STRIDE dla nowych elementów

| STRIDE | Wektor | Granica | Obrona | Status |
|---|---|---|---|---|
| **S**poofing | fałszywy adapter (proces innego użytkownika) łączy się z potokiem | G5 | ACL pliku sesyjnego + HMAC §4.3 | zamknięte |
| S | fałszywy adapter (proces tego samego użytkownika, Z4) | G5 | bramka W2 (okno = wykrycie); cisza po odmowie; wyłącznik §5.5 | **rezydualne RB-1** |
| S | podszycie się pod serwer potoku (squatting nazwy) | G5 | losowa nazwa 128 b + `FIRST_PIPE_INSTANCE` (fail-closed przy bind) + weryfikacja `auth-ok` przez adapter | zamknięte (O-2) |
| S | fałszywe okno bramki narysowane przez malware | UI | wymaga Z4; poza modelem jak każdy overlay (R4-pokrewne) | poza modelem |
| **T**ampering | podmiana binarki/adaptera | G3 | B3 (`%ProgramFiles%`) + B4 (podpis) + fuse asar — **warunek: B nie wychodzi przed B4** | jak w A |
| T | modyfikacja ramek w locie na potoku | G5 | wymaga uprawnień kernel/debug albo Z4 (wtedy nieistotne — patrz RB-1) | poza modelem |
| T | podmiana pliku sesyjnego przez innego użytkownika | G5 | ACL profilu | zamknięte |
| **R**epudiation | „aplikacja coś wysłała beze mnie" | UI | bramka na każdej odpowiedzi + dziennik sesyjny §6.7 (ulotny, zgodny z D3) | zamknięte co do sesji |
| **I**nfo disclosure | legenda/oryginał/nazwa pliku przez potok | G2/G5 | W1: buildery `listings.js` jako jedyny producent; walidacja kształtu; skan §6.3; testy C-BR-9 | zamknięte konstrukcyjnie |
| I | przeoczone przez NER PII w tokenizowanym tekście | G6 | podgląd bramki + skan regex; **nieusuwalne** (R1) | rezydualne RB-2 |
| I | payload w logach klienta MCP / historii rozmowy / chmurze | G6 | poza granicą; dokumentacja użytkownika | rezydualne RB-5 |
| I | payload w stderr adaptera → logi klienta na dysku | G6 | zakaz §7.3 + test C-BR-12 | zamknięte |
| I | sekret sesyjny w profilu roamingowym | G5 | `%LOCALAPPDATA%` §4.3 | zamknięte |
| I | payloady w pamięci/pagefile procesu głównego i okna bramki | OS | payload jest już stokenizowany (klasa niżej niż legenda); BitLocker (Z5), R3 | rezydualne, jak R3 |
| **D**oS | spam bramkami (zapętlony LLM albo Z4) | G5 | kolejka ≤ 5, cisza po odmowie 60 s, dedup, wyłącznik | zamknięte |
| D | zalew połączeń / ramka-gigant | G5 | limit 4 połączeń, timeout auth 5 s, limit ramki 4 MiB | zamknięte |
| D | zajęcie nazwy potoku przed startem aplikacji | G5 | losowa nazwa (atak wymaga odczytu pliku sesyjnego, który jeszcze nie istnieje); bind fail-closed z komunikatem | zamknięte |
| **E**levation | złośliwe argumenty narzędzia → renderer | G5→G2 | zamknięta lista 5 narzędzi, walidacja schematu w procesie głównym (limity §4.3, odrzucanie nadmiarowych pól), brak ścieżek/URL-i w argumentach | zamknięte |
| E | eskalacja przez okno bramki | UI | sandbox + contextIsolation + `textContent`-only + preload bramki z dwiema funkcjami + walidacja nadawcy decyzji | zamknięte |
| E | wstrzyknięcie treści do UI przez `write_outcome` | G1' | istniejąca dyscyplina C-INP-1/C-INP-2 (rendering przez `textContent`), obowiązuje też okno bramki | zamknięte |

### 9.3 Scenariusze warte osobnego opisu

- **SB-1 (odpowiednik S2 dla mostu): malware Z4 woła `read_source` po cichu.**
  Uwierzytelni się (RB-1), ale odpowiedź wymaga kliknięcia w oknie, którego
  użytkownik się nie spodziewa. Skutek: brak cichej eksfiltracji; sygnał
  kompromitacji. Poza tym ten sam atakujący ma prostsze drogi (czyta RAM
  renderera, robi zrzuty ekranu) — most **nie pogarsza** jego pozycji,
  a bramka ją ujawnia.
- **SB-2: klient MCP (proces zaufany przez użytkownika) jest skompromitowany
  albo złośliwie skonfigurowany.** Widzi wyłącznie to, co przeszło bramkę:
  tokeny i syntetyczne etykiety. Nie zna legendy, nie zna nazw plików, nie
  może niczego wyciągnąć bez klikania człowieka. Może natomiast zalewać
  bramkę żądaniami — patrz DoS.
- **SB-3: socjotechnika przez treść.** LLM (albo dokument źródłowy — Z3!)
  umieszcza w wyniku `write_outcome` tekst nakłaniający użytkownika do
  ominięcia procedur („wklej mi legendę do czatu"). Most tego nie
  rozstrzygnie technicznie; obrona to edukacja w dokumentacji + stała rama
  okna bramki (pasek ostrzegawczy jest elementem UI aplikacji, nie treści).
  Odnotowane jako ograniczenie.
- **SB-4: habituacja użytkownika.** Największe realne ryzyko produktu:
  po 50 kliknięciach „Wyślij" czytanie payloadu zanika. Przeciwdziałanie
  wpisane w projekt: opóźnienie aktywacji przycisku, czerwone podświetlenia
  skanu z wymuszonym polem wyboru, cisza po odmowie (mniej okien = każde
  znaczy więcej), kompaktowe bramki dla `list_*` (małe decyzje nie zużywają
  uwagi potrzebnej dużym). Reszta to odpowiedzialność człowieka — zgodnie
  z filozofią wariantu B.
- **SB-5: awaria/restart aplikacji w trakcie oczekującej bramki.** Wiszące
  żądania dostają `isError`; osierocony plik sesyjny jest nadpisywany przy
  następnym starcie; adapter nie cache'uje nazwy potoku (§5.2). Fail-closed
  na każdej ścieżce.
- **SB-6: tożsamość klienta.** Adapter deklaruje nazwę klienta (z MCP
  `initialize.clientInfo`), ale nie ma silnej tożsamości procesu po drugiej
  stronie stdio; Node nie eksponuje też PID-u klienta potoku. Dlatego UI
  bramki mówi „podaje się jako…" i numeruje połączenia. Świadome ograniczenie,
  nie luka: decyzja użytkownika dotyczy **payloadu**, nie tożsamości pytającego.

### 9.4 Ryzyka rezydualne wariantu B (przyjęte świadomie, do zapisania)

| ID | Ryzyko | Dlaczego zostaje | Zarządzanie |
|---|---|---|---|
| RB-1 | proces Z4 (to samo konto) uwierzytelni się do potoku | sekret z definicji dostępny dla konta użytkownika; DACL/HMAC nie rozróżnia procesów tego samego konta | bramka = kontrola i czujnik; wyłącznik mostu; dokumentacja |
| RB-2 | przeoczone PII w tokenizowanym tekście przechodzi po zatwierdzeniu | R1, granica jakości NER | podgląd + skan §6.3 + język dokumentacji (S-MCP-1); przyszłość: lokalny LLM-weryfikator (wizja produktu) |
| RB-3 | użytkownik zatwierdza bez czytania (habituacja) | czynnik ludzki | SB-4; metryki UX w przyszłości |
| RB-4 | payloady (stokenizowane) w RAM/pagefile/WER trzech procesów | własność OS/JS jak R3 | klasa danych niższa niż legenda; BitLocker (Z5) |
| RB-5 | retencja po stronie klienta MCP i chmury (logi, historia, trening) | poza granicą aplikacji (G6) | jawna granica odpowiedzialności w §2 i dokumentacji użytkownika |
| RB-6 | protokół MCP ewoluuje, ręczna implementacja może się zestarzeć | decyzja O-11 | testy kontraktowe M8, pin wersji protokołu, przegląd przy aktualizacjach klientów |

---

## §10. Wpływ na SECURITY-CHECKLIST.md

### 10.1 Profil wariantowy

Checklista zyskuje rozdział „9. Most MCP" obowiązujący **wyłącznie wariant B**
oraz kolumnę/oznaczenie wariantu tam, gdzie statusy się różnią. Werdykt bramki
wydania jest od tej pory wydawany **per wariant** (A może wyjść, gdy B jeszcze
nie — i odwrotnie nigdy: B dziedziczy wszystkie wymagania A). Dla wariantu A
jedyna nowa pozycja to asercja czystości artefaktu (C-BR-13).

### 10.2 Nowe pozycje (propozycja, numeracja do przyjęcia przez Opusa)

| ID | Pozycja (skrót) |
|---|---|
| C-BR-1 | serwer/klient potoku przyjmują wyłącznie ścieżki `\\.\pipe\…` (asercja runtime + test jednostkowy) |
| C-BR-2 | `node:net` importowany wyłącznie w `pipe-server.mjs` i `pipe-client.mjs`; pozostałe moduły sieciowe: zero importów w całym `electron/` (test statyczny, oba warianty) |
| C-BR-3 | zero wywołań `connect(host, port)` / gniazd TCP w całym repo `electron/` (test statyczny) |
| C-BR-4 | plik sesyjny: `%LOCALAPPDATA%` (nie roaming), zapis atomowy, zero PII, sprzątany przy wyjściu i wstrzymaniu mostu |
| C-BR-5 | wzajemny HMAC przed pierwszą ramką narzędziową; porównania stałoczasowe; timeout auth; sekret nigdy na potoku |
| C-BR-6 | każda odpowiedź narzędzia przechodzi przez bramkę; nie istnieje ścieżka kodu zwracająca payload bez decyzji (test e2e: odpowiedź wisi do kliknięcia) |
| C-BR-7 | tożsamość payloadu: hash tekstu w bramce == hash tekstu na potoku (test e2e) |
| C-BR-8 | skan kontrolny aktywny: asercja tokenów dla `read_*`, regexy PII podświetlone w bramce |
| C-BR-9 | legenda niesérializowalna przez żaden kanał IPC (zamknięta lista kanałów + walidacja kształtu + test) |
| C-BR-10 | argumenty narzędzi walidowane schematem w procesie głównym przed dotknięciem renderera |
| C-BR-11 | limity: kolejka bramek, cisza po odmowie, timeout decyzji fail-closed, limit ramki i połączeń |
| C-BR-12 | adapter nie zapisuje niczego na dysk i nie loguje treści payloadów (stderr-dyscyplina; test na złotych transkryptach) |
| C-BR-13 | artefakt A wolny od mostu: asar bez `bridge/`, bez stringów `\\.\pipe\`/`pii:bridge:`/`--bridge-adapter` (asercja w build A) |
| C-BR-14 | artefakt B kompletny i z fuses identycznymi jak A (`@electron/fuses read` porównane automatycznie) |
| C-BR-15 | adapter nigdy nie uruchamia GUI; tryb adaptera nie dotyka single-instance lock |
| C-BR-16 | okno bramki: sandbox, contextIsolation, rendering wyłącznie `textContent`, preload o dwóch funkcjach, walidacja nadawcy decyzji |

### 10.3 Zmiany pozycji istniejących

- **C-NET-6:** rozdzielenie na C-NET-6 (wariant A, bez zmian, wreszcie
  z egzekucją testową — domyka S-NET-4) i C-NET-6b (wariant B, §4.6).
- **C-IPC-2/C-IPC-3:** aktualizacja opisu — kanały `pii:bridge:*` w wariancie
  B, wszystkie z walidacją nadawcy (wzorzec S-IPC-1 staje się warunkiem
  wejścia mostu, nie „SHOULD").
- **C-IPC-5:** rozszerzenie o kanały mostu (żaden nie przenosi legendy;
  `pii:bridge:result` przenosi wyłącznie wyniki builderów `listings.js`).
- **C-PKG-2/C-INT-9:** bez zmian merytorycznych; potwierdzenie, że most
  nie wnosi żadnych `node_modules` do paczki (O-11).
- **C-WIN-8:** dopisek o trybie adaptera (C-BR-15).
- **B4 (podpis kodu):** status „bloker" obejmuje oba warianty; dla B jest
  **twardszy** — most zwiększa wartość podszycia się pod binarkę, więc
  dystrybucja B bez podpisu jest wykluczona bez żadnych odstępstw.

### 10.4 Testy wydania wariantu B (rozszerzenie sekcji „Testy…")

`npm test` (w tym testy mostu), `desktop:build` + `desktop:build:bridge`
(z asercjami artefaktów obu stron), `desktop:smoke` (A, bez zmian),
`desktop:smoke:bridge` (M8: pełny przebieg z fałszywym klientem stdio,
bramka sterowana przez CDP, licznik blokad sieci **nadal 0** po pełnym
przebiegu mostu — most nie generuje żadnego ruchu widzianego przez strażnika),
ręczna matryca klientów (Claude Desktop, Cowork, Codex).

---

## §11. Wpływ na pozostałe dokumenty

- **SECURITY.md:** §10 przestaje być „decyzją odłożoną" — wskazuje ten
  dokument jako rozstrzygnięcie; nowy §10a opisuje most wariantu B
  (transport, bramka, plik sesyjny) po zaimplementowaniu; §14 aktualizuje
  rejestr rzeczy odłożonych.
- **THREAT-MODEL.md:** dopisek do §2 (granice G5/G6), §4 (scenariusze SB-*),
  §5 (RB-*), §6 D1 — zrealizowana wariantem B w kształcie (b); adnotacja
  o profilu wariantowym.
- **CLAUDE.md i docs/webmcp.md:** korekta języka wymagana przez S-MCP-1
  („tokenizacja wykrytych encji", nie „only as tokenized text") — dotyczy
  także opisu webowego WebMCP, niezależnie od mostu.
- **Nowy docs/bridge.md (dokumentacja użytkownika):** konfiguracja klientów
  (§7.4), objaśnienie bramki, granica odpowiedzialności (§2), retencja po
  stronie klienta (RB-5), FAQ („dlaczego aplikacja pyta przy każdym
  odczycie?").

---

## §12. Plan implementacji dla Sonneta

Zasady nadrzędne: (1) każdy moduł przechodzi bramkę Opusa **przed** merge
(W5); (2) zero nowych zależności runtime; (3) żadnych zmian w plikach
wariantu A poza zamkniętą listą z §8.2; (4) prace Sonneta nad hardeningiem A
(S-NET-1/2/5, C-NET-14, S-LOG-1, S-IPC-1) idą niezależnie i **przed** mostem
tam, gdzie się stykają (S-IPC-1 jest warunkiem wejścia M5). Każdy moduł ma
jawne kryteria akceptacji; testy jednostkowe wchodzą razem z modułem, nie po.

| Moduł | Zakres | Kryteria akceptacji (skrót) | Bramka Opusa |
|---|---|---|---|
| **M1** `session-file.mjs` | ścieżka LOCALAPPDATA, zapis atomowy, sprzątanie, kształt pliku | testy: atomowość (brak pliku częściowego), brak PII w treści, fail-closed bez `%LOCALAPPDATA%` | tak (dotyka dysku) |
| **M2** `pipe-server.mjs`, `pipe-client.mjs`, `auth.mjs` | bind losowej nazwy, `FIRST_PIPE_INSTANCE` (O-2), framing NDJSON + limity, handshake HMAC, rejestr połączeń | testy: odrzucenie ścieżki nie-potokowej, złe MAC-i, timeout auth, limit ramki, EADDRINUSE fail-closed; C-BR-1/2/3/5 zielone | tak (sieć/IPC — rdzeń) |
| **M3** `gate.mjs` + okno bramki | kolejka FIFO, okno modalne, kanał decyzji, timeout, cisza po odmowie, teksty §6.2/§6.6 | testy jednostkowe kolejki; e2e: approve/reject/timeout/anulowanie przez CDP; C-BR-6/7/11/16 | tak (UI decyzji = serce W2) |
| **M4** `outbound-checks.mjs` + wspólny moduł wzorca tokenów | wyniesienie `TOKEN_PATTERN` do modułu współdzielonego z `listings.js`; regexy PII z pipeline'u; progi i podświetlenia | testy na korpusie syntetycznym (`test-data/synthetic/`); zero fałszywych blokad (skan ostrzega, nie blokuje); C-BR-8 | tak (dotyka semantyki W1) |
| **M5** renderer: `src/mcp/tools.js` + obsługa IPC mostu | refaktor ciał narzędzi z bloku WebMCP do modułu transport-agnostycznego; rejestracja `pii:bridge:*` za `VITE_PII_BRIDGE`; walidacja nadawcy (S-IPC-1) | web build bez zmian zachowania; wariant A: brak symboli mostu w bundlu; `npm run eval` bez regresji; C-BR-9/10 | tak (IPC + sąsiedztwo legendy) |
| **M6** `adapter-main.mjs`, `mcp-stdio.mjs` | rozgałęzienie argv przed single-instance; minimalny MCP (initialize/ping/tools); błędy „aplikacja nieuruchomiona"; powiadomienia postępu; stderr-dyscyplina | złote transkrypty JSON-RPC; test „app-down"; C-BR-12/15 | tak (granica G6) |
| **M7** wariantowość: `main-bridge.mjs`, konfigi Vite/buildera, `assert-variant-artifacts.mjs`, skrypty npm | dwa instalowalne obok siebie artefakty; asercje §8.3 w obu buildach; fuses identyczne | C-BR-13/14 zielone; `desktop:smoke` A bez zmian | tak (W4) |
| **M8** e2e + matryca klientów | `e2e/desktop-bridge-smoke.mjs`: fałszywy klient stdio ↔ adapter ↔ aplikacja spakowana; scenariusze: approve, reject, timeout, app-down, licznik blokad = 0; pomiar RAM adaptera (O-10); ręczna matryca Claude Desktop / Cowork / Codex | pełny przebieg zielony na spakowanym B; raport zgodności klientów | tak (dowód całości) |

Kolejność: M1 → M2 → M4 → M3 → M5 → M6 → M7 → M8 (M4 przed M3, bo bramka
konsumuje wyniki skanu). Dokumenty (§11) aktualizowane w dwóch rzutach:
po M2 (transport istnieje) i po M8 (całość zweryfikowana).

---

## §13. Rejestr założeń i pozycji DO WERYFIKACJI PRZEZ OPUSA

Każda pozycja dotyka sieci, IPC albo legendy — zgodnie z W5 żadna nie jest
przesądzona do czasu decyzji Opusa.

| ID | Kwestia | Propozycja projektu | Ryzyko przy błędzie |
|---|---|---|---|
| **O-1** | DACL potoku nieustawialny z czystego Node → kompensacja protokołem (§4.4) | nieodgadywalna nazwa + sekret za ACL profilu + wzajemny HMAC | inny użytkownik maszyny mógłby łączyć się z potokiem (nadal bez danych: bramka) |
| **O-2** | `FILE_FLAG_FIRST_PIPE_INSTANCE` w libuv/Electron 43: bind na zajętą nazwę = błąd | przyjęte; test empiryczny w M2 | cichy split-brain serwera potoku |
| **O-3** | protokół uwierzytelnienia §4.3 (konteksty, nonce, stałoczasowość, limity) | jak w §4.3 | podszycie/odtworzenie sesji między kontami |
| **O-4** | opis ekspozycji potoków przez SMB (§4.5) i jego akceptacja | ryzyko pomijalne, udokumentowane jawnie | nieścisła obietnica w dokumentacji |
| **O-5** | reformulacja C-NET-6 → C-NET-6b (§4.6): wąskie odstępstwo z egzekucją | dwie dozwolone lokalizacje `node:net`, tylko `\\.\pipe\`, trzy warstwy testów | erozja niezmiennika „main bez sieci" |
| **O-6** | mechanizm doklejenia preloadu mostu bez zmian w `main.mjs` (§8.2) | `session.registerPreloadScript` (empirycznie potwierdzić w Electronie 43); fallback: bierny punkt rozszerzenia | zmiana wspólnego rdzenia A |
| **O-7** | zamknięta lista błędów zwracanych bez bramki (§6.1) | tylko stałe komunikaty, zero interpolacji treści | kanał boczny w komunikatach błędów |
| **O-8** | timeout bramki 120 s + keep-alive powiadomieniami postępu (§6.4) | jak w §6.4; weryfikacja zachowań klientów w M8 | zrywanie wywołań w trakcie namysłu człowieka |
| **O-9** | gwarancja „pokazane = wysłane" jednym buforem + test hashy (§6.8) | jak w §6.8 | rozjazd podglądu i wysyłki = złamanie W2 |
| **O-10** | adapter jako ta sama binarka w trybie argv (§7.1); koszt RAM | akceptacja + pomiar w M8; plan B: Node SEA (§7.5) | stały koszt pamięci u użytkownika |
| **O-11** | minimalny MCP bez `@modelcontextprotocol/sdk` (§7.2) | zero-dep + testy kontraktowe + matryca klientów | niezgodność protokołu z przyszłymi klientami |
| **O-12** | interpretacja „wariant A dokładnie jak dziś" (§8.4) | behawioralnie + asercje artefaktów; refaktor wspólnych źródeł dozwolony | spór o zakres zmian w repo |

Założenia przyjęte bez osobnej weryfikacji (spójne z modelem A): Z1–Z6
z `THREAT-MODEL.md`, w szczególności Z4 jako główny atakujący i Z5
(BitLocker) jako kontrola organizacyjna.

## §14. Decyzje produktowe do potwierdzenia przez Alana

| ID | Decyzja | Rekomendacja projektu |
|---|---|---|
| P-1 | nazwy handlowe wariantów (A: „Lokalny anonimizator"? B: „pii.tools Desktop Bridge"?), `productName`/`appId` wariantu B | rozłączne nazwy i identyfikatory (wymóg techniczny §8.2); brzmienie do decyzji |
| P-2 | most aktywny od startu aplikacji czy włączany ręcznie per sesja (§5.5) | aktywny od startu, z widocznym wskaźnikiem i wyłącznikiem — kontrolą jest bramka, nie nasłuch |
| P-3 | bramka także dla `list_sources`/`list_outcomes` (§6.1) | tak w v1 (litera W2); ewentualna zgoda sesyjna dla listingów dopiero po doświadczeniu z użycia i za zgodą Opusa |
| P-4 | eksport dziennika sesyjnego do pliku (§6.7) | nie w v1 (D3: zero plików); do rozważenia później |
| P-5 | długość timeoutu bramki i opóźnienia aktywacji „Wyślij" (§6.2, §6.4) | 120 s / ~1,5 s; do kalibracji po testach z prawdziwym przepływem |

---

*Koniec projektu. Następny krok: bramka Opusa nad §13 (O-1…O-12), decyzje
Alana nad §14 (P-1…P-5), potem implementacja wg §12 (M1…M8), moduł po module,
każdy przez pełną bramkę.*
