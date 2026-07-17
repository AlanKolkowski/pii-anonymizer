// W2 (W1-W3-MORPHOLOGY-DESIGN.md §2.4): rule engine for Polish surname
// paradigms — the single truth shared by the runtime flexion engine and the
// W1 compiler (§1.4.2), which runs 100% of SGJP surname lexemes through
// these rules and stores ONLY the divergent lexemes in the compiled
// dictionary (subtractive dictionary). Pure functions, no I/O, no data
// imports — dictionary data arrives by parameter in the consumers.
//
// Case alphabet (§0.3, identical to src/tokens.js): M D C B N Ms W.
//
// A priori class statuses follow the §2.4 table; the compiler's measured
// agreement table (§1.4.2) has the final word and can DEGRADE a class to
// dictionary-only via the classStatus override — a rule that often misses
// has no right to generate without dictionary attestation.

export const CASES = ['M', 'D', 'C', 'B', 'N', 'Ms', 'W'];

// 'rule' — generates; 'dictionary-only' — never generates (the compiled
// dictionary or an attested form must supply the paradigm). The a priori
// 'low' classes from §2.4 start as dictionary-only: conservative until the
// compiler's agreement measurement exists (zero guesses, §2.1).
export const DEFAULT_CLASS_STATUS = {
  'adjectival-ski-m': 'rule',
  'adjectival-ska-f': 'rule',
  'adjectival-ny-m': 'rule',
  'adjectival-na-f': 'rule',
  'adjectival-other': 'dictionary-only',
  'noun-masculine': 'rule',
  'noun-masculine-ek': 'rule',
  'noun-masculine-el': 'dictionary-only',
  'noun-masculine-a': 'dictionary-only',
  'noun-masculine-o': 'dictionary-only',
  'noun-feminine-a': 'rule',
  'feminine-indeclinable': 'rule',
};

// --- foreign heuristic (§2.6) ----------------------------------------------

const POLISH_LETTERS = new Set('abcdefghijklmnoprstuwyząćęłńóśźż'.split(''));
// 'ng' is deliberately absent (naturalized Lange/Langa are Polish
// declension targets); 'uy' has no native Polish occurrences.
const FOREIGN_DIGRAPHS = ['th', 'sch', 'ck', 'oo', 'ee', 'ph', 'qu', 'uy'];

// Orthography says "not a Polish declension target": q/v/x, foreign
// diacritics, or tell-tale digraphs. PESEL frequency never overrides this
// (§2.6 — the register carries foreign surnames too).
export function isForeignName(word) {
  const lower = word.toLocaleLowerCase('pl');
  for (const ch of lower) {
    if (/\p{L}/u.test(ch) && !POLISH_LETTERS.has(ch)) return true;
  }
  return FOREIGN_DIGRAPHS.some((d) => lower.includes(d));
}

// --- alternation tables (§2.4.1 — code, not data; closed, stable-only) ------

// Ms/W of hard-stem masculines: stem-final cluster/consonant → replacement
// INCLUDING the ending. Longest keys first. Velars and (historically) soft
// stems take -u without mutation.
const MASC_LOCATIVE_MUTATIONS = [
  ['ście', 'st'], ['ździe', 'zd'], ['śle', 'sł'], ['źle', 'zł'], ['śnie', 'sn'], ['źnie', 'zn'],
  ['rze', 'r'], ['cie', 't'], ['dzie', 'd'], ['le', 'ł'],
  ['bie', 'b'], ['pie', 'p'], ['mie', 'm'], ['wie', 'w'], ['fie', 'f'],
  ['nie', 'n'], ['sie', 's'], ['zie', 'z'],
].map(([ending, stemEnd]) => ({ stemEnd, ending }));

const MASC_U_LOCATIVE_ENDINGS = ['k', 'g', 'ch', 'cz', 'sz', 'ż', 'rz', 'dż', 'l', 'j', 'ć', 'ś', 'ź', 'ń'];

