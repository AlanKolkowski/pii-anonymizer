# Kompilacja SGJP → `morph-pl.json` (FL-1b, uruchomienie na PC)

Ten dokument to instrukcja dla Alana: jak na komputerze stacjonarnym (PC,
32 GB RAM) skompilować realny słownik SGJP do artefaktu
`src/verifier/morph/data/morph-pl.json`, którego używa silnik fleksji
(`src/verifier/morph/load.js` + `analyze.js` + `generate.js`,
FLEKSJA-IMPL-PLAN.md).

**Ta gałąź (`feature/sgjp-compile`) dostarcza wyłącznie narzędzie
(`scripts/compile-sgjp.mjs`) i dowód na syntetycznym fixture
(`scripts/fixtures/mini-sgjp.tab`). Nikt w tej sesji nie pobrał ani nie
skompilował realnego SGJP – to poniższy krok, wykonywany świadomie przez
Alana, poza tą gałęzią (albo na nowym commicie na tej samej gałęzi, jeśli
tak zdecydujesz).**

## 0. Zanim zaczniesz: PC, nie laptop

Zrzut SGJP po rozpakowaniu to **setki MB tekstu**. Kompilator streamuje
(czyta linia po linii, nigdy nie ładuje całego pliku do pamięci – zob.
§3 niżej), ale zgodnie z konwencją projektu (`EVAL-RECALL-AUDIT.md`,
`FLEKSJA-IMPL-PLAN.md` §8): **PC = stacjonarny (32 GB) jest zalecany**;
laptop (15,4 GB, podłoga specyfikacji 16 GB) dopuszczalny wyłącznie
świadomie i poza godzinami pracy na sprawach.

## 1. Skąd pobrać SGJP

- **Strona pobrań:** <http://download.sgjp.pl/morfeusz/> – katalogi
  oznaczone datą (np. `20260628/`). Wejdź i sprawdź, jaki jest **aktualny**
  najnowszy katalog daty – nie zakładaj, że `20260628` nadal jest
  najnowszy w dniu, w którym to czytasz.
- **Plik:** w wybranym katalogu szukaj pliku o nazwie
  `sgjp-<data>.tab.gz` (potwierdzone w `W1-W3-MORPHOLOGY-DESIGN.md` §1.1:
  na dzień 2026-07-12 był to `sgjp-20260628.tab.gz`, **41 MB** po
  spakowaniu). To zrzut danych fleksyjnych Morfeusza 2 w formacie `.tab` –
  DOKŁADNIE ten format, pod który pisany jest `compile-sgjp.mjs`.
- **Licencja u źródła:** <http://morfeusz.sgjp.pl/doc/license/> –
  deklaruje dwuklauzulową licencję BSD dla danych fleksyjnych SGJP
  (autorzy: Zygmunt Saloni, Włodzimierz Gruszczyński, Marcin Woliński,
  Robert Wołosz, Danuta Skowrońska). Otwórz tę stronę i porównaj z treścią
  wklejoną w `SGJP_LICENSE_NOTICE` (nagłówek `scripts/compile-sgjp.mjs`) –
  to jest properny **warunek bramki GATE-FLEKSJA-DANE** (checklist
  1.2.5 w `W1-W3-MORPHOLOGY-DESIGN.md`), nie formalność.

### Pobranie (ręczne – `fetch-morph-sources.mjs` z planu FL-1a NIE istnieje jeszcze)

PowerShell:

```powershell
Invoke-WebRequest -Uri "http://download.sgjp.pl/morfeusz/<data>/sgjp-<data>.tab.gz" -OutFile "scripts\.cache\morph\sgjp-<data>.tab.gz"
Get-FileHash "scripts\.cache\morph\sgjp-<data>.tab.gz" -Algorithm SHA256
```

Bash / Git Bash:

```bash
mkdir -p scripts/.cache/morph
curl -o scripts/.cache/morph/sgjp-<data>.tab.gz "http://download.sgjp.pl/morfeusz/<data>/sgjp-<data>.tab.gz"
sha256sum scripts/.cache/morph/sgjp-<data>.tab.gz
```

