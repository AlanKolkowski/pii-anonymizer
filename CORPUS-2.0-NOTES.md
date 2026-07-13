# CORPUS-2.0-NOTES.md — korpus 2.0 (dev/holdout) + niezawodność evalu

Branch `feature/corpus-2.0` z `main`@`553bce2`, worktree `corpus-2.0-worktree`
(osobny `npm ci`, bez junction `node_modules`). Sesja Sonnet, 2026-07-13/14.
**Gałąź NIEZMERGOWANA — do przeglądu Opusa** (duży dodatek danych + dotyka
toru pomiarowego, zgodnie z instrukcją zlecenia).

Realizuje `RECALL-90-DESIGN.md` §3 (korpus 2.0) i naprawia incydent §5
`RECALL-B2-NOTES.md` (wiszący `node.exe` po evalu).

---

## PRIORYTET 1 — korpus 2.0

### Co powstało

Rozszerzenie `scripts/generate-adversarial-corpus.mjs` (nie nowy byt) +
sześć nowych modułów w `scripts/corpus/`:

| Plik | Rola |
|---|---|
| `rng.mjs` | Deterministyczny PRNG (mulberry32 + FNV-1a hash seedów-stringów) |
| `checksums.mjs` | Generatory PESEL/NIP/REGON9/REGON14/IBAN z poprawnymi sumami kontrolnymi — lustro algorytmów z `src/anonymizer.js` (A1) |
| `diacritics.mjs` | Degradacja diakrytyków (B5), mapa dwukierunkowa, `selectDegradedOccurrences` gwarantuje mieszankę form |
| `ocr-transforms.mjs` | Pozostałe 4 klasy OCR: podmiana glifów, rozstrzelenie, sklejenie, przenoszenie |
| `holdout-people.mjs` | Pula osób holdoutu (64 rekordy, 4 podklasy PERSON_NAME), mechaniczna deklinacja `-ski/-cki/-dzki` |
| `holdout-pools.mjs` | Role, organizacje, adresy (klaster wielkopolski), kwoty, frazy art. 9-10, formaty identyfikatorów, pułapki FP |
| `holdout-manifest.json` | Kwoty per typ z §3.3, z jawnym mapowaniem interpretacyjnym wierszy projektu na `entity_group` |
| `holdout-templates.mjs` | 19 szablonów dokumentów (nowe kształty, nieobecne w dev) + `assembleHoldoutDocs()` |
| `holdout-disjointness.mjs` + `.test.js` | Twarda asercja rozłączności wartości (§3.4 pkt 1), na PRAWDZIWYCH korpusach, nie liście ręcznej |

`--pool=dev` (domyślny) — **bez zmian, bajtowo identyczny** z zachowaniem
sprzed sesji (zweryfikowane `md5sum` przed/po refaktorze `main()`).
`--pool=holdout` — nowa ścieżka, pisze do `test-data/adversarial-holdout/`.

### Liczby (holdout, wygenerowane 2026-07-14)

**206 dokumentów, 1685 encji oczekiwanych.** Powyżej szacunku projektu
(~120-140 dok., ~1000-1100 encji) — patrz „Decyzja: przekroczenie szacunku"
niżej.

Samokontrola kwot (`checkHoldoutQuota` w generatorze, odmawia zapisu przy
niedoborze) — **wszystkie 22 `byType`, 10 podtypów identyfikatorów, 5 klas
OCR spełnione**, większość ze sporym zapasem:

| Typ | Cel (manifest) | Wygenerowano |
|---|---|---|
| PERSON_NAME | 200 | 481 |
| PERSON_ROLE_OR_TITLE | 100 | 102 (margines 2) |
| DOCUMENT_REFERENCE | 80 | 83 (margines 3) |
| PERSON_IDENTIFIER | 60 | 84 |
| ORGANIZATION_IDENTIFIER | 45 | 110 |
| BANK_ACCOUNT_IDENTIFIER | 15 | 41 |
| VEHICLE_IDENTIFIER | 30 | 32 (margines 2) |
| HEALTH_DATA | 30 | 38 |
| CRIMINAL_OFFENCE_DATA | 30 | 33 |
| TRADE_UNION_MEMBERSHIP | 15 | 18 |
| RELIGION/POLITICAL/SEXUAL_ORIENTATION | 4 każda | 5 każda |
| ETHNIC_ORIGIN | 3 | 5 |
| FINANCIAL_AMOUNT | 80 | 132 |
| POSTAL_ADDRESS | 55 | 121 |
| LOCATION | 45 | 81 |
| ORGANIZATION_NAME | 80 | 147 |
| DATE_OF_BIRTH | 25 | 26 (margines 1) |
| PHONE_NUMBER | 30 | 36 |
| EMAIL_ADDRESS | 25 | 36 |
| PERSON_ATTRIBUTE | 25 | 56 |

