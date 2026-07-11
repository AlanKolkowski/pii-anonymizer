# DOCX-REBUILD-DESIGN.md — rekonstrukcja formatowania .docx przy deanonimizacji

**Wersja:** 1.0 (projekt do akceptacji)
**Data:** 2026-07-10
**Autor:** Fable (architekt aplikacji desktopowej)
**Status:** PROJEKT. Zero kodu implementacji. Dokument czeka na bramkę Opusa,
implementacja (Sonnet) nie startuje przed akceptacją.
**Odbiorca:** Opus jako bramka bezpieczeństwa; wtórnie Alan (decyzje produktowe,
§14) i Sonnet (plan implementacji, §12).

**Relacja do istniejących dokumentów:** `SECURITY.md` opisuje zbudowane
zabezpieczenia (w tym CSP §6 i politykę legendy §9); `THREAT-MODEL.md` — model
zagrożeń (w szczególności Z3: dokumenty wejściowe są niezaufane, oraz S4:
spreparowany dokument); `SECURITY-CHECKLIST.md` — bramkę wydania (C-INP-5:
DOCX bez XXE). Ten dokument projektuje **nowy moduł renderera** (rekonstrukcja
.docx) i jego wpływ na tamte dokumenty. Jest **niezależny** od
`MCP-BRIDGE-DESIGN.md` — funkcja działa identycznie w wariancie A (air-gap)
i B (most), patrz §7 i §10.

**Konwencja oznaczeń:** fragmenty JSON i struktury w tym dokumencie to schematy
danych i specyfikacje zachowań, nie kod implementacji. Każde miejsce dotykające
niezaufanego wejścia albo legendy jest oznaczone **[DO WERYFIKACJI PRZEZ
OPUSA: O-n]** i zebrane w rejestrze §13. Rejestry O-n, P-n i MD-n są **lokalne
dla tego dokumentu** (niezależne od rejestrów w `MCP-BRIDGE-DESIGN.md`).
Pozycje checklisty C-DOCX-n i scenariusze S-DOCX-n są globalnie unikalne.

---

## §1. Problem produktowy i cel

### 1.1 Workflow, który ma zadziałać

1. Alan anonimizuje dokumenty źródłowe w aplikacji; legenda (token → dane)
   żyje wyłącznie w RAM renderera (`SECURITY.md` §9).
2. Claude/Codex, pracując na tekście stokenizowanym, przygotowuje **gotowe
   pismo procesowe jako .docx**: papier firmowy K-Law, style, numeracja,
   tabele, układ — ale w treści zamiast danych osobowych stoją tokeny
   `[PERSON_NAME_1]`, `[ADDRESS_2]` itd.
3. Alan wskazuje ten plik aplikacji. Aplikacja podmienia tokeny na dane
   z legendy **wewnątrz istniejącego .docx**, niczego poza tym nie zmieniając:
   wynik to ten sam dokument — papier, style, nagłówki, stopki, tabele —
   z odtworzonymi danymi. Pismo prawie gotowe do podpisu.

Dziś krok 3 nie istnieje: eksport zdeanonimizowany (`src/export/deanon.js`,
`generateDocxBlob`) buduje **nowy, płaski** dokument akapit-po-akapicie
(`docx` → `Paragraph`/`TextRun` bez żadnych właściwości), więc całe
formatowanie od AI ginie.

### 1.2 Wymagania nienegocjowalne (W1–W5)

- **W1 — niezaufane wejście.** Plik .docx od AI jest traktowany dokładnie jak
  każdy dokument z Z3: wrogi ZIP, wrogi XML, wrogie relacje. Parsowanie odporne
  na XXE i bomby encji; treść trafia do DOM wyłącznie przez
  `textContent`/`createTextNode` (dyscyplina C-INP-1/C-INP-2 bez wyjątków).
- **W2 — operacja lokalna, w rendererze.** Legenda nie opuszcza renderera,
  bajty pliku nie przechodzą przez żaden kanał IPC ani sieć, zero trwałości
  poza jawnym pobraniem wyniku przez użytkownika. Funkcja nie zmienia niczego
  w `electron/` i działa w obu wariantach (A i B) oraz w wydaniu webowym.
- **W3 — zero nowych zależności runtime.** Rekonstrukcja używa wyłącznie
  API platformy (DOMParser, XMLSerializer, DecompressionStream,
  CompressionStream) i kodu własnego repo. Uzasadnienie i odrzucone
  alternatywy: §2.
- **W4 — zero nowych ścieżek egress w wyniku.** Moduł **niczego nie dodaje**
  do dokumentu: żadnych nowych relacji, części, odwołań. Zbiór relacji
  wejścia i wyjścia jest identyczny (test C-DOCX-5), a wykryte w wejściu
  odwołania zewnętrzne inne niż hiperłącza blokują eksport (§9.3).
- **W5 — fail-safe, nigdy zgadywanie.** Token nieobecny w legendzie,
  uszkodzony albo rozerwany nieodtwarzalnie **pozostaje widoczny** w wyniku
  i jest raportowany. Moduł nigdy nie wstawia wartości „na oko".

### 1.3 Poza zakresem

- Fleksja wstawianych wartości (Jan Kowalski → Jana Kowalskiego) — osobny
  projekt; tu wyłącznie punkt zaczepienia (§8).
- Formaty inne niż .docx (ODT, RTF, DOC/CFB, PDF) — odrzucane czytelnym
  błędem.
- Zmiana formatu tokenów, promptów systemowych AI ani protokołu mostu —
  §6.4 rozstrzyga kwestię (c) po stronie parsera.
- Jakość detekcji NER (R1) — bez zmian; rekonstrukcja konsumuje istniejącą
  legendę.

---

## §2. Decyzja: chirurgiczna edycja istniejącego OOXML (kwestia a)

### 2.1 Wybrane podejście

**Rozpakowanie ZIP własnym czytnikiem → parsowanie wyłącznie potrzebnych
części XML (po twardym odrzuceniu DTD) → podmiana ograniczona do treści
węzłów tekstowych `w:t` → serializacja → przepakowanie, przy czym każda
część bez podmian jest kopiowana bajt-w-bajt.**

Właściwości, które przesądzają:

1. **Minimalny dotyk = minimalne ryzyko zepsucia dokumentu.** Jedyne
   modyfikowane węzły to treść `w:t` (plus atrybut `xml:space`, §4.6).
   Style, numeracja, sekcje, obrazy, czcionki, ustawienia, właściwości —
   nietknięte. Części bez ani jednej podmiany nie są nawet re-serializowane:
   ich **skompresowane bajty** przechodzą do wyniku verbatim (§3.3). To
   maksimum wierności formatowaniu, jakie w ogóle istnieje.
2. **Brak wstrzyknięcia XML z konstrukcji.** Wartości z legendy pochodzą
   z niezaufanych dokumentów źródłowych (Z3). Wstawiamy je jako **węzły
   tekstowe DOM**, a serializator sam escapuje `&`, `<`, `>` — wartość
   `</w:t><w:evil/>` nie ma jak stać się znacznikiem. Podejście „sklejanie
   stringów XML" wymagałoby ręcznego escapowania, czyli miejsca na błąd
   klasy XSS-w-XML. To jest główny argument za pełnym parserem zamiast
   chirurgii na tekście pliku. **[DO WERYFIKACJI PRZEZ OPUSA: O-3]**
3. **Zero nowych zależności** (W3): DOMParser/XMLSerializer są w platformie,
   inflate/deflate daje `DecompressionStream('deflate-raw')` /
   `CompressionStream('deflate-raw')` (Chromium ≥ 103, a więc i Electron 43;
   web: Firefox ≥ 113, Safari ≥ 16.4 — z detekcją funkcji i czytelnym
   komunikatem przy braku), CRC-32 już istnieje w repo
   (`src/export/zip.js:15`). Cały kod bezpieczeństwa jest nasz, mały
   i audytowalny — spójnie z filozofią „zero-dep" z decyzji O-11 mostu.