`scripts/.cache/` jest już w `.gitignore` – pobrany zrzut źródłowy NIE
wchodzi do repo, wchodzi wyłącznie skompilowany artefakt.

**Zapisz obliczoną sumę SHA-256 gdzieś poza pamięcią modelu** (np. w
`scripts/morph-sources.lock.json`, jeśli/gdy ten plik powstanie – na razie
`compile-sgjp.mjs` sam liczy i zapisuje sumę WEJŚCIA do
`morph-artifact.lock.json`, więc masz ją i tak w wyniku kompilacji, zob.
§3).

## 2. Uruchomienie kompilatora

```powershell
node scripts/compile-sgjp.mjs scripts\.cache\morph\sgjp-<data>.tab.gz --out=src\verifier\morph\data\morph-pl.json
```

Domyślnie `--lock` i `--report` lądują obok `--out`
(`src\verifier\morph\data\morph-artifact.lock.json` i
`...\COMPILE-REPORT.md`) – możesz je nadpisać `--lock=` / `--report=`.
Opcjonalnie `--sample-size=N` (domyślnie 30) zmienia liczbę PRÓBKOWANYCH
wierszy danych, na których kompilator sprawdza kształt pliku, zanim ruszy
pełny przebieg (zob. §4 – bramka fail-closed).

**Czas i pamięć:** nie zostały zmierzone w tej sesji (zakaz uruchamiania
realnej kompilacji na laptopie – to świadomie Twój krok). Rząd wielkości,
z konstrukcji skryptu: parsowanie strumieniowe linia-po-linii pliku
tekstowego rzędu setek MB to zwykle pojedyncze minuty na sprzęcie
stacjonarnym, pamięć szczytowa proporcjonalna do SŁOWNICTWA (liczby
unikalnych lematów imion/nazwisk/ról), NIE do rozmiaru pliku – ale
zmierz i zapisz realny czas/pamięć w `COMPILE-REPORT.md` przy pierwszym
uruchomieniu (to jest dokładnie decyzja O-FL-6 z `FLEKSJA-IMPL-PLAN.md`
§12, mierzona, nie zgadywana).

## 3. Co dostajesz na wyjściu

Trzy pliki, wszystkie deterministyczne (dwukrotna kompilacja z tych samych
wejść = bajt w bajt ten sam `morph-pl.json`, FLEKSJA-IMPL-PLAN.md §1.4.3):

| Plik | Rola |
|---|---|
| `src/verifier/morph/data/morph-pl.json` | artefakt – **commitowany do repo**, to on ląduje w bundlu |
| `src/verifier/morph/data/morph-artifact.lock.json` | sha256 artefaktu + sha256 pliku wejściowego + liczności sekcji + wersja formatu + licencja – pin do przeglądu na bramce |
| `src/verifier/morph/data/COMPILE-REPORT.md` | raport czytelny dla człowieka: liczności, tabela zgodności reguł per klasa (słownik odejmujący), zaobserwowane etykiety klasyfikacji, licencja |

### Weryfikacja sumy

```powershell
$lock = Get-Content src\verifier\morph\data\morph-artifact.lock.json | ConvertFrom-Json
$real = Get-FileHash src\verifier\morph\data\morph-pl.json -Algorithm SHA256
if ($lock.sha256 -eq $real.Hash.ToLower()) { "OK: suma zgodna" } else { "BŁĄD: suma NIEZGODNA" }
```

### Decyzja o rozmiarze i miejscu bytowania (tabela 1.5, W1-W3-MORPHOLOGY-DESIGN.md §1.5)

Sprawdź `sizeBytes` w locku po realnej kompilacji:

- **≤ 5 MB** (oczekiwane): zostaje jako statyczny import w bundlu, jak dziś.
- **> 5 MB**: przenieś do `resources/morph/` + wpis w `models/manifest.json`
  (wzorzec `electron/model-integrity.mjs`) – TO wymaga osobnej zmiany poza
  tym skryptem.
