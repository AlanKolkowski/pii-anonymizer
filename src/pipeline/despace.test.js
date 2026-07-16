import {
  detectSpacedPhrases,
  buildDespacedVariant,
  buildDespacedSegments,
  checkDespaceInvariant,
} from './despace.js';

function words(text) {
  return detectSpacedPhrases(text).flatMap((p) => p.words);
}

function gluedWords(text) {
  return words(text).map((w) => w.letters.map((p) => text[p]).join(''));
}

describe('detectSpacedPhrases — grammar (OCR-SPACING-DESIGN.md §2.2 pkt 1)', () => {
  it('detects a title-case spaced word (class T)', () => {
    const found = words('Pozwana W r ó b l e w s k a nie stawiła się.');
    expect(found).toHaveLength(1);
    expect(found[0].wordClass).toBe('T');
    expect(gluedWords('Pozwana W r ó b l e w s k a nie stawiła się.')).toEqual(['Wróblewska']);
  });

  it('detects an all-caps spaced word (class C)', () => {
    const found = words('U R Z Ą D przyjmuje wnioski.');
    expect(found).toHaveLength(1);
    expect(found[0].wordClass).toBe('C');
    expect(gluedWords('U R Z Ą D przyjmuje wnioski.')).toEqual(['URZĄD']);
  });

  it('splits at a lower→UPPER transition into a two-word phrase', () => {
    const text = 'Stawiła się B o ż e n a W r ó b l e w s k a osobiście.';
    const phrases = detectSpacedPhrases(text);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].words.map((w) => w.wordClass)).toEqual(['T', 'T']);
    expect(gluedWords(text)).toEqual(['Bożena', 'Wróblewska']);
  });

  it('joins adjacent spaced words across a 2-3 whitespace gap into one phrase', () => {
    const two = detectSpacedPhrases('B o ż e n a  W r ó b l e w s k a');
    expect(two).toHaveLength(1);
    expect(two[0].words).toHaveLength(2);

    const three = detectSpacedPhrases('B o ż e n a   W r ó b l e w s k a');
    expect(three).toHaveLength(1);
    expect(three[0].words).toHaveLength(2);

    const four = detectSpacedPhrases('B o ż e n a    W r ó b l e w s k a');
    expect(four).toHaveLength(2);
  });

  it('joins across a line break inside the ≤3 whitespace budget', () => {
    const phrases = detectSpacedPhrases('B o ż e n a \n W r ó b l e w s k a');
    expect(phrases).toHaveLength(1);
    expect(phrases[0].words).toHaveLength(2);
  });

  it('leaves a lowercase preposition out of the word ("w T o r u n i u")', () => {
    expect(gluedWords('mieszka w T o r u n i u od lat')).toEqual(['Toruniu']);
  });

  it('is silent on initials, enumerations, acronyms and emphasis spacing', () => {
    expect(words('J. K. przybył.')).toEqual([]);
    expect(words('wybierz: a) tak b) nie c) wstrzymuję się')).toEqual([]);
    expect(words('spółka S.A. z siedzibą w RP')).toEqual([]);
    expect(words('sąd p o s t a n a w i a co następuje')).toEqual([]);
  });

  it('is silent below four letters (3-letter words need confirmation v1 lacks — O-OS-1)', () => {
    expect(words('świadek K o s zeznał')).toEqual([]);
    expect(words('R P')).toEqual([]);
  });

  it('is silent on mixed-case runs that fit neither class', () => {
    expect(words('A B C d e f')).toEqual([]);
  });

  it('is silent on ordinary text', () => {
    expect(words('Jan Kowalski zamieszkały w Toruniu, PESEL 92050112345.')).toEqual([]);
  });

  it('stops at partial spacings instead of guessing ("W r óblewska")', () => {
    expect(words('pozwana W r óblewska nie przyszła')).toEqual([]);
  });

  it('treats a hyphen as a word boundary (double-barrelled names split)', () => {
    expect(gluedWords('K o w a l s k a - W i ś n i e w s k a')).toEqual(['Kowalska', 'Wiśniewska']);
  });

  it('ends a caps word at a trailing lowercase preposition', () => {
    expect(gluedWords('W O J E W Ó D Z K I w P o z n a n i u')).toEqual(['WOJEWÓDZKI', 'Poznaniu']);
  });

  it('fuses two caps words separated by a single space — known R-OS-5 limit, NER is the net', () => {
    // "S Ą D R E J O N O W Y" with a 1-space inter-word gap is
    // indistinguishable from one long spaced word by this grammar; the glued
    // garbage ("SĄDREJONOWY") is what the model sees and won't confirm.
    expect(gluedWords('S Ą D R E J O N O W Y')).toEqual(['SĄDREJONOWY']);
  });
});

