# Abbreviation-aware segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Napraw segmentację zdań tak, aby polskie skróty (`sp. z o.o.`, `ds.`, `adw. Kowalski`, `2023 r.`, numeracja `I./II.`, listy `1./2.`) nie powodowały dzielenia zdania na osobne segmenty.

**Architecture:** Nowy step `mergeAbbreviationsStep` w fazie `segment`, po `segmentSentencexStep`. Operuje na `ctx.segments[]`, iteracyjnie scala sąsiadujące segmenty wg reguł R1a (dict Cat A), R1b (dict Cat B + mała litera po), R2 (nieznany skrót + mała litera po), R3 (marker listy). Blok: podwójny `\n\n` nigdy nie scala. Słownik polskich skrótów (tylko kończących się kropką) w osobnym pliku.

**Tech Stack:** JavaScript ESM, Vitest (globals), Node + Web Worker.

Spec: `docs/superpowers/specs/2026-04-16-abbreviation-aware-segmentation-design.md`

---

## File Structure

- `src/pipeline/data/polish-abbreviations.js` — nowy; eksport `CAT_A: Set<string>`, `CAT_B: Set<string>` (tokens lowercase).
- `src/pipeline/steps/merge-abbreviations.js` — nowy; eksport `mergeAbbreviationsStep` (funkcja `(ctx) => ctx`).
- `src/pipeline/steps/merge-abbreviations.test.js` — nowy; testy jednostkowe.
- `src/pipeline/configs/default.js` — modyfikacja; dodanie kroku w fazie `segment`.
- `src/pipeline/configs/default.test.js` — modyfikacja; sanity check że krok scala znane skróty w pełnym pipeline.

---

### Task 1: Dodaj słownik polskich skrótów

**Files:**
- Create: `src/pipeline/data/polish-abbreviations.js`
- Test: `src/pipeline/data/polish-abbreviations.test.js`

- [ ] **Step 1: Napisz test weryfikujący zawartość słownika**

```js
// src/pipeline/data/polish-abbreviations.test.js
import { describe, it, expect } from 'vitest';
import { CAT_A, CAT_B } from './polish-abbreviations.js';

describe('polish-abbreviations dictionary', () => {
  it('CAT_A contains common titles', () => {
    expect(CAT_A.has('adw.')).toBe(true);
    expect(CAT_A.has('prof.')).toBe(true);
    expect(CAT_A.has('ul.')).toBe(true);
  });

  it('CAT_B contains common context-dependent abbreviations', () => {
    expect(CAT_B.has('r.')).toBe(true);
    expect(CAT_B.has('sp.')).toBe(true);
    expect(CAT_B.has('z o.o.')).toBe(true);
    expect(CAT_B.has('art.')).toBe(true);
    expect(CAT_B.has('m.in.')).toBe(true);
  });

  it('all tokens are lowercase', () => {
    for (const token of [...CAT_A, ...CAT_B]) {
      expect(token).toBe(token.toLowerCase());
    }
  });

  it('excludes non-dot abbreviations', () => {
    for (const nonDot of ['kg', 'km', 'cm', 'zł', 'dr', 'mgr', 'nr', 'pkt']) {
      expect(CAT_A.has(nonDot)).toBe(false);
      expect(CAT_B.has(nonDot)).toBe(false);
    }
  });

  it('CAT_A and CAT_B are disjoint', () => {
    for (const token of CAT_A) {
      expect(CAT_B.has(token)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Uruchom test — powinien failować (brak pliku)**

Run: `npx vitest run src/pipeline/data/polish-abbreviations.test.js`
Expected: FAIL — "Cannot find module './polish-abbreviations.js'"

- [ ] **Step 3: Stwórz plik słownika**

```js
// src/pipeline/data/polish-abbreviations.js