// C/Ms of feminine -a noun surnames: stem-final → mutated stem + 'e'
// (hard stems), or plain -y/-i for soft/velar stems handled in the class.
const FEM_DATIVE_MUTATIONS = [
  ['st', 'ście'], ['sł', 'śle'], ['zd', 'ździe'], ['sn', 'śnie'],
  ['k', 'ce'], ['g', 'dze'], ['ch', 'sze'],
  ['r', 'rze'], ['t', 'cie'], ['d', 'dzie'], ['ł', 'le'],
  ['b', 'bie'], ['p', 'pie'], ['m', 'mie'], ['w', 'wie'], ['f', 'fie'],
  ['n', 'nie'], ['s', 'sie'], ['z', 'zie'],
].map(([stemEnd, replacement]) => ({ stemEnd, replacement }));

const FEM_SOFT_STEM_ENDINGS = ['l', 'j', 'i', 'cz', 'sz', 'ż', 'rz', 'c', 'dz'];

function endsWithAny(stem, endings) {
  return endings.find((e) => stem.endsWith(e)) ?? null;
}

// Orthographic join for soft-final stems: ń/ś/ź/ć/dź before a vowel are
// written ni/si/zi/ci/dzi (Krzemień → Krzemienia, never "Krzemieńa").
const SOFT_FINAL = { 'ń': 'ni', 'ś': 'si', 'ź': 'zi', 'ć': 'ci' };

function softJoin(stem, ending) {
  if (!/^[aeiouy]/.test(ending)) return stem + ending;
  if (stem.endsWith('dź')) return `${stem.slice(0, -2)}dzi${ending}`;
  const soft = SOFT_FINAL[stem[stem.length - 1]];
  return soft ? stem.slice(0, -1) + soft + ending : stem + ending;
}

function mascLocative(stem) {
  for (const { stemEnd, ending } of MASC_LOCATIVE_MUTATIONS) {
    if (stem.endsWith(stemEnd)) return stem.slice(0, -stemEnd.length) + ending;
  }
  if (endsWithAny(stem, MASC_U_LOCATIVE_ENDINGS)) return softJoin(stem, 'u');
  return null; // outside the closed table → dictionary or flag, never a guess
}

function femDativeLocative(stem) {
  const soft = endsWithAny(stem, FEM_SOFT_STEM_ENDINGS);
  if (soft) {
    // Soft stems take -i (l/j/i) or -y (hardened cz/sz/ż/rz/c/dz), same
    // surface as their genitive.
    return femGenitive(stem);
  }
  for (const { stemEnd, replacement } of FEM_DATIVE_MUTATIONS) {
    if (stem.endsWith(stemEnd)) return stem.slice(0, -stemEnd.length) + replacement;
  }
  return null;
}

function femGenitive(stem) {
  if (stem.endsWith('i')) return stem; // -ia lemmas: Kania → Kani
  if (endsWithAny(stem, ['k', 'g', 'l', 'j'])) return `${stem}i`;
  return `${stem}y`;
}

// --- classification (§2.4) --------------------------------------------------

export function classifySurname(lemma, gender) {
  const l = lemma.toLocaleLowerCase('pl');
  if (gender === 'f') {
    if (/(?:ska|cka|dzka)$/.test(l)) return 'adjectival-ska-f';
    if (/(?:na|owa)$/.test(l) && l.length > 3) return 'adjectival-na-f';
    if (l.endsWith('a')) return 'noun-feminine-a';
    return 'feminine-indeclinable';
  }
  if (/(?:ski|cki|dzki)$/.test(l)) return 'adjectival-ski-m';
  if (/(?:ny|owy)$/.test(l) && l.length > 3) return 'adjectival-ny-m';
  if (/[iye]$/.test(l)) return 'adjectival-other';
  if (l.endsWith('a')) return 'noun-masculine-a';
  if (l.endsWith('o')) return 'noun-masculine-o';
  if (/(?:el|eł|ec)$/.test(l)) return 'noun-masculine-el';
  if (/ek$/.test(l) && l.length > 3) return 'noun-masculine-ek';
  if (/[bcdfghjklłmnprstwzżźćśńż]$/.test(l) || /(?:cz|sz|rz|dż|ch)$/.test(l)) return 'noun-masculine';
  return null;
}