describe('buildDespacedVariant — variant and offset map (§2.2 pkt 2-3)', () => {
  it('returns null when there is nothing to do', () => {
    expect(buildDespacedVariant('Zwykły tekst bez rozstrzeleń.')).toBeNull();
  });

  it('glues the word, copies the rest identically, keeps punctuation', () => {
    const text = 'Sąd wzywa W r ó b l e w s k ą, zam. w Toruniu.';
    const built = buildDespacedVariant(text);
    expect(built.variant).toBe('Sąd wzywa Wróblewską, zam. w Toruniu.');
    expect(built.words).toHaveLength(1);
    const w = built.words[0];
    expect(built.variant.slice(w.variantStart, w.variantEnd)).toBe('Wróblewską');
    expect(text.slice(w.start, w.end)).toBe('W r ó b l e w s k ą');
  });

  it('maps every variant character back to the exact original character', () => {
    const text = 'Sąd wzywa W r ó b l e w s k ą, zam. w Toruniu.';
    const { variant, origPos, insertedSpaces } = buildDespacedVariant(text);
    expect(checkDespaceInvariant(text, variant, origPos, insertedSpaces)).toBe(true);
    for (let i = 0; i < variant.length; i++) {
      expect(text[origPos[i]]).toBe(variant[i]);
    }
  });

  it('joins a phrase with one inserted space that maps into the original gap', () => {
    const text = 'B o ż e n a  W r ó b l e w s k a';
    const { variant, origPos, insertedSpaces } = buildDespacedVariant(text);
    expect(variant).toBe('Bożena Wróblewska');
    expect(insertedSpaces.size).toBe(1);
    const [spaceIdx] = [...insertedSpaces];
    expect(variant[spaceIdx]).toBe(' ');
    expect(/\s/.test(text[origPos[spaceIdx]])).toBe(true);
    for (let i = 1; i < origPos.length; i++) {
      expect(origPos[i]).toBeGreaterThan(origPos[i - 1]);
    }
  });

  it('folds glued class-C words to Title Case (B2 fold), map untouched', () => {
    const text = 'W I E L K O P O L S K I  U R Z Ą D  W O J E W Ó D Z K I w Poznaniu';
    const built = buildDespacedVariant(text);
    expect(built.variant).toBe('Wielkopolski Urząd Wojewódzki w Poznaniu');
    // Map still points at the original (uppercase) letters.
    for (const w of built.words) {
      const orig = text.slice(w.start, w.end).replace(/\s+/g, '');
      const glued = built.variant.slice(w.variantStart, w.variantEnd);
      expect(glued.toLowerCase()).toBe(orig.toLowerCase());
    }
  });

  it('maps a span drawn on the variant back to the full spaced span (roundtrip)', () => {
    const text = 'Pozwana W r ó b l e w s k a nie stawiła się.';
    const { variant, origPos } = buildDespacedVariant(text);
    const s = variant.indexOf('Wróblewska');
    const e = s + 'Wróblewska'.length;
    const mappedStart = origPos[s];
    const mappedEnd = origPos[e - 1] + 1;
    expect(text.slice(mappedStart, mappedEnd)).toBe('W r ó b l e w s k a');
  });
});

describe('buildDespacedSegments', () => {
  it('omits segments without detection and keeps global offsets', () => {
    const segments = [
      { text: 'Zwykłe zdanie pierwsze.', offset: 0 },
      { text: 'Pozwana W r ó b l e w s k a nie żyje.', offset: 24 },
    ];
    const out = buildDespacedSegments(segments);
    expect(out).toHaveLength(1);
    expect(out[0].offset).toBe(24);
    expect(out[0].text).toBe('Pozwana Wróblewska nie żyje.');
  });
});

// --- property test (§2.4, R-OS-1): the map is the module's core risk -------
//
// Deterministic seeded fuzz: random documents with injected spaced words and
// phrases mixed into realistic noise (initials, enumerations, acronyms,
// digits, emphasis spacing). For every generated document the invariants
// must hold — a single violation is a build we must never ship, because a
// wrong map means masking the wrong characters.

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

