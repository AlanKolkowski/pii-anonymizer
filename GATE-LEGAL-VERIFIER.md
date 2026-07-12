# GATE-LEGAL-VERIFIER.md — bramka Opusa nad weryfikatorem wyjścia AI (Fable)

**Data:** 2026-07-12
**Autor:** Opus (bramka bezpieczeństwa i jakości)
**Zakres:** `LEGAL-OUTPUT-VERIFIER-DESIGN.md` v1.1 (warstwa online w bazach
publicznych) + fundament kodu (`src/verifier/legal-refs/`, `verifier-daemon/`),
sesja F-C2 (Fable). Artefakty na gałęzi `feature/legal-verifier`.
**Werdykt: FUNDAMENT + PROJEKT 1.1 PRZYJĘTE**, z dwoma warunkami MEDIUM do
domknięcia zanim warstwa online kiedykolwiek przekroczy kanał.

## §1. Bezpieczeństwo / kanał (moja domena — zweryfikowane u źródła)
- **Rdzeń offline nie otwiera sieci:** `src/verifier/legal-refs/` — zero
  `fetch`/`node:net`/gniazd; aplikacja **nie importuje demona** (grep pusty).
  Egress fizycznie nieosiągalny z procesu aplikacji.
- **Egress wyłącznie w demonie, z `fetch` wstrzykiwanym** (realny fetch tylko w
  `run-poc.mjs` i smoke'ach za flagą `LEGAL_REFS_LIVE`).
- **Pakiet niesie tylko sygnatury:** `packetEligible` wyklucza T-9 (własna
  sygnatura) i „uncertain"; `assertPacketSafe` fail-closed (limit, ≥7 cyfr,
  e-mail, biała lista znaków). Powrót — parser ścisły, dane niezaufane,
  adnotacja-only. Obrona w głąb: demon powtarza strażnik (granica G8).
- **Transport (§5.7) NIE zbudowany** — projekt pod O-TR-6 (nazwany potok + HMAC
  + plik sesyjny, klient = jeden plik `node:net`, fizyczna nieobecność w A).
  §5.8 (dlaczego demon a nie klient HTTP — egress w procesie bez PII, separacja
  fizyczna nie polityczna) to najlepszy argument architektoniczny w projekcie.
- **Uczciwość udowodniona pomiarem:** luka SN w SAOS (dekada) obrócona w dowód
  „nie-znalezione ≠ nie istnieje"; degradacja przy niedostępności bazy → znacznik.

## §2. Poprawność (przegląd + własna weryfikacja)
Ekstraktor obejmuje wszystkie klasy sygnatur i jednostek; uczciwość werdyktów
utrzymana w kodzie (adnotacja nie zmienia werdyktu ani tekstu, zero zielonej
pieczątki merytorycznej); adaptery fail-closed z wstrzykiwanym fetch; projekt 1.1
wewnętrznie spójny; 83 testy fundamentu + pełna suita zielone.

## §3. Dwa warunki MEDIUM (do O-TR-6, przed jakąkolwiek warstwą online)
1. **Przeciek T-9 przy „silnych organach" (WSA/NSA/TSUE/TK/KIO).** Prześledzone
   w kodzie: własna sygnatura wielolinijkowa („Sygn. akt:" i `II SA/Wa 245/19` w
   osobnych wierszach) → `context.js:36` (`immediateSygn && !organ`) obalone przez
   organ z repertorium → `context.js:40` skrót STRONG_ORGANS → `role:'citation'` →
   `packetEligible=true`. Łamie niezmiennik §2.4 („własna sygnatura nigdy do
   pakietu, konstrukcyjnie"). Groźne zwłaszcza przy demonie (własna sygnatura
   odpytywana w bazach z IP użytkownika). **Fix:** organ z repertorium nie jest
   sygnałem citation bez potwierdzenia (kontekstowy organ albo forma/data);
   goldeny WSA/NSA own-case.
2. **Niespójność schematu ELI.** Kontrakt adaptera dopuszcza `adresPublikacyjny`/
   `statusAktu`, adapter ELI je wypełnia, ale `external-results.js` `METADATA_KEYS`
   ich nie zna → verbatim przekazanie metadanych ELI = fail-closed odrzucenie
   całości → obiecany „status aktu przez ELI" (§2.3) nie ma pola do aplikacji.
   Latentne. **Fix:** uzgodnić §5.4/`METADATA_KEYS` + golden.

## §4. LOW / INFO
Strażnik demona nie jest dokładnym lustrem app (`stanZbiorow` bez limitu);
nietestowane gałęzie strażników; rok TSUE `\d{2,4}` niespójny; taksonomia sądów
app↔SAOS do zmapowania w przyszłym komparatorze TR12.

## §5. Nie zablokowane / otwarte
**Rdzeń OFFLINE (M0: ekstraktor + lista + znacznik = maszynowa egzekucja reguły
`[DO WERYFIKACJI]`) niezablokowany** — oba MEDIUM dotyczą tylko warstwy online.
Otwarte pod bramkę: O-TR-6 (transport, przy budowie), O-TR-7 (regulaminy/robots
każdej bazy — wykładnia Alana), O-TR-8 (semantyka werdyktów + mapa pokrycia).
Decyzje Alana: P-TR-10…13 (bazy fal 1/2, API-first, etykieta ruchu, online jako
wyróżnik B).