// --- generation --------------------------------------------------------------

function adjectivalMasculine(lemma) {
  const stem = lemma.slice(0, -1); // Żurawski → Żurawsk
  return {
    M: lemma, D: `${stem}iego`, C: `${stem}iemu`, B: `${stem}iego`,
    N: `${stem}im`, Ms: `${stem}im`, W: lemma,
  };
}

function adjectivalNyMasculine(lemma) {
  const stem = lemma.slice(0, -1); // Chmielny → Chmieln
  return {
    M: lemma, D: `${stem}ego`, C: `${stem}emu`, B: `${stem}ego`,
    N: `${stem}ym`, Ms: `${stem}ym`, W: lemma,
  };
}

function adjectivalFeminine(lemma) {
  const stem = lemma.slice(0, -1); // Zawadzka → Zawadzk
  const soft = /(?:sk|ck|dzk)$/.test(stem);
  const dcms = soft ? `${stem}iej` : `${stem}ej`;
  return {
    M: lemma, D: dcms, C: dcms, B: `${stem}ą`, N: `${stem}ą`, Ms: dcms, W: lemma,
  };
}

function nounMasculine(lemma, stem = lemma) {
  const instrumental = endsWithAny(stem, ['k', 'g']) ? `${stem}iem` : softJoin(stem, 'em');
  const locative = mascLocative(stem);
  return {
    M: lemma, D: softJoin(stem, 'a'), C: softJoin(stem, 'owi'), B: softJoin(stem, 'a'),
    N: instrumental, Ms: locative, W: locative,
  };
}

function nounMasculineEk(lemma) {
  // Movable e (§2.4, productive): Pietraszek → Pietraszk- → Pietraszka.
  const stem = `${lemma.slice(0, -2)}k`;
  return nounMasculine(lemma, stem);
}

function nounFeminineA(lemma) {
  const stem = lemma.slice(0, -1);
  const dative = femDativeLocative(stem);
  return {
    M: lemma, D: femGenitive(stem), C: dative, B: `${stem}ę`,
    N: `${stem}ą`, Ms: dative,
    // Vocative of feminine surnames is left as an explicit gap (G20: luki
    // jawne) — practice wavers between -o and the nominative.
    W: null,
  };
}

function feminineIndeclinable(lemma) {
  return { M: lemma, D: lemma, C: lemma, B: lemma, N: lemma, Ms: lemma, W: lemma };
}

const GENERATORS = {
  'adjectival-ski-m': adjectivalMasculine,
  'adjectival-na-f': adjectivalFeminine,
  'adjectival-ska-f': adjectivalFeminine,
  'adjectival-ny-m': adjectivalNyMasculine,
  'noun-masculine': nounMasculine,
  'noun-masculine-ek': nounMasculineEk,
  'noun-feminine-a': nounFeminineA,
  'feminine-indeclinable': feminineIndeclinable,
};

/**
 * Generates the singular paradigm of a surname lemma for a bearer of the
 * given gender ('m' | 'f'), or flags. Never guesses: foreign orthography,
 * dictionary-only classes and stems outside the closed alternation tables
 * come back as flags, and any missing single form is an explicit null gap.
 *
 * @param {string} lemma - nominative singular as written (capitalized)
 * @param {'m'|'f'} gender
 * @param {object} [options]
 * @param {object} [options.classStatus] - per-class status override, e.g.
 *   the compiler-measured degradations (§1.4.2 / G-W1-5).
 */
export function generateSurnameParadigm(lemma, gender, options = {}) {
  if (typeof lemma !== 'string' || lemma.length < 2) {
    return { status: 'flaga', powod: 'struktura' };
  }
  if (isForeignName(lemma)) return { status: 'flaga', powod: 'obce' };

  const klasa = classifySurname(lemma, gender);
  if (!klasa) return { status: 'flaga', powod: 'nie-umiem-odmienić' };

  const status = options.classStatus?.[klasa] ?? DEFAULT_CLASS_STATUS[klasa];
  // Dictionary-only classes have NO generator by construction — promoting
  // one via override still flags (there is no rule to promote); the
  // subtractive compiler treats "no prediction" as divergence, which is
  // exactly what routes these lexemes into the exceptions dictionary.
  if (status !== 'rule' || !GENERATORS[klasa]) {
    return { status: 'flaga', powod: 'nie-umiem-odmienić', klasa };
  }

  // Missing single forms (a stem outside the closed locative table, the
  // feminine vocative) stay as explicit null gaps in the paradigm — the
  // regular cases still stand, and a gap can never be mistaken for a form.
  const paradygmat = GENERATORS[klasa](lemma);
  return { status: 'ok', klasa, paradygmat };
}

