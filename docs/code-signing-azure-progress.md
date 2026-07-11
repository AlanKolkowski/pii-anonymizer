# Podpis kodu przez Azure Artifact Signing — postęp wdrożenia (bloker B4)

Notatka robocza śledząca faktyczny stan wdrożenia opisanego w
[`code-signing-azure.md`](./code-signing-azure.md). Uzupełniaj w miarę postępu.

## Dane zasobów Azure

| Element | Wartość | Status |
|---|---|---|
| Subskrypcja (Subscription ID) | `e2bc6bfd-aa1b-460f-a593-788e91464283` (Azure subscription 1) | ✅ założona (pay-as-you-go, Organization) |
| Grupa zasobów | `ParagrafiPrompt` | ✅ utworzona |
| Konto Artifact Signing — nazwa | `kolkowskicodesign` | ✅ konto utworzone (deployment `CreateAccount-20260710203029`) |
| Region | Poland Central (zakładane, do potwierdzenia) | — |
| Weryfikacja tożsamości — Organization | ID `3ec26312-e243-4061-af00-ce6b748bcc79` | ✅ **Zakończono (Completed)** |
| Nazwa organizacji na certyfikacie | Kancelaria Radcy Prawnego K-Law Alan Kolkowski | ✅ zweryfikowana |
| Strona WWW podana w walidacji | `https://kolkowski.pl` | ✅ |
| Profil certyfikatu — nazwa | `klawcodesigningprofile` | ✅ utworzony, aktywny (krótkotrwały certyfikat podpisujący — rotowany automatycznie, to normalne) |
| Certyfikat — Subject (CN/O) | `CN=Kancelaria Radcy Prawnego K-Law Alan Kolkowski, O=Kancelaria Radcy Prawnego K-Law Alan Kolkowski, L=Toruń, S=Kujawsko-pomorskie, C=PL` | ✅ potwierdzony na ekranie profilu |
| Region konta | Poland Central (`https://plc.codesigning.azure.net`) | ✅ potwierdzony |
| Rejestracja aplikacji (service principal) — Application (client) ID | `20d14414-2990-41fd-898a-9e9fb8c620cc` | ✅ utworzona |
| Rejestracja aplikacji — Directory (tenant) ID | `98593fce-35dc-4dd4-a05c-52007de481e0` | ✅ |
| Rola **Artifact Signing Certificate Profile Signer** | przypisana `klaw-anonimizator-signing` na profilu `klawcodesigningprofile` | ✅ przypisana |
| Client secret | **nie zapisany tutaj** — trzymać wyłącznie w menedżerze haseł / jako zmienna środowiskowa maszyny budującej | ⚠️ **do rotacji** – użyty do udanego podpisu 2026-07-11, ale trafił do historii PowerShell i wcześniej do czatu; wygenerować nowy w Entra ID i unieważnić obecny |
| `electron-builder.yml` — `win.azureSignOptions` | wpięte (endpoint, codeSigningAccountName, certificateProfileName, publisherName) | ✅ zrobione |

## Do zrobienia dalej

Wszystkie kroki wdrożenia podpisu wykonane 2026-07-11 – instalator podpisany,
`Get-AuthenticodeSignature` → **Valid** (pełny przebieg:
[`code-signing-azure-session-log.md`](./code-signing-azure-session-log.md)
sekcje 13–16). Status pozycji:

1. ✅ Client secret utworzony i użyty do udanego podpisu. **Pozostaje: rotacja**
   (obecny trafił do historii PowerShell i wcześniej do czatu – wygenerować nowy
   w Entra ID, unieważnić obecny; patrz ostrzeżenie na górze logu sesji).
2. ✅ `publisherName` przywrócony w `electron-builder.yml` (wymagany w
   electron-builder 26.x) i build z nim przechodzi – podpis `Valid`. Aktualizacja
   `electron-builder` do 26.15.3 zamknęła bug cudzysłowowania; kwestia „bez
   `publisherName`" jest już nieaktualna.
3. ✅ Zbudowano i zweryfikowano:
   ```powershell
   Get-AuthenticodeSignature "release\LokalnyAnonimizator-Setup-0.1.0.exe"
   # Status: Valid; Signer: CN=Kancelaria Radcy Prawnego K-Law Alan Kolkowski
   ```
   Bramki `C-WIN-2` → **PASS**, `C-WIN-4` → **PASS (żywa weryfikacja SmartScreen
   niewykonana)** w `SECURITY-CHECKLIST.md`. `signtool verify /pa /v` opcjonalny
   (wymaga `signtool.exe` w PATH; podpis potwierdzony już przez
   `Get-AuthenticodeSignature`).

