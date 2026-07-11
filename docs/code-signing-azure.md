# Podpis kodu przez Azure Artifact Signing — przewodnik (bloker B4)

Praktyczny przewodnik pozyskania i wpięcia podpisu kodu dla instalatora
Windows „Lokalnego anonimizatora". Realizuje bloker **B4** z
[`SECURITY-FIXES.md`](../SECURITY-FIXES.md). Kroki techniczne pochodzą
z oficjalnego [Quickstart: Set up Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
(Microsoft Learn, akt. 2026-05) i [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq);
kroki UI portalu mogą się nieznacznie zmienić — przy rozbieżności wygrywa
dokumentacja Microsoftu.

## Dlaczego to nie łamie air-gapu

Podpis działa **przy budowaniu instalatora, na maszynie autora**, nie w
działającej aplikacji. Gotowy `.exe` u użytkownika nadal nie ma żadnego kanału
do sieci (SECURITY.md §3). Podpis to kotwica autentyczności („to naprawdę
zbudował Alan Kolkowski"), do której dowiązują się blokery integralności B1 i B3:
bez podpisu atakujący może przepakować binarkę razem z jej wewnętrznymi sumami.

## Dlaczego Azure Artifact Signing, nie EV

- **Basic: 9,99 USD/mies.** (~120 USD/rok). Klucz w chmurowym HSM Microsoftu,
  FIPS 140-2 Level 3, zero tokenów sprzętowych do pilnowania.
- **Polska się kwalifikuje**: certyfikaty Public Trust są dostępne dla
  organizacji w UE, a wśród regionów podpisu jest **Poland Central**
  (`https://plc.codesigning.azure.net`).
- **Reputacja SmartScreen** narasta automatycznie przez historię pobrań, tak
  samo jak przy EV — więc dopłata do EV nie kupuje tu realnej przewagi.
- **Integracja gotowa**: `electron-builder.yml:56-60` przewiduje już
  `azureSignOptions`.

Zastrzeżenie: Azure wydaje odpowiednik **OV**, nie EV (i nie planuje EV). Dla
narzędzia dystrybuowanego wąsko to bez znaczenia.

## ⚠ Pułapka numer jeden dla polskiej JDG: typ konta rozliczeniowego

Microsoft daje dwie ścieżki walidacji tożsamości:

| Ścieżka | Dostępność | Dla Ciebie |
|---|---|---|
| **Organization** (podmiot gospodarczy) | USA, Kanada, **UE**, UK | **TA** — Kancelaria K-Law jako podmiot |
| Individual (osoba fizyczna) | **tylko USA i Kanada** | niedostępna w Polsce |

Wniosek: musisz iść ścieżką **Organization**, a ona wymaga, żeby **konto
rozliczeniowe Azure było typu firmowego (organization), nie prywatnego**.
Microsoft wprost zabrania walidacji organizacji z konta rozliczeniowego typu
„Individual". Dlatego zakładając subskrypcję Azure, **użyj danych firmy**
(Kancelaria Radcy Prawnego K-Law Alan Kolkowski, NIP, adres z CEIDG), a nie
konta prywatnego. Dane rozliczeniowe (nazwa, adres) muszą **dokładnie** zgadzać
się z tym, co ma trafić na certyfikat. `[DO POTWIERDZENIA przy zakładaniu:
czy Twoja obecna subskrypcja Azure ma billing typu organization]`.

## Wymagania wstępne

1. **Microsoft Entra tenant** (dawniej Azure AD) — najlepiej firmowy.
2. **Płatna subskrypcja Azure** (pay-as-you-go). Trial, darmowa i sponsorowana
   są odrzucane przez usługę.
3. Dane firmy zgodne z CEIDG (nazwa podmiotu, adres, NIP/REGON).
4. Rządowy dokument tożsamości osoby reprezentującej (do Verified ID) oraz
   telefon z aplikacją Microsoft Authenticator.

## Kroki (portal Azure)

### 1. Zarejestruj dostawcę zasobów

Subskrypcje → Twoja subskrypcja → Dostawcy zasobów → `Microsoft.CodeSigning`
→ **Zarejestruj**. (CLI: `az provider register --namespace Microsoft.CodeSigning`.)

### 2. Utwórz konto Artifact Signing

Wyszukaj „Artifact Signing Accounts" → **Utwórz**. Region: **Poland Central**
(albo West/North Europe). SKU: **Basic**. Nazwa: 3–24 znaki alfanumeryczne,
zaczyna się literą.

### 3. Walidacja tożsamości — ścieżka Organization

W koncie: Identity validations → **Organization** → **New Identity** →
**Public**. Wypełnij:
- **Organization Name**: pełna nazwa podmiotu (jak w CEIDG).
- **Website url**: strona kancelarii.
- **Primary / Secondary Email**: dwa różne adresy w domenie firmy, muszą
  odbierać e-maile z linkami z zewnątrz (link ważny 7 dni).
- **Business Identifier**: identyfikator podmiotu (NIP lub REGON).
- **Adres**: adres firmy z CEIDG.
- **First/Last Name**: osoba reprezentująca (Ty), dokładnie jak w dokumencie
  tożsamości — przejdziesz przez Verified ID (partner AU10TIX: skan dokumentu,
  kod PIN na e-mail, QR, Microsoft Authenticator).

Kliknij **Certificate subject preview**, żeby zobaczyć, co znajdzie się na
certyfikacie, i dopiero potem **Create**.

**Czas: 1–20 dni roboczych** (dłużej, jeśli Microsoft poprosi o dodatkowe
dokumenty — np. wydruk z CEIDG wydany w ostatnich 12 miesiącach, dowód
rejestracji domeny na podmiot). To jest powód, żeby ruszyć teraz.

Potrzebna rola: **Artifact Signing Identity Verifier** (inaczej przycisk „New
identity" jest wyszarzony).

### 4. Utwórz profil certyfikatu

Certificate profiles → **Create** → typ **Public Trust** → wskaż zwalidowaną
tożsamość (**Verified CN and O**). Zaznacz „Include street address / postal
code", jeśli mają być na certyfikacie. **Create**.

### 5. Rola do podpisywania

Przypisz koncie/tożsamości budującej rolę **Artifact Signing Certificate
Profile Signer** (Access control / IAM na zasobie).

## Wpięcie w `electron-builder.yml` (B4)

Odkomentuj i uzupełnij `win.azureSignOptions` (endpoint regionu, nazwa konta
i profilu). Sekrety (poświadczenia service principala) **wyłącznie przez
zmienne środowiskowe**, nigdy w repo:

```yaml
win:
  azureSignOptions:
    endpoint: "https://plc.codesigning.azure.net"   # Poland Central
    codeSigningAccountName: "<nazwa-konta>"
    certificateProfileName: "<nazwa-profilu>"
    # uwierzytelnianie przez AZURE_TENANT_ID / AZURE_CLIENT_ID /
    # AZURE_CLIENT_SECRET w środowisku budowania (service principal
    # z rolą Certificate Profile Signer)
```

`[DO WERYFIKACJI: dokładna nazwa i schemat pól azureSignOptions w wersji
electron-builder z tego repo — sprawdź w changelogu przed pierwszym podpisem]`.

## Weryfikacja po podpisaniu

```powershell
Get-AuthenticodeSignature "release\Lokalny anonimizator Setup <wersja>.exe"
# Status ma być: Valid; SignerCertificate wskazuje na K-Law
signtool verify /pa /v "release\...Setup.exe"
```

Bramka `C-WIN-2` / `C-WIN-4` w `SECURITY-CHECKLIST.md` przechodzi na PASS, gdy
`Get-AuthenticodeSignature` zwraca `Valid`, a świeża instalacja nie wywołuje
ostrzeżenia SmartScreen (reputacja narasta po kilku pobraniach).

## Pułapki

- **Nie commituj** certyfikatu ani sekretów (klucz i tak jest po stronie
  Microsoftu, ale poświadczenia service principala są wrażliwe).
- **Zgodność danych**: nazwa i adres w koncie rozliczeniowym, walidacji
  tożsamości i profilu muszą być identyczne, inaczej certyfikat wyjdzie z błędną
  treścią, a poprawka wymaga nowej walidacji (kolejne dni).
- **Znaczniki czasu** (timestamp): usługa podpisuje z serwerem czasu
  `timestamp.acs.microsoft.com` — dzięki temu podpis pozostaje ważny po
  wygaśnięciu certyfikatu.
- **Ważność**: od 1 marca 2026 certyfikaty ważne ~15 miesięcy; Azure odnawia je
  automatycznie, dopóki walidacja tożsamości jest aktualna (przypomnienia na 60
  dni przed wygaśnięciem — nie przegap, inaczej podpisywanie staje).

## Źródła

- [Quickstart: Set up Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [Cennik Artifact Signing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