// Skróty, po których następuje rzeczownik (zwykle własny).
// Scalaj ZAWSZE, niezależnie od wielkości litery następnego słowa.
export const CAT_A = new Set([
  // Tytuły/zawody
  'adw.', 'apl.', 'mec.', 'prof.', 'inż.', 'lek.', 'med.',
  'por.', 'kpt.', 'ks.', 'o.', 'św.', 'p.',
  // Wielowyrazowe
  'r.pr.',
  // Adresowe
  'ul.', 'al.', 'pl.', 'os.', 'gm.', 'pow.', 'woj.', 'm.st.',
  'im.', 'pn.',
]);

// Skróty, które mogą legalnie kończyć zdanie.
// Scalaj TYLKO gdy następny segment zaczyna się małą literą.
export const CAT_B = new Set([
  // Prawne
  'art.', 'ust.', 'pkt.', 'lit.', 'par.', 'rozdz.', 'zał.',
  'dz.u.', 'dz.urz.', 'rep.', 'poz.', 'sygn.', 'zob.',
  // Daty/czas
  'r.', 'w.', 'p.n.e.', 'n.e.',
  'godz.', 'min.', 'sek.', 'ok.',
  'pon.', 'wt.', 'czw.', 'pt.', 'sob.', 'niedz.',
  // Ogólne
  'tj.', 'tzn.', 'tzw.', 'np.', 'm.in.', 'itp.', 'itd.',
  'ww.', 'cd.', 'cdn.', 'br.', 'bm.', 'ub.r.', 'ds.',
  // Firmy
  'sp.', 'z o.o.', 'o.o.', 's.a.', 'p.p.', 'p.o.', 'spółdz.',
  // Inne
  'tel.', 'ob.', 'zw.',
]);
```

- [ ] **Step 4: Uruchom test — powinien przejść**

Run: `npx vitest run src/pipeline/data/polish-abbreviations.test.js`
Expected: PASS, 5 testów zielonych.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/data/polish-abbreviations.js src/pipeline/data/polish-abbreviations.test.js
git commit -m "feat(segment): add Polish abbreviations dictionary"
```

---

### Task 2: Step `mergeAbbreviationsStep` — szkielet + R3 (marker listy)

**Files:**
- Create: `src/pipeline/steps/merge-abbreviations.js`
- Create: `src/pipeline/steps/merge-abbreviations.test.js`

Zaczynamy od najprostszej reguły (R3) i szkieletu step'a. Pozostałe reguły dokładamy w kolejnych taskach.

- [ ] **Step 1: Napisz test dla R3 (marker listy)**

```js
// src/pipeline/steps/merge-abbreviations.test.js
import { describe, it, expect } from 'vitest';
import { mergeAbbreviationsStep } from './merge-abbreviations.js';

function makeCtx(text, segments) {
  return { text, segments, entities: [], anonymized: '', legend: {} };
}

describe('mergeAbbreviationsStep', () => {
  describe('R3: list marker', () => {
    it('merges a lone arabic-numeral marker with the next segment', () => {
      const text = '1. Pismo z dnia 15 kwietnia.';
      const ctx = makeCtx(text, [
        { text: '1. ', offset: 0 },
        { text: 'Pismo z dnia 15 kwietnia.', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '1. Pismo z dnia 15 kwietnia.', offset: 0 },
      ]);
    });

    it('merges a lone Roman-numeral marker with the next segment', () => {
      const text = 'I. PODSTAWA PRAWNA';
      const ctx = makeCtx(text, [
        { text: 'I. ', offset: 0 },
        { text: 'PODSTAWA PRAWNA', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'I. PODSTAWA PRAWNA', offset: 0 },
      ]);
    });

    it('merges a lone single-letter marker with the next segment', () => {
      const text = 'a. pierwszy punkt.';
      const ctx = makeCtx(text, [
        { text: 'a. ', offset: 0 },
        { text: 'pierwszy punkt.', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'a. pierwszy punkt.', offset: 0 },
      ]);
    });

    it('does NOT merge a segment that is not a standalone marker', () => {
      const text = 'To jest zdanie 1. Następne zdanie.';
      const ctx = makeCtx(text, [
        { text: 'To jest zdanie 1. ', offset: 0 },
        { text: 'Następne zdanie.', offset: 18 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'To jest zdanie 1. ', offset: 0 },
        { text: 'Następne zdanie.', offset: 18 },
      ]);
    });
  });

  describe('empty/single segment passthrough', () => {
    it('returns empty segments unchanged', () => {
      const ctx = makeCtx('', []);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([]);
    });

    it('returns single segment unchanged', () => {
      const ctx = makeCtx('hello', [{ text: 'hello', offset: 0 }]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'hello', offset: 0 }]);
    });
  });
});
```