## Napotkane i rozwiązane problemy (dla pamięci)

- Logowanie osobistym kontem Microsoft do Entra → błąd „nie istnieje w dzierżawie
  Microsoft Services" — oczekiwane dla kont prywatnych bez własnego tenanta;
  rozwiązane przez założenie nowej subskrypcji Azure (typ Organization) na
  `alankolkowski@gmail.com`.
- „You are not eligible for an Azure subscription" — rozwiązane po poprawie
  danych adresowych/karty przy ponownej rejestracji.
- Przycisk „New identity" wyszarzony — brak roli **Artifact Signing Identity
  Verifier** na koncie Artifact Signing; nadana przez Access control (IAM) na
  zasobie.
- Link weryfikacji e-mail zwracał „The request is blocked" (błąd niezależny od
  przeglądarki/sieci/urządzenia, testowane wyczerpująco) — ostatecznie
  weryfikacja i tak przeszła (status „Validation Pass" → „Zakończono"), bez
  potrzeby zgłoszenia do Azure Support.
- `npm` przestało działać globalnie po stronie systemu (`Cannot find module
  ...npm\node_modules\npm\bin\npm-cli.js`) — niezwiązane z Azure; naprawione
  reinstalacją/naprawą Node.js (finalnie Node 24.18.0 / npm 11.16.0, zamiast
  pierwotnego Node 22 — bez znaczenia, projekt nie ma wymogu `engines`).
- Pierwszy build z pełnym `azureSignOptions` (z `publisherName`) rzucił błędem
  `Invoke-TrustedSigning : Cannot process argument transformation on parameter
  'FilesFolderDepth'...`. Przyczyna: electron-builder 25.1.8 buduje polecenie
  PowerShell dla Azure Trusted Signing bez cudzysłowu wokół wartości ze
  spacjami. Po usunięciu `publisherName` błąd wrócił w tym samym miejscu, tym
  razem przez spacje w samej ścieżce projektu („szkolenia AI", „kopia repo
  pii") — czyli to ogólniejszy bug cudzysłowowania w 25.1.8, nie tylko
  `publisherName`. Naprawione upstream w electron-builder dopiero w serii
  26.0.0 (PR #8606/#8631). **Zaktualizowano `electron-builder` do `^26.8.1`**
  w `package.json` — `npm install` pobrał `26.15.3`.
- Po aktualizacji: błąd walidacji schematu — w 26.x `publisherName` stał się
  polem **wymaganym** w `azureSignOptions` (wcześniej opcjonalne). Przywrócono
  `publisherName: "Kancelaria Radcy Prawnego K-Law Alan Kolkowski"` w
  `electron-builder.yml`.
- ✅ **Potwierdzone: problem z cudzysłowowaniem/spacjami jest rozwiązany** na
  electron-builder 26.15.3 — polecenie `Invoke-TrustedSigning` w logu ma teraz
  poprawnie zacytowane wszystkie wartości, łącznie ze ścieżką ze spacjami.
- Nowa, osobna przeszkoda: `TrustedSigning` (moduł PowerShell) próbuje przy
  pierwszym użyciu zainstalować narzędzie `sign` (dotnet tool), co wymaga
  zainstalowanego **.NET SDK** (nie samego runtime) — brak SDK na maszynie.
  ✅ **Naprawione (2026-07-11)**: `winget install --id Microsoft.DotNet.SDK.8`
  → .NET SDK **8.0.422** (wybór 8, bo `sign 0.9.1-beta.24469.1` targetuje
  `net8.0`). Po tym build podpisał instalator, `Get-AuthenticodeSignature` →
  **Valid**.
- Po naprawie SDK wyszły jeszcze dwie pułapki (pełny opis w logu sesji, sekcje
  14–15): (a) **stary, unieważniony rotacją client secret** → `AADSTS7000215:
  Invalid client secret provided` (rozwiązanie: użyć wartości nowego klucza);
  (b) **wklejanie sekretu do `Read-Host -AsSecureString`** w konsoli Windows
  bierze tylko pierwszy znak → podpis `NotSigned` (rozwiązanie: zmontować
  komendę z sekretem w apostrofach w Notatniku i wkleić całość do PowerShell).
