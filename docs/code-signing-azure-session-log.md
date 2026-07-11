# Podpis kodu Azure Artifact Signing — pełny log sesji (bloker B4)

Ten plik to wyczerpujący, chronologiczny zapis CAŁEJ sesji konfiguracji podpisu
kodu dla instalatora Windows „Lokalny anonimizator". Powstał, żeby nowa sesja
(np. Claude Code / inny agent) mogła przejąć zadanie **bez utraty kontekstu**.

Powiązane pliki:
- [`code-signing-azure.md`](./code-signing-azure.md) — oryginalny przewodnik krok po kroku.
- [`code-signing-azure-progress.md`](./code-signing-azure-progress.md) — skrócona tabela statusu (ten plik jest jej pełnym rozwinięciem).
- `SECURITY-FIXES.md` — bloker **B4**.
- `SECURITY-CHECKLIST.md` — bramki `C-WIN-2` / `C-WIN-4`, które ma to zamknąć.

## ⚠️ PILNE — do zrobienia niezależnie od reszty

**Client secret service principala został w pewnym momencie wklejony jawnie w
terminalu i trafił do logu tej sesji** (widoczny w historii czatu w postaci
`$env:AZURE_CLIENT_SECRET = "..."`). Zgodnie z dobrą praktyką bezpieczeństwa
taki sekret należy uznać za potencjalnie ujawniony i **wygenerować nowy** w
Azure (Entra ID → rejestracja aplikacji `klaw-anonimizator-signing` →
Certyfikaty i klucze tajne → usunąć stary klucz, dodać nowy), a następnie użyć
już tylko nowej wartości. Nigdzie w tym pliku ani w repo nie zapisuję
faktycznej wartości sekretu — celowo.

## Cel

Skonfigurować podpisywanie kodu (code signing) instalatora `.exe` (NSIS,
electron-builder) przez usługę **Azure Artifact Signing** (dawniej Trusted
Signing), tak żeby `Get-AuthenticodeSignature` zwracał `Valid`, a
`SignerCertificate` wskazywał na Kancelarię Radcy Prawnego K-Law Alan
Kolkowski. To zamyka bramki `C-WIN-2`/`C-WIN-4` z `SECURITY-CHECKLIST.md`.

## 1. Założenie konta Azure

- Zalogowanie się istniejącym, prywatnym kontem Microsoft do Entra ID dawało
  błąd: *„Wybrany użytkownik nie istnieje w dzierżawie Microsoft Services"*
  (AADSTS50020/16000). To oczekiwane zachowanie dla osobistych kont MSA bez
  własnego katalogu (tenanta) — nie błąd, tylko brak konta Azure.
- Rozwiązanie: założono **nową subskrypcję Azure** na e-mail
  `alankolkowski@gmail.com`.
- Typ konta przy zakładaniu subskrypcji: **„For use in connection with an
  organization, university, research group, NGO"** (= Organization, nie
  Individual) — wymagane, bo tylko billing typu Organization pozwala na
  walidację tożsamości organizacji (Kancelaria jako JDG kwalifikuje się mimo
  że to osoba fizyczna prowadząca działalność).
