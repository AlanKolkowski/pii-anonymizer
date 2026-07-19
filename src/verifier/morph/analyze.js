// W2/K1-lite (W1-W3-MORPHOLOGY-DESIGN.md §2.2 pkt 1-2, §2.3): structure
// parsing of a PERSON_NAME legend value and gender resolution. Pure
// functions, data by parameter (the loaded morph structure from load.js) —
// nothing here reads storage or network. The generation half of K1/K3
// (analyzePersonName/generateForm/fullParadigm with the G1-G20 goldens)
// builds ON these primitives — documented next step on this branch.

import { genderFromAdjectivalSurname, isForeignName, generateSurnameParadigm, surnameLemmaCandidates } from './paradigms.js';

// The -ski/-cki/-dzki (m) ~ -ska/-cka/-dzka (f) adjectival family is a
// single closed, fully productive suffix set that denotes exactly one
// paradigm each — unlike a generic ending (bare "-a", or "-na"/"-owa"),
// nothing else in the rule engine legitimately produces these sequences at
// the nominative by coincidence. See resolveSurnameWord's "genuine" filter
// below for why that distinction matters.
const ADJECTIVAL_SKI_FAMILY = new Set(['adjectival-ski-m', 'adjectival-ska-f']);

const INITIAL_RE = /^\p{Lu}\.$/u;
const WORD_RE = /^\p{Lu}[\p{L}]+(?:-\p{Lu}[\p{L}]+)?$/u;
const MAX_WORDS = 4;

/**
 * Splits a legend value into typed words (§2.2 pkt 1-2). Allowed v1
 * structures: [imię]+ [nazwisko], [inicjał]+ [nazwisko], [imię]+,
 * [nazwisko] (single word — the dictionary decides), [inicjał]+ (flagged:
 * not automatically declinable). Anything else — conjunctions, digits,
 * slashes, lowercase words, more than four words — flags 'struktura'.
 *
 * Word types are POSITIONAL against the imiona dictionary: every leading
 * word found in the dictionary is an imię; the final word is the nazwisko
 * (unless it too is a dictionary given name and nothing else follows).
 *
 * @param {string} value - normalized legend value (trimmed, single spaces)
 * @param {Map} imiona - morph.imiona (lowercased name → entry) or empty Map
 */
export function parseNameStructure(value, imiona = new Map()) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { status: 'flaga', powod: 'struktura' };
  }
  const rawWords = value.trim().split(/\s+/);
  if (rawWords.length > MAX_WORDS) return { status: 'flaga', powod: 'struktura' };

  const slowa = [];
  for (const raw of rawWords) {
    if (INITIAL_RE.test(raw)) {
      slowa.push({ tekst: raw, typ: 'inicjał' });
      continue;
    }
    if (!WORD_RE.test(raw)) return { status: 'flaga', powod: 'struktura' };
    slowa.push({ tekst: raw, typ: null }); // resolved below
  }

  const words = slowa.filter((s) => s.typ !== 'inicjał');
  if (words.length === 0) {
    // "[inicjał]+" — legal input, not automatically declinable (G14).
    return { status: 'flaga', powod: 'struktura', slowa };
  }

  // Positional typing: last non-initial word is the surname candidate;
  // leading words must be given names (dictionary or not — an unknown
  // leading word is still typed 'imię', K1 proper flags it 'imię-nieznane').
  for (let i = 0; i < slowa.length; i++) {
    if (slowa[i].typ === 'inicjał') continue;
    const isLast = slowa[i] === words[words.length - 1];
    if (!isLast) {
      slowa[i].typ = 'imię';
      continue;
    }
    // Single word overall: the dictionary decides (§2.2 pkt 2); otherwise
    // the final word is the surname.
    if (words.length === 1 && slowa.length === 1) {
      slowa[i].typ = imiona.has(slowa[i].tekst.toLocaleLowerCase('pl')) ? 'imię' : 'nazwisko';
    } else {
      slowa[i].typ = slowa[i].tekst.includes('-') ? 'nazwisko-dwuczłonowe' : 'nazwisko';
    }
  }

  // Initials may only precede the surname ([inicjał]+ [nazwisko]); an
  // initial AFTER the surname is no known Polish name structure.
  const lastInitial = slowa.map((s) => s.typ).lastIndexOf('inicjał');
  const surnameIndex = slowa.findIndex((s) => s.typ.startsWith('nazwisko'));
  if (lastInitial !== -1 && surnameIndex !== -1 && lastInitial > surnameIndex) {
    return { status: 'flaga', powod: 'struktura' };
  }

  return { status: 'ok', slowa };
}