- **> 10 MB**: STOP. Wróć do cięcia progów włączenia zamiast powiększać
  artefakt (ten kompilator na razie nie ma progów frekwencji – Z2/Z3 nie
  są zintegrowane, zob. §5 pkt 2 niżej).

## 4. Fail-closed: czego kompilator NIE zrobi po cichu

- Jeśli pierwsze ~30 wierszy danych (pomijając ewentualne komentarze) nie
  wygląda jak SGJP `.tab` (za mało kolumn, tag bez dwukropków) –
  **kompilator odmawia przed zapisaniem czegokolwiek**.
- Jeśli w całych danych nie pojawi się ANI JEDNA rozpoznawana etykieta
  klasyfikacji (`imię` / `nazwisko` / `pospolita`) – odmawia. To jest
  dokładnie test na to, czy założenie etykiet (patrz §5 pkt 1) jest
  trafne dla pliku, który faktycznie pobrałeś.
- Jeśli jakikolwiek wiersz danych ma nieoczekiwaną liczbę kolumn, albo
  jeśli te same (lemat, przypadek) mają sprzeczne, niedające się pogodzić
  formy (np. imię z dwiema różnymi formami dopełniacza) – odmawia
  CAŁOŚCI, nie tylko pomija wadliwy wiersz. Zero cichego śmiecia w
  artefakcie.

## 5. Co NIE jest jeszcze zrobione (uczciwie, do potwierdzenia)

1. **Etykiety klasyfikacji nazwy własnej NIE są potwierdzone na realnym
   pliku.** `W1-W3-MORPHOLOGY-DESIGN.md` §1.1 mówi to wprost: "dokładną
   semantykę kolumn i etykiet klasyfikacji («imię», «nazwisko») kompilator
   przybija testem na nagłówku pobranego pliku przy implementacji – nie
   zakładamy jej z pamięci". `compile-sgjp.mjs` zakłada dokładnie te dwie
   etykiety (`DEFAULT_CLASSIFICATION` w nagłówku pliku) – sprawdzone przeze
   mnie strukturalnie (format 4-5 kolumn tab-separated, gramatyka tagów z
   dwukropkiem) na publicznej dokumentacji Morfeusza/SGJP (tagset,
   przykładowy plik budowy `PoliMorfSmall.tab`), ale **literalne wartości
   etykiet dla imion/nazwisk w PRAWDZIWYM zrzucie `sgjp-*.tab.gz` nie były
   przeze mnie widziane** (nie pobierałem realnego pliku – to zadanie
   celowo tego zakazywało). `COMPILE-REPORT.md`, sekcja "Etykiety
   klasyfikacji zaobserwowane w danych", pokaże Ci PRAWDZIWĄ listę po
   pierwszym uruchomieniu – **przejrzyj ją ręcznie**. Jeśli etykiety
   różnią się od "imię"/"nazwisko"/"pospolita", zmień
   `DEFAULT_CLASSIFICATION` (albo przekaż `classification` do
   `compileFile`) – jedna linia, nie przepisywanie logiki.