- [ ] **Step 2: Uruchom test — powinien failować (brak pliku)**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: FAIL — "Cannot find module './merge-abbreviations.js'"

- [ ] **Step 3: Implementuj szkielet + R3**

```js
// src/pipeline/steps/merge-abbreviations.js

const LIST_MARKER_RE = /^(\d+|[IVXLCDM]+|[a-z])\.$/;

function isListMarker(segText) {
  return LIST_MARKER_RE.test(segText.trim());
}

/**
 * Zwraca tekst scalonych segmentów a..b (inclusive) wycięty z oryginalnego
 * tekstu: od offset[a] do offset[b] + length tekstu b.
 */
function sliceMerged(originalText, segA, segB) {
  const start = segA.offset;
  const end = segB.offset + segB.text.length;
  return { text: originalText.slice(start, end), offset: start };
}

/**
 * Czy scalać segment (i) z segmentem (i+1)?
 * Zwraca string z nazwą reguły lub null.
 */
function shouldMerge(prev, next, originalText) {
  if (isListMarker(prev.text)) return 'R3';
  return null;
}

export function mergeAbbreviationsStep(ctx) {
  const { text, segments } = ctx;
  if (!segments || segments.length < 2) {
    return ctx;
  }

  const out = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1];
    const curr = segments[i];
    const rule = shouldMerge(prev, curr, text);
    if (rule) {
      out[out.length - 1] = sliceMerged(text, prev, curr);
    } else {
      out.push(curr);
    }
  }

  return { ...ctx, segments: out };
}
```