4. **Fail-safe jest naszą decyzją, nie właściwością cudzej biblioteki** (W5):
   raport podmian i pozostawionych tokenów (§6) wymaga pełnej kontroli nad
   dopasowaniem, której silniki szablonów nie dają.

### 2.2 Alternatywy odrzucone

| Alternatywa | Dlaczego odrzucona |
|---|---|
| **`docx@9.6.1` → `patchDocument`** (już w drzewie, więc formalnie zero *nowych* zależności) | Zweryfikowałam w kodzie paczki (`node_modules/docx/dist/index.mjs:22555–22669`): (1) **każdą** część `.xml`/`.rels` round-tripuje przez parser `xml-js` do JSON i re-serializuje — także części bez żadnych podmian, czyli maksymalna perturbacja struktury tam, gdzie my gwarantujemy bajt-w-bajt; (2) **bezwarunkowo mutuje** `word/document.xml`: dopisuje namespace'y `mc/wp/r/w15/m` i `mc:Ignorable` nawet przy zerze trafień; (3) zawiera maszynerię **dodawania relacji** (hiperłącza, obrazy) — dokładnie ta zdolność, której W4 zakazuje, siedziałaby w naszej ścieżce niezaufanego wejścia; (4) pętla `recursive=true` (`while(true)`) ponawia podmianę, dopóki placeholder znika — wartość zawierająca własny placeholder to ryzyko zapętlenia; (5) brak raportu „co zostało niepodmienione" (W5); (6) ciągnie do ścieżki niezaufanego wejścia `jszip`, `xml-js`, `nanoid`, `hash.js` — czterokrotnie większa powierzchnia audytu niż moduł własny. Paczka `docx` zostaje tym, czym jest: generatorem płaskiego eksportu. |
| **docxtemplater** | Nowa zależność runtime (łańcuch dostaw: docxtemplater + pizzip + moduły), a jej parser wyrażeń (`angular-expressions`) buduje funkcje dynamicznie — konflikt z dążeniem do usunięcia `'unsafe-eval'` z CSP (C-INP-8) i niepotrzebna zdolność wykonywania wyrażeń z treści dokumentu. Semantyka szablonu (pętle, warunki) to powierzchnia, której nie potrzebujemy do literalnej podmiany. |
| **docx-templates** | Jak wyżej, mocniej: silnik **wykonuje JavaScript osadzony w dokumencie** (sandbox opt-in). Wrogi .docx z Z3 nie może mieć prawa wykonać czegokolwiek. Dyskwalifikacja z definicji. |
| **Generacja od zera** (rozbudowa obecnego `generateDocxBlob` o odczytane style) | To status quo plus złudzenie: żeby „przenieść" formatowanie, trzeba by sparsować i odwzorować cały WordprocessingML (style, numeracje, sekcje, nagłówki, tabele, rysunki) w API `docx` — praktycznie transpilator OOXML→OOXML. Nieproporcjonalny koszt, gwarantowana strata wierności (papier firmowy!). |
| **Chirurgia na stringu XML** (regex/indexOf po surowym tekście części, bez parsera) | Kusząca wydajnościowo, ale: ręczne escapowanie wartości (patrz §2.1 pkt 2), krucha na encje (`&amp;` w treści rozjeżdża offsety), na CDATA, na komentarze, na `w:t` w atrybutowych wariantach zapisu. Odrzucona jako podejście podstawowe; dopuszczona wyłącznie jako **szybki pre-filtr** („czy ta część w ogóle zawiera `[`?") przed decyzją o parsowaniu, bo negatywny wynik pre-filtra niczego nie modyfikuje. |
| **mammoth** (już w drzewie) | To ekstraktor tekstu (`extractRawText`), nie edytor — nie ma ścieżki zapisu. Zostaje w swojej dzisiejszej roli: podgląd tekstowy (§3.4). |

---

## §3. Architektura przepływu

### 3.1 Diagram

```
 [ NIEZAUFANY PLIK: pismo-od-AI.docx (tokeny zamiast PII) ]      granica G1
      │  wybór pliku przez użytkownika (File.arrayBuffer(), limit 25 MB
      │  z istniejącej bramki importu, src/file-import/index.js:10)
      ▼
 ┌─ RENDERER ──────────────────────────────────────────────────────────────┐
 │                                                                         │
 │  (1) ZIP-CZYTNIK (własny, pamięciowy)                    [O-1]          │
 │      katalog centralny → wpisy {nazwa, metoda, rozmiary, CRC, offset}   │
 │      limity dekompresji, odrzucenie metod/cech spoza allow-listy        │
 │      │                                                                  │
 │  (2) INSPEKCJA OOXML                                     [O-2]          │
 │      [Content_Types].xml → makra? strict? → odrzucenie                  │
 │      _rels/.rels + word/_rels/*.rels → mapa części + relacje zewnętrzne │
 │      → klasyfikacja egress (§9.3): blokada / raport                     │
 │      │                                                                  │
 │  (3) SILNIK TOKENÓW (per część: document, header*, footer*,             │
 │      footnotes, endnotes)                                [O-3][O-4]     │
 │      pre-filtr „[" → DOCTYPE-reject → DOMParser → strumień tekstu       │
 │      akapitu + mapa segmentów → dopasowanie tokenów legendy →           │
 │      plan podmian → zapis do w:t → XMLSerializer                        │
 │      │                                             ┌──────────────┐     │
 │      │            legenda (A1, RAM renderera) ────►│ podmiana     │     │
 │      │            czytana w chwili eksportu,       │ + szew       │     │
 │      │            nigdy kopiowana do pliku pośr.   │ fleksji (§8) │     │
 │      │                                             └──────────────┘     │
 │  (4) ZIP-SKŁADACZ                                                       │
 │      części zmodyfikowane: deflate/store + nowy CRC                     │
 │      części nietknięte: surowe skompresowane bajty verbatim             │
 │      │                                                                  │
 │  (5) RAPORT REKONSTRUKCJI (§6) → UI (textContent)        [O-5]          │
 │      podmienione / pozostawione / ostrzeżenia egress                    │
 │      │                                                                  │
 │  (6) downloadBlob(<stem>-deanon.docx)  — jedyny artefakt, jawny zapis   │
 └─────────────────────────────────────────────────────────────────────────┘
```

Wszystko powyżej dzieje się w rendererze, na wątku UI (rozmiary ograniczone
limitami z §9.2 czynią to bezpiecznym; jeśli pomiar w MD6 pokaże > ~200 ms na
realnym piśmie, przetwarzanie przenosi się pod istniejący Web Lock jak inne
długie zadania — bez zmiany architektury). Żaden krok nie dotyka sieci, IPC,
dysku ani procesu głównego.

### 3.2 Podział na moduły (mapowanie na plan §12)

| Krok | Moduł (nowy katalog `src/docx-rebuild/`) | Rola |
|---|---|---|
| 1 | `zip-reader` | katalog centralny, ekstrakcja pojedynczych wpisów na żądanie, limity |
| 2 | `ooxml-inspect` | typy zawartości, rozwiązanie części po relacjach, klasyfikacja relacji zewnętrznych, detekcja makr |
| 3 | `token-engine` | strumień tekstu akapitu, mapa segmentów, dopasowanie, plan podmian, raport |
| 4 | `zip-writer` | rekompozycja: verbatim-copy + nowe wpisy; reużycie `crc32` wyniesionego z `src/export/zip.js` |
| 5–6 | integracja UI w `src/ui/deanon-workspace/` + `src/export/deanon.js` | import, plakietka, eksport, raport |

### 3.3 Niezmiennik „nietknięte = bajt-w-bajt"

Część, w której silnik tokenów nie wykonał **ani jednej** podmiany, nie jest
re-serializowana: do wyniku trafia jej oryginalny, skompresowany strumień
(z oryginalnym CRC i rozmiarami z katalogu centralnego; lokalne nagłówki są
normalizowane z metadanych katalogu centralnego, co przy okazji neutralizuje
wpisy z data-descriptorem). Skutki:

- obrazy, czcionki, style, ustawienia — **nigdy nawet nie są dekompresowane**
  (poza małymi częściami inspekcji z kroku 2), co zawęża powierzchnię bomby
  dekompresyjnej do kilku plików XML o twardych limitach,
- test bajtowej identyczności części nietkniętych jest trywialny
  i automatyczny (C-DOCX-10),
- metadane wpisów (czasy modyfikacji ZIP) są kopiowane ze źródła — aplikacja
  nie stempluje wyniku czasem pracy radcy (higiena metadanych).

### 3.4 Integracja z zakładką Deanonimizuj

Import pliku .docx z tokenami tworzy dokument wynikowy (outcome) rozszerzony
o pola nieobecne w dzisiejszych wynikach tekstowych:

```json
{ "id": "…", "label": "pismo-od-AI.docx", "text": "<podgląd tekstowy>",
  "docx": { "bytes": "<ArrayBuffer, tylko RAM>", "inspection": { "…": "§9.3" } } }
```

- `text` (podgląd w istniejących panelach z pigułkami tokenów) pochodzi
  z istniejącego `extractDocx` (mammoth) — **wyłącznie do odczytu**;
  edycja tekstu podglądu jest dla wpisów DOCX zablokowana, bo źródłem prawdy
  są bajty, nie podgląd (inaczej użytkownik edytowałby tekst, którego eksport
  nie odzwierciedli).
- `docx.bytes` żyje wyłącznie w RAM (spójnie z §9 `SECURITY.md`), znika
  z usunięciem wyniku i zamknięciem aplikacji; nie wchodzi do
  `legendSnapshot`, nie przechodzi przez MCP (`buildOutcomeListing` widzi
  wyłącznie `text` — bez zmian).
- Przycisk „Eksportuj DOCX" dla takiego wyniku uruchamia rekonstrukcję
  zamiast płaskiego `generateDocxBlob`; nazwa pliku przez istniejące
  `uniqueDeanonFileName`/`sanitizeFileStem`. Wyniki tekstowe eksportują się
  jak dziś. Legenda: istniejąca reguła `effectiveOutcomeLegend`
  (snapshot ▸ żywa legenda), identycznie jak w eksporcie płaskim.
- Liczniki „tokenów odtworzonych" w pasku stanu dla wpisów DOCX pochodzą
  **z raportu silnika** (§6.2), nie z podglądu tekstowego — podgląd może
  sklejać akapity inaczej niż XML. **[DO WERYFIKACJI PRZEZ OPUSA: O-5]**

---

## §4. Run-splitting: dopasowanie i podmiana krok po kroku (twarde wyzwanie)

### 4.1 Dlaczego naiwny replace nie działa

WordprocessingML dzieli tekst akapitu (`w:p`) na runy (`w:r`), a run niesie
tekst w `w:t`. Word i generatory rozcinają runy przy każdej zmianie
formatowania, znaczniku pisowni (`w:proofErr`), zakładce, komentarzu, rsid,
zapisanym łamaniu strony. Token `[PERSON_NAME_1]` w realnym pliku bywa więc
rozłożony np. tak (schemat, nie kod):

```
<w:p>
  <w:r><w:rPr><w:b/></w:rPr><w:t>Pozwany [PERSON_</w:t></w:r>
  <w:proofErr w:type="spellStart"/>
  <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>NAME_</w:t></w:r>
  <w:r><w:t>1] wnosi o…</w:t></w:r>
</w:p>
```

`replaceAll` po treści pojedynczych węzłów nigdy nie zobaczy pełnego tokenu.

### 4.2 Strumień tekstu akapitu i mapa segmentów

Dla każdej przetwarzanej części (§5.1), po parsowaniu (§9.1):

1. **Enumeracja akapitów:** wszystkie elementy `w:p` w części, wyszukiwane
   **po namespace** WordprocessingML (nie po prefiksie — prefiks jest
   konwencją, nie gwarancją).
2. **Zbiór segmentów akapitu:** przejście poddrzewa akapitu w porządku
   dokumentu; do strumienia wchodzą wyłącznie węzły `w:t`, których
   **najbliższym przodkiem `w:p` jest ten akapit** (akapity zagnieżdżone —
   pola tekstowe w `w:txbxContent` — są enumerowane osobno jako własne
   akapity, więc nic nie jest liczone podwójnie ani pomijane).
3. **Strumień `S`:** konkatenacja treści segmentów; równolegle **mapa
   segmentów**: lista `(węzeł w:t, początek w S, długość)`.
4. **Sentinele:** każdy element „nietekstowy z treścią lub granicą" napotkany
   między segmentami wstrzykuje do `S` znak wartowniczy `U+FFFC` (znaku tego
   nie ma w gramatyce tokenów, więc żadne dopasowanie nie przetnie granicy):
   `w:br`, `w:cr`, `w:tab`, `w:sym`, `w:noBreakHyphen`, `w:softHyphen`,
   `w:drawing`, `w:pict`, `w:object`, `w:fldChar`, `w:footnoteReference`
   i pokrewne odwołania. Skutek fail-safe: token „przerwany" twardym
   elementem (np. tabulatorem w środku) **nie zostanie dopasowany** —
   pozostanie widoczny i trafi do raportu (§6), zamiast być zgadywany.
5. **Wykluczenia ze strumienia:** `w:instrText` (kody pól — podmiana w kodzie
   pola mogłaby zmienić semantykę INCLUDE/REF; skan rezyduów §6.2 je czyta,
   strumień podmian nie), `w:delText` (tekst usunięty w trybie śledzenia
   zmian — §5.2). Oba wstrzykują sentinel.

### 4.3 Dopasowanie tokenów

1. Po `S` przechodzi **jedna** wspólna gramatyka tokenów — dziś istnieje
   w trzech kopiach (`src/anonymizer.js:139`, `src/mcp/listings.js:28`,
   `src/ui/deanon-workspace/index.js:9`, przy czym kopia UI jest ciaśniejsza);
   projekt wymaga wyniesienia jej do modułu współdzielonego (ten sam ruch
   planuje M4 mostu — wykonuje ten, kto pierwszy wejdzie do implementacji).
2. Każde trafienie gramatyki: jeśli literał **jest kluczem legendy** →
   kandydat do podmiany; jeśli nie → rezyduum „token nieznany" do raportu
   (typowe źródło: AI wymyśliła własny token, literówka w indeksie).
   Dopasowanie jest **literalne** — gramatyka wymaga domkniętego `]`
   bezpośrednio po indeksie, więc `[PERSON_NAME_1]` nigdy nie dopasuje się
   wewnątrz `[PERSON_NAME_10]` (prefiks bez `]` nie jest trafieniem).
3. Trafienia są z natury rozłączne (regex globalny na literałach), przetwarzane
   od lewej. **[DO WERYFIKACJI PRZEZ OPUSA: O-4]**

### 4.4 Reguła formatowania wstawianej wartości

Trafienie obejmuje segmenty `i…j` mapy. Zapis planu podmiany:

- **cała wartość** (po szwie fleksji, §8) trafia do segmentu `i`, w miejsce
  fragmentu tokenu, między zachowany prefiks i (jeśli token kończy się
  w tym samym segmencie) sufiks treści tego węzła;
- segmenty `i+1 … j−1` — treść fragmentów tokenu **usuwana** (węzły zostają,
  puste `w:t` jest legalne i częste w plikach z Worda);
- segment `j` — zostaje wyłącznie treść po końcu tokenu.

Konsekwencja: **wstawiona wartość dziedziczy formatowanie runu, w którym
token się zaczyna** (`w:rPr` tego runu jest nietknięte — my zmieniamy tylko
tekst). Token rozcięty między dwa różne formatowania (pół pogrubione, pół
nie): wartość w całości przyjmuje formatowanie początku, a struktura runów —
i formatowanie tekstu **wokół** tokenu — pozostają nienaruszone.

Alternatywy odrzucone: „formatowanie większościowe" (wymaga interpretacji
`w:rPr`, czyli heurystyki = zgadywanie), „proporcjonalny podział wartości
między runy" (dzieli nazwisko w pół stylem, efekt wizualnie absurdalny),
„nowy run o scalonych właściwościach" (tworzenie węzłów = większy dotyk
struktury, sprzeczny z §2.1 pkt 1). Reguła „pierwszy run wygrywa" jest
deterministyczna, wyjaśnialna użytkownikowi jednym zdaniem i w praktyce
poprawna: rozcięcia wewnątrz tokenu prawie zawsze są artefaktem proofErr/rsid
przy **jednolitym** formatowaniu widocznym.