2. **Z2/Z3 (listy PESEL imion/nazwisk) NIE są zintegrowane.** Ten
   kompilator czyta WYŁĄCZNIE Z1 (SGJP). Efekt: każde imię dostaje
   `frek: 0` (uczciwy brak danych, nie zmyślona liczba); brak progów
   włączenia frekwencyjnego (FLEKSJA-IMPL-PLAN.md §1.4.1 "Progi
   włączenia"); ewentualne imiona/nazwiska SPOZA SGJP, obecne tylko w
   PESEL ("byt bez paradygmatu", jak `konrad` w
   `src/verifier/morph/fixtures/mini-lexicon.js`) nie powstaną – to osobny
   krok merge Z1+Z2/Z3, nieopisany przez ten skrypt.
3. **`scripts/fetch-morph-sources.mjs` i `scripts/morph-sources.lock.json`
   (kotwica źródeł per `W1-W3-MORPHOLOGY-DESIGN.md` §1.3) nie istnieją.**
   §1 tego dokumentu daje Ci ręczny odpowiednik (pobranie + `Get-FileHash`)
   – wystarczający do jednorazowego uruchomienia, ale bez automatycznego
   fail-closed przy niezgodności sumy PRZY POBRANIU (kompilator sam i tak
   zapisuje sumę wejścia do `morph-artifact.lock.json` PO fakcie).
4. **Wykładnia sui generis baz danych (O-FL-1) i licząca się bramka
   GATE-FLEKSJA-DANE** – decyzje prawne/przeglądowe, nie techniczne;
   `FLEKSJA-IMPL-PLAN.md` §10/§12 je opisuje. Ten skrypt dostarcza materiał
   do przeglądu (raport, lock, licencja w artefakcie), nie zastępuje
   samej decyzji.
5. **`THIRD_PARTY_NOTICES.md`** nie został zaktualizowany przez tę gałąź
   (celowo – wpis dotyczy realnych danych, nie fixture). Gotowe wiersze do
   wklejenia są w `W1-W3-MORPHOLOGY-DESIGN.md` §1.2.4; dodaj je przy
   pierwszym realnym scaleniu artefaktu.

## 6. Licencja i autorstwo (obowiązek noty BSD-2)

`compile-sgjp.mjs` wpisuje pełną notę licencyjną BSD-2 (autorzy, link do
deklaracji, zastrzeżenie zakresu) do **każdego** skompilowanego artefaktu
(`meta.zrodla.sgjp.notice`) i do `COMPILE-REPORT.md` – nie tylko do tego
dokumentu – więc nota podróżuje razem z danymi nawet, jeśli ktoś przeczyta
wyłącznie JSON. Treść noty:

```
SGJP - Słownik gramatyczny języka polskiego (dane fleksyjne).
Copyright (c) Zygmunt Saloni, Włodzimierz Gruszczyński, Marcin Woliński,
Robert Wołosz, Danuta Skowrońska. Licencja: BSD-2-Clause (deklaracja:
http://morfeusz.sgjp.pl/doc/license/). Redistribution and use in source
and binary forms are permitted under the two-clause BSD terms; this
notice and the disclaimer must be reproduced in the documentation or
other materials provided with the distribution - satisfied by
THIRD_PARTY_NOTICES.md (W1-W3-MORPHOLOGY-DESIGN.md §1.2.1/§1.2.4).
This artifact contains ONLY a compiled subset (given names, surnames,
procedural role nouns) of the source data (subtractive dictionary,
FLEKSJA-IMPL-PLAN.md §1.4.2).
```

Docelowy wpis w `THIRD_PARTY_NOTICES.md` (gotowiec, do wklejenia przy
scaleniu realnego artefaktu – patrz punkt 5 wyżej) jest już przygotowany w
`W1-W3-MORPHOLOGY-DESIGN.md` §1.2.4.

## 7. Test na fixture (co JUŻ jest dowiedzione, bez realnego SGJP)

`scripts/compile-sgjp.test.js` dowodzi na w pełni syntetycznym
`scripts/fixtures/mini-sgjp.tab` (zero treści z prawdziwego SGJP/PoliMorf)
całego łańcucha: parsowanie → słownik odejmujący (subtrakcja leksemów w
pełni przewidywalnych regułą, włączenie WYJĄTKÓW w całości, nigdy
częściowo) → `loadMorphData()` (prawdziwy `load.js`, bez zmian) →
`analyzePersonName`/`generateForm` (prawdziwe `analyze.js`/`generate.js`,
bez zmian) poprawnie odmieniają nazwiska i imiona z fixture. To jest
dowód, że narzędzie działa – nie dowód, że realny zrzut SGJP wygląda
dokładnie tak, jak zakładam (stąd §5 wyżej).

Uruchomienie: `npx vitest run scripts/compile-sgjp.test.js`.

---

_Autor: Claude Sonnet, na zlecenie Alana Kolkowskiego, gałąź
`feature/sgjp-compile`. Ten dokument NIE jest poradą prawną – decyzje
licencyjne (O-FL-1, GATE-FLEKSJA-DANE) podejmuje Alan._
