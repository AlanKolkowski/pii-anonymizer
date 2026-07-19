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

## Ograniczenia v1

- Eksport z zerem podmian jest blokowany (niemal na pewno zły plik albo cudza
  legenda); eksport płaski tekstowy pozostaje dostępny jak dotąd.
- PDF dla wpisu DOCX nadal powstaje z płaskiego podglądu tekstowego.
- Wartości wstawiane są w mianowniku z legendy (fleksja to osobny projekt —
  szew `resolveReplacement` już istnieje).
- Formaty ODT/RTF/DOC oraz kontenery zaszyfrowane są odrzucane czytelnym
  błędem.