/**
 * Gender resolution (§2.3) — first decisive source wins:
 *   1. the imiona dictionary on the FIRST given name (m/f entries decide;
 *      'm/f' names fall through),
 *   2. an adjectival surname form (the only path for [inicjał] [nazwisko]),
 *   3. an unambiguously gendered adjectival form among the attested forms.
 * No resolution → flaga 'rodzaj-niejednoznaczny', zero proposals (G15).
 * Role context is deliberately NOT used in v1 (§2.3).
 *
 * @param {Array<{tekst, typ}>} slowa - from parseNameStructure
 * @param {Map} imiona
 * @param {string[]} [attestedForms]
 */
export function resolveGender(slowa, imiona = new Map(), attestedForms = []) {
  const firstName = slowa.find((s) => s.typ === 'imię');
  if (firstName) {
    const entry = imiona.get(firstName.tekst.toLocaleLowerCase('pl'));
    if (entry && (entry.rodzaj === 'm' || entry.rodzaj === 'f')) {
      return { rodzaj: entry.rodzaj, zrodlo: 'imię-słownik' };
    }
  }

  const surname = slowa.find((s) => s.typ.startsWith('nazwisko'));
  if (surname) {
    for (const part of surname.tekst.split('-')) {
      const fromSurname = genderFromAdjectivalSurname(part);
      if (fromSurname) return { rodzaj: fromSurname, zrodlo: 'nazwisko-przymiotnikowe' };
    }
  }

  for (const attested of attestedForms ?? []) {
    for (const word of String(attested).split(/\s+/)) {
      const fromAttested = genderFromAdjectivalSurname(word);
      if (fromAttested) return { rodzaj: fromAttested, zrodlo: 'poświadczone' };
    }
  }

  return { status: 'flaga', powod: 'rodzaj-niejednoznaczny' };
}

// Re-exported here so K1 consumers deal with one module surface.
export { isForeignName };

// --- analyzePersonName (K1/K3, FLEKSJA-IMPL-PLAN.md SS2.4) ------------------
//
// The generation half of K1: builds on parseNameStructure + resolveGender
// above (structure/gender) and paradigms.js (surname rule engine) to
// resolve, per word, a LEMMA (nominative) and the set of cases the word's
// surface form could itself represent — the basis both for reconstructing
// the nominative ("lematM", G12's "legend holds the first-seen case, not
// the nominative" problem) and for attesting which surface forms are on
// file per case (poswiadczoneWgPrzypadka, SS3.3).
//
// Word-level resolution never guesses: an unresolved word gets przypadki:
// [] and a zrodloLematu flag explaining why (obce / imię-nieznane /
// nieznane), which generateForm (generate.js) turns into a flag rather than
// a fabricated form.

function capitalizeLike(sample, word) {
  // Mirrors the capitalization pattern of `sample` onto `word` (dictionary
  // lemmas are stored lowercase in the imiona Map; the input text is the
  // authority on how a real name is actually capitalized).
  if (sample[0] === sample[0].toLocaleUpperCase('pl')) {
    return word[0].toLocaleUpperCase('pl') + word.slice(1);
  }
  return word;
}