### 4.5 Zastosowanie planu podmian

Dla każdego węzła `w:t` nowa treść jest budowana **jednym przebiegiem**
z uporządkowanych, rozłącznych trafień (żadnych sekwencyjnych `replaceAll`
po dokumencie — wartości wstawione nie są ponownie skanowane, więc wartość
zawierająca przypadkiem literał tokenu nie wywoła kaskady; to samo ryzyko,
które w `patchDocument` tworzy pętlę `recursive`, u nas nie istnieje
z konstrukcji).

### 4.6 Higiena zapisu

- **`xml:space="preserve"`:** jeśli nowa treść węzła zaczyna się lub kończy
  białym znakiem (np. wartość krótsza niż token, sufiks zaczyna się spacją),
  a węzeł nie ma atrybutu — atrybut jest dodawany (inaczej Word obetnie
  spacje brzegowe). To jedyna dopuszczalna zmiana atrybutu w całym module.
- **Sanityzacja wartości:** znaki sterujące C0 (poza `\t`) oraz `\r`/`\n`
  w wartości legendy są zamieniane na pojedynczą spację i odnotowywane
  w raporcie — literalny znak nowej linii wewnątrz `w:t` nie ma zdefiniowanej
  semantyki i bywa gubiony przez Worda; łamanie wierszy pozostaje domeną
  struktury dokumentu, nie wartości.
