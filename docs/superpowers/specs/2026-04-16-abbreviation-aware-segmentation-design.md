# Abbreviation-aware segmentation

Data: 2026-04-16
Problem: sentencex tnie polskie zdania na kropkach w skrótach (`sp. z o.o.`, `specjalista ds. marketingu`, `adw. Kowalski`, `2023 r.`, numeracja `I.`/`II.`, listy `1.`/`2.`). Model NER widzi fragmenty bez kontekstu, co pogarsza recall.

## Cel

Naprawić segmentację dla polszczyzny tak, aby kropka w skrócie nie dzieliła zdania na dwa segmenty. Zakres: wyłącznie polski (LANG='pl').

## Architektura

Dodaj krok post-processing do fazy `segment`, po `segmentSentencexStep`:

```js
{ phase: 'segment', steps: [
    createSentencexSegmentStep(getSentenceBoundaries),
    mergeAbbreviationsStep,  // nowe
]}
```

Sentencex dalej robi podstawową segmentację. Nowy krok operuje na `ctx.segments[]` i scala sąsiadujące segmenty wg reguł poniżej. Zalety:

- Zero ingerencji w tekst wejściowy (żadnego maskowania kropek).
- Offsety pozostają ważne — scalony segment dziedziczy `offset` pierwszego; `text` to konkatenacja z oryginalnego tekstu między `offset` a `offset+length` ostatniego.
- Chunk-splitting (cap 900 znaków) działa już na scalonych sentencjach (scal → tnij nadmiarowe).
- Krok jest environment-agnostic (browser worker + Node eval).

## Reguły scalania

Krok iteruje segmenty od lewej. Dla każdej pary (N, N+1) sprawdza warunki w kolejności. Pierwsza pasująca reguła powoduje scalenie; po scaleniu kolejna iteracja sprawdza nowy scalony segment względem N+2.

**R1a — Dict Cat A (tytuły/adresowe).** Jeśli segment N, po obcięciu trailing whitespace, kończy się tokenem ze zbioru Cat A → scal zawsze.

**R1b — Dict Cat B (kontekstowe).** Jeśli segment N kończy się tokenem ze zbioru Cat B ORAZ pierwszy niebiały znak N+1 to mała litera polska → scal.

**R2 — Heurystyka małej litery.** Jeśli segment N kończy się wzorcem `\w+\.` (dowolne słowo + kropka, nie w słowniku) ORAZ pierwszy niebiały znak N+1 to mała litera polska → scal. Siatka bezpieczeństwa dla nieujętych skrótów.

**R3 — Marker listy.** Jeśli cały tekst segmentu N (po `.trim()`) pasuje do `^(\d+|[IVXLCDM]+|[a-z])\.$` → scal zawsze z następnym.

**Block — granica akapitu.** Jeśli między końcem segmentu N a początkiem N+1 (w oryginalnym tekście) występuje `\n\s*\n` → nigdy nie scalaj, niezależnie od reguł R1–R3. Chroni bloki adresowe / listy akapitowe.

Matchowanie tokenów słownika: sufiks 1–3 słów segmentu (najdłuższy match wygrywa). Porównanie case-insensitive (wszystkie tokeny w słowniku trzymane lowercase, porównanie na `segment.slice(...).toLowerCase()`).

## Słownik

Plik `src/pipeline/data/polish-abbreviations.js`. Eksportuje dwa `Set<string>`.

**Zasada zakresu:** tylko skróty, które w standardowej polszczyźnie kończą się kropką. Skróty bez kropki (`kg`, `m`, `cm`, `km`, `zł`, `gr`, `dr`, `mgr`, `nr`, `wg`, `pkt` — kończą się ostatnią literą wyrazu) są pomijane, bo nigdy nie wyzwalają cięcia w sentencex.

**Cat A (scalaj zawsze):**
- Tytuły: `adw.`, `apl.`, `mec.`, `prof.`, `inż.`, `lek.`, `med.`, `por.`, `kpt.`, `ks.`, `o.`, `św.`, `p.`
- Wielowyrazowe: `r.pr.`
- Adresowe: `ul.`, `al.`, `pl.`, `os.`, `gm.`, `pow.`, `woj.`, `m.st.`, `im.`, `pn.`

**Cat B (scalaj tylko gdy mała litera po):**
- Prawne: `art.`, `ust.`, `pkt.`, `lit.`, `par.`, `rozdz.`, `zał.`, `dz.u.`, `dz.urz.`, `rep.`, `poz.`, `sygn.`, `zob.`
- Daty/czas: `r.`, `w.`, `p.n.e.`, `n.e.`, `godz.`, `min.`, `sek.`, `ok.`, `pon.`, `wt.`, `czw.`, `pt.`, `sob.`, `niedz.`
- Ogólne: `tj.`, `tzn.`, `tzw.`, `np.`, `m.in.`, `itp.`, `itd.`, `ww.`, `cd.`, `cdn.`, `br.`, `bm.`, `ub.r.`, `ds.`
- Firmy: `sp.`, `z o.o.`, `o.o.`, `s.a.`, `p.p.`, `p.o.`, `spółdz.`
- Inne: `tel.`, `ob.`, `zw.`

## Pliki

**Nowe:**
- `src/pipeline/data/polish-abbreviations.js`
- `src/pipeline/steps/merge-abbreviations.js`
- `src/pipeline/steps/merge-abbreviations.test.js`

**Modyfikowane:**
- `src/pipeline/configs/default.js` (dodanie kroku)
- `src/pipeline/configs/default.test.js` (sanity check)

## Testy

- R1a: `adw. Kowalski`, `ul. Mickiewicza 5`, `prof. Nowak`
- R1b lowercase: `2020 r. w Krakowie`, `ust. 1 umowy`, `art. 415 k.c.`
- R1b uppercase: `2020 r. Jego syn` (NIE scala), `sp. z o.o. Firma` (scala `sp.`+`z o.o.`, potem nie scala)
- R2: `xyz. małe` (scala), `xyz. Duże` (nie scala)
- R3: `I.` / `II.` / `1.` / `a.` jako samodzielny segment
- Block: `...Wiśniewski.\n\nul. Różana` nie scala mimo `ul.` w Cat A
- Iteracyjność: `sp. z o.o. powstała w 2020 r.` → jeden segment
- Offsety: po scaleniu offset pierwszego, length = sum, tekst = slice oryginału

## Nie w zakresie

- Języki inne niż polski.
- Modyfikacja wewnętrznych słowników sentencex (nie są dostępne przez API).
- Detekcja sentence boundaries od zera (nadal sentencex).
- Inne heurystyki (np. named-entity aware) — za skomplikowane na ten etap.