Podtypy identyfikatorów (cel ≥15 każdy): pesel 24, dowodOsobisty 16,
paszport 16, prawoJazdy 16, nip 48, regon 16, krs 16, ibanNrb 41, vin 16,
rejestracja 16 — wszystkie spełnione.

Klasy OCR (cel ≥20 każda): glyphSubstitution 42, spacedOut 42, joined 21,
lineWrap 21, diacritics 21 — wszystkie spełnione (joined/lineWrap z
minimalnym marginesem 1, ale deterministycznie stabilnym, nie losowym —
nie ma ryzyka „migotania" między przebiegami).

Pułapki FP: 20 dokumentów z ≤1 encją realną (9,7% z 206) — nieco poniżej
celu „~12%" z §3.3, ale mechanizm realny i nietrywialny (nie 0%).

### Decyzja: przekroczenie szacunku ~1000-1100 encji / ~120-140 dokumentów

Projekt (§3.3) szacował ~1000-1100 encji na ~120-140 dokumentach. Faktyczny
wynik: 1685 encji na 206 dokumentach. Przyczyna: żeby każdy z 22 typów +
10 podtypów identyfikatorów + 5 klas OCR miał realny margines bezpieczeństwa
(nie dokładnie kwotę minimalną — kwota to *minimum*, nie *cel*), a jednocześnie
dokumenty miały realistyczną, a nie sztucznie stłoczoną treść (unikanie
jednego zdania z 10 różnymi faktami art. 9-10), naturalnie wychodzi więcej
niż szacunek z góry. **Kwoty per typ są rzeczywistym kontraktem
(`checkHoldoutQuota` odmawia zapisu poniżej nich) — łączna suma nie jest
osobno ograniczona z góry**, ani w projekcie, ani w zleceniu tej sesji.
`holdout-manifest.json`'s `targetTotalEntities.max` zaktualizowany na 2000
z komentarzem wyjaśniającym to samo. Rekomendacja: jeśli Opus/Alan uzna, że
206 dokumentów to za dużo (np. ze względu na czas przyszłego pomiaru evalu
na PC), przycięcie liczby instancji per szablon w
`scripts/corpus/holdout-templates.mjs` (funkcja `assembleHoldoutDocs`) jest
bezpieczne — samokontrola kwot natychmiast zasygnalizuje, jeśli przycięcie
zejdzie poniżej któregokolwiek minimum.

### Jakość gramatyczna — co naprawiono, co zostało

Ręczny przegląd próbki wygenerowanych dokumentów (nie tylko strażnicy
automatyczne, które sprawdzają offsety/typy/rozłączność, nie prozę) ujawnił
realne błędy gramatyczne, naprawione w toku sesji:

- **Przypadek miejscownika po „w"**: „z siedzibą w Turek" → „w Turku"
  (`CITIES_LOCATIVE` w `holdout-pools.mjs`, użyte wszędzie gdzie zdanie
  wymaga miejscownika).
- **Niezgodność rodzaju**: „pana Wróblewskiej" (męski honoryfikat + żeńskie
  nazwisko), „Ubezpieczony: Wróblewska", „Strona Bogdan Zieliński
  zamieszkała" — pula osób (`holdout-people.mjs`) dostała pole `gender`
  (wywiedzione z końcówki `-ski/-ska` dla odmiana/dwuczłonowe, jawnie
  otagowane dla pospolite), a szablony (`holdout-templates.mjs`) dostały
  pomocnicze funkcje `pastTense`, `honorificNom/Acc`, `surnameAcc`,
  `defendantLabel`, `plaintiffLabel`. `surnameAcc` wykorzystuje, że polski
  biernik pokrywa się z dopełniaczem dla rzeczowników męskoosobowych i
  z narzędnikiem dla przymiotnikowych żeńskich — więc nie trzeba osobnego
  pola na biernik.

**Znana, świadomie nienaprawiona luka:** `ROLES` (~30 fraz) i
`ORGANIZATIONS`/`COMPANIES` (~18 nazw) w `holdout-pools.mjs` to gołe stringi,
nieodmieniane. Rola albo organizacja trafiająca w slot zdania wymagający
dopełniacza/celownika/biernika zostaje w mianowniku („ustanowił
pełnomocnikiem sędzia SO" zamiast „sędziego SO"; „doręczyć... oraz
Spółdzielnia Mleczarska" zamiast „Spółdzielni Mleczarskiej"). Naprawa
wymagałaby tabel deklinacyjnych dla ~30 fraz ról i ~18 nazw organizacji —
osobne zadanie, nieproporcjonalne do reszty tej sesji. **Nie wpływa na
poprawność ground truth** (span i typ encji są poprawne niezależnie od
form gramatycznych wokół), tylko na naturalność prozy. Rekomendacja:
follow-up, jeśli Alan/Opus uzna jakość prozy za istotną dla materiałów
(np. jeśli fragmenty holdoutu miałyby być cytowane w dokumentacji
metodologii, §4.3).