- [ ] **Step 4: Uruchom test — powinien przejść**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: PASS, 5 testów zielonych.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/merge-abbreviations.js src/pipeline/steps/merge-abbreviations.test.js
git commit -m "feat(segment): add mergeAbbreviationsStep with list-marker rule (R3)"
```

---

### Task 3: Reguła Block (granica akapitu)

**Files:**
- Modify: `src/pipeline/steps/merge-abbreviations.js`
- Modify: `src/pipeline/steps/merge-abbreviations.test.js`

Block musi działać PRZED wszystkimi innymi regułami — dlatego dodajemy go teraz, zanim dołożymy reguły które by scaliły.

- [ ] **Step 1: Napisz test blokujący scalanie przy `\n\n`**

Dopisz do `merge-abbreviations.test.js` w `describe('mergeAbbreviationsStep')`:

```js
  describe('Block: paragraph boundary', () => {
    it('blocks R3 merge when there is a double newline between segments', () => {
      const text = '1.\n\nPismo z dnia.';
      const ctx = makeCtx(text, [
        { text: '1.', offset: 0 },
        { text: 'Pismo z dnia.', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '1.', offset: 0 },
        { text: 'Pismo z dnia.', offset: 4 },
      ]);
    });

    it('blocks merge when double newline has whitespace between newlines', () => {
      const text = '1. \n \n Pismo.';
      const ctx = makeCtx(text, [
        { text: '1. ', offset: 0 },
        { text: 'Pismo.', offset: 7 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });
  });
```

- [ ] **Step 2: Uruchom testy — nowe powinny failować**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: 2 testy FAIL (segmenty scalane mimo `\n\n`).

- [ ] **Step 3: Dodaj blokadę paragrafu w `shouldMerge`**

Zmień `shouldMerge` w `src/pipeline/steps/merge-abbreviations.js`:

```js
const PARAGRAPH_BREAK_RE = /\n\s*\n/;

function hasParagraphBreakBetween(prev, next, originalText) {
  const start = prev.offset + prev.text.length;
  const end = next.offset;
  if (end <= start) return false;
  const between = originalText.slice(start, end);
  return PARAGRAPH_BREAK_RE.test(between);
}

function shouldMerge(prev, next, originalText) {
  if (hasParagraphBreakBetween(prev, next, originalText)) return null;
  if (isListMarker(prev.text)) return 'R3';
  return null;
}
```

Zauważ: test pierwszy ma gap między segmentami `[offset 2..4)` = `"\n\n"` — `hasParagraphBreakBetween` sprawdza właśnie tę przestrzeń w oryginalnym tekście. Drugi test: gap `[offset 3..7)` = `" \n \n "` — również matchuje `/\n\s*\n/`.

- [ ] **Step 4: Uruchom testy — wszystkie powinny przejść**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: PASS, wszystkie testy zielone.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/merge-abbreviations.js src/pipeline/steps/merge-abbreviations.test.js
git commit -m "feat(segment): block merging across paragraph boundaries"
```

---

### Task 4: Reguła R1a (słownik Cat A)

**Files:**
- Modify: `src/pipeline/steps/merge-abbreviations.js`
- Modify: `src/pipeline/steps/merge-abbreviations.test.js`

Wprowadzamy matchowanie sufiksu 1–3 słów końca segmentu przeciwko słownikowi.

- [ ] **Step 1: Napisz testy dla R1a**

Dopisz do `merge-abbreviations.test.js`:

```js
  describe('R1a: dictionary Cat A (always merge)', () => {
    it('merges "adw." followed by uppercase name', () => {
      const text = 'adw. Kowalski';
      const ctx = makeCtx(text, [
        { text: 'adw. ', offset: 0 },
        { text: 'Kowalski', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'adw. Kowalski', offset: 0 }]);
    });

    it('merges "ul." followed by a street name', () => {
      const text = 'ul. Mickiewicza 5';
      const ctx = makeCtx(text, [
        { text: 'ul. ', offset: 0 },
        { text: 'Mickiewicza 5', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'ul. Mickiewicza 5', offset: 0 }]);
    });

    it('matches case-insensitively', () => {
      const text = 'Ul. Różana';
      const ctx = makeCtx(text, [
        { text: 'Ul. ', offset: 0 },
        { text: 'Różana', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'Ul. Różana', offset: 0 }]);
    });

    it('matches multi-word suffix "r.pr."', () => {
      const text = 'r.pr. Jan Nowak';
      const ctx = makeCtx(text, [
        { text: 'r.pr. ', offset: 0 },
        { text: 'Jan Nowak', offset: 6 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'r.pr. Jan Nowak', offset: 0 }]);
    });

    it('does NOT merge when paragraph break is present', () => {
      const text = 'ul.\n\nKowalski';
      const ctx = makeCtx(text, [
        { text: 'ul.', offset: 0 },
        { text: 'Kowalski', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });
  });
```

- [ ] **Step 2: Uruchom testy — R1a powinny failować**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: 5 nowych testów FAIL (segmenty nie scalane).

- [ ] **Step 3: Dodaj matchowanie sufiksu + regułę R1a**

Zmień `src/pipeline/steps/merge-abbreviations.js`:

```js
import { CAT_A, CAT_B } from '../data/polish-abbreviations.js';

const LIST_MARKER_RE = /^(\d+|[IVXLCDM]+|[a-z])\.$/;
const PARAGRAPH_BREAK_RE = /\n\s*\n/;
const MAX_SUFFIX_WORDS = 3;

function isListMarker(segText) {
  return LIST_MARKER_RE.test(segText.trim());
}

function hasParagraphBreakBetween(prev, next, originalText) {
  const start = prev.offset + prev.text.length;
  const end = next.offset;
  if (end <= start) return false;
  return PARAGRAPH_BREAK_RE.test(originalText.slice(start, end));
}

/**
 * Zwraca nazwę kategorii ('A' albo 'B') jeśli sufiks 1..MAX_SUFFIX_WORDS słów
 * na końcu segText (po trim) jest w którymś słowniku. Dłuższy match wygrywa.
 */
function matchDictionarySuffix(segText) {
  const trimmed = segText.trimEnd();
  const words = trimmed.split(/\s+/);
  for (let n = Math.min(MAX_SUFFIX_WORDS, words.length); n >= 1; n--) {
    const candidate = words.slice(words.length - n).join(' ').toLowerCase();
    if (CAT_A.has(candidate)) return 'A';
    if (CAT_B.has(candidate)) return 'B';
  }
  return null;
}

function sliceMerged(originalText, segA, segB) {
  const start = segA.offset;
  const end = segB.offset + segB.text.length;
  return { text: originalText.slice(start, end), offset: start };
}

function shouldMerge(prev, next, originalText) {
  if (hasParagraphBreakBetween(prev, next, originalText)) return null;
  if (isListMarker(prev.text)) return 'R3';
  const cat = matchDictionarySuffix(prev.text);
  if (cat === 'A') return 'R1a';
  return null;
}

export function mergeAbbreviationsStep(ctx) {
  const { text, segments } = ctx;
  if (!segments || segments.length < 2) {
    return ctx;
  }
  const out = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1];
    const curr = segments[i];
    const rule = shouldMerge(prev, curr, text);
    if (rule) {
      out[out.length - 1] = sliceMerged(text, prev, curr);
    } else {
      out.push(curr);
    }
  }
  return { ...ctx, segments: out };
}
```

- [ ] **Step 4: Uruchom testy — wszystkie powinny przejść**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: PASS, wszystkie testy zielone.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/merge-abbreviations.js src/pipeline/steps/merge-abbreviations.test.js
git commit -m "feat(segment): add Cat A dictionary rule (always merge)"
```

---

### Task 5: Reguła R1b (Cat B + mała litera po)

**Files:**
- Modify: `src/pipeline/steps/merge-abbreviations.js`
- Modify: `src/pipeline/steps/merge-abbreviations.test.js`

- [ ] **Step 1: Napisz testy dla R1b**

Dopisz do `merge-abbreviations.test.js`:

```js
  describe('R1b: dictionary Cat B (merge only if lowercase follows)', () => {
    it('merges "r." when followed by lowercase', () => {
      const text = '12 września 2023 r. na rachunek';
      const ctx = makeCtx(text, [
        { text: '12 września 2023 r. ', offset: 0 },
        { text: 'na rachunek', offset: 20 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '12 września 2023 r. na rachunek', offset: 0 },
      ]);
    });

    it('does NOT merge "r." when followed by uppercase (real sentence end)', () => {
      const text = 'Zmarł w 2020 r. Jego syn odziedziczył';
      const ctx = makeCtx(text, [
        { text: 'Zmarł w 2020 r. ', offset: 0 },
        { text: 'Jego syn odziedziczył', offset: 16 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('merges "ust." followed by digit', () => {
      const text = '§ 4 ust. 1 umowy';
      const ctx = makeCtx(text, [
        { text: '§ 4 ust. ', offset: 0 },
        { text: '1 umowy', offset: 9 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      // "1" nie jest małą literą polską, więc R1b NIE scali.
      // Ten test dokumentuje zachowanie — R2 (task 6) też nie złapie
      // "ust." bo jest w słowniku Cat B. Celowo pozostaje nie scalone
      // dopóki nie mamy innej reguły. Poprawimy to przez dodanie "cyfry"
      // do akceptowanych znaków po Cat B w tym samym tasku.
      expect(result.segments).toEqual([
        { text: '§ 4 ust. 1 umowy', offset: 0 },
      ]);
    });

    it('merges "sp." with "z o.o." (lowercase z follows)', () => {
      const text = 'firma ABC sp. z o.o. powstała';
      const ctx = makeCtx(text, [
        { text: 'firma ABC sp. ', offset: 0 },
        { text: 'z o.o. ', offset: 14 },
        { text: 'powstała', offset: 21 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      // sp. + z o.o. → merge (sp. w Cat B, "z" lowercase)
      // potem scalony "firma ABC sp. z o.o. " kończy się "z o.o." (Cat B),
      // next "powstała" lowercase → merge.
      expect(result.segments).toEqual([
        { text: 'firma ABC sp. z o.o. powstała', offset: 0 },
      ]);
    });

    it('does NOT merge "sp. z o.o." when uppercase sentence follows', () => {
      const text = 'firma ABC sp. z o.o. Następnie zatrudnił';
      const ctx = makeCtx(text, [
        { text: 'firma ABC sp. ', offset: 0 },
        { text: 'z o.o. ', offset: 14 },
        { text: 'Następnie zatrudnił', offset: 21 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      // sp. + z o.o. scalają (lowercase z). Potem "z o.o." + "Następnie" —
      // uppercase po Cat B → NIE scala.
      expect(result.segments).toEqual([
        { text: 'firma ABC sp. z o.o. ', offset: 0 },
        { text: 'Następnie zatrudnił', offset: 21 },
      ]);
    });
  });
```

**Uwaga do Step 3:** Test "ust. 1 umowy" zakłada, że cyfra (`1`) też trigger-uje merge dla Cat B. Implementacja w Step 3 musi to uwzględnić (rozszerzenie "mała litera polska lub cyfra"). Bez tego cyfra po ust./art./pkt. nie scaliłaby się, co jest częste w dokumentach prawnych.

- [ ] **Step 2: Uruchom testy — R1b powinny failować**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: 5 nowych testów FAIL.

- [ ] **Step 3: Dodaj regułę R1b**

Zmień `src/pipeline/steps/merge-abbreviations.js` — dodaj helper i zaktualizuj `shouldMerge`:

```js
// Pierwszy niebiały znak po trim początku. Zwraca '' jeśli pusty.
function firstNonWhitespaceChar(s) {
  const trimmed = s.trimStart();
  return trimmed.length > 0 ? trimmed[0] : '';
}

const LOWERCASE_POLISH_RE = /[a-ząćęłńóśźż]/;
const DIGIT_RE = /[0-9]/;

function startsWithLowercaseOrDigit(s) {
  const ch = firstNonWhitespaceChar(s);
  return LOWERCASE_POLISH_RE.test(ch) || DIGIT_RE.test(ch);
}

function shouldMerge(prev, next, originalText) {
  if (hasParagraphBreakBetween(prev, next, originalText)) return null;
  if (isListMarker(prev.text)) return 'R3';
  const cat = matchDictionarySuffix(prev.text);
  if (cat === 'A') return 'R1a';
  if (cat === 'B' && startsWithLowercaseOrDigit(next.text)) return 'R1b';
  return null;
}
```

- [ ] **Step 4: Uruchom testy — wszystkie powinny przejść**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/merge-abbreviations.js src/pipeline/steps/merge-abbreviations.test.js
git commit -m "feat(segment): add Cat B dictionary rule (merge on lowercase/digit)"
```

---

### Task 6: Reguła R2 (heurystyka dla nieznanych skrótów)

**Files:**
- Modify: `src/pipeline/steps/merge-abbreviations.js`
- Modify: `src/pipeline/steps/merge-abbreviations.test.js`

- [ ] **Step 1: Napisz testy dla R2**

Dopisz do `merge-abbreviations.test.js`:

```js
  describe('R2: unknown-abbreviation heuristic', () => {
    it('merges unknown "xyz." followed by lowercase', () => {
      const text = 'skrót xyz. niski';
      const ctx = makeCtx(text, [
        { text: 'skrót xyz. ', offset: 0 },
        { text: 'niski', offset: 11 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'skrót xyz. niski', offset: 0 }]);
    });

    it('does NOT merge unknown "xyz." followed by uppercase', () => {
      const text = 'skrót xyz. Wielkie';
      const ctx = makeCtx(text, [
        { text: 'skrót xyz. ', offset: 0 },
        { text: 'Wielkie', offset: 11 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('does NOT merge when previous segment does not end with word+dot', () => {
      const text = 'Pierwsze zdanie? drugie';
      const ctx = makeCtx(text, [
        { text: 'Pierwsze zdanie? ', offset: 0 },
        { text: 'drugie', offset: 17 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });
  });
```

- [ ] **Step 2: Uruchom testy — R2 powinny częściowo failować**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: pierwszy test R2 FAIL (brak scalania), pozostałe dwa mogą już przechodzić (brak regresji).

- [ ] **Step 3: Dodaj regułę R2**

W `src/pipeline/steps/merge-abbreviations.js`:

```js
const WORD_DOT_END_RE = /\w\.\s*$/u;

function endsWithWordDot(segText) {
  return WORD_DOT_END_RE.test(segText);
}

function shouldMerge(prev, next, originalText) {
  if (hasParagraphBreakBetween(prev, next, originalText)) return null;
  if (isListMarker(prev.text)) return 'R3';
  const cat = matchDictionarySuffix(prev.text);
  if (cat === 'A') return 'R1a';
  if (cat === 'B' && startsWithLowercaseOrDigit(next.text)) return 'R1b';
  if (endsWithWordDot(prev.text) && startsWithLowercaseOrDigit(next.text)) return 'R2';
  return null;
}
```

Uwaga: R2 triggeruje też cyfrą (spójność z R1b).

- [ ] **Step 4: Uruchom testy — wszystkie powinny przejść**

Run: `npx vitest run src/pipeline/steps/merge-abbreviations.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/merge-abbreviations.js src/pipeline/steps/merge-abbreviations.test.js
git commit -m "feat(segment): add lowercase heuristic for unknown abbreviations"
```

---

### Task 7: Integracja z pipeline'em

**Files:**
- Modify: `src/pipeline/configs/default.js`
- Modify: `src/pipeline/configs/default.test.js`

- [ ] **Step 1: Napisz test integracyjny w `default.test.js`**

Dopisz do `src/pipeline/configs/default.test.js` drugi `it` w istniejącym `describe`:

```js
  it('merges Polish abbreviations in segment phase (adw., ul., r.)', async () => {
    const mockLoadModel = async () => ({
      infer: async () => [],
      dispose: async () => {},
    });

    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries);
    const text = 'W dniu 10 września 2023 r. pomiędzy Panem Kowalskim a firmą sp. z o.o. zawarto umowę. adw. Nowak reprezentuje stronę.';
    const result = await runPipeline(text, pipeline);

    // Znajdź krok segment-abbreviation merge w debug.
    const segmentDebug = result.debug.filter(d => d.phase === 'segment');
    expect(segmentDebug.length).toBe(2);
    expect(segmentDebug[1].step).toBe('mergeAbbreviationsStep');

    // Ostatni stan segmentów po fazie segment — weź z runnera inaczej:
    // sprawdźmy że istnieje segment zawierający "adw. Nowak" jako całość,
    // co w praktyce wymaga że "adw." NIE został oddzielony od "Nowak".
    // Najprostszy dowód: tekst wejściowy jest w wynikach preserved, a liczba
    // segmentów po merge-abbr jest mniejsza niż przed.
    const before = segmentDebug[0].changes.segments.count.after;
    const after = segmentDebug[1].changes.segments.count.after;
    expect(after).toBeLessThan(before);
  });
```

- [ ] **Step 2: Uruchom test — powinien failować**

Run: `npx vitest run src/pipeline/configs/default.test.js`
Expected: FAIL — krok `mergeAbbreviationsStep` nie istnieje w pipeline.

- [ ] **Step 3: Dodaj krok do `default.js`**

Zmień `src/pipeline/configs/default.js`:

```js
import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../steps/merge-abbreviations.js';
import { createNerStep } from '../steps/ner.js';
import { regexStep } from '../steps/regex.js';
import { allowedTypesStep } from '../steps/allowed-types.js';
import { snapStep } from '../steps/snap.js';
import { filterStep } from '../steps/filter.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { rescanStep } from '../steps/rescan.js';
import { tokenizeStep } from '../steps/tokenize.js';

export const MODELS = [
  { id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' },
  { id: 'bardsai/eu-pii-anonimization', dtype: 'q8' },
];

export function createDefaultPipeline(loadModel, getSentenceBoundaries) {
  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [
        createSentencexSegmentStep(getSentenceBoundaries),
        mergeAbbreviationsStep,
    ]},
    { phase: 'ner', steps: [createNerStep(MODELS, loadModel), regexStep] },
    { phase: 'postprocess', steps: [allowedTypesStep, snapStep, filterStep, dedupStep, mergeStep, tokenizeStep, rescanStep] },
  ];
}
```

- [ ] **Step 4: Uruchom cały test suite**

Run: `npm test`
Expected: PASS, wszystkie testy zielone (w tym istniejące).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/configs/default.js src/pipeline/configs/default.test.js
git commit -m "feat(segment): wire mergeAbbreviationsStep into default pipeline"
```

---

### Task 8: Weryfikacja na rzeczywistych dokumentach (eval)

**Files:** brak zmian kodu — uruchomienie i weryfikacja artefaktów.

- [ ] **Step 1: Uruchom eval z labelką**

Run: `npm run eval -- --label=abbr-merge`
Expected: pipeline przechodzi przez wszystkie `test-data/synthetic/*.txt`.

- [ ] **Step 2: Uruchom scoring**

Run: `npm run eval:score`
Expected: tabela F1 per-dokument + aggregate.

- [ ] **Step 3: Porównaj z poprzednim runem**

Run: `npm run eval:compare`
Expected: raport różnic. Sprawdź że F1 aggregate się NIE pogorszył (optymalnie poprawił).

- [ ] **Step 4: Spot-check debug.json**

Wybierz jeden dokument i przejrzyj `test-data/results/latest/<dokument>/debug.json` — znajdź wpis dla `mergeAbbreviationsStep`. Zweryfikuj że:
- `count.before` > `count.after` (coś zostało scalone)
- W `removed` i `added` nie ma bloków adresowych scalonych błędnie (`\n\n` block działa)

Jeśli F1 spadł lub znajdziesz regresję: wróć do Task 4–6 i popraw słownik / reguły.

- [ ] **Step 5: Commit wyników eval (jeśli run się zapisał do git)**

Sprawdź `git status`. Jeśli w `test-data/results/` są nowe pliki śledzone przez git:

```bash
git add test-data/results/
git commit -m "chore: add eval run with abbreviation merge enabled"
```

---

## Self-Review Notes

**Spec coverage:** R1a, R1b, R2, R3, Block, słownik Cat A/Cat B (tylko z kropką), matchowanie sufiksu 1–3, integracja w default.js, testy — wszystko ma zadanie.

**Rozszerzenie vs spec:** `startsWithLowercaseOrDigit` (cyfra też trigger) w R1b/R2 — nie było w spec-u, ale wyjaśniłem w Task 5 czemu (dokumenty prawne: `ust. 1`, `art. 415`). Zgodne z intencją specu.

**Placeholder scan:** brak TBD/TODO; każdy step zawiera pełny kod.

**Consistency:** `mergeAbbreviationsStep` używane identycznie w Task 2..7. `matchDictionarySuffix`, `isListMarker`, `shouldMerge`, `sliceMerged` — sygnatury spójne między taskami.