// --- lemmatization (rule inversion, §2.2 pkt 3) ------------------------------

const INVERSE_SUFFIXES = [
  // adjectival masculine
  { strip: 'iego', addBack: 'i' }, { strip: 'iemu', addBack: 'i' }, { strip: 'im', addBack: 'i' },
  // adjectival -ny/-owy masculine
  { strip: 'ego', addBack: 'y' }, { strip: 'emu', addBack: 'y' }, { strip: 'ym', addBack: 'y' },
  // adjectival feminine
  { strip: 'iej', addBack: 'a' }, { strip: 'ej', addBack: 'a' },
  { strip: 'ą', addBack: 'a' },
  // masculine noun endings
  { strip: 'owi', addBack: '' }, { strip: 'iem', addBack: '' }, { strip: 'em', addBack: '' },
  { strip: 'a', addBack: '' }, { strip: 'u', addBack: '' },
  // feminine noun endings
  { strip: 'y', addBack: 'a' }, { strip: 'i', addBack: 'a' }, { strip: 'ę', addBack: 'a' },
];

// Inverse of the locative mutations: ending → stem-final restoration.
const INVERSE_LOCATIVES = MASC_LOCATIVE_MUTATIONS.map(({ stemEnd, ending }) => ({ ending, stemEnd }));

function inverseCandidatesRaw(form) {
  const out = new Set([form]);
  for (const { strip, addBack } of INVERSE_SUFFIXES) {
    if (form.toLocaleLowerCase('pl').endsWith(strip) && form.length > strip.length + 1) {
      out.add(form.slice(0, -strip.length) + addBack);
    }
  }
  for (const { ending, stemEnd } of INVERSE_LOCATIVES) {
    if (form.toLocaleLowerCase('pl').endsWith(ending) && form.length > ending.length + 1) {
      out.add(form.slice(0, -ending.length) + stemEnd);
    }
  }
  // movable e: Mroczka → Mroczk → Mroczek
  for (const candidate of [...out]) {
    if (/k$/.test(candidate) && candidate.length > 3) {
      out.add(`${candidate.slice(0, -1)}ek`);
    }
  }
  return [...out];
}

/**
 * Lemma candidates for an inflected surname form — SELF-VALIDATING: a
 * candidate survives only if regenerating its paradigm actually produces
 * the input form. Heuristic strips propose; the generator disposes. Returns
 * [{ lemma, gender, klasa }].
 */
export function surnameLemmaCandidates(form, options = {}) {
  const results = [];
  const seen = new Set();
  for (const candidate of inverseCandidatesRaw(form)) {
    for (const gender of ['m', 'f']) {
      const generated = generateSurnameParadigm(candidate, gender, options);
      if (generated.status !== 'ok') continue;
      const matches = Object.values(generated.paradygmat).includes(form);
      if (!matches) continue;
      const key = `${candidate}::${gender}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ lemma: candidate, gender, klasa: generated.klasa });
    }
  }
  return results;
}

// Adjectival surname forms carry gender on their sleeve (§2.3 pkt 2) —
// the only gender source for the "[inicjał] [nazwisko]" structure.
export function genderFromAdjectivalSurname(word) {
  const l = word.toLocaleLowerCase('pl');
  if (/(?:ski|cki|dzki|skiego|ckiego|dzkiego|skiemu|ckiemu|dzkiemu|skim|ckim|dzkim)$/.test(l)) return 'm';
  if (/(?:ska|cka|dzka|skiej|ckiej|dzkiej|ską|cką|dzką)$/.test(l)) return 'f';
  return null;
}