### Incydent: uszkodzony plik dev podczas weryfikacji

W trakcie sesji `test-data/adversarial/adw_03_nazwisko_dywiz.txt` okazał się
obcięty do 0 bajtów (`git diff --stat` potwierdził realną utratę treści — 3
linie usunięte — podczas gdy WSZYSTKIE pozostałe pliki dev pokazane jako „M"
w `git status` okazały się tylko szumem `autocrlf` w cache gita, bez
realnej różnicy). Przyczyna nieznana — żadna operacja w historii tej sesji
nie powinna była dotknąć tego pliku (cała ścieżka zapisu dev przechodzi przez
niezmienioną `writeCorpus()`, zweryfikowaną `md5sum` przed i po zmianach
`--pool=holdout` w tej sesji). Naprawione przez `git checkout -- <plik>`
(bezpieczne: plik nietknięty żadną świadomą zmianą, historia gita jest
poprawnym źródłem prawdy), ponownie zweryfikowane bajtowo identyczne po
naprawie. Odnotowane na wypadek powtórzenia się w przyszłych sesjach —
jeśli `npm test`/`ground-truth.test.js` kiedyś nagle zgłosi masowe
niedopasowania offsetów w `test-data/adversarial/`, to pierwszy podejrzany
scenariusz do sprawdzenia.

### Odłożone świadomie (NIE zadanie generatora)

**Podzbiór holdout-human** (5-10 dokumentów pisanych ręcznie, wzorowanych na
realnej praktyce kancelarii, anotowanych przez inną osobę/sesję niż autor
dokumentu) — RECALL-90-DESIGN.md §3.2. To NIE jest zadanie generatora ani
tej sesji — osobna, ręczna robota Alana. Odnotowane w README holdoutu jako
follow-up (`test-data/adversarial-holdout/README.md`, punkt 4 polityki
zamrożenia).

**Naprawa deklinacji ROLES/ORGANIZATIONS** — patrz wyżej, jakość gramatyczna.

### Jak odtworzyć

```bash
node scripts/generate-adversarial-corpus.mjs               # dev (bez zmian)
node scripts/generate-adversarial-corpus.mjs --pool=holdout # holdout
npm test                                                     # 2062 testów, bez modeli AI
```

Punktowa weryfikacja detekcji na 2-3 dokumentach holdoutu (`node src/eval/run.js
test-data/adversarial-holdout/hold_*.txt --label=...`) — **NIE ukończona
w tej sesji**, zablokowana tym samym zewnętrznym problemem HuggingFace opisanym
w sekcji „PRIORYTET 2 — Weryfikacja" niżej (CDN zwraca 500 dla jednego pliku
modelu). Struktura korpusu jest niezależnie zweryfikowana wieloma innymi
drogami bez potrzeby modeli AI: `findRegexEntities` (prawdziwy detektor
regexowy aplikacji) potwierdza, że wygenerowane identyfikatory/kwoty/sygnatury
są faktycznie wykrywalne (`holdout-templates.test.js`, `holdout-pools.test.js`,
`checksums.test.js`, `ocr-transforms.test.js`) — ale przebieg PRZEZ oba modele
NER na realnych dokumentach holdoutu pozostaje do zrobienia, gdy HuggingFace
odzyska plik.

**NIE uruchamiać** `npm run eval` na holdoucie w całości (206 dok. × 2
modele) bez uprzedzenia Alana — to dokładnie skala, która wcześniej
powodowała OOM/zawisanie na tej klasie maszyn (`eval-adversarial-ostroznosc.md`).
Pomiar bramkowy przenosi się na maszynę Alana z większym RAM (instrukcja
zlecenia tej sesji).

---

## PRIORYTET 2 — niezawodność evalu

### Diagnoza

`src/eval/run.js`'s `main()` kończył się bez wywołania `process.exit()` po
stronie sukcesu — tylko ścieżka błędu (`.catch()`) wywoływała
`process.exit(1)`. Modele SĄ prawidłowo `dispose()`-owane per-dokument już
dziś (`src/pipeline/steps/ner.js` i `load-models.js` mają własny cykl
load-use-dispose) — ale natywne wątki sesji `onnxruntime-node` potrafią
przeżyć każde JS-owe wywołanie `dispose()` i nie zwolnić uchwytu
zarejestrowanego w pętli zdarzeń `libuv`, więc proces Node nigdy naturalnie
nie kończy działania, mimo że cała praca (w tym zapis `summary.json`)
jest już dawno skończona (`RECALL-B2-NOTES.md` §5: proces wisiał ~2,5 h,
niezabijalny przez `TaskStop`).