- **Serializacja:** XMLSerializer na zmodyfikowanym drzewie; deklaracja XML
  jest przenoszona ze źródła części (jeśli była), a wynik kodowany UTF-8.
  Encje znakowe w treści powstają wyłącznie z escapowania serializatora.
- **Czego świadomie nie ruszamy:** `w:proofErr`, `w:lastRenderedPageBreak`,
  atrybuty `w:rsid*`, statystyki `docProps/app.xml`, `dcterms:modified`
  w `docProps/core.xml` — to pamięć podręczna/metadane, które Word
  przelicza sam; każda z tych „kosmetyk" to dotyk struktury bez zysku.

### 4.7 Weryfikowalna wierność serializacji

Ryzyko rezydualne podejścia DOM: XMLSerializer może zapisać równoważny XML
minimalnie inaczej niż źródło (samodomykanie pustych elementów, kolejność
deklaracji przestrzeni nazw w obrębie węzła). To jest **równoważność
infoset**, którą Word akceptuje, ale nie zakładam tego na wiarę: bramka
akceptacji MD3/MD6 zawiera test „zero podmian → część nie jest dotykana"
(niezmiennik §3.3 czyni ten przypadek bajtowo-identycznym) oraz złote pliki
otwierane w realnym Wordzie/LibreOffice po rekonstrukcji z podmianami.
**[DO WERYFIKACJI PRZEZ OPUSA: O-6]**

---

## §5. Zakres części i przypadki szczególne

### 5.1 Które części są przetwarzane

Rozwiązywane **po relacjach**, nie po zgadywanych nazwach plików:
`_rels/.rels` → część główna (typ relacji `officeDocument`) → jej
`word/_rels/document.xml.rels` → części typów: `header`, `footer`,
`footnotes`, `endnotes`. Przetwarzane silnikiem tokenów są więc:

| Część | Status | Uwaga |
|---|---|---|
| dokument główny | podmiana | tabele (`w:tbl` → `w:p` w komórkach), SDT/content-controls (`w:sdtContent` → `w:p`/`w:r`), hiperłącza (`w:hyperlink` → `w:r`) — wszystko pokrywa reguła „najbliższy przodek `w:p`" |
| nagłówki i stopki (wszystkie, w tym parzyste/pierwsza strona) | podmiana | **papier firmowy**: tu żyją wzmianki typu „Sygn. akt [CASE_NUMBER_1]" |
| przypisy dolne i końcowe | podmiana | struktura jak dokument (akapity/runy) |
| pola tekstowe / kanwy (`w:txbxContent`) | podmiana | zagnieżdżone `w:p` enumerowane jako własne akapity (§4.2 pkt 2); duplikat treści w `mc:AlternateContent` (Choice/Fallback) jest podmieniany **w obu** gałęziach, co utrzymuje je spójne |
| komentarze (`comments.xml`) | **raport-only** w v1 | tokeny w komentarzach nie są podmieniane (komentarz to warstwa robocza; wstrzykiwanie tam PII bez podglądu = ryzyko bez potrzeby); wykryte tokeny → raport; decyzja produktowa P-3 |
| kody pól (`w:instrText`, `w:fldSimple/@w:instr`) | **raport-only** | podmiana w instrukcji pola może zmienić jego działanie; token w **wyniku** pola (zwykłe `w:t` między separatorem a końcem pola) jest podmieniany normalnie |
| tekst usunięty w śledzeniu zmian (`w:delText`) | **raport-only** | §5.2 |
| pozostałe części (style, numeracja, ustawienia, motyw, czcionki, media, właściwości) | bajt-w-bajt | §3.3 |

### 5.2 Zmiany śledzone

`w:ins` (wstawienia) zawierają zwykłe `w:r`/`w:t` — podmiana działa
naturalnie. `w:delText` (treść usunięta) **nie jest** podmieniany: token
w usuniętym fragmencie to token, nie PII — pozostawienie go jest bezpieczne,
a wstrzyknięcie tam prawdziwych danych tworzyłoby PII w warstwie historii,
której użytkownik zwykle nie ogląda. Raport odnotowuje: „N tokenów w tekście
usuniętym (zmiany śledzone) — pozostawione". Rekomendacja produktowa:
pismo do podpisu i tak powinno mieć zaakceptowane zmiany (P-3).

### 5.3 Warianty OOXML poza zakresem v1 (odrzucane czytelnie, nie po cichu)

- **Strict OOXML** (namespace `purl.oclc.org/ooxml/…`): praktycznie
  nie występuje w plikach od Worda/generatorów AI; wykrycie → komunikat
  „format Strict OOXML nieobsługiwany" zamiast cichego zera podmian.
- **Makra** (`vbaProject` w `[Content_Types].xml`): odmowa przetwarzania
  (C-DOCX-9) — plik podszywający się pod .docx z makrem nie jest legalnym
  wejściem tego przepływu.
- **Zaszyfrowany kontener** (CFB/EncryptedPackage) i stary `.doc`:
  to nie jest ZIP → czytelny błąd formatu.

---

## §6. Fail-safe i raport rekonstrukcji (kwestia d)

