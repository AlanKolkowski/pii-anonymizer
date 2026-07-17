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
//
// Alongside the randomized fuzz, a handful of DETERMINISTIC edge cases lock
// down boundaries that random generation would otherwise only hit by luck:
// a spaced word at the very start of the text (no left neighbor), at the
// very end (no right neighbor), two distinct spaced words immediately
// adjacent with nothing but the minimum boundary gap between them, and a
// spaced word flush against punctuation with zero intervening whitespace.

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
// §2.2 pkt 1: "granica słowa" is ANY run of ≥2 whitespace chars (plus tab
// and line-end) — 2, 3 and 4-space runs are all equally valid boundaries,
// so all three are exercised here, not just the 2-3 the original draft had.
const WORD_GAPS = ['  ', '   ', '    ', ' \n ', '\t'];
// Inter-word gap WITHIN one phrase must stay ≤ MAX_PHRASE_GAP (3) to be
// joined (§2.2 pkt 1: "przerwa ≤ 3 znaki białe"). The 4-space entry is a
// deliberate just-over-the-threshold probe: those two words must then
// surface as independently-correct detections instead of one joined phrase.
const PHRASE_GAPS = [' ', '  ', '   ', '    ', ' \n '];
// Punctuation directly flush against a spaced word's first/last bare
// letter, with NO intervening whitespace ("przypadki brzegowe": z
// interpunkcją). Brackets/quotes/comma/full-stop are non-letters, so they
// satisfy isBareLetterAt's boundary check without needing a gap. The
// repeated '' entries mean "no punctuation this round" stays the common case.
const PUNCT_LEAD = ['(', '„', '', '', ''];
const PUNCT_TRAIL = [')', ',', '.', ';', ':', '”', '', '', ''];

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
      // an injected spaced word or phrase, optionally flush against
      // punctuation on either side ("przypadki brzegowe": z interpunkcją).
      const lead = pick(rng, PUNCT_LEAD);
      if (lead) push(lead);
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
      const trail = pick(rng, PUNCT_TRAIL);
      if (trail) push(trail);
    } else {
      push(pick(rng, NOISE));
    }
  }
  return { text: parts.join(''), injected };
}

// Runs the full §2.4 invariant battery on one (text, injected) pair and
// returns whether the builder fail-opened (null). Shared by the seeded fuzz
// and the deterministic edge cases below so both are held to identically
// strict checks — nothing here softens once a map exists:
//
//   0. checkDespaceInvariant — the builder's OWN internal gate — must say
//      true. Called directly (not re-derived ad hoc) so a regression in the
//      invariant function itself cannot slip past silently.
//   1. origPos is exactly as long as variant, and strictly increasing.
//   2. Character fidelity: text[origPos[i]] === variant[i] for every
//      variant position that is not an inserted phrase space (modulo the
//      length-preserving class-C Title Case fold, which changes case only).
//   3. Every deliberately injected word/phrase is detected with its exact
//      original span and its glued text (case-insensitively).
//   4. Span roundtrip: an arbitrary variant span, mapped back through
//      origPos to the original and stripped of whitespace, equals the
//      variant span stripped of whitespace.
//   5. Determinism: re-running on the same text yields the same variant
//      and the same map.
function checkOneDoc(text, injected, rng) {
  const built = buildDespacedVariant(text);
  if (built === null) return { isNull: true };
  const { variant, origPos, insertedSpaces, words: detected } = built;

  // 0. checkDespaceInvariant's own contract (see its docstring in despace.js)
  // is checked on the RAW glued variant, BEFORE class-C words get the B2
  // Title Case fold — the fold changes case, so a strict, post-fold call
  // would spuriously fail on any document containing a folded class-C word,
  // even though the map is perfectly correct. Reconstruct the exact
  // pre-fold variant from origPos/insertedSpaces (this is *by definition*
  // what buildDespacedVariant had before its own fold loop ran) and check
  // the invariant on that — this still fully re-verifies origPos's bounds
  // and strict monotonicity (not tautological), while step 2 below
  // independently re-verifies character fidelity against the REAL,
  // returned (post-fold) variant that callers actually receive.
  const preFold = origPos.map((p, i) => (insertedSpaces.has(i) ? ' ' : text[p])).join('');
  expect(checkDespaceInvariant(text, preFold, origPos, insertedSpaces)).toBe(true);

  // 1.
  expect(origPos.length).toBe(variant.length);
  for (let i = 1; i < origPos.length; i++) {
    expect(origPos[i]).toBeGreaterThan(origPos[i - 1]);
  }

  // 2.
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

  // 3.
  for (const inj of injected) {
    const hit = detected.find((w) => w.start === inj.start && w.end === inj.end);
    expect(hit, `injected "${inj.glued}" at ${inj.start} not detected in: ${text}`).toBeDefined();
    const glued = variant.slice(hit.variantStart, hit.variantEnd);
    expect(glued.toLowerCase()).toBe(inj.glued.toLowerCase());
  }

  // 4. Deterministic callers (rng omitted) probe a fixed spread of spans;
  // the fuzz probes random ones — both exercise the same assertion.
  const probeCount = rng ? 5 : Math.min(variant.length, 8);
  for (let probe = 0; probe < probeCount; probe++) {
    const a = rng ? Math.floor(rng() * variant.length) : probe;
    const b = rng
      ? Math.min(variant.length, a + 1 + Math.floor(rng() * 30))
      : Math.min(variant.length, a + 1 + probe * 3);
    if (a >= b) continue;
    const mappedStart = origPos[a];
    const mappedEnd = origPos[b - 1] + 1;
    const originalSlice = text.slice(mappedStart, mappedEnd).replace(/\s+/g, '').toLowerCase();
    const variantSlice = variant.slice(a, b).replace(/\s+/g, '').toLowerCase();
    expect(originalSlice).toBe(variantSlice);
  }

  // 5.
  const again = buildDespacedVariant(text);
  expect(again.variant).toBe(variant);
  expect(again.origPos).toEqual(origPos);

  return { isNull: false };
}

