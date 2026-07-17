# PRODUCT-DECISIONS.md — decyzje produktowe Alana (finalne)

**Data:** 2026-07-11
**Status:** zatwierdzone przez Alana; wiążące dla implementacji.
**Źródło:** decyzje P z `MCP-BRIDGE-DESIGN.md` §14, `DOCX-REBUILD-DESIGN.md` §14,
`LOCAL-VERIFIER-DESIGN.md` §13. Ten plik jest jedynym źródłem prawdy o
rozstrzygnięciach; przy rozbieżności z §14/§13 projektów wygrywa ten plik.

Cztery decyzje odbiegają od rekomendacji projektów (oznaczone **[ZMIANA]**):
most domyślnie wstrzymany (2), dłuższy timeout z keep-alive (5), miejscowości
z form poświadczonych w v1 (13), wskazówki przypadka od LLM w v1 (17).

---

## Most MCP (wariant B) — projekt `MCP-BRIDGE-DESIGN.md`

| # | Decyzja | Rozstrzygnięcie |
|---|---|---|
| 1 | Nazwy wariantów, appId/productName | A = „Lokalny anonimizator"; **B = „Lokalny anonimizator + AI"**. Rozłączne `appId` i `productName` (wymóg techniczny: instalacja obok siebie, osobny profil). |
| 2 | Most aktywny od startu | **[ZMIANA — alternatywa]** Most **domyślnie WSTRZYMANY**. Widoczny wskaźnik stanu + jawny włącznik „Włącz most"; rusza dopiero po świadomym włączeniu. Zmienia §5.5 projektu (stan startowy: wstrzymany, nie aktywny). |
| 3 | Bramka także dla `list_sources`/`list_outcomes` | **Tak** — każde narzędzie przez bramkę, w tym listy (bramka kompaktowa dla samych list). Jedna reguła: „nic nie wychodzi bez kliknięcia". |
| 4 | Eksport dziennika mostu do pliku | **Nie w v1** (zasada „zero plików dziennika", D3; dziennik ulotny w RAM). |
| 5 | Timeout bramki i opóźnienie „Wyślij" | **[ZMIANA]** Timeout **180 s** (nie 120) **z keep-alive** przez powiadomienia postępu (O-8/§6.4 — podtrzymuje wywołanie mimo namysłu). Opóźnienie aktywacji „Wyślij" ~1,5 s. Kalibracja w matrycy klientów M8; jeśli klient zrywa przy 180 s mimo keep-alive, zejść dla niego niżej. |

## DOCX — rekonstrukcja formatowania — projekt `DOCX-REBUILD-DESIGN.md`

| # | Decyzja | Rozstrzygnięcie |
|---|---|---|
| 6 | Nazwa funkcji w UI | Przycisk „Importuj pismo od AI (DOCX)"; plakietka „DOCX" na karcie wyniku; eksport bez nowej nazwy (istniejący „Eksportuj DOCX" zachowuje formatowanie dla wpisów DOCX). |
| 7 | Zewnętrzne odwołania w pliku od AI | **Twarda blokada w v1, bez „eksportuj mimo to"** (hiperłącza dozwolone i raportowane; reszta zewnętrzna — obrazy zdalne, `attachedTemplate`, `subDoc`, pola INCLUDE/DDE — blokuje eksport). |
| 8 | Komentarze i zmiany śledzone | **Raport-only** (nie wstrzykiwać PII w komentarze/`delText`; tokeny tam → raport). |
| 9 | Zero podmian (żaden token nie pasuje) | **Blokada eksportu z diagnozą** (zły plik / cudza legenda / AI przepisała tokeny); eksport płaski tekstowy pozostaje jak dziś. |
| 10 | Podgląd tekstowy importowanego .docx | **Zawsze**, z pigułkami tokenów; **edycja podglądu zablokowana** (źródłem prawdy są bajty .docx). |
| 11 | Kanał binarny .docx przez most (`write_outcome_docx`) | **Nie w v1** (import pliku z dysku wystarcza; binarny payload kłóci się z „pokazane = wysłane"). |
| 12 | Fleksja w module DOCX | **v1 wstawia formę bazową z legendy**; odmiana dochodzi projektem (b) przez gotowy szew `resolveReplacement` (§8). |

## Lokalny weryfikator i fleksja — projekt `LOCAL-VERIFIER-DESIGN.md`

| # | Decyzja | Rozstrzygnięcie |
|---|---|---|
| 13 | Zakres fleksji v1 | `PERSON_NAME` pełny potok; organizacje i pseudonimy **tylko z form poświadczonych**. **[ZMIANA — kompromis]** Miejscowości (`LOCATION`): w v1 **z form poświadczonych** (jeśli dokument źródłowy ma odmienioną formę „w Toruniu", użyj jej; sam mianownik → flaga); **pełna generacja z mianownika w v1.1** (wymaga drugiej bazy TERYT/SGJP). |
| 14 | Zbiorcze „Zatwierdź wszystkie pewne (N)" | **Tak** — jeden gest, wyłącznie dla sugestii wysokiej pewności; niepewne zawsze per sztuka. |
| 15 | Poziom 3 (wbudowany LLM WASM) | **Decyzja po v1**; jeśli tak — najpierw benchmark (W9), komponent opcjonalny, nie w domyślnym instalatorze. |
| 16 | LM Studio | **(b) ścieżka ręczna „Kopiuj pakiet weryfikacyjny" od zaraz** (schowek + gotowy prompt, zero kanału). **(c) integracja API — najwyżej po v1, osobny projekt + osobna bramka, tylko wariant B.** (a) brak = domyślny stan wariantu A. |
| 17 | Wskazówki przypadka od LLM (`[PERSON_NAME_1\|D]`) | **[ZMIANA — alternatywa, z warunkiem]** **Tak w v1**, jako **niewiążąca wskazówka**: parser ścisły (`\|M/D/C/B/N/Ms/W`, wszystko inne = zwykły token), dane niezaufane (nigdy polecenie), tylko dodatkowy głos w kaskadzie K2. **Warunek: wprowadzić RAZEM z konsolidacją gramatyki tokenów** (wspólna warstwa), nie osobno — inaczej rozjazd kontraktu w trzech miejscach. |
| 18 | Start poziomu 2 (ponowny NER) | **Przycisk „Sprawdź krzyżowo"** w v1 (koszt inferencji zauważalny; auto jako opcja później). |
| 19 | Nazwa funkcji w UI | **„Weryfikacja pisma"**. |

## Audyt recall — projekt `EVAL-RECALL-AUDIT.md`

| # | Decyzja | Rozstrzygnięcie |
|---|---|---|
| 20 | Kategorie szczególne (art. 9-10 RODO) w domyślnej konfiguracji (A12) | **Włączone domyślnie** (zgodnie z rekomendacją audytu). `DEFAULT_ENABLED_CATEGORIES` obejmuje `health-biometric` i `special-categories`, więc ustawienie domyślne maskuje dane o zdrowiu, biometrii, wyznaniu, poglądach, orientacji, przynależności związkowej, pochodzeniu i karalności. Uzasadnienie: nadmiar maskowania jest odwracalny (użytkownik widzi `[HEALTH_1]` i cofa), przeciek do LLM-a nie; koszt zerowy (oba modele już ładowane dla kategorii tożsamości/kontaktu, `requiredSources` bez zmian). Zamyka ustalenie α audytu (przy pustym `localStorage` `main.js` startuje z `defaultEnabledEntities()`, dotąd bez art. 9-10 → recall 0 na najcięższych danych). |
| 21 | Wariant modelu w instalatorze desktopowym (C4, ustalenie β audytu) | **Desktop dystrybuuje warianty jakości web (fp32/fp16), NIE q8.** Priorytet: jakość ≥ oryginał webowy, nigdy gorzej — świadomie większy instalator (~+1,6 GB modeli). Znosi regresję q8 z §11 audytu (syntetyczny F1 86,0→92,6, HEALTH_DATA 13,3→100, pełne wycieki wagi ≥4 13→5) i sprawia, że desktop = jakość mierzona w evalu. Implementacja: usunięcie override'u q8 w `entity-sources.js`, repack artefaktów fp32/fp16, **regeneracja `models/manifest.json` i re-weryfikacja łańcucha integralności B1** (bramka Opusa). Warunek pomiaru przed wydaniem: bench pamięci/latencji fp32 na WASM na sprzęcie kancelaryjnym (czy ścieżka GPU działa na desktopie; jeśli fp32-WASM za ciężki, dopuszczalny floor to fp16 obu modeli, o ile eval nie pokaże regresji względem web). |

---

## Skutki dla implementacji (dla Sonneta, przy planie z SHARED-FOUNDATION)

- **Decyzja 17 wiąże się z wspólną warstwą — konkret dla S1 (bramka Opusa
  2026-07-11).** `SHARED-FOUNDATION-DESIGN.md` powstał przed tą decyzją i w §1.3
  zakłada „anotacja przypadka poza v1" — to nieaktualne. S1 (kontrakt §3.2)
  rozszerza się o **opcjonalną** anotację: `[TYP_INDEKS]` albo
  `[TYP_INDEKS|PRZYPADEK]`, parser ścisły (`|M/D/C/B/N/Ms/W`; każda inna treść
  po `|` = NIE token). `tokenId` pozostaje bez anotacji
  (`[PERSON_NAME_1|D]` → `tokenId = "PERSON_NAME_1"`), żeby `legend[token]`
  działał niezmieniony; `findTokens` zwraca dodatkowo `case?`. Token bez
  anotacji = zachowanie dzisiejsze (wsteczna zgodność, `case = undefined`).
  Semantyka (przypadek jako głos w kaskadzie) zostaje w W3 weryfikatora (§3.6);
  S1 tylko parsuje. Aktualizuje O-WER-9 / P-WER-5 („tak w v1") i §1.3
  SHARED-FOUNDATION.
- **Decyzja 2 zmienia bootstrap mostu:** serwer potoku i plik sesyjny powstają
  dopiero po jawnym włączeniu, nie przy starcie aplikacji.
- **Decyzja 13 (miejscowości z form poświadczonych)** korzysta z tej samej
  struktury „form poświadczonych" co nazwiska — bez drugiej bazy w v1.
- **Decyzja 5** wymaga mechanizmu keep-alive w adapterze (M6) i pomiaru
  zachowania klientów w M8.

---

## Scope-tiers / decyzje po sprincie Fable (2026-07-18)

- **O-ST-4: liczba do materiałów = recall W1-only, cel ≥95%.** Benchmark marketingowy
  mierzy recall na rzeczywistych danych osobowych (warstwa `mask`/W1), nie „ogółem".
  „Ogółem" (76% F1) i W1 (dziś 86,5% F1, holdout 206 all-mask) liczą INNY mianownik –
  nie porównywać wprost. 95%+ to cel, nie deklaracja końcowa. (Decyzja Alana.)
- **O-ST-2: art. 9-10 + identyfikatory (waga 5) NIE w trwałym słowniku przeglądu.**
  Decyzje o nich per dokument, w RAM; blokada przy zapisie i odczycie `localStorage`.
  Poluzowanie wymaga jawnej zgody Alana. (Realizacja: `03f664f`.)
- **GATE-SCOPE** (werdykt w `GATE-SCOPE.md`): stos scope-tiers zbramkowany i zintegrowany
  na `integration/sprint` (2477 testów zielonych, main nietknięty); aktywacja warstwowości
  ZABLOKOWANA do B6 (H-3: 8 wycieków wagi ≥4 na 49 dok.). Sprzątanie sprintu naprawiło 5
  defektów w kodzie z zielonymi testami (wyciek W1 na most, błąd licznika tokenów, dziura
  D2, wyciek sygnatury EPU Nc-e, martwa rekonstrukcja DOCX omijająca 2 bramki).