### 6.1 Zasada

**Nigdy nie zgaduj.** Jedyna operacja zmieniająca treść to podmiana
**dokładnego literału tokenu obecnego w legendzie**. Wszystko inne —
token nieznany, token przerwany sentinelem, token o zniekształconej pisowni,
token w części raport-only — zostaje w dokumencie **widoczne** i trafia do
raportu. Dokument z pozostawionym tokenem jest bezpieczny (token to nie PII);
dokument z błędnie zgadniętą wartością to fałszywe pismo procesowe.

### 6.2 Raport (schemat danych, nie kod)

```json
{ "parts": [ { "part": "word/document.xml",
    "replaced": [ { "token": "[PERSON_NAME_1]", "count": 3 } ],
    "left":     [ { "token": "[PERSON_NAME_9]", "reason": "brak-w-legendzie",
                    "context": "…pozwany [PERSON_NAME_9] wnosi…" },
                  { "token": "[ADDRESS_1]", "reason": "przerwany-elementem" } ] } ],
  "reportOnly": [ { "part": "word/comments.xml", "tokens": 2 } ],
  "sanitized": 0,
  "egress": { "blocked": [], "hyperlinks": 1 },
  "totals": { "replaced": 14, "left": 1 } }
```

- **Skan rezyduów** po podmianie: gramatyka tokenów przechodzi ponownie po
  strumieniach wszystkich części przetwarzanych **i** raport-only
  (`instrText`, `delText`, komentarze) — wynik zasila `left`/`reportOnly`.
- `context` to ±40 znaków strumienia wokół rezyduum — tekst stokenizowany,
  renderowany w UI wyłącznie przez `textContent` (C-DOCX-4).
- UI: raport pod paskiem eksportu; `left.total > 0` → wyraźne ostrzeżenie
  „N tokenów pozostało w dokumencie — otwórz plik i uzupełnij ręcznie przed
  podpisem". Eksport **nie jest blokowany** przez rezydua (wynik jest
  bezpieczny, a użytkownik dostaje mapę braków); blokują go wyłącznie
  znaleziska egress (§9.3) i zero podmian (P-4).
  **[DO WERYFIKACJI PRZEZ OPUSA: O-5]**

### 6.3 Rozstrzygnięcie: zero podmian

Plik, w którym żaden token legendy nie został znaleziony, to niemal na pewno
pomyłka (zły plik, cudza legenda, AI przepisała tokeny). Rekomendacja:
eksport zablokowany komunikatem z listą tokenów legendy vs tokenów znalezionych
w pliku (P-4). Spójne z istniejącą bramką „eksport wymaga legendy tokenów".

### 6.4 Konwencja tokenów: prompty AI vs parser (kwestia c)

**Rozstrzygnięcie: niezawodność wyłącznie po stronie parsera.** Mechanizm
§4 nie wymaga od AI niczego poza przepisaniem tokenów jako zwykłego tekstu —
dowolnie pociętego przez edytor. Po stronie promptów (dokumentacja
użytkownika, `docs/`) pozostaje wyłącznie **niewiążąca higiena**: „tokenów
nie odmieniaj, nie tłumacz, nie zamieniaj na własne placeholdery" — bo AI,
która przepisze `[PERSON_NAME_1]` na `[Pozwany 1]`, wyprodukuje rezyduum
(§6.1), którego żaden parser nie odzyska bez zgadywania. Bezpieczeństwo
i poprawność **nie zależą** od przestrzegania tej higieny; zależy od niej
tylko wygoda (mniej ręcznych uzupełnień).

---

## §7. Skąd bierze się wejściowy .docx (kwestia b)

### 7.1 Ścieżka podstawowa: import pliku (warianty A i B, identycznie)

Użytkownik zapisuje .docx od AI na dysk (robi to klient AI — Claude
Desktop/Cowork/Codex — własnymi narzędziami, poza naszą aplikacją) i wskazuje
plik w zakładce Deanonimizuj. Wejście przechodzi istniejącą bramkę importu
(limit 25 MB, `src/file-import/index.js`). Ta ścieżka jest **jedyną** w v1
i czyni funkcję całkowicie niezależną od mostu: działa w wariancie A,
w wariancie B i w wydaniu webowym.

### 7.2 Ścieżka przez most (wariant B): świadomie NIE w v1

`write_outcome` mostu przenosi **tekst** i tak ma zostać. Rozważona
i odrzucona alternatywa — narzędzie `write_outcome_docx` (binarny payload
base64 przez potok):