### Naprawa

`main().then(() => process.exit(0)).catch(err => { ...; process.exit(1); })`
— wymuszone czyste zakończenie natychmiast po zapisaniu `summary.json` i
symlinku `latest`, niezależnie od stanu natywnych uchwytów onnxruntime.

### Weryfikacja — ZABLOKOWANA zewnętrznie (nie przez kod tej sesji)

Próba: eval na 3 małych dokumentach holdoutu (`hold_pospolite_04`,
`hold_art910_health_03`, `hold_finanse_wezwanie_00`,
`--label=corpus-2.0-exit-fix-smoke`), trzykrotnie. Wszystkie trzy próby
padły w TYM SAMYM miejscu (ładowanie tokenizera modelu multilang, PRZED
jakąkolwiek inferencją): `Internal server error... tokenizer.json`.

**Zdiagnozowane u źródła, nie zgadywane:** bezpośredni `curl -I -L` do
`https://huggingface.co/wjarka/eu-pii-anonimization-multilang/resolve/main/tokenizer.json`
(z pominięciem Node/onnxruntime całkowicie) zwraca `HTTP/1.1 500 Internal
Server Error` wprost z CloudFront (`X-Cache: Error from cloudfront`) —
**potwierdzona zewnętrzna awaria CDN HuggingFace dla tego jednego pliku**,
nie problem sieci/środowiska/kodu tej sesji. `config.json` z tego samego
repo pobiera się poprawnie (307, natychmiast) — awaria jest punktowa
(jeden plik), nie całościowa (cały HF Hub).

**Wniosek:** weryfikacja end-to-end (rzeczywisty przebieg evalu) nie mogła
zostać ukończona w tej sesji z przyczyn całkowicie poza kontrolą kodu.
Pewność co do poprawności naprawy opiera się na rozumowaniu na poziomie
kodu, nie na przebiegu:
- zmiana jest jednowierszowa, mechaniczna: `main().then(() => process.exit(0)).catch(...)`
  zamiast `main().catch(...)` — standardowy, dobrze udokumentowany wzorzec
  Node.js (wymuszenie zakończenia procesu niezależnie od otwartych uchwytów
  natywnych w event loopie);
- ścieżka błędu (`.catch()`) jest dowodnie wykonywalna i poprawna — WSZYSTKIE
  trzy nieudane próby zakończyły proces kodem wyjścia 1 poprawnie (zero
  zawieszenia na ścieżce błędu, co samo w sobie jest częściowym dowodem, że
  `process.exit()` w tym miejscu pliku faktycznie działa w tym środowisku);
- jedyna niezweryfikowana ścieżka to sukces (`.then()`), strukturalnie
  identyczna, różniąca się tylko kodem wyjścia (0 zamiast 1).

**Rekomendacja dla Alana:** powtórzyć `node src/eval/run.js
test-data/adversarial-holdout/hold_pospolite_04.txt --label=verify-exit-fix`
(pojedynczy mały dokument wystarczy), kiedy HuggingFace odzyska ten plik —
sprawdzić `Get-Process -Name node` od razu po zakończeniu, tak jak
opisuje `eval-adversarial-ostroznosc.md`. Jeśli proces zniknie z listy
natychmiast po wypisaniu `Results: .../`, naprawa działa.

### Odłożone świadomie

Flaga `--batch=N` (uruchamianie bardzo dużych korpusów w świeżych procesach
potomnych) — NIE zaimplementowana. Zgodnie z instrukcją zlecenia: „jeśli nie
starczy czasu, sam process.exit wystarczy, bo na 32 GB PC pamięć nie jest
wąskim gardłem". `process.exit(0)` naprawia dokładnie zdiagnozowany problem
(zawieszony proces, nie OOM) — OOM na maszynie tej sesji (15,4 GB RAM,
`eval-adversarial-ostroznosc.md`) to osobny, nienaprawiony w tej sesji
problem, dotyczący WYŁĄCZNIE bardzo dużych przebiegów (38+ dok. × 2 modele),
nieistotny dla docelowej maszyny Alana (32 GB).

---

*Notatka sporządzona w ramach gałęzi `feature/corpus-2.0`, sesja Sonnet,
2026-07-13/14. Gałąź NIEZMERGOWANA — zostawiona do przeglądu Opusa.*