const NAMES_T = ['Wróblewska', 'Kamiński', 'Bożena', 'Świątek', 'Łukasz', 'Nowakowska', 'Dzięcioł', 'Kręglewski'];
const WORDS_C = ['URZĄD', 'SKARBOWY', 'WIELKOPOLSKI', 'ODDZIAŁ', 'REJONOWY'];
const NOISE = [
  'sąd wzywa', 'pozwana', 'dnia 12 maja 2024 r.', 'art. 233 § 1 k.c.', 'J. K.',
  'a) tak b) nie', 'spółka S.A.', 'p o s t a n a w i a', 'PESEL 92050112345',
  'w Toruniu', 'sygn. akt I C 1552/23', '—', 'tel. 600 700 800', 'R P',
  'K o s', 'W r óblewska',
];
const WORD_GAPS = ['  ', '   ', ' \n ', '\t'];
const PHRASE_GAPS = [' ', '  ', '   ', ' \n '];

function despace(word) {
  return word.split('').join(' ');
}

function generateDoc(rng) {
  const parts = [];
  const injected = [];
  let cursor = 0;
  const push = (s) => {
    parts.push(s);
    cursor += s.length;
  };
  const itemCount = 3 + Math.floor(rng() * 10);
  for (let k = 0; k < itemCount; k++) {
    if (k > 0) push(pick(rng, WORD_GAPS));
    if (rng() < 0.45) {
      // an injected spaced word or phrase
      const wordCount = rng() < 0.3 ? 2 : 1;
      let previous = null;
      for (let w = 0; w < wordCount; w++) {
        const name = rng() < 0.3 ? pick(rng, WORDS_C) : pick(rng, NAMES_T);
        if (w > 0) {
          // A single-space gap after a caps word fuses into one chain with
          // no case transition to split on (documented R-OS-5 limit), so
          // only title-case predecessors may draw the 1-space gap here.
          const gaps = previous === previous.toUpperCase() ? PHRASE_GAPS.slice(1) : PHRASE_GAPS;
          push(pick(rng, gaps));
        }
        previous = name;
        const start = cursor;
        push(despace(name));
        injected.push({ start, end: cursor, glued: name });
      }
    } else {
      push(pick(rng, NOISE));
    }
  }
  return { text: parts.join(''), injected };
}

describe('despace property test (seeded fuzz)', () => {
  it('invariants hold on 300 generated documents', () => {
    const rng = makeRng(0xC0FFEE);
    for (let round = 0; round < 300; round++) {
      const { text, injected } = generateDoc(rng);
      const built = buildDespacedVariant(text);
      if (injected.length === 0) {
        continue; // noise-only documents may legitimately build nothing
      }
      expect(built).not.toBeNull();
      const { variant, origPos, insertedSpaces, words: detected } = built;

      // 1. Map shape: one origin per variant char, strictly increasing.
      expect(origPos.length).toBe(variant.length);
      for (let i = 1; i < origPos.length; i++) {
        expect(origPos[i]).toBeGreaterThan(origPos[i - 1]);
      }

      // 2. Character fidelity modulo the class-C Title Case fold: the
      //    original character at origPos[i] equals the variant character
      //    up to case; non-inserted, non-folded positions must be exact.
      const foldedRanges = detected.filter((w) => w.wordClass === 'C');
      for (let i = 0; i < variant.length; i++) {
        if (insertedSpaces.has(i)) continue;
        const inFolded = foldedRanges.some((w) => i >= w.variantStart && i < w.variantEnd);
        if (inFolded) {
          expect(text[origPos[i]].toLowerCase()).toBe(variant[i].toLowerCase());
        } else {
          expect(text[origPos[i]]).toBe(variant[i]);
        }
      }

      // 3. Every injected word is detected with its exact span and glue.
      for (const inj of injected) {
        const hit = detected.find((w) => w.start === inj.start && w.end === inj.end);
        expect(hit, `injected "${inj.glued}" at ${inj.start} not detected in: ${text}`).toBeDefined();
        const glued = variant.slice(hit.variantStart, hit.variantEnd);
        expect(glued.toLowerCase()).toBe(inj.glued.toLowerCase());
      }

      // 4. Span roundtrip for random variant spans: original slice equals
      //    variant slice once whitespace is stripped (case-insensitively,
      //    class-C folds change case only).
      for (let probe = 0; probe < 5; probe++) {
        const a = Math.floor(rng() * variant.length);
        const b = Math.min(variant.length, a + 1 + Math.floor(rng() * 30));
        const mappedStart = origPos[a];
        const mappedEnd = origPos[b - 1] + 1;
        const originalSlice = text.slice(mappedStart, mappedEnd).replace(/\s+/g, '').toLowerCase();
        const variantSlice = variant.slice(a, b).replace(/\s+/g, '').toLowerCase();
        expect(originalSlice).toBe(variantSlice);
      }

      // 5. Determinism.
      const again = buildDespacedVariant(text);
      expect(again.variant).toBe(variant);
      expect(again.origPos).toEqual(origPos);
    }
  });
});