- Po drodze błąd **„You are not eligible for an Azure subscription"** —
  rozwiązany poprawą danych profilu Microsoft (adres, telefon) na
  [account.microsoft.com](https://account.microsoft.com/) i upewnieniem się,
  że kraj adresu karty płatniczej zgadza się z krajem wybranym w „About you"
  (Polska). Adres karty **nie musi** być identyczny z adresem Kancelarii —
  musi się zgadzać z rekordami banku dla tej karty (użyto adresu prywatnego).
- Plan wsparcia technicznego: wybrano **darmowy** („No technical support...") —
  bez wpływu na możliwość korzystania z Artifact Signing; kwestie
  subskrypcji/rozliczeń są obsługiwane w ramach darmowego Basic Support
  niezależnie od tego wyboru.
- Wynik: Subskrypcja **„Azure subscription 1"**, Subscription ID
  `e2bc6bfd-aa1b-460f-a593-788e91464283`.

## 2. Zasoby Artifact Signing

| Zasób | Wartość |
|---|---|
| Grupa zasobów | `ParagrafiPrompt` |
| Konto Artifact Signing | `kolkowskicodesign` |
| Region | Poland Central (`https://plc.codesigning.azure.net`) |
| Deployment (pierwsze utworzenie konta) | `CreateAccount-20260710203029` |

Dostawca zasobów `Microsoft.CodeSigning` zarejestrowany (Subskrypcje →
Dostawcy zasobów → Register).

## 3. Weryfikacja tożsamości (Identity validation)

- Ścieżka: **Organization → New Identity → Public**.
- Wymagana rola do odblokowania przycisku „New identity": **Artifact Signing
  Identity Verifier**, przypisana na koncie Artifact Signing przez Access
  control (IAM) → Add role assignment → wyszukanie samego siebie.
- Dane wniosku:
  - Organization Name: **Kancelaria Radcy Prawnego K-Law Alan Kolkowski**
    (dokładnie jak w CEIDG).
  - Website url: **`https://kolkowski.pl`** (wersja kanoniczna, bez „www" —
    sprawdzone w przeglądarce, że to ona jest docelowa).
  - Primary/Secondary Email: dwa różne adresy w domenie **kolkowski.pl**
    (nie gmail) — konieczne, bo Microsoft wysyła tam linki weryfikacyjne
    ważne 7 dni.
  - Business Identifier: NIP Kancelarii.
  - Adres: Piekary 33, Toruń, woj. kujawsko-pomorskie, PL.
  - First/Last Name: dane Alana Kolkowskiego jak w dokumencie tożsamości.
  - Przejście przez Verified ID (partner AU10TIX): skan dowodu, skan twarzy,
    wirtualne ID w Microsoft Authenticator.
- **Napotkany, wyczerpująco przetestowany problem**: link weryfikacji e-mail
  zwracał komunikat **„The request is blocked."** z ID w stylu
  `20260711T180818Z-177bb68489b5w9h6hC1WAWn9pn00000006gg000000001aza`.
  Sprawdzone bez skutku na: MS Edge/Chrome, PC/Android, tryb normalny i
  incognito, WiFi i dane komórkowe — zawsze ten sam błąd. Zidentyfikowano to
  jako znany, udokumentowany na Microsoft Q&A twardy blok po stronie
  zewnętrznego dostawcy weryfikacji tożsamości Microsoftu (reguły
  geo/tenant/ryzyka), niemożliwy do obejścia samoobsługowo — jedyna
  udokumentowana ścieżka to zgłoszenie do Azure Support z podaniem ID błędu,
  Subscription ID i Tenant ID, z prośbą o „manual reset / re-trigger identity
  verification". **W tym przypadku zgłoszenie do supportu nie było ostatecznie
  potrzebne** — weryfikacja przeszła mimo błędu (być może blok dotyczył tylko
  konkretnego kliknięcia/sesji, nie całego procesu).
- Status końcowy: e-mail „Validation Pass" → w portalu status **Zakończono
  (Completed)**.
- **Identity Validation ID: `3ec26312-e243-4061-af00-ce6b748bcc79`**.

## 4. Profil certyfikatu

- Nazwa: **`klawcodesigningprofile`**.
- Typ: **Public Trust**. Program Type: **None** (dotyczy tylko programu
  Windows Endpoint Security Platform — nie nasz przypadek).
- Verified CN and O → wskazuje na walidację `3ec26312-...`.
- Potwierdzony Subject (dokładnie z ekranu certyfikatu):
  ```
  CN=Kancelaria Radcy Prawnego K-Law Alan Kolkowski, O=Kancelaria Radcy Prawnego K-Law Alan Kolkowski, L=Toruń, S=Kujawsko-pomorskie, C=PL
  ```
- **Uwaga (nie błąd)**: certyfikat pokazuje krótki okres ważności (np. „aktywny
  do" za ~3 dni). To normalne — Artifact Signing wystawia krótkotrwałe
  certyfikaty podpisujące, automatycznie rotowane przy każdym podpisywaniu;
  ważność samego podpisu utrzymuje się dzięki znakowaniu czasem (RFC 3161,
  `timestamp.acs.microsoft.com`).

## 5. Service principal (do podpisywania z linii poleceń / CI)

- Utworzony przez **Microsoft Entra ID → Rejestracje aplikacji → Nowa
  rejestracja** (⚠️ NIE „Aplikacje dla przedsiębiorstw" — to inna, osobna
  kategoria, do zarządzania gotowymi aplikacjami, nie do tworzenia nowej
  tożsamości; „Rejestracje aplikacji" to osobna pozycja w menu Entra ID, nie
  jest dostępna przez przycisk „Dodaj" na stronie Użytkownicy).
- Nazwa: `klaw-anonimizator-signing`.
- **Application (client) ID: `20d14414-2990-41fd-898a-9e9fb8c620cc`**
- **Directory (tenant) ID: `98593fce-35dc-4dd4-a05c-52007de481e0`**
- Client secret: utworzony (Certyfikaty i klucze tajne → Nowy klucz tajny
  klienta) — **wartość NIE jest zapisana w tym pliku** (patrz ostrzeżenie na
  górze — trzeba go zrotować, bo został przypadkiem wklejony w terminalu).
- Rola **Artifact Signing Certificate Profile Signer** przypisana temu
  service principalowi, w zakresie profilu certyfikatu
  `klawcodesigningprofile` (Access control (IAM) na profilu → Add role
  assignment → Members → wyszukanie po nazwie wyświetlanej
  `klaw-anonimizator-signing` — czasem trzeba wpisać nazwę ręcznie, bo
  autouzupełnianie nie pokazuje świeżo utworzonej rejestracji od razu).

## 6. Konfiguracja w repo

### `electron-builder.yml`

Sekcja `win:` (był tam tylko zakomentowany placeholder `signtoolOptions`),
docelowo:

```yaml
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
  azureSignOptions:
    endpoint: "https://plc.codesigning.azure.net" # Poland Central
    codeSigningAccountName: "kolkowskicodesign"
    certificateProfileName: "klawcodesigningprofile"
    publisherName: "Kancelaria Radcy Prawnego K-Law Alan Kolkowski"
```

`publisherName` jest **wymagane** w electron-builder 26.x (w 25.x było
opcjonalne) — musi zgadzać się dokładnie z CN na certyfikacie (patrz sekcja 4).

### `package.json`

- `electron-builder` zaktualizowany z `^25.1.8` na **`^26.8.1`** (faktycznie
  zainstalowana wersja po `npm install`: **26.15.3**).
- Brak pola `engines` — projekt nie wymusza konkretnej wersji Node.
- Skrypt budowania: `desktop:build` = `desktop:verify-models &&
  desktop:build:renderer && electron-builder --config electron-builder.yml`.
- Plik wynikowy: `release\LokalnyAnonimizator-Setup-0.1.0.exe`.

## 7. Problemy środowiskowe (niezwiązane z Azure) — napotkane i naprawione

1. **`npm` przestało działać globalnie**: `Cannot find module
   '...npm\node_modules\npm\bin\npm-cli.js'`, mimo że `node -v` działało
   (`v22.0.0`). Diagnoza: `where npm` w PowerShellu to alias na
   `Where-Object` (nie pokazuje nic sensownego) — trzeba użyć **`where.exe
   npm`** albo `Get-Command npm -All`. Naprawa: reinstalacja/naprawa Node.js
   przez oficjalny instalator z nodejs.org (wybrano **Repair** po
   komunikacie „plik jest otwarty" podczas instalacji — trzeba było zamknąć
   inne okna/procesy trzymające pliki). Finalnie zainstalowany **Node
   24.18.0 / npm 11.16.0** (świadomie NIE najnowsze 26.5.0 „Current"/nie-LTS,
   ze względu na zależności natywne projektu — `onnxruntime-node`,
   `@napi-rs/canvas` — bezpieczniej na LTS; i tak brak `engines` w
   package.json, więc 22 vs 24 bez znaczenia dla samego projektu).
2. Nowe okno PowerShell czasem otwiera się w `C:\Windows\system32` — zawsze
   `cd` do folderu projektu przed komendami.
3. `$env:AZURE_*` żyją tylko w danej sesji PowerShell — trzeba je ustawiać na
   nowo w KAŻDYM nowym oknie, tuż przed `npm run desktop:build`.

## 8. Bugi w electron-builder — napotkane i naprawione

1. **electron-builder 25.1.8**: przy budowaniu polecenia PowerShell dla Azure
   Trusted Signing (`Invoke-TrustedSigning`) biblioteka NIE otaczała
   cudzysłowem wartości ze spacjami. Objawy (dwa warianty tego samego buga):
   - Z `publisherName: "Kancelaria Radcy Prawnego K-Law Alan Kolkowski"`:
     `Invoke-TrustedSigning : Cannot process argument transformation on
     parameter 'FilesFolderDepth'. Cannot convert value "K-Law" to type
     "System.Int32"` — słowo „K-Law" z nazwy organizacji wylądowało jako
     osobny token na niepowiązanym parametrze.
   - Po usunięciu `publisherName` jako obejścia: ten sam błąd przeniósł się
     na ścieżkę pliku (`kopia repo pii` w ścieżce projektu) — słowo „repo"
     wylądowało na tym samym parametrze `FilesFolderDepth`.
   - Przyczyna potwierdzona w GitHub issues electron-buildera (#8606, #8612,
     #8631): poprawka cudzysłowowania dla Azure Trusted Signing weszła
     dopiero w serii **26.0.0-alpha** (alpha.4), nie w żadnym wydaniu 25.x.
   - **Naprawa: aktualizacja `electron-builder` do `^26.8.1`** (zainstalowane:
     26.15.3) w `package.json`.
2. **Po aktualizacji do 26.15.3**: nowy błąd walidacji schematu:
   `configuration.win.azureSignOptions should be one of these: null` /
   `configuration.win should be a null`. Przyczyna: w 26.x `publisherName`
   stało się polem **wymaganym** w schemacie `azureSignOptions` (wcześniej
   nieegzekwowane) — a zostało usunięte jako wcześniejsze obejście.
   **Naprawa: przywrócono `publisherName`** w `electron-builder.yml`.
3. **Po przywróceniu `publisherName` na 26.15.3**: build przeszedł krok
   walidacji i krok pakowania; polecenie `Invoke-TrustedSigning` w logu jest
   już **poprawnie zacytowane** (każda wartość w apostrofach, łącznie ze
   ścieżką ze spacjami) — **ten problem jest w pełni zamknięty**.

## 9. Bloker instalacji `sign` (brak .NET SDK) – ✅ ROZWIĄZANY 2026-07-11

**Rozwiązanie: zainstalowano .NET SDK 8.0.422 przez winget. Pełny przebieg
naprawy oraz dalsze pułapki i wynik końcowy – w sekcjach 13–16 niżej. Poniższy
opis zachowany jako zapis pierwotnej diagnozy.**

Po poprawnym zbudowaniu i próbie podpisania, moduł PowerShell `TrustedSigning`
(wersja lokalna `0.5.8`, ścieżka
`C:\Users\alan1\Documents\WindowsPowerShell\Modules\TrustedSigning\0.5.8\`)
przy pierwszym użyciu próbuje doinstalować wymagane zależności:

- `Microsoft.Windows.SDK.BuildTools 10.0.26100.4188`
- `Microsoft.Trusted.Signing.Client 1.0.95`
- `sign 0.9.1-beta.24469.1` ← **tu się wywala**

Pełny komunikat błędu:

```
The command could not be loaded, possibly because:
  * You intended to execute a .NET application:
      The application 'tool' does not exist.
  * You intended to execute a .NET SDK command:
      No .NET SDKs were found.
Download a .NET SDK:
https://aka.ms/dotnet-download
Failed to install package: sign 0.9.1-beta.24469.1
```

**Diagnoza**: pakiet `sign` to narzędzie typu **dotnet global tool** — jego
instalacja wymaga zainstalowanego **.NET SDK** (nie samego runtime). Na tej
maszynie .NET SDK nie jest zainstalowany (albo jest tylko runtime).

**Zaplanowana naprawa (NIE jeszcze potwierdzona jako działająca)**:

1. Pobrać i zainstalować **.NET SDK** (najnowsza wersja LTS) ze strony
   [dotnet.microsoft.com/download](https://dotnet.microsoft.com/download) —
   koniecznie **SDK**, nie „Runtime" ani „ASP.NET Core Runtime".
2. Zamknąć wszystkie okna terminala, otworzyć nowe.
3. Sprawdzić `dotnet --version` (powinno zwrócić numer wersji SDK).
4. Powtórzyć build (patrz sekcja 10 — pełna komenda).
5. Jeśli nadal błąd przy instalacji pakietu `sign` — sprawdzić, czy problem
   nie leży w konfiguracji źródeł NuGet (`nuget.org` musi być osiągalne,
   log pokazuje `Found existing package source: https://www.nuget.org/api/v2/`)
   albo czy firewall/proxy nie blokuje pobierania z NuGet.

## 10. Kanoniczna komenda do budowania i weryfikacji

Zawsze w JEDNYM oknie PowerShell, jednym blokiem:

```powershell
cd "C:\Users\alan1\Desktop\Kancelaria\szkolenia AI\Lokalny anonimizator\kopia repo pii"
$env:AZURE_TENANT_ID = "98593fce-35dc-4dd4-a05c-52007de481e0"
$env:AZURE_CLIENT_ID = "20d14414-2990-41fd-898a-9e9fb8c620cc"
$env:AZURE_CLIENT_SECRET = "<nowa wartość sekretu po rotacji — patrz ostrzeżenie na górze>"
npm run desktop:build
Get-AuthenticodeSignature "release\LokalnyAnonimizator-Setup-0.1.0.exe" | Format-List *
```

Oczekiwany wynik sukcesu: `Status: Valid`, `SignerCertificate` wskazujący na
CN „Kancelaria Radcy Prawnego K-Law Alan Kolkowski".

Opcjonalnie (nieobowiązkowe, wymaga zainstalowanego Windows SDK/`signtool.exe`
w PATH, co nie było jeszcze potwierdzone na tej maszynie):
```powershell
signtool verify /pa /v "release\LokalnyAnonimizator-Setup-0.1.0.exe"
```

## 11. Drobne, nieszkodliwe komunikaty z logu buildu (dla porządku, nie błędy)

- `npm warn deprecated rimraf@2.6.3` — nieszkodliwe ostrzeżenie zależności.
- `npm warn allow-scripts` (lista pakietów z install scripts) — informacyjne,
  nie blokuje builda.
- `[assert-no-remote-urls]` — własny mechanizm bezpieczeństwa projektu
  (SECURITY.md §3, §6), potwierdza brak zdalnych zasobów w runtime; martwe
  stringi CDN w bundlu to nieaktywne gałęzie fallbacku, blokowane i tak przez
  runtime.
- `unable to find pwsh.exe, falling back to powershell.exe` — electron-builder
  woli PowerShell 7, ale Windows PowerShell 5.1 też działa.
- `duplicate dependency references` — informacyjne, dotyczy struktury
  node_modules, nie blokuje builda.

## 12. Co zostaje do zrobienia po naprawieniu .NET SDK

1. Potwierdzić `Get-AuthenticodeSignature` → `Valid`.
2. (Opcjonalnie) `signtool verify /pa /v ...`.
3. Sprawdzić bramki `C-WIN-2` / `C-WIN-4` w `SECURITY-CHECKLIST.md` → PASS.
4. Świeża instalacja z podpisanego `.exe` nie powinna wywoływać ostrzeżenia
   SmartScreen (reputacja narasta z czasem/pobraniami — pierwsze ostrzeżenie
   może się jeszcze pojawić, to nie oznacza błędu podpisu).
5. Zaktualizować `docs/code-signing-azure-progress.md` i ten plik o wynik.
6. Rozważyć zrotowanie client secret (patrz ostrzeżenie na górze pliku), jeśli
   jeszcze nie zrobione.

## 13. Rozwiązanie blokera .NET SDK (2026-07-11)

- **Diagnoza potwierdzona**: `dotnet --list-sdks` → puste; `dotnet --list-runtimes`
  pokazywał wyłącznie runtime `Microsoft.NETCore.App 6.0.16` i
  `Microsoft.WindowsDesktop.App 6.0.16`. Komenda `dotnet` istniała (host w
  `C:\Program Files\dotnet\`), ale żadnego SDK — dokładnie jak w sekcji 9.
- **Wybór wersji**: .NET **8** SDK (nie 10). Powód: pakiet `sign 0.9.1-beta.24469.1`
  jest narzędziem `dotnet global tool` targetującym **net8.0** — potwierdzone w
  samym module: `…\TrustedSigning\0.5.8\NugetInstall\NugetInstall.psm1`,
  `Get-SignCliPackageInfo` → `ContentPath = "tools\net8.0\any"`. .NET 8 SDK
  dostarcza równocześnie środowisko do instalacji narzędzia i runtime 8.0 do
  jego uruchomienia. .NET 10 odrzucony, bo narzędzie net8.0 mogłoby nie
  wystartować na samym runtime 10 (roll-forward przez główną wersję nie jest
  domyślny).
- **Instalacja**:
  ```powershell
  winget install --id Microsoft.DotNet.SDK.8 -e --accept-source-agreements --accept-package-agreements --disable-interactivity
  ```
  Wynik: **Microsoft .NET SDK 8.0.422** (`dotnet-sdk-8.0.422-win-x64.exe`, hash
  zweryfikowany przez winget). Instalacja per-machine do `C:\Program Files\dotnet\`
  (może wywołać monit UAC).
- **Weryfikacja**: `dotnet --version` → `8.0.422`; `dotnet --list-sdks` →
  `8.0.422 [C:\Program Files\dotnet\sdk]`; `dotnet --list-runtimes` pokazuje
  teraz `Microsoft.NETCore.App 8.0.28` i `Microsoft.WindowsDesktop.App 8.0.28`
  obok starego 6.0.16. `dotnet.exe` (host) się nie zmienia, więc SDK jest
  wykrywane bez modyfikacji PATH.
- **Potwierdzenie naprawy w izolacji** (bez sekretu Azure — czysta operacja
  `dotnet tool`): odtworzenie polecenia modułu do katalogu tymczasowego:
  ```powershell
  dotnet tool install sign --version 0.9.1-beta.24469.1 --tool-path <temp> --add-source "https://www.nuget.org/api/v2/"
  ```
  → **exit 0**, „Pomyślnie zainstalowano narzędzie »sign«". Bloker „No .NET SDKs
  were found" zniknął.
- **Ważna obserwacja o źródłach NuGet**: bez `--add-source` to samo polecenie
  zwraca **`No NuGet sources are defined or enabled`** — na tej maszynie dotnet
  CLI nie ma domyślnie włączonego nuget.org. Nie jest to problem, bo moduł
  `TrustedSigning` przekazuje własne źródło: `Get-NugetV2PackageSource`
  (`NugetInstall.psm1`) znajduje istniejące źródło PackageManagement o lokacji
  `https://www.nuget.org/api/v2/` (feed **v2**) i podaje je jako `--add-source`.
  Feed v2 działa z `dotnet tool install` na tej maszynie (potwierdzone wyżej).
- **Jak moduł instaluje zależności** (dla pamięci): `NugetInstall.psm1`,
  `Get-EveryDependency`. Build tools (`Microsoft.Windows.SDK.BuildTools
  10.0.26100.4188`) i `Microsoft.Trusted.Signing.Client 1.0.95` instalowane przez
  `Install-Package` (PackageManagement) — dlatego były już w cache
  `%LOCALAPPDATA%\TrustedSigning\` z wcześniejszej próby. `sign` instalowany
  osobno przez `Install-NugetToolPackage` (`dotnet tool install … --tool-path
  %LOCALAPPDATA%\TrustedSigning\sign --add-source <v2>`), potem przenoszony z
  `.store` i `sign.exe` usuwany. To ten jeden krok wymagał .NET SDK.

## 14. Pułapka: nieważny (stary) client secret → AADSTS7000215 (2026-07-11)

Po naprawie SDK build przeszedł **wszystkie** etapy poza ostatnim: `verify-models`,
`build:renderer`, pakowanie, instalację `sign` CLI podczas builda
(`Sign CLI package installed: False → Installing package: sign 0.9.1-beta.24469.1`,
bez błędu — potwierdzenie naprawy w realnym buildzie) oraz uruchomienie
`signtool.exe`, który połączył się z Azure. Padło dopiero uwierzytelnianie:

```
SignTool Error: An unexpected internal error has occurred.
Azure.Identity.AuthenticationFailedException: ClientSecretCredential authentication failed
  MsalServiceException ErrorCode: invalid_client
  AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in
  the request is the client secret value, not the client secret ID, for a secret
  added to app '20d14414-2990-41fd-898a-9e9fb8c620cc'.
```

- **Przyczyna**: użyto **starego** client secret, który w międzyczasie został
  **unieważniony rotacją** (usunięcie starego klucza w Entra ID → Rejestracje
  aplikacji → `klaw-anonimizator-signing` → Certyfikaty i klucze tajne).
- **To NIE był problem value-vs-ID**, mimo co sugeruje treść błędu: wysłano
  40-znakową **wartość** sekretu, nie GUID identyfikatora. Sekret był po prostu
  martwy (usunięty).
- **Rozwiązanie**: użyć wartości **aktualnego** (nowego) klucza. Wartość client
  secret jest widoczna w Azure tylko raz, tuż po utworzeniu — po odświeżeniu
  strony znika i trzeba utworzyć nowy klucz.
- **Wniosek operacyjny**: przy rotacji do builda używaj wartości NOWEGO klucza;
  stary po usunięciu przestaje działać natychmiast.

## 15. Pułapka: wklejanie sekretu do `Read-Host -AsSecureString` (2026-07-11)

Żeby sekret nie trafił do historii terminala, pliku ani czatu, jednym z
podejść był skrypt pytający o sekret przez `Read-Host -AsSecureString`. Okazało
się to zawodne w konsoli Windows:

- Wklejenie sekretu do **maskowanego** pola przyjęło **tylko pierwszy znak**
  (jedna gwiazdka). Efekt: 1-znakowy sekret → `AADSTS7000215` →
  `Get-AuthenticodeSignature` = `NotSigned`. To znany problem conhost/PSReadLine
  z wklejaniem do promptu SecureString.
- **Metoda, która zadziałała** (bez ręcznego przepisywania sekretu): zmontować
  pełną komendę w **Notatniku** — tam wklejanie działa normalnie i wartość jest
  widoczna, więc nie ma pomyłki — z sekretem w **apostrofach** `'...'`
  (literał w PowerShell, bezpieczny dla znaku `~` występującego w sekretach
  Azure), a potem wkleić **całość** do PowerShell:
  ```powershell
  Set-Location "…\kopia repo pii"
  $env:AZURE_TENANT_ID = "98593fce-35dc-4dd4-a05c-52007de481e0"
  $env:AZURE_CLIENT_ID = "20d14414-2990-41fd-898a-9e9fb8c620cc"
  $env:AZURE_CLIENT_SECRET = 'WARTOSC_NOWEGO_SEKRETU'
  npm run desktop:build
  Get-AuthenticodeSignature "release\LokalnyAnonimizator-Setup-0.1.0.exe" | Format-List *
  ```
- **Kompromis bezpieczeństwa tej metody**: sekret ląduje w historii PowerShell
  (plik PSReadLine `ConsoleHost_history.txt`) i na ekranie — lokalnie, nie w
  repo ani w czacie. Dlatego po podpisaniu **wskazana jest rotacja** client
  secret (patrz ostrzeżenie na górze pliku i sekcja 16).

## 16. ✅ WYNIK KOŃCOWY (2026-07-11) — podpis `Valid`

`Get-AuthenticodeSignature "release\LokalnyAnonimizator-Setup-0.1.0.exe"`:

- **Status: `Valid`**, StatusMessage: „Signature verified."
- **SignerCertificate Subject**: `CN=Kancelaria Radcy Prawnego K-Law Alan
  Kolkowski, O=Kancelaria Radcy Prawnego K-Law Alan Kolkowski, L=Toruń,
  S=Kujawsko-pomorskie, C=PL`
- **Thumbprint**: `CADF7EB750A14953885D0069493E2CEEA6C9317B`
- **Wystawca**: `CN=Microsoft ID Verified CS AOC CA 04, O=Microsoft Corporation,
  C=US` (Azure Artifact Signing)
- Certyfikat podpisujący ważny **11–14.07.2026** (krótkotrwały, zgodnie z sekcją 4).
- **TimeStamperCertificate**: `CN=Microsoft Public RSA Time Stamping Authority`
  (RFC 3161) — znakowanie czasem utrwala ważność podpisu mimo krótkiego życia
  certyfikatu podpisującego.

Zamknięcia:

- Bloker **B4 zamknięty**.
- `SECURITY-CHECKLIST.md`: `C-WIN-2` → **PASS**, `C-WIN-4` → **PASS (żywa
  weryfikacja SmartScreen niewykonana)**, werdykt bramki zaktualizowany
  (wszystkie B1–B4 zamknięte).
- **Do zrobienia po fakcie**: **rotacja `AZURE_CLIENT_SECRET`** (był w historii
  PowerShell, a wcześniej także w czacie) — patrz ostrzeżenie na górze pliku.
- **Opcjonalne testy ręczne przed dystrybucją**: żywa instalacja z monitem UAC
  do `%ProgramFiles%` (C-WIN-1), zachowanie SmartScreen przy pierwszej realnej
  dystrybucji (C-WIN-4 — reputacja certyfikatu OV narasta z czasem/pobraniami).
