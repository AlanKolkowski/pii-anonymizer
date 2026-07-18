# WSPÓŁPRACA-AGENTÓW.md — kontrakt pracy autonomicznej

**Cel:** pozwolić trójce agentów projektować, kodować i bramkować kod bardziej autonomicznie przez najbliższe dni, bez utraty bezpieczeństwa i jakości. **Status: PROPOZYCJA do zgody Alana.** Po akceptacji scalam na main jako obowiązujący.

## 1. Role
- **Fable (architekt)** — projektuje i finalizuje projekty (dokumenty). Realizowany jako **podagent-architekt** (narzędzie Agent, silny model) dla pełnej autonomii, albo osobna sesja Fable, gdy Alan jest dostępny do potwierdzenia.
- **Sonnet (wykonawca)** — implementuje wg ZBRAMKOWANEGO projektu, test-first, na osobnej gałęzi z main. Podagent (Agent, model sonnet).
- **Opus / Claudia (bramka + orkiestracja + architekt bezpieczeństwa)** — bramkuje projekty i kod, prowadzi sekwencję, scala wg reguł, pilnuje inwariantów. Sama nie pisze dużego kodu (tylko drobiazgi); zawsze dostarcza NIEZALEŻNĄ weryfikację, nie ufa zieleni agenta.

## 2. Pętla pracy (na każdą funkcjonalność)
Projekt/finalizacja (Fable) → **bramka projektu** (Opus: kompletność, bezpieczeństwo, decyzje otwarte, zgodność z inwariantami) → implementacja (Sonnet: RED→GREEN, gałąź z main, laptop-safe) → **bramka kodu** (Opus: niezależny przebieg testów, przegląd diffu, adwersarialna weryfikacja) → scalenie wg §4.

## 3. Twarde inwarianty bezpieczeństwa (nienegocjowalne)
1. **Niezmienność all-mask:** certyfikowany produkt (`allMask:true`) zostaje bajt w bajt, dopóki Alan nie aktywuje warstwowości. Każda funkcjonalność musi to udowodnić (`tier-partition-invariance.test.js` zielony + test niezmienności).
2. **Laptop = podłoga 16 GB:** ZERO `npm run eval` / ładowania modeli / korpusu adversarial na laptopie (OOM). Pomiar detekcji tylko na PC (Alan).
3. **Test-first + niezależna bramka:** czerwony przed zielonym; Opus sam odpala testy i czyta diff, nie ufa raportowi.
4. **Jeden pisarz drzewa na raz:** dwaj agenci w jednym working tree kolidują. Gałęzie z main, sekwencyjnie albo z izolacją; Opus git-read-only, gdy agent pracuje.
5. **Nie zmyślać:** sum kontrolnych, algorytmów, sygnatur, kwot, numerów artykułów. Niepewny algorytm → wariant kotwiczony bez sumy (jak R-PASZ), jawnie oznaczony.
6. **Bezpieczeństwo egress:** przez granicę AI tylko tokeny + nazwy syntetyczne; deanonimizacja wyłącznie lokalnie; bramka człowieka na moście.

## 4. Granice autonomii
**Robię BEZ Alana (autonomicznie), pod warunkiem bramka PASS + pełny `vitest run src` zielony + inwarianty §3 nietknięte:**
- Uruchamiam podagentów, bramkuję, iteruję.
- Scalam na main i pushuję: **poprawy detekcji** (recall, nowe regexy/kategorie zbramkowane z FP=0), **mechanizmy no-op** (jak mask-floor `null`), **narzędzia evala**, **dokumenty projektowe**.

**STOP — czekam na Alana (flaguję, nie zgaduję zgody):**
- **Aktywacja warstwowości** (`allMask:false`) w produkcie — ZAWSZE.
- Zmiana łamiąca niezmienność all-mask certyfikowanego produktu bez pomiaru PC.
- **Decyzje licencyjne**, wybór modeli LLM, sporne kategorie/warstwy.
- Merge gałęzi, której WARTOŚĆ wymaga pomiaru PC (np. OS-despace) — czeka na pomiar.
- Cokolwiek nieodwracalnego / na zewnątrz (publikacja, wysyłka, zmiana ustawień).

## 5. Mechanizm autonomii przez najbliższe dni
- Podagenci pracują w tle; powiadomienie po skończeniu wznawia Opus → bramka → następny krok. **Pętla samopodtrzymująca się** (nie wymaga obecności Alana).
- Dla pełnej autonomii rola „Fable" = podagent-architekt (Agent), bo sesje Fable wymagają kliknięcia Alana przy send_message.
- Raport po każdej domkniętej funkcjonalności: co zbramkowane, co scalone, co czeka na Alana.
- Stan main zawsze zielony i spójny; gałęzie kodu niepushnięte do przeglądu, chyba że §4 pozwala scalić.

## 6. Kolejność czterech funkcjonalności (zależności)
1. **KW** — mała, niezależna → **w toku (Sonnet), Opus bramkuje.**
2. **Fleksja** — fundament (silnik morfologiczny det. + anotacja |M/D/C już w S1). DOCX od niej zależy. **Blokada: decyzja licencyjna słowników.**
3. **DOCX (pełna rekonstrukcja)** — MD3-MD5 + integracja fleksji przy deanonimizacji. **Zależy od fleksji.**
4. **Most AI produkcyjny** — M1-M8, niezależny, może równolegle. **Krytyczny bezpieczeństwowo** (Electron, nazwany potok) → najostrzejsza bramka.

Rekomendowana ścieżka: KW (teraz) ‖ fleksja (fundament) → DOCX ; most równolegle po fleksji, z osobną, zaostrzoną bramką bezpieczeństwa.