// Resolves ONE surname-typed word to its dictionary/rule lemma and the set
// of cases the surface form could represent. Dictionary exceptions
// (nazwiskaWyjatki, via the reverse index) are authoritative and skip the
// rule engine entirely — a hyphenated word is treated as one opaque unit
// in v1 (splitting each half is a v1.1 refinement, SS13 O-FL-5 territory).
function resolveSurnameWord(tekst, morph) {
  const key = tekst.toLocaleLowerCase('pl');
  const dictHits = (morph?.formaDoLematu?.get(key) ?? []).filter((e) => e.sekcja === 'nazwiska');
  if (dictHits.length > 0) {
    const przypadki = [...new Set(dictHits.flatMap((h) => h.przypadki))];
    return { lemat: dictHits[0].lemat, przypadki, zrodloLematu: 'słownik' };
  }

  if (isForeignName(tekst)) {
    return { lemat: tekst, przypadki: [], zrodloLematu: 'obce' };
  }

  const candidates = surnameLemmaCandidates(tekst);
  if (candidates.length === 0) {
    return { lemat: tekst, przypadki: [], zrodloLematu: 'nieznane' };
  }
  const enriched = candidates.map((c) => {
    const regenerated = generateSurnameParadigm(c.lemma, c.gender);
    const przypadek = Object.entries(regenerated.paradygmat ?? {}).find(([, f]) => f === tekst)?.[0] ?? null;
    return { ...c, przypadek };
  });

  // A self-match from the closed -ski/-ska adjectival family (see
  // ADJECTIVAL_SKI_FAMILY above) is diagnostic on its own: M (nominative)
  // equals the lemma for every class, so this ISN'T a coincidence the way
  // an indeclinable self-match is — the word genuinely already IS this
  // surname's nominative. It must win outright over any noun-class
  // candidate that the generic bare-vowel inversion heuristic derives from
  // the SAME surface form purely by accident (e.g. treating "Zawadzka" —
  // already the correct feminine nominative — as though it were the
  // genitive of an invented masculine stem "Zawadzk"/"Zawadzek", both of
  // which happen to regenerate "…a" as a coincidence of the closed
  // alternation tables). This is intentionally NOT extended to -na/-owa:
  // that ending is far less exclusive and collides with ordinary nouns too
  // readily (e.g. "Barana", the oblique of the noun surname "Baran", also
  // superficially matches adjectival-na-f) to trust a bare self-match.
  const trusted = enriched.find((e) => e.lemma === tekst && ADJECTIVAL_SKI_FAMILY.has(e.klasa));
  if (trusted) {
    return {
      lemat: trusted.lemma,
      przypadki: [trusted.przypadek],
      zrodloLematu: 'reguła',
      kandydaciRodzaju: [trusted],
    };
  }

  // `feminine-indeclinable`'s paradigm is the constant function (every case
  // equals the lemma), so a candidate whose lemma is the surface form
  // ITSELF unchanged ALWAYS self-matches trivially — for every word, in
  // every case, whether or not the bearer is actually an indeclinable
  // feminine surname. That vacuous reading must never shadow a candidate
  // that required a REAL inversion (a different lemma), which is the
  // informative signal; it survives only as the fallback when nothing else
  // inverted (e.g. genuinely nominative input).
  const genuine = enriched.filter((e) => e.lemma !== tekst);
  const ranked = genuine.length > 0 ? genuine : enriched;
  return {
    lemat: ranked[0].lemma,
    przypadki: [...new Set(ranked.map((e) => e.przypadek).filter(Boolean))],
    zrodloLematu: 'reguła',
    kandydaciRodzaju: ranked,
  };
}

// Resolves ONE word of any type (inicjał / imię / nazwisko*) — shared by
// the primary value's word list and by every attested variant's word list
// (buildAttestedByCase below), so both consult the exact same rules.
function resolveWord(slowo, imiona, morph) {
  if (slowo.typ === 'inicjał') {
    return { ...slowo, lemat: slowo.tekst, przypadki: ['M'], zrodloLematu: 'inicjał', warianty: false };
  }
  if (slowo.typ === 'imię') {
    const key = slowo.tekst.toLocaleLowerCase('pl');
    if (imiona.has(key)) {
      return { ...slowo, lemat: capitalizeLike(slowo.tekst, slowo.tekst), przypadki: ['M'], zrodloLematu: 'słownik', warianty: false };
    }
    const hit = morph?.formaDoLematu?.get(key)?.find((e) => e.sekcja === 'imiona');
    if (hit) {
      return {
        ...slowo,
        lemat: capitalizeLike(slowo.tekst, hit.lemat),
        przypadki: hit.przypadki,
        zrodloLematu: 'słownik',
        warianty: false,
      };
    }
    return { ...slowo, lemat: slowo.tekst, przypadki: [], zrodloLematu: 'imię-nieznane', warianty: false };
  }
  // nazwisko / nazwisko-dwuczłonowe
  const resolved = resolveSurnameWord(slowo.tekst, morph);
  const dictEntry = resolved.zrodloLematu === 'słownik' ? morph?.nazwiskaWyjatki?.get(resolved.lemat) : null;
  return {
    ...slowo,
    lemat: resolved.lemat,
    przypadki: resolved.przypadki,
    zrodloLematu: resolved.zrodloLematu,
    warianty: Boolean(dictEntry?.warianty),
    kandydaciRodzaju: resolved.kandydaciRodzaju ?? null,
  };
}

