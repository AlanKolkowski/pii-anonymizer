import { describe, it, expect } from 'vitest';
import {
  hasUppercaseSignal,
  foldWord,
  foldUppercaseSegmentText,
  buildFoldedSegments,
} from './case-fold.js';

// Full Polish alphabet (32 letters), uppercase form — the fuzz corpus for
// the length-preservation property test (RECALL-90-DESIGN.md §2.2: "test
// dowodzący: property-test length-preservation, fuzz na stringach z pełnym
// polskim alfabetem").
const POLISH_UPPER_ALPHABET = [...'AĄBCĆDEĘFGHIJKLŁMNŃOÓPQRSŚTUVWXYZŹŻ'];

// Deterministic PRNG (mulberry32) so a fuzz failure is reproducible without
// pulling in a fuzzing dependency — Math.random() would make a failing seed
// unrecoverable.
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUpperWord(rng, minLen, maxLen) {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  let word = '';
  for (let i = 0; i < len; i++) {
    word += POLISH_UPPER_ALPHABET[Math.floor(rng() * POLISH_UPPER_ALPHABET.length)];
  }
  return word;
}

describe('foldWord / foldUppercaseSegmentText — length preservation property', () => {
  it('preserves UTF-16 length for every letter of the Polish alphabet, individually', () => {
    for (const letter of POLISH_UPPER_ALPHABET) {
      const word = letter.repeat(3);
      const folded = foldWord(word);
      expect(folded).not.toBeNull();
      expect(folded.length).toBe(word.length);
    }
  });

  it('fuzz: 2000 random all-uppercase Polish words fold to exactly the same length', () => {
    const rng = mulberry32(20260713);
    for (let i = 0; i < 2000; i++) {
      const word = randomUpperWord(rng, 3, 24);
      const folded = foldWord(word);
      expect(folded).not.toBeNull();
      expect(folded.length).toBe(word.length);
      // first char unchanged, per contract ("pierwsza litera bez zmian")
      expect(folded[0]).toBe(word[0]);
    }
  });

  it('fuzz: 500 random full segments (mixed uppercase/lowercase/punctuation/digits) preserve length whenever folding succeeds', () => {
    const rng = mulberry32(13072026);
    const fillers = [' ', ', ', '.', '\n', '123', 'zwykłe słowo', 'sp. z o.o.', '-'];
    for (let i = 0; i < 500; i++) {
      let text = '';
      const parts = 3 + Math.floor(rng() * 6);
      for (let p = 0; p < parts; p++) {
        if (rng() < 0.5) {
          text += randomUpperWord(rng, 3, 15);
        } else {
          text += fillers[Math.floor(rng() * fillers.length)];
        }
      }
      const folded = foldUppercaseSegmentText(text);
      if (folded !== null) {
        expect(folded.length).toBe(text.length);
      }
    }
  });
});

describe('foldWord', () => {
  it('folds ZAKŁADU / UBEZPIECZEŃ / SPOŁECZNYCH to their natural Title Case', () => {
    expect(foldWord('ZAKŁADU')).toBe('Zakładu');
    expect(foldWord('UBEZPIECZEŃ')).toBe('Ubezpieczeń');
    expect(foldWord('SPOŁECZNYCH')).toBe('Społecznych');
  });

  it('leaves the first character untouched even for a single-letter input', () => {
    expect(foldWord('Ż')).toBe('Ż');
  });
});

describe('hasUppercaseSignal', () => {
  it('detects a segment with a >=3 letter fully-uppercase word', () => {
    expect(hasUppercaseSignal('ODWOŁANIE OD DECYZJI ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH')).toBe(true);
  });

  it('does not trigger on a normal-case sentence', () => {
    expect(hasUppercaseSignal('Zaskarżoną decyzją ZUS odmówił mi prawa do renty.')).toBe(true); // "ZUS" is 3 letters, fully upper
    expect(hasUppercaseSignal('Zaskarżoną decyzją odmówiono mi prawa do renty.')).toBe(false);
  });

  it('does not trigger on short (<3 letter) uppercase tokens like initials or "W"/"DO"', () => {
    expect(hasUppercaseSignal('W dniu 10 września, DO Sądu Rejonowego.')).toBe(false);
  });

  it('does not trigger on a mixed-case word even if it starts with 3+ uppercase-looking letters', () => {
    expect(hasUppercaseSignal('ZUSem interesuje się każdy.')).toBe(false);
  });

  it('does not trigger on OCR letter-spaced text (each "word" is a single letter) — out of scope, RECALL-90-DESIGN.md §2.2 (adw_24)', () => {
    expect(hasUppercaseSignal('Z A K Ł A D   U B E Z P I E C Z E Ń   S P O Ł E C Z N Y C H')).toBe(false);
  });
});

describe('foldUppercaseSegmentText', () => {
  it('folds only the fully-uppercase words, leaving the rest of the segment untouched', () => {
    const text = 'ODWOŁANIE OD DECYZJI ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH';
    const folded = foldUppercaseSegmentText(text);
    expect(folded).toBe('Odwołanie Od Decyzji Zakładu Ubezpieczeń Społecznych');
    expect(folded.length).toBe(text.length);
  });

  it('leaves short uppercase tokens and punctuation untouched', () => {
    const text = 'Za pośrednictwem: ZUS Oddział w Łodzi';
    expect(foldUppercaseSegmentText(text)).toBe('Za pośrednictwem: Zus Oddział w Łodzi');
  });

  it('folds every uppercase run including short ones, non-letter characters (digits, slashes) untouched', () => {
    const text = 'UMOWA KREDYTU GOTÓWKOWEGO NR KG/2025/02/00871';
    const folded = foldUppercaseSegmentText(text);
    expect(folded).toBe('Umowa Kredytu Gotówkowego Nr Kg/2025/02/00871');
    expect(folded.length).toBe(text.length);
  });
});

describe('buildFoldedSegments', () => {
  it('returns only the qualifying segments, with offsets copied through unchanged', () => {
    const segments = [
      { text: 'Zwykłe zdanie bez wersalików.', offset: 0 },
      { text: 'ODWOŁANIE OD DECYZJI ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH', offset: 30 },
      { text: 'Kolejne zwykłe zdanie.', offset: 90 },
    ];
    const folded = buildFoldedSegments(segments);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toEqual({
      text: 'Odwołanie Od Decyzji Zakładu Ubezpieczeń Społecznych',
      offset: 30,
    });
    // "OD" (2 letters) is below the detection threshold but still folds
    // once the segment qualifies, so the header doesn't come out mixed-case.
    expect(folded[0].text).not.toMatch(/\bOD\b/);
  });

  it('returns an empty array when nothing qualifies (common case — most documents)', () => {
    const segments = [
      { text: 'Powód: Konrad Żurawski, ul. Polna 3/5.', offset: 0 },
      { text: 'Pozwana: Miedziak-Metal sp. z o.o.', offset: 40 },
    ];
    expect(buildFoldedSegments(segments)).toEqual([]);
  });
});