1. **Konflikt z W2/O-9 mostu („pokazane = wysłane"):** bramka człowieka
   pokazuje dokładny payload; dla binarnego .docx musiałaby pokazywać
   ekstrakt/interpretację, czyli coś innego niż faktyczne bajty — dokładnie
   ten rozjazd, którego zakazuje gwarancja tożsamości payloadu.
2. Kierunek „do środka" i tak kończy się plikiem na dysku użytkownika
   (wynik rekonstrukcji), więc oszczędność wobec §7.1 to jedno okno wyboru
   pliku — zysk niewspółmierny do poszerzenia protokołu, limitów ramek
   i powierzchni walidacji.
3. Rekonstrukcja pozostaje czystą funkcją renderera; most pozostaje czystym
   kanałem tekstu. Ortogonalność = prostszy audyt obu projektów.

Jeżeli po doświadczeniach z użycia Alan uzna przepływ za uciążliwy, temat
wraca jako **osobny** projekt z własną bramką Opusa (P-6). Ten dokument
niczego w `MCP-BRIDGE-DESIGN.md` nie zmienia.

### 7.3 Higiena treści przy imporcie

Podgląd tekstowy (mammoth) importowanego pliku przechodzi przez istniejące
ścieżki (`textContent`, pigułki tokenów) — zero nowych sinków DOM. Nazwa
pliku, jak dziś, nigdy nie buduje ścieżki/URL-a/HTML-a (C-INP-3) i nie
przechodzi przez MCP (syntetyczny `mcpLabel` — bez zmian).

---

## §8. Punkt zaczepienia fleksji (kwestia e)

Cała podmiana przechodzi przez **jeden szew**:

```
resolveReplacement({ token, baseValue, contextBefore, contextAfter, part })
  → { text, note? }
```

- **v1:** implementacja tożsamościowa — `text = baseValue` (mianownik
  z legendy), `note` nieużywane.
- **Projekt (b) — moduł fleksji** podłącza się wyłącznie w tym miejscu:
  dostaje token, wartość bazową i kontekst strumienia (±N znaków **tekstu
  stokenizowanego** wokół trafienia — wystarczający do wykrycia przyimków
  i rekcji: „przeciwko [PERSON_NAME_1]" → dopełniacz), zwraca odmienioną
  formę i opcjonalną adnotację do raportu („odmieniono: Jana Kowalskiego").
- Kontrakt bezpieczeństwa szwu: funkcja jest **czysta i lokalna** (zero I/O,
  zero sieci, zero DOM), wynik przechodzi tę samą sanityzację §4.6 co wartość
  bazowa, a raport odnotowuje każdą różnicę względem formy bazowej —
  użytkownik widzi w raporcie, że wartość została odmieniona, nie podmieniona
  na inną. Istniejący płaski przepływ (`deanonymizeText`) może w przyszłości
  przejść przez ten sam szew — poza zakresem v1.

---

## §9. Model zagrożeń: niezaufany OOXML w module rekonstrukcji

Rozszerzenie S4 z `THREAT-MODEL.md` (granica G1). Aktywa bez zmian
(A1 legenda, A2 oryginały); nowy artefakt przejściowy: bajty .docx
i zrekonstruowany wynik w RAM renderera — klasa A2 (wynik zawiera pełne PII
z legendy, z definicji produktu).

### 9.1 S-DOCX-1: XXE i bomby encji w częściach XML

**Wektor:** `<!DOCTYPE` z encjami zewnętrznymi (wyciek/SSRF w klasycznych
parserach) albo rekurencyjnymi (billion laughs → DoS).
**Obrona, dwuwarstwowa, fail-closed:**
1. **Pre-skan przed parsowaniem:** część zawierająca `<!DOCTYPE` albo
   `<!ENTITY` jest odrzucana w całości → import kończy się błędem
   „nieprawidłowy dokument". OOXML **nigdy** legalnie nie zawiera DTD, więc
   zero fałszywych blokad. To jest kontrola podstawowa — niezależna od
   właściwości jakiegokolwiek parsera.
2. DOMParser w Chromium nie wykonuje I/O dla DTD (brak resolvera encji
   zewnętrznych; a nawet hipotetyczne żądanie zatrzymują CSP `connect-src`
   i strażnik sieci — warstwy §3/§6 `SECURITY.md`). Traktowane wyłącznie
   jako głębia obrony, nie podstawa.
Detekcja błędów parsowania: dokument-wynik `parsererror` → odrzucenie części
i całego eksportu (nie „pomiń część"). **[DO WERYFIKACJI PRZEZ OPUSA: O-3]**

### 9.2 S-DOCX-2: bomba dekompresyjna / wrogi kontener ZIP

**Wektory:** rozdęte wpisy (deflate 1:1000+), tysiące wpisów, duplikaty nazw
(rozjazd „co skanuję" vs „co kopiuję"), zagnieżdżone/nakładające się wpisy,
ZIP64, szyfrowanie, egzotyczne metody kompresji.
**Obrona (allow-lista, fail-closed):**
- metody wyłącznie 0 (store) i 8 (deflate); flaga szyfrowania, ZIP64,
  patch-data → odrzucenie pliku;
- limity: ≤ 2048 wpisów; dekompresji podlegają **wyłącznie** części
  inspekcji i części tokenowe (§3.3), każda ≤ 50 MiB po rozpakowaniu
  (licznik w strumieniu dekompresji, przekroczenie = natychmiastowe
  przerwanie), suma rozpakowanych ≤ 200 MiB;
- **duplikat nazwy wpisu = odrzucenie pliku** (usuwa całą klasę ataków
  „inna kopia dla skanera, inna dla składacza");
- nazwy wpisów są kluczami w pamięci, nigdy ścieżkami: **zip-slip nie
  istnieje w tym projekcie z konstrukcji** — nic nie jest rozpakowywane na
  dysk, `../` w nazwie to po prostu nieznany klucz kopiowany verbatim;
- kolizja z istniejącym limitem importu: plik > 25 MB odpada wcześniej
  (C-INP-10). **[DO WERYFIKACJI PRZEZ OPUSA: O-1]**

### 9.3 S-DOCX-3: egress przez wynikowy dokument (wymaganie W4)

**Wektor:** wynik rekonstrukcji zawiera pełne PII. Jeśli plik od AI zawiera
odwołania zewnętrzne, otwarcie wyniku w Wordzie może je odpalić:
`attachedTemplate` na UNC/HTTP (klasyczny wyciek NTLM i sygnału otwarcia),
obraz linkowany (`TargetMode="External"`), `INCLUDEPICTURE`/`INCLUDETEXT`/
`DDEAUTO` w kodach pól, ramki `subDoc`/`frame`.
**Obrona:**
1. **Moduł niczego nie dodaje** — zbiór relacji i części wejścia i wyjścia
   jest identyczny; test C-DOCX-5 porównuje komplet `.rels` przed/po
   (bajt-w-bajt, bo `.rels` nigdy nie są modyfikowane).
2. **Inspekcja wejścia** (krok 2, §3.1): wszystkie `*.rels` +
   `word/settings.xml` + kody pól są skanowane; klasyfikacja:
   - `hyperlink` z `TargetMode="External"` — **dozwolone** (zwykłe łącze
     klikane świadomie przez człowieka; standard w pismach), liczone
     i pokazane w raporcie;
   - wszystko inne zewnętrzne (obrazy zdalne, `attachedTemplate`, `subDoc`,
     `frame`, OLE, pola INCLUDE*/DDE*) — **blokada eksportu** z listą
     znalezisk w raporcie; w v1 bez przycisku „mimo to" (P-2).
   Skan wykonuje się przy imporcie (użytkownik widzi problem od razu),
   wynik jest zapisany w `docx.inspection` i egzekwowany ponownie przy
   eksporcie. **[DO WERYFIKACJI PRZEZ OPUSA: O-2]**

### 9.4 S-DOCX-4: wstrzyknięcie XML przez wartości legendy

**Wektor:** wartości legendy pochodzą ze **źródłowych** dokumentów (Z3);
spreparowany dokument źródłowy może podsunąć encję o wartości
`</w:t><w:evil/>…`, licząc na sklejanie stringów XML.
**Obrona:** zamknięte z konstrukcji — wartości wchodzą wyłącznie jako węzły
tekstowe DOM (§2.1 pkt 2), serializator escapuje; sanityzacja §4.6 usuwa
znaki sterujące. Test C-DOCX-6 zawiera złośliwe wartości legendy.
**[DO WERYFIKACJI PRZEZ OPUSA: O-3]**

### 9.5 S-DOCX-5: podmiana treści niezauważona przez użytkownika

**Wektor:** plik od AI (albo skompromitowany klient AI) zawiera treść inną
niż zatwierdzona w rozmowie — np. zmieniony numer rachunku do zapłaty;
rekonstrukcja nadaje jej wiarygodną formę pisma na papierze firmowym.
**Obrona i jej granice, uczciwie:** to ryzyko istnieje dziś w każdym
przepływie „AI generuje pismo" i nie jest tworzone przez ten moduł; moduł
je **zmniejsza** raportem (liczby podmian, rezydua) i niczym więcej. Pismo
przed podpisem czyta radca — kontrola pozostaje ludzka (analogia do RB-3
mostu). Odnotowane jako rezyduum, nie do rozwiązania technicznie w tym
projekcie.

### 9.6 S-DOCX-6: DoS złożonościowy

**Wektor:** milion pustych akapitów/runów, patologiczne zagnieżdżenia SDT,
gigantyczne pojedyncze akapity.
**Obrona:** limity §9.2 ograniczają surowiec (≤ 50 MiB XML na część);
algorytm §4 jest liniowy po liczbie węzłów (jedno przejście poddrzewa na
akapit, mapa segmentów bez backtrackingu); brak rekurencji zależnej od
głębokości poza parserem platformy. Zamrożenie wątku UI na skrajnym pliku
kończy się jak każde długie zadanie — bez utraty danych; przeniesienie pod
Web Lock w razie potrzeby (§3.1).

### 9.7 Ryzyka rezydualne modułu

| ID | Ryzyko | Dlaczego zostaje | Zarządzanie |
|---|---|---|---|
| RD-1 | wynik .docx z pełnym PII ląduje na dysku użytkownika | to jest cel produktu (pismo do podpisu) | jawne pobranie na kliknięcie; dalej działa BitLocker (Z5) i higiena stanowiska — jak przy dzisiejszym eksporcie płaskim |
| RD-2 | Word może przeliczyć/wyrenderować dokument inaczej niż producent pliku | właściwość formatu, nie modułu | złote pliki + test otwarcia w Wordzie/LibreOffice (MD6) |
| RD-3 | treść merytoryczna pisma pochodzi od AI (S-DOCX-5) | poza granicą modułu | raport + obowiązkowa lektura przed podpisem (dokumentacja) |
| RD-4 | tokeny, których AI nie przepisała wiernie, wymagają ręcznego uzupełnienia | granica fail-safe (W5) | raport z kontekstem; higiena promptów §6.4 |

---

## §10. Wpływ na wariantowość i istniejące gwarancje

- **Zero zmian w `electron/`.** Moduł żyje w `src/` (renderer, wspólny dla
  webu i obu wariantów desktopu). Asercje artefaktów wariantów
  (`MCP-BRIDGE-DESIGN.md` §8.3) nietknięte; C-NET-6 nietknięte; fuses,
  CSP (§6 `SECURITY.md`), strażnik sieci — bez jednej zmienionej linii.
- **Air-gap:** przebieg rekonstrukcji nie generuje żadnego żądania —
  istniejące kryterium `networkBlock.blockedTotal === 0` w testach dymnych
  obejmie nowy krok (MD6 dodaje import+eksport .docx do `desktop:smoke`).
- **Legenda (A1):** czytana w chwili eksportu w rendererze, jak przy
  eksporcie płaskim; nie jest serializowana do żadnej struktury pośredniej
  poza planem podmian w RAM; kanały IPC — bez zmian (żaden nie istnieje dla
  tej funkcji). **[DO WERYFIKACJI PRZEZ OPUSA: O-7]**
- **Trwałość:** bajty wejścia i wyniku wyłącznie w RAM; jedyny artefakt
  dyskowy to plik pobrany jawnie przez użytkownika (istniejący
  `downloadBlob`, z `URL.revokeObjectURL`). Zgodne z D2/D3.
- **Web:** funkcja działa też w wydaniu webowym (te same API platformy);
  detekcja braku `DecompressionStream` → czytelny komunikat zamiast awarii.
- **CSP:** bez zmian — żadnego `eval`, żadnych nowych źródeł, blob-URL już
  dozwolony dla pobrań.

---

## §11. Wpływ na SECURITY-CHECKLIST.md i pozostałe dokumenty

### 11.1 Nowe pozycje checklisty (sekcja 3, „Wejście niezaufane")

| ID | Pozycja (skrót) |
|---|---|
| C-DOCX-1 | części XML parsowane wyłącznie po pre-skanie odrzucającym `<!DOCTYPE`/`<!ENTITY`; `parsererror` = twarde odrzucenie (test z plikami XXE/billion-laughs) |
| C-DOCX-2 | kontener ZIP: allow-lista metod (store/deflate), odrzucenie szyfrowania/ZIP64/duplikatów nazw; limity: ≤ 2048 wpisów, ≤ 50 MiB/część, ≤ 200 MiB sumarycznie; dekompresja wyłącznie części inspekcji i tokenowych |
| C-DOCX-3 | zero zapisu na dysk w przetwarzaniu (zip-slip strukturalnie niemożliwy); bajty wejścia/wyniku wyłącznie w RAM renderera |
| C-DOCX-4 | treść i raport z .docx trafiają do DOM wyłącznie przez `textContent`/`createTextNode` (rozszerzenie C-INP-1 na nowe UI) |
| C-DOCX-5 | wynik nie wnosi żadnej nowej relacji/części/odwołania: komplet `*.rels` wejścia i wyjścia bajtowo identyczny (test automatyczny) |
| C-DOCX-6 | podmiana wyłącznie literałów tokenów obecnych w legendzie, przez węzły tekstowe DOM; test ze złośliwymi wartościami legendy (znaczniki, encje, znaki sterujące) |
| C-DOCX-7 | fail-safe: token nieznany/przerwany/w części raport-only pozostaje widoczny i policzony w raporcie; zero heurystyk podmiany |
| C-DOCX-8 | odwołania zewnętrzne wejścia: klasyfikacja wg §9.3; nie-hiperłącza blokują eksport; hiperłącza raportowane |
| C-DOCX-9 | `vbaProject`/makra, Strict OOXML, kontener niebędący ZIP → odmowa z czytelnym błędem (nigdy ciche zero podmian) |
| C-DOCX-10 | części bez podmian kopiowane bajt-w-bajt (test porównuje strumienie skompresowane); liczniki raportu pochodzą z silnika, nie z podglądu tekstowego |

### 11.2 Zmiany pozycji istniejących

- **C-INP-5:** dopisek — obok mammoth (ekstrakcja) istnieje drugi konsument
  DOCX (`src/docx-rebuild/`), z własnym reżimem C-DOCX-1/2; pozycja
  rozszerza się o odsyłacz.
- **C-INP-10:** bez zmian (limit 25 MB obejmuje nowy import tą samą bramką).
- **C-PERS-1:** dopisek — bajty .docx w RAM jak tekst dokumentów; zero
  nowych magazynów.
- Sekcja „Testy przed wydaniem": `desktop:smoke` rozszerzony o przebieg
  import → rekonstrukcja → weryfikacja podmian i licznika blokad (MD6).

### 11.3 Pozostałe dokumenty

- **THREAT-MODEL.md:** S4 zyskuje odsyłacz do §9 tego dokumentu (scenariusze
  S-DOCX-1…6, rezydua RD-1…4); tabela STRIDE — wiersz „bomba dekompresyjna"
  rozszerzony o limity C-DOCX-2.
- **SECURITY.md:** §14 (rejestr odłożonych) — pozycja „formatowany eksport
  deanonimizacji" przechodzi z planów do zrealizowanych po MD6.
- **CLAUDE.md / docs:** nowy `docs/docx-rebuild.md` (instrukcja użytkownika:
  przepływ, higiena promptów §6.4, znaczenie raportu, dlaczego niektóre
  pliki są blokowane §9.3).

---

## §12. Plan implementacji dla Sonneta

Zasady nadrzędne: (1) każdy moduł dotyka niezaufanego wejścia albo legendy,
więc **każdy** przechodzi bramkę Opusa przed merge; (2) zero nowych
zależności runtime; (3) testy jednostkowe wchodzą z modułem, nie po nim;
(4) złote pliki testowe (`test-data/docx/`) powstają w MD1 i rosną z każdym
modułem: minimum to pismo z papierem firmowym (nagłówek/stopka), tokenami
rozbitymi między runy (proofErr/rsid), tabelą, przypisem, polem tekstowym,
zmianami śledzonymi, oraz pliki wrogie (XXE, billion laughs, bomba deflate,
duplikaty wpisów, `attachedTemplate`, obraz zdalny, makro).

| Moduł | Zakres | Kryteria akceptacji (skrót) | Bramka Opusa |
|---|---|---|---|
| **MD1** `zip-reader` | katalog centralny, ekstrakcja wpisu na żądanie przez `DecompressionStream`, limity i allow-listy §9.2; fixture'y złote i wrogie | testy node-env: poprawny odczyt złotych; każdy wrogi plik odrzucony właściwym błędem; limit rozmiaru przerywa strumień (pomiar, nie deklaracja); C-DOCX-2/3 | tak (parser niezaufanego wejścia) |
| **MD2** `zip-writer` | rekompozycja: verbatim-copy wpisów nietkniętych z metadanymi źródła, nowe wpisy deflate/store z CRC; wyniesienie `crc32` do modułu współdzielonego z `src/export/zip.js` (eksporty płaskie bez regresji) | round-trip bez modyfikacji = bajtowo identyczne wpisy; wynik otwiera się w Word/LibreOffice; `npm test` bez regresji eksportów | tak (integralność wyniku) |
| **MD3** `ooxml-inspect` | `[Content_Types].xml`, rozwiązanie części po relacjach, klasyfikacja relacji zewnętrznych §9.3, detekcja makr/Strict, pre-skan DOCTYPE | testy: każda klasa znaleziska na osobnym fixturze; hiperłącze przechodzi, `attachedTemplate` blokuje; C-DOCX-1 (pre-skan), C-DOCX-8/9 | tak (decyzje egress) |
| **MD4** `token-engine` | strumień akapitu + mapa segmentów + sentinele (§4.2), dopasowanie po wspólnej gramatyce tokenów (konsolidacja trzech kopii), plan podmian, reguła pierwszego runu (§4.4), `xml:space`, sanityzacja, szew `resolveReplacement` (§8), raport + skan rezyduów (§6.2) | testy jsdom-env na spreparowanych fragmentach XML: token w 1/2/3 runach, na styku formatowań, przez proofErr, w tabeli/przypisie/nagłówku/txbx (Choice+Fallback), przerwany `w:br`/`w:tab` (pozostaje + raport), nieznany token, wartość złośliwa (C-DOCX-6), spacje brzegowe (`xml:space`), dwa tokeny w akapicie, zero podmian; C-DOCX-6/7 | tak (jedyny konsument legendy) |
| **MD5** orkiestrator + UI | `rebuildDocx(bytes, legend, resolveReplacement)` spinający MD1–MD4; import w zakładce Deanonimizuj (§3.4), plakietka DOCX, blokada edycji podglądu, eksport przez rekonstrukcję, rendering raportu (`textContent`), blokady eksportu (§6.3, §9.3) | e2e Playwright w realnym Chromium: złoty plik → import → eksport → rozpakowanie wyniku w teście → tokeny podmienione, formatowanie/`.rels` nietknięte (C-DOCX-5/10), rezydua zgodne z raportem; eksporty płaskie bez regresji | tak (UI na niezaufanej treści + legenda) |
| **MD6** dowody całości | krok w `desktop:smoke` (+ `:packaged`, `:offline`): import wrogiego i złotego pliku, `blockedTotal === 0`; ręczny test otwarcia wyników w Wordzie (papier firmowy wzrokowo nienaruszony); aktualizacja `SECURITY-CHECKLIST.md` (C-DOCX-1…10), `THREAT-MODEL.md`, `docs/docx-rebuild.md`; pomiar czasu na realnym piśmie (§3.1) | wszystkie smoke'i zielone w trybie repo i spakowanym; checklista uzupełniona ze statusami PASS/FAIL popartymi testami | tak (dowód całości) |

Kolejność: MD1 → MD2 → MD3 → MD4 → MD5 → MD6. MD1+MD2 są parą (kontener),
MD3 i MD4 można rozwijać równolegle po MD1. Fixture'y wrogie powstają
w MD1/MD3 razem z kodem, który mają łamać.

---

## §13. Rejestr pozycji DO WERYFIKACJI PRZEZ OPUSA

Numeracja lokalna dla tego dokumentu. Każda pozycja dotyka niezaufanego
wejścia albo legendy — zgodnie z regułą bramki żadna nie jest przesądzona
do czasu decyzji Opusa.

| ID | Kwestia | Propozycja projektu | Ryzyko przy błędzie |
|---|---|---|---|
| **O-1** | własny czytnik ZIP jako parser niezaufanego wejścia (§9.2, MD1) | allow-listy + limity + duplikaty = odrzucenie; dekompresja tylko części potrzebnych | przeoczony wariant kontenera = wejście dla bomby/rozjazdu skaner-vs-składacz |
| **O-2** | klasyfikacja relacji zewnętrznych i polityka blokady (§9.3) | hiperłącza dozwolone (raport), cała reszta zewnętrzna blokuje eksport, bez override w v1 | zbyt wąska lista typów = egress w wyniku z PII; zbyt szeroka = blokada legalnych pism |
| **O-3** | DOCTYPE-reject jako kontrola podstawowa + wartości legendy wyłącznie jako węzły tekstowe DOM (§9.1, §9.4) | pre-skan fail-closed; zakaz sklejania stringów XML w całym module | XXE/bomba encji; wstrzyknięcie znaczników z wrogiego dokumentu źródłowego |
| **O-4** | konsolidacja gramatyki tokenów do jednego modułu i dopasowanie literalne (§4.3) | jedna gramatyka współdzielona z `anonymizer`/`listings`/UI; koordynacja z M4 mostu | dwie gramatyki = token podmieniony w tekście, a niewidoczny dla skanu rezyduów (albo odwrotnie) |
| **O-5** | wiarygodność raportu: liczniki wyłącznie z silnika, kontekst rezyduów w UI przez `textContent`, eksport mimo rezyduów (§3.4, §6.2) | jak w §6 | raport rozjechany z zawartością pliku = fałszywe poczucie kompletności przed podpisem pisma |
| **O-6** | wierność serializacji XMLSerializer wobec Worda (§4.7) | niezmiennik bajt-w-bajt dla części bez podmian + złote pliki w realnym Wordzie dla części z podmianami | uszkodzony dokument / monit naprawy Worda na piśmie do podpisu |
| **O-7** | brak jakiejkolwiek nowej ścieżki legendy poza renderer (§10) | zero IPC, zero trwałości, plan podmian wyłącznie w RAM | regresja gwarancji A1 z `SECURITY.md` §9 |
| **O-8** | zakres części v1: komentarze/`delText`/`instrText` raport-only (§5) | podmiana tylko w warstwie widocznej; rezydua raportowane | PII wstrzyknięte w warstwy ukryte dokumentu albo — przy zbyt wąskim skanie — tokeny przeoczone w raporcie |
| **O-9** | sanityzacja wartości i `xml:space` (§4.6) | C0→spacja z adnotacją; atrybut dodawany przy białych znakach brzegowych | utrata spacji w piśmie albo niezdefiniowane znaki w `w:t` |

---

## §14. Decyzje produktowe do potwierdzenia przez Alana

| ID | Decyzja | Rekomendacja projektu |
|---|---|---|
| P-1 | nazwa funkcji w UI | przycisk importu: „Importuj pismo od AI (DOCX)"; eksport bez osobnej nazwy — istniejący „Eksportuj DOCX" po prostu zachowuje formatowanie dla wpisów DOCX; plakietka „DOCX" na karcie wyniku |
| P-2 | polityka blokady przy zewnętrznych odwołaniach (§9.3): twarda czy z przyciskiem „eksportuj mimo to" | **twarda w v1** (bez override): przypadki legalnych pism z zewnętrznymi szablonami/obrazami zdalnymi są w praktyce zerowe, a każdy override uczy klikania; wrócić po realnych zgłoszeniach |
| P-3 | komentarze i zmiany śledzone: raport-only (§5.2) czy podmiana także tam | **raport-only**; zalecenie w dokumentacji: pismo do podpisu = zmiany zaakceptowane, komentarze usunięte (można dodać tę wskazówkę do raportu, gdy warstwy wykryto) |
| P-4 | zachowanie przy zerze podmian (§6.3) | **blokada eksportu** z czytelną diagnozą (zły plik / cudza legenda / AI przepisała tokeny); eksport płaski tekstowy pozostaje dostępny jak dziś |
| P-5 | czy podgląd tekstowy importowanego .docx ma być tworzony zawsze | tak — natychmiastowy podgląd z pigułkami tokenów w istniejących panelach; edycja zablokowana (źródłem prawdy są bajty, §3.4) |
| P-6 | przyszły kanał binarny przez most (`write_outcome_docx`, §7.2) | **nie w v1**; wraca wyłącznie jako osobny projekt z bramką Opusa, jeśli praktyka pokaże, że okno wyboru pliku realnie boli |
| P-7 | fleksja (§8) | v1 wstawia formę bazową (mianownik z legendy); raport nie udaje odmiany; moduł fleksji jako projekt (b) podłącza się do gotowego szwa |

---

*Koniec projektu. Następny krok: bramka Opusa nad §13 (O-1…O-9), decyzje
Alana nad §14 (P-1…P-7), potem implementacja wg §12 (MD1…MD6), moduł po
module, każdy przez pełną bramkę.*
