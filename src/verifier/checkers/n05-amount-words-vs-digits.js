// N-5 (LOCAL-VERIFIER-DESIGN.md §4.1): "10 500 zl (slownie: dziesiec tysiecy
// piecset zlotych)" -- the spelled-out amount must match the digits.
//
// Deliberately parses words -> number rather than generating number -> words:
// real legal documents decline the whole numeral phrase in genitive when
// "zlotych" governs it (e.g. "osmiuset dziewiecdziesieciu", not the
// nominative "osiemset dziewiecdziesiat" -- verified against
// test-data/synthetic/pismo_01_wezwanie_do_zaplaty.txt), so generating a
// single grammatically "correct" nominative string and comparing would false
// -positive on genuinely correct documents. The lexicon below lists both
// forms for every numeral; parsing only needs to recognize a form, never
// produce one, which sidesteps having to get Polish case agreement right.
// Scope: integers up to 999 999 -- comfortably past any realistic legal
// document amount.
const ONES = {
  'zero': 0, 'jeden': 1, 'jednego': 1, 'dwa': 2, 'dwóch': 2, 'trzy': 3, 'trzech': 3,
  'cztery': 4, 'czterech': 4, 'pięć': 5, 'pięciu': 5, 'sześć': 6, 'sześciu': 6,
  'siedem': 7, 'siedmiu': 7, 'osiem': 8, 'ośmiu': 8, 'dziewięć': 9, 'dziewięciu': 9,
};
const TEENS = {
  'dziesięć': 10, 'dziesięciu': 10, 'jedenaście': 11, 'jedenastu': 11,
  'dwanaście': 12, 'dwunastu': 12, 'trzynaście': 13, 'trzynastu': 13,
  'czternaście': 14, 'czternastu': 14, 'piętnaście': 15, 'piętnastu': 15,
  'szesnaście': 16, 'szesnastu': 16, 'siedemnaście': 17, 'siedemnastu': 17,
  'osiemnaście': 18, 'osiemnastu': 18, 'dziewiętnaście': 19, 'dziewiętnastu': 19,
};
const TENS = {
  'dwadzieścia': 20, 'dwudziestu': 20, 'trzydzieści': 30, 'trzydziestu': 30,
  'czterdzieści': 40, 'czterdziestu': 40, 'pięćdziesiąt': 50, 'pięćdziesięciu': 50,
  'sześćdziesiąt': 60, 'sześćdziesięciu': 60, 'siedemdziesiąt': 70, 'siedemdziesięciu': 70,
  'osiemdziesiąt': 80, 'osiemdziesięciu': 80, 'dziewięćdziesiąt': 90, 'dziewięćdziesięciu': 90,
};
const HUNDREDS = {
  'sto': 100, 'stu': 100, 'dwieście': 200, 'dwustu': 200, 'trzysta': 300, 'trzystu': 300,
  'czterysta': 400, 'czterystu': 400, 'pięćset': 500, 'pięciuset': 500,
  'sześćset': 600, 'sześciuset': 600, 'siedemset': 700, 'siedmiuset': 700,
  'osiemset': 800, 'ośmiuset': 800, 'dziewięćset': 900, 'dziewięciuset': 900,
};
const THOUSAND_MARKERS = new Set(['tysiąc', 'tysiące', 'tysięcy']);
const IGNORED_WORDS = new Set(['i', 'oraz']);

function wordValue(word) {
  return HUNDREDS[word] ?? TENS[word] ?? TEENS[word] ?? ONES[word];
}

// Returns the parsed integer, or null if the phrase contains no recognizable
// numeral words at all (distinguishing "nothing to parse" from "parses to 0"),
// or if it contains a numeral-scale word this lexicon doesn't cover (e.g.
// "milion", "miliard" -- scope is capped at 999 999, see header comment).
// An unrecognized word means "can't parse this phrase", never "parse the
// rest and ignore it": silently dropping "milion" out of "jeden milion
// dwieście tysięcy złotych" used to leave a smaller, still-numeric total
// standing in for the real amount, turning genuinely correct seven-figure
// amounts (routine in CHF/EUR sums) into false high-severity mismatches.
function parsePolishNumberWords(phrase) {
  const words = phrase
    .toLowerCase()
    .replace(/\d+\s*\/\s*100/g, ' ')
    .replace(/\bzlot(y|e|ych)\b/gi, ' ')
    .replace(/\bzłot(y|e|ych)\b/gi, ' ')
    .replace(/[.,;:()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !IGNORED_WORDS.has(w));

  if (words.length === 0) return null;

  let total = 0;
  let group = 0;

  for (const word of words) {
    if (THOUSAND_MARKERS.has(word)) {
      total += (group === 0 ? 1 : group) * 1000;
      group = 0;
      continue;
    }
    const value = wordValue(word);
    if (value === undefined) return null; // unrecognized numeral word -- can't safely parse, don't guess
    group += value;
  }
  total += group;

  return total;
}

// \s already matches U+00A0 (non-breaking space, sometimes used as a Polish
// thousands separator) per the ECMAScript spec, so plain \d/\s cover both a
// regular-space-separated and NBSP-separated amount without special-casing.
// Grosze are optional: real invoices almost always carry them ("45 000,00
// zl"), but a plainer "10 500 zl" is legal Polish too and is in fact
// LOCAL-VERIFIER-DESIGN.md's own illustrative example of a mismatch.
const AMOUNT_PATTERN = /(\d[\d\s]*)(?:,(\d{2}))?\s*zł\s*\(\s*słownie:\s*([^)]+?)\s*\)/gi;
const WHITESPACE = /\s/g;

export function checkAmountWordsVsDigits(text) {
  const findings = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const [full, integerDigits, groszeDigits, wordsPhrase] = match;
    const digitAmount = parseInt(integerDigits.replace(WHITESPACE, ''), 10);
    const wordAmount = parsePolishNumberWords(wordsPhrase);

    if (wordAmount === null) continue; // couldn't parse the words at all -- don't guess, don't flag
    if (wordAmount !== digitAmount) {
      const digitLabel = groszeDigits ? `${digitAmount} zł, ${groszeDigits}/100` : `${digitAmount} zł`;
      findings.push({
        checker: 'N-5',
        severity: 'wysoka',
        message: `Kwota cyfrowo (${digitLabel}) nie zgadza się ze słowną („${wordsPhrase.trim()}" = ${wordAmount} zł).`,
        index: match.index,
        length: full.length,
        quote: full,
      });
    }
  }
  return findings;
}
