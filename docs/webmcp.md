# WebMCP — konfiguracja i użycie

pii.tools udostępnia dokumenty agentowi przez WebMCP bez wysyłania jawnych danych osobowych do LLM. Przez MCP przechodzą wyłącznie teksty w formie tokenów, np. `[PERSON_NAME_1]`, oraz nazwy dokumentów (`label`), które są syntetyczne (np. „Źródło 1") albo jawnie udostępnione przez użytkownika — nigdy surowe nazwy plików. Źródła, w których pipeline nie wykrył żadnej encji, nie są udostępniane przez MCP, bo tokenizacja byłaby identyczna z oryginalnym tekstem. Legenda oraz deanonimizacja zostają w przeglądarce użytkownika.

## Szybki start: Claude Desktop

### 1. Skonfiguruj WebMCP w Claude Desktop

Otwórz terminal i uruchom jednorazowo komendę:

- **macOS:** aplikacja Terminal.
- **Windows:** PowerShell albo Windows Terminal z menu Start.

```bash
npx -y @jason.today/webmcp@latest --config claude
```

Ta sama komenda działa na macOS i Windowsie. Następnie zrestartuj Claude Desktop, żeby odczytał nową konfigurację MCP.

### 2. Jeśli `npx` nie działa

`npx` jest częścią Node.js/npm. Jeśli terminal pokazuje błąd typu „command not found” albo „not recognized”, zainstaluj **Node.js LTS** z [nodejs.org](https://nodejs.org/), otwórz nowe okno Terminala / PowerShell i uruchom komendę konfiguracji jeszcze raz.

### 3. Przygotuj dokumenty w pii.tools

1. Otwórz aplikację (`npm run dev` lokalnie albo wdrożoną stronę).
2. Dodaj jeden lub więcej dokumentów źródłowych.
3. Kliknij **Anonimizuj** i poczekaj, aż źródła będą gotowe.
4. Kliknij przycisk **Podłącz AI** w dolnym pasku narzędzia.

### 4. Wygeneruj token w Claude

W Claude Desktop poproś:

```text
Wygeneruj token WebMCP dla pii.tools
```

Claude/WebMCP powinien zwrócić token połączenia. Wklej go w widget **Podłącz AI** w pii.tools i kliknij **Połącz**. Następnie zrestartuj Claude Desktop jeszcze raz — często dopiero po tym Claude widzi narzędzia udostępnione przez stronę.

### 5. Pracuj na tokenach

Po połączeniu agent powinien:

1. wywołać `list_sources`, żeby zobaczyć gotowe źródła,
2. wywołać `read_source` dla potrzebnych dokumentów,
3. wykonać pracę na zanonimizowanym tekście,
4. zapisać wynik przez `write_outcome`, nadal w formie tokenów.

Przeglądarka pokaże użytkownikowi zdeanonimizowaną wersję outcome'u. Agent nie dostaje legendy i nie widzi jawnego PII.

## Dostępne narzędzia MCP

| Narzędzie | Argumenty | Wynik | Zastosowanie |
| --- | --- | --- | --- |
| `list_sources` | brak | JSON: `id`, `label`, `char_count` | Lista gotowych, zanonimizowanych dokumentów źródłowych; źródła bez wykrytych encji są pomijane. |
| `read_source` | `{ id }` | tekst tokenizowany albo JSON `error` | Odczyt jednego dokumentu źródłowego; zwraca błąd, jeśli nie można potwierdzić tokenizacji. |
| `list_outcomes` | brak | JSON: `id`, `label`, `char_count` | Lista wyników zapisanych przez agenta. |
| `read_outcome` | `{ id }` | tekst tokenizowany | Odczyt wcześniejszego wyniku agenta. |
| `write_outcome` | `{ id?, label, text }` | JSON: `id`, `success` albo `error` | Utworzenie albo aktualizacja wyniku w tokenach. |

`write_outcome` akceptuje zwykły tekst, ale agent powinien zachowywać tokeny z dokumentów źródłowych. Wszystko, co nie jest znanym tokenem, zostanie wyświetlone bez zmian.

## Instrukcja dla agenta

Jeśli tworzysz skill, custom instruction albo prompt systemowy dla klienta LLM, użyj poniższych zasad:

- Nie proś użytkownika o wklejenie oryginalnego dokumentu do czatu.
- Nie proś o legendę anonimizacji.
- Jeśli narzędzia WebMCP nie są dostępne, poprowadź użytkownika przez konfigurację Claude Desktop i restart klienta.
- Jeśli narzędzia są dostępne, ale nie ma połączenia z przeglądarką, poproś użytkownika o wygenerowanie tokenu WebMCP i wklejenie go w widget **Podłącz AI**.
- Najpierw użyj `list_sources`; jeśli lista jest pusta, poproś użytkownika o dodanie dokumentów i kliknięcie **Anonimizuj**. Pusta lista może też oznaczać, że w gotowych źródłach nie wykryto żadnych encji, więc aplikacja nie udostępnia ich przez MCP.
- Czytaj źródła przez `read_source` i pracuj wyłącznie na tekście tokenizowanym. Jeśli `read_source` zwróci błąd, poproś użytkownika o sprawdzenie dokumentu w przeglądarce zamiast żądać oryginalnej treści w czacie.
- Wynik zapisuj przez `write_outcome` z opisowym `label`.
- Jeżeli późniejsze kroki wymagają poprzednich wyników, użyj `list_outcomes` i `read_outcome`.
- Nie wypisuj jawnych danych osobowych w czacie. Deanonimizacja ma nastąpić tylko w przeglądarce użytkownika.

Przykładowa prośba użytkownika do agenta:

```text
Połącz się z dokumentami w pii.tools przez WebMCP. Przeczytaj źródła, przygotuj podsumowanie i zapisz wynik jako outcome. Nie proś mnie o oryginalny tekst ani legendę.
```

## Troubleshooting

### Claude nie widzi narzędzi WebMCP

- Upewnij się, że komenda `npx -y @jason.today/webmcp@latest --config claude` zakończyła się sukcesem.
- Zrestartuj Claude Desktop po konfiguracji WebMCP.
- Wygeneruj token, wklej go w widget pii.tools i kliknij **Połącz**.
- Zrestartuj Claude Desktop jeszcze raz po połączeniu strony.
- Sprawdź, czy klient MCP ma w konfiguracji serwer `webmcp`.

### `npx` nie jest rozpoznawany

- Zainstaluj Node.js LTS z [nodejs.org](https://nodejs.org/).
- Zamknij i otwórz ponownie Terminal / PowerShell.
- Uruchom komendę konfiguracji jeszcze raz.

### Widget nadal pokazuje „Rozłączono”

- Wygeneruj nowy token w Claude Desktop.
- Wklej token w widget i kliknij **Połącz**.
- Jeśli karta aplikacji była odświeżana albo minęło kilka minut bezczynności, połączenie mogło wygasnąć.

### `list_sources` zwraca pustą listę

- Dodaj dokument w pii.tools.
- Kliknij **Anonimizuj**.
- Poczekaj, aż dokument ma status gotowy.

### Agent pyta o oryginalny dokument

To błąd instrukcji agenta. Przypomnij mu, że ma używać WebMCP tools i pracować tylko na tokenach.