describe('despace property test (seeded fuzz)', () => {
  it('invariants hold on 500 generated documents; measures the fail-open (null) rate', () => {
    const rng = makeRng(0xC0FFEE);
    const ROUNDS = 500;
    let nullTotal = 0;
    let roundsWithInjected = 0;
    let nullWithInjected = 0;

    for (let round = 0; round < ROUNDS; round++) {
      const { text, injected } = generateDoc(rng);
      const { isNull } = checkOneDoc(text, injected, rng);

      if (isNull) nullTotal += 1;
      if (injected.length > 0) {
        roundsWithInjected += 1;
        if (isNull) nullWithInjected += 1;
      }
    }

    const overallNullRate = (100 * nullTotal) / ROUNDS;
    const injectedNullRate = roundsWithInjected ? (100 * nullWithInjected) / roundsWithInjected : 0;
    // Reported to stdout on every run — this is the number OCR-SPACING-DESIGN.md
    // §2.4 asks the property test to surface: how often the builder fails
    // open overall, and (the number that actually matters) how often it
    // fails open on input that genuinely contains spaced-out content.
    console.log(
      `[despace fuzz] ${ROUNDS} rounds — overall null (fail-open) rate: ` +
        `${overallNullRate.toFixed(1)}% (${nullTotal}/${ROUNDS}, mostly noise-only ` +
        'documents with nothing to despace — expected, not a loss). Null rate ' +
        'AMONG documents that actually contain injected spaced content — the ' +
        `number that means silent, un-flagged detection loss: ${injectedNullRate.toFixed(1)}% ` +
        `(${nullWithInjected}/${roundsWithInjected}).`
    );

    // The load-bearing promise (R-OS-1; kryterium 2.3 pkt 1): fail-open is
    // for genuinely empty/ambiguous input, never for content the grammar
    // itself matches — a null here would be a silent recall loss.
    expect(nullWithInjected).toBe(0);
  });
});

describe('despace property test — deterministic edge cases ("przypadki brzegowe")', () => {
  it('detects a spaced word at the absolute start of the text (no left neighbor)', () => {
    const text = 'W r ó b l e w s k a przyszła do sądu dnia wczorajszego.';
    const end = text.indexOf(' przyszła');
    const { isNull } = checkOneDoc(text, [{ start: 0, end, glued: 'Wróblewska' }]);
    expect(isNull).toBe(false);
  });

  it('detects a spaced word at the absolute end of the text (no right neighbor)', () => {
    const text = 'Do sądu dnia wczorajszego przyszła W r ó b l e w s k a';
    const start = text.indexOf('W r ó');
    const { isNull } = checkOneDoc(text, [{ start, end: text.length, glued: 'Wróblewska' }]);
    expect(isNull).toBe(false);
  });

  it('detects two distinct spaced words immediately adjacent (minimum 2-space boundary, no other noise)', () => {
    const text = 'K a m i ń s k i  N o w a k o w s k a';
    const firstEnd = text.indexOf('  ');
    const secondStart = firstEnd + 2;
    const injected = [
      { start: 0, end: firstEnd, glued: 'Kamiński' },
      { start: secondStart, end: text.length, glued: 'Nowakowska' },
    ];
    const { isNull } = checkOneDoc(text, injected);
    expect(isNull).toBe(false);
  });

  it('detects a spaced word flush against punctuation on both sides, ending the text', () => {
    const text = 'Wzywa się świadka („W r ó b l e w s k a”).';
    const start = text.indexOf('W r ó');
    const end = start + 'W r ó b l e w s k a'.length;
    const { isNull } = checkOneDoc(text, [{ start, end, glued: 'Wróblewska' }]);
    expect(isNull).toBe(false);
  });

  it('detects a spaced word immediately preceded by an opening bracket, no gap', () => {
    const text = '(W r ó b l e w s k a) potwierdziła odbiór.';
    const start = text.indexOf('W r ó');
    const end = text.indexOf(')');
    const { isNull } = checkOneDoc(text, [{ start, end, glued: 'Wróblewska' }]);
    expect(isNull).toBe(false);
  });
});
