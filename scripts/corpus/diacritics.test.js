import { createRng } from './rng.mjs';
import { hasEligibleChar, degradeDiacritics, selectDegradedOccurrences } from './diacritics.mjs';

// A fuzz set of real Polish words/names covering every one of the nine
// pairs, plus a few with no eligible characters at all.
const DIACRITIC_RICH = [
  'Żółć', 'łąka', 'źrebię', 'Kołkowski', 'Świątek', 'Wąchock', 'Żurek',
  'Pszczółka', 'Konstancja', 'Wołyński', 'Częstochowa', 'Grudziądz', 'Śliwka',
  'Michalina Wróżek-Ślązak', 'Bąk', 'Gołąb', 'Kania', 'Nieśwież',
];
const NO_DIACRITIC_ELIGIBLE = ['123456', 'Xywy', 'FVDMY', ''];

describe('hasEligibleChar', () => {
  it('is true for every word in the diacritic-rich fuzz set', () => {
    for (const w of DIACRITIC_RICH) expect(hasEligibleChar(w)).toBe(true);
  });

  it('is false for words/strings with no diacritic-toggleable characters', () => {
    for (const w of NO_DIACRITIC_ELIGIBLE) expect(hasEligibleChar(w)).toBe(false);
  });
});

describe('degradeDiacritics: length preservation', () => {
  it('never changes UTF-16 length, across a large fuzz x seed x fraction sweep', () => {
    let combos = 0;
    for (const word of DIACRITIC_RICH) {
      for (let seed = 0; seed < 15; seed++) {
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          const rng = createRng(`diacritics-length/${word}/${seed}/${fraction}`);
          const degraded = degradeDiacritics(rng, word, { fraction });
          expect(degraded.length).toBe(word.length);
          combos++;
        }
      }
    }
    expect(combos).toBe(DIACRITIC_RICH.length * 15 * 5);
  });

  it('leaves strings with no eligible characters completely unchanged', () => {
    const rng = createRng('diacritics-noop');
    for (const w of NO_DIACRITIC_ELIGIBLE) {
      expect(degradeDiacritics(rng, w, { fraction: 1 })).toBe(w);
    }
  });
});

describe('degradeDiacritics: determinism', () => {
  it('same seed + same input produces the same output', () => {
    const a = degradeDiacritics(createRng('diacritics-det'), 'Kołkowski', { fraction: 0.5 });
    const b = degradeDiacritics(createRng('diacritics-det'), 'Kołkowski', { fraction: 0.5 });
    expect(a).toBe(b);
  });
});

describe('degradeDiacritics: actually mutates eligible characters', () => {
  // Both words below are chosen to have exactly ONE eligible character each,
  // so the expected output can be verified by hand instead of duplicating
  // the toggle map into the test.
  it('strip direction: the one eligible char in "Bąk" (ą) loses its diacritic', () => {
    expect(degradeDiacritics(createRng('diacritics-strip'), 'Bąk', { fraction: 1 })).toBe('Bak');
  });

  it('add direction: the one eligible char in "Grom" (o) gains a diacritic it never had (Alan-reported OCR direction)', () => {
    expect(degradeDiacritics(createRng('diacritics-add'), 'Grom', { fraction: 1 })).toBe('Gróm');
  });

  it('a fixed fraction on a multi-eligible-char word produces a varied subset of flips across seeds, not the same one every time', () => {
    const outputs = new Set();
    const N = 30;
    for (let i = 0; i < N; i++) {
      outputs.add(degradeDiacritics(createRng(`diacritics-variety/${i}`), 'Częstochowa', { fraction: 0.4 }));
    }
    // 7 eligible chars, choose-3 has C(7,3)=35 combinations — 30 seeds should
    // not collapse onto a single output.
    expect(outputs.size).toBeGreaterThan(1);
    for (const out of outputs) {
      expect(out).not.toBe('Częstochowa');
      expect(out.length).toBe('Częstochowa'.length);
    }
  });
});

describe('selectDegradedOccurrences', () => {
  it('for 0 occurrences, returns an empty set', () => {
    expect(selectDegradedOccurrences(createRng('occ-0'), 0).size).toBe(0);
  });

  it('for 1 occurrence, degrades it (no "mixture" is possible with a single mention)', () => {
    expect(selectDegradedOccurrences(createRng('occ-1'), 1)).toEqual(new Set([0]));
  });

  it('for N>=2 occurrences, the degraded subset is never empty and never the full set, across many seeds', () => {
    for (let n = 2; n <= 6; n++) {
      for (let seed = 0; seed < 30; seed++) {
        const rng = createRng(`occ-mixture/${n}/${seed}`);
        const chosen = selectDegradedOccurrences(rng, n);
        expect(chosen.size).toBeGreaterThan(0);
        expect(chosen.size).toBeLessThan(n);
        for (const idx of chosen) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(n);
        }
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = selectDegradedOccurrences(createRng('occ-det'), 5);
    const b = selectDegradedOccurrences(createRng('occ-det'), 5);
    expect(a).toEqual(b);
  });
});