// Intersects the per-word case sets of a parsed value; [] on a word means
// "unresolved", so it neither confirms nor contradicts agreement — words
// that DID resolve must still agree with each other, or the value's own
// case is 'niejednoznaczny' (never silently pick one).
function agreeingCase(perWordCases) {
  const resolved = perWordCases.filter((c) => c.length > 0);
  if (resolved.length === 0) return null;
  let inter = new Set(resolved[0]);
  for (const cases of resolved.slice(1)) inter = new Set([...inter].filter((c) => cases.includes(c)));
  if (inter.size === 0) return 'niejednoznaczny';
  return inter.size === 1 ? [...inter][0] : [...inter];
}

// Formy poświadczone (SS3.3): `value` (the legend's first-seen form) plus
// every other attested surface variant are each parsed and case-resolved
// with the SAME rules as the primary analysis; a form whose words agree on
// one OR MORE cases (agreeingCase returns an array for genuine syncretism,
// e.g. masculine-personal D=B) is recorded under every such case slot
// (first writer per slot — `value` is inserted first, so it wins ties
// against later attestations).
function buildAttestedByCase(value, attestedForms, imiona, morph) {
  const out = {};
  const forms = new Set([value, ...(attestedForms ?? [])].filter((f) => typeof f === 'string' && f !== ''));
  for (const form of forms) {
    const parsed = parseNameStructure(form, imiona);
    if (parsed.status !== 'ok') continue; // unparseable/junk attested form — skip, never blocks the rest (K1.4)
    const resolved = parsed.slowa.map((s) => resolveWord(s, imiona, morph));
    const nonInitial = resolved.filter((s) => s.typ !== 'inicjał');
    const przypadek = agreeingCase(nonInitial.map((s) => s.przypadki));
    if (przypadek == null || przypadek === 'niejednoznaczny') continue;
    for (const p of Array.isArray(przypadek) ? przypadek : [przypadek]) {
      if (!(p in out)) out[p] = form;
    }
  }
  return out;
}

/**
 * Analyzes a PERSON_NAME legend value (analyzePersonName, W1-W3-MORPHOLOGY-
 * DESIGN.md SS2.4 / FLEKSJA-IMPL-PLAN.md SS2.4). `value` may be in ANY case —
 * the legend holds whatever form was first seen, not necessarily the
 * nominative (G12's problem) — so this reconstructs the nominative lemma
 * ("lematM") from each word independently rather than assuming `value`
 * already IS the base form.
 *
 * @param {string} value - legend value, e.g. "Jana Kowalskiego"
 * @param {string[]} attestedForms - other raw surface variants seen for the
 *   same token (deriveAttested, src/verifier/attested.js) — `value` itself
 *   is folded in automatically, callers don't need to repeat it.
 * @param {object|null} morph - loadMorphData() result, or null (dictionary
 *   lookups then always miss — rule-governed surnames still work).
 * @returns {{status:'ok', ...} | {status:'flaga', powod:string}}
 */
export function analyzePersonName(value, attestedForms = [], morph = null) {
  const imiona = morph?.imiona ?? new Map();
  const parsed = parseNameStructure(value, imiona);
  if (parsed.status !== 'ok') return { status: 'flaga', powod: parsed.powod };

  const rodzajInfo = resolveGender(parsed.slowa, imiona, attestedForms);
  const slowa = parsed.slowa.map((s) => resolveWord(s, imiona, morph));
  const lematM = slowa.map((s) => s.lemat).join(' ');
  const nonInitial = slowa.filter((s) => s.typ !== 'inicjał');
  const inputPrzypadek = agreeingCase(nonInitial.map((s) => s.przypadki));

  return {
    status: 'ok',
    value,
    slowa,
    rodzaj: rodzajInfo.status === 'flaga' ? null : rodzajInfo.rodzaj,
    rodzajZrodlo: rodzajInfo.status === 'flaga' ? null : rodzajInfo.zrodlo,
    rodzajFlaga: rodzajInfo.status === 'flaga' ? rodzajInfo.powod : null,
    lematM,
    inputPrzypadek,
    poswiadczoneWgPrzypadka: buildAttestedByCase(value, attestedForms, imiona, morph),
    morph,
  };
}
