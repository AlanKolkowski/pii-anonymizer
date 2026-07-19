# Rekonstrukcja DOCX — pismo od AI z zachowanym formatowaniem

Instrukcja użytkownika dla przepływu z `DOCX-REBUILD-DESIGN.md` (§3.4, §6.4,
§9.3). Stan: moduły MD1–MD5 zaimplementowane, przed bramką Opusa.

## Przepływ

1. Zanonimizuj dokumenty źródłowe w zakładce **Anonimizuj** — legenda
   (token → dane) powstaje lokalnie w przeglądarce i nigdzie nie wychodzi.
2. Przekaż tekst stokenizowany do AI (Claude/Codex). AI przygotowuje gotowe
   pismo jako **.docx** — papier firmowy, style, tabele — z tokenami
   `[PERSON_NAME_1]` w treści. Zapisz plik na dysk.
3. W zakładce **Deanonimizuj** kliknij **„Importuj pismo od AI (DOCX)"**
   i wskaż plik. Zobaczysz podgląd tekstowy (tylko do odczytu — źródłem
   prawdy są bajty pliku) oraz wynik inspekcji.
4. Kliknij **„Eksportuj DOCX"**. Aplikacja podmieni tokeny na dane z legendy
   **wewnątrz istniejącego pliku**, niczego poza tym nie zmieniając, i pobierze
   wynik jako `<nazwa>-deanon.docx`. Całość dzieje się lokalnie, w RAM.

## Higiena promptów (niewiążąca — §6.4)

Poproś AI, żeby tokenów **nie odmieniała, nie tłumaczyła i nie zamieniała na
własne placeholdery**. Bezpieczeństwo od tego nie zależy (parser i tak nie
zgaduje), ale każdy przepisany token to ręczne uzupełnienie po Twojej stronie.

## Raport rekonstrukcji

Po eksporcie pasek stanu pokazuje liczby **z silnika podmian** (nie
z podglądu): ile tokenów podmieniono i ile pozostało. Pozostawione tokeny to
zawsze jedna z sytuacji:

- token nieobecny w legendzie (AI wymyśliła własny albo literówka w indeksie),
- token przerwany twardym elementem (tabulator/grafika w środku),
- token w warstwie raport-only: komentarze, kody pól, tekst usunięty
  w trybie śledzenia zmian (celowo niepodmieniane — §5).

Dokument z pozostawionym tokenem jest bezpieczny (token to nie dane osobowe).
**Otwórz plik i uzupełnij braki ręcznie przed podpisem.**

## Dlaczego niektóre pliki są blokowane (§9.3)

Wynik rekonstrukcji zawiera pełne dane osobowe, więc plik wejściowy nie może
mieć odwołań, które Word odpali przy otwarciu:

- **Blokują eksport:** dołączone szablony (`attachedTemplate`), obrazy
  linkowane z sieci, pola `INCLUDETEXT`/`INCLUDEPICTURE`/`DDE`, osadzenia OLE,
  podszywanie się pod .docx z makrami, format Strict OOXML, jakiekolwiek DTD.
- **Nie blokują:** zwykłe hiperłącza (klikane świadomie) — są tylko policzone
  w raporcie.

Blokada jest twarda (bez „eksportuj mimo to") — usuń odwołania w edytorze
i zaimportuj plik ponownie.

## Odmiana przez przypadki (fleksja)

Aplikacja próbuje wstawić dane osobowe w poprawnym przypadku gramatycznym
zamiast zawsze w mianowniku z legendy, gdy kontekst zdania na to pozwala
(np. „od [PERSON_NAME_1]" wstawi „od Jana Kowalskiego", nie „od Jan Kowalski").
Zasady:

- Silnik nigdy nie zgaduje: odmienia tylko wtedy, gdy jest tego pewny
  (jednoznaczny sygnał w zdaniu – przyimek, czasownik, rola procesowa – albo
  poświadczona forma z innego miejsca w tym samym dokumencie źródłowym).
  W razie wątpliwości wstawia formę bazową z legendy, tak jak dziś.
- AI może (nieobowiązkowo) dopisać przypadek wprost przy tokenie, np.
  `[PERSON_NAME_1|D]` dla dopełniacza – to podpowiedź, nie polecenie; błędna
  podpowiedź bez potwierdzenia w kontekście zdania jest ignorowana.
- Pasek stanu po eksporcie pokazuje „odmieniono N form"; pełna lista (z jakiej
  wartości na jaką, w jakim przypadku) jest dostępna w rozwijanym raporcie pod
  paskiem – to mapa do przeczytania pisma przed podpisem, nie zapora eksportu.
- Dziś działa w trybie ograniczonym: pełny słownik odmiany (imiona, nazwiska)
  jeszcze nie istnieje, więc odmiana działa najpewniej tam, gdzie dana osoba
  pojawia się w dokumencie źródłowym więcej niż raz w różnych przypadkach, oraz
  dla typowych nazwisk przymiotnikowych (np. na -ski/-cka). Zakres będzie rósł
  bez zmian po stronie użytkownika.

## Ograniczenia v1

- Eksport z zerem podmian jest blokowany (niemal na pewno zły plik albo cudza
  legenda); eksport płaski tekstowy pozostaje dostępny jak dotąd.
- PDF dla wpisu DOCX nadal powstaje z płaskiego podglądu tekstowego – odmiana
  dotyczy wyłącznie rekonstrukcji .docx.
- Formaty ODT/RTF/DOC oraz kontenery zaszyfrowane są odrzucane czytelnym
  błędem.
