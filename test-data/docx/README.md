# Złote i wrogie pliki DOCX (DOCX-REBUILD, MD6)

Zestaw wejść do rekonstrukcji chirurgicznej (`src/docx-rebuild/`). Pliki są
generowane deterministycznie: `node scripts/generate-docx-rebuild-goldens.mjs`
odtwarza każdy bajt w bajt (zerowe znaczniki czasu w ZIP), więc dowolny diff
w gicie oznacza zmianę generatora, nigdy zegara.

Semantyka każdego pliku jest przypięta testem `src/docx-rebuild/goldens.test.js`,
który czyta TE pliki z dysku i przepuszcza przez prawdziwy silnik: to, co
poniżej obiecujemy, jest sprawdzane maszynowo przy każdym `npm test`.

## Inwentarz

| Plik | Co zawiera | Oczekiwane zachowanie aplikacji |
|---|---|---|
| `golden-pismo.docx` | token w całym runie, token rozcięty między dwa runy, token w tekście hiperłącza, token w wyniku pola `fldSimple`, token we wstawce trybu śledzenia zmian (`w:ins`), token w tekście usuniętym (`w:delText`), tokeny w nagłówku i stopce, 1 hiperłącze zewnętrzne (`sip.legalis.pl`) | import przechodzi; eksport `ok`: 8 podmian, 0 pozostawionych; warstwa „tekst-usunięty" w raporcie jako pozycja informacyjna (1 token, nieruszany); hiperłącze zliczone, NIE blokuje |
| `hostile-egress-template.docx` | poprawny DOCX z tokenem, ale relacja `attachedTemplate` → `http://evil.example/szablon.dotm` | eksport zablokowany (`blocked-egress`), komunikat wskazuje typ odwołania; zero bajtów wyniku |
| `hostile-doctype-xxe.docx` | `<!DOCTYPE` z encją `SYSTEM file:///…` w `document.xml` | odmowa na pre-skanie (kod `DOCTYPE`), zanim jakikolwiek parser XML zobaczy bajt |
| `hostile-billion-laughs.docx` | `<!DOCTYPE` z zagnieżdżonymi encjami (bomba encji) | jak wyżej: odmowa `DOCTYPE` |
| `hostile-macros.docx` | wpis `vbaProject.bin` (kontener makr przebrany za .docx) | odmowa `MACROS` z czytelnym błędem, nigdy ciche „0 podmian" |
| `hostile-not-a-zip.docx` | RTF udający DOCX (to w ogóle nie jest ZIP) | odmowa warstwy kontenera (`ZipFormatError`) |

## Ręczny test MD6 (Word / LibreOffice) — dla Alana

Cel: potwierdzić RD-2 (rendering Worda) i wizualną nienaruszalność „papieru
firmowego" — tego żaden test automatyczny nie zobaczy.

1. `npm run dev`, zanonimizuj dowolny dokument, który da w legendzie tokeny
   `[PERSON_NAME_1]`, `[PERSON_NAME_2]`, `[ADDRESS_1]`, `[CASE_NUMBER_1]`
   (np. pismo z dwoma nazwiskami, adresem i sygnaturą).
2. Zakładka deanonimizacji → „Importuj pismo od AI (DOCX)" → `golden-pismo.docx`.
3. Eksportuj wynik. Oczekiwane: raport „podmieniono 8", wzmianka o warstwie
   tekstu usuniętego, 1 hiperłącze zewnętrzne w raporcie.
4. Otwórz wynik w Wordzie i sprawdź wzrokowo:
   - nagłówek „Kancelaria K-LAW – pełnomocnik …" i stopka z adresem: obecne,
     z podmienioną wartością, formatowanie nietknięte,
   - kursywa w zdaniu „…wnosi o oddalenie…" zaczyna się tam gdzie w oryginale
     (token był rozcięty między runy: wartość weszła do pierwszego runu),
   - hiperłącze do Legalisa dalej klika i prowadzi tam, gdzie prowadziło,
   - pole `Klient:` pokazuje podmienioną wartość; po F9 (aktualizacja pól)
     Word może przywrócić wartość właściwości dokumentu — to właściwość
     formatu (RD-2), odnotować, nie naprawiać,
   - w trybie recenzji: wstawka podmieniona, tekst usunięty nadal pokazuje
     token (warstwa raport-only, zgodnie z projektem §5.2),
   - żadnego monitu Worda o naprawę pliku.
5. Powtórz import dla każdego `hostile-*.docx`: aplikacja musi odmówić z
   komunikatem z tabeli (a `hostile-egress-template.docx` — zablokować eksport).
6. Wynik z kroku 4 otwórz też w LibreOffice Writer (drugi silnik renderujący).

Uwaga: pliki `hostile-*` są nieszkodliwe same w sobie (encje XML nie mają się
gdzie rozwinąć, `vbaProject.bin` to 8 bajtów nagłówka OLE bez kodu), ale NIE
otwieraj ich w starym, niełatanym Wordzie z włączonymi makrami — zachowuj je
jak każdy plik testowy bezpieczeństwa.
