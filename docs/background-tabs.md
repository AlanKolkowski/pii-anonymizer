# Przetwarzanie w tle (nieaktywna karta)

Anonimizacja i OCR działają w całości w przeglądarce, więc podlegają mechanizmom
oszczędzania energii, które przeglądarki stosują wobec kart działających w tle.
Ta strona opisuje, co aplikacja robi sama, a co można ustawić w przeglądarce,
jeśli przetwarzanie wyraźnie zwalnia po przełączeniu się na inną kartę lub
aplikację.

## Co aplikacja robi automatycznie

- **Rastrowanie stron PDF nie zatrzymuje się w ukrytej karcie.** Renderowanie
  stron do OCR działa niezależnie od `requestAnimationFrame`, które w ukrytych
  kartach nigdy nie jest wywoływane.
- **Trwający import i anonimizacja trzymają blokadę Web Lock.** Przeglądarki
  oparte na Chromium (Chrome, Edge) nie usypiają ani nie zamrażają kart, które
  trzymają taką blokadę — długie zadanie nie zostanie wstrzymane w połowie,
  nawet gdy karta długo pozostaje w tle.

Mimo to przeglądarka może obniżyć **priorytet CPU** całego procesu ukrytej
karty. Modele NER i OCR liczą się wtedy wolniej — zadanie się nie zatrzyma,
ale potrwa dłużej. Na to nie ma API po stronie strony WWW; pomagają dopiero
ustawienia poniżej.

## Uniwersalna rada (każda przeglądarka)

Najskuteczniejsze jest utrzymanie karty **widocznej**: przeciągnij ją do
osobnego okna i zostaw je na wierzchu, choćby zmniejszone w rogu ekranu.
Widoczna karta zachowuje pełny priorytet. Przy pracy na laptopie podłącz
zasilanie — tryby oszczędzania baterii nasilają dławienie kart w tle.

## Microsoft Edge

Edge ma najbardziej agresywne mechanizmy oszczędzania:

1. **Usypiające karty:** otwórz `edge://settings/system` i w sekcji
   „Optymalizuj wydajność" dodaj adres aplikacji do listy **„Nigdy nie usypiaj
   tych witryn"** (albo wyłącz usypianie kart całkowicie).
2. **Tryb wydajności (efficiency mode):** gdy jest aktywny (bateria, oszczędzanie
   baterii w Windows), Edge przenosi procesy kart w tle na rdzenie
   energooszczędne z obniżonym taktowaniem — na nowszych procesorach Intel
   potrafi to kilkukrotnie spowolnić obliczenia. Wyłącz go na tej samej stronie
   ustawień albo podłącz zasilanie.

## Google Chrome

1. Otwórz `chrome://settings/performance` i dodaj adres aplikacji do
   **„Zawsze zachowuj aktywność tych witryn"** (sekcja Oszczędzanie pamięci).
2. Wyłącz **Oszczędzanie energii** (ta sama strona ustawień) na czas
   przetwarzania dużych dokumentów, albo podłącz zasilanie.

## Firefox

Firefox nie usypia kart tak agresywnie jak Edge i nie ma listy wyjątków dla
witryn. Obniża jednak priorytet procesów kart w tle, więc obliczenia mogą
zwolnić. Wystarczy trzymać kartę widoczną w osobnym oknie.

## Safari (macOS)

Safari korzysta z systemowego App Nap: macOS dławi okna całkowicie zasłonięte
przez inne. Nie ma ustawienia per witryna — zostaw okno choć częściowo widoczne
podczas przetwarzania.
