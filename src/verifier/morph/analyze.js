// W2/K1-lite (W1-W3-MORPHOLOGY-DESIGN.md §2.2 pkt 1-2, §2.3): structure
// parsing of a PERSON_NAME legend value and gender resolution. Pure
// functions, data by parameter (the loaded morph structure from load.js) —
// nothing here reads storage or network. The generation half of K1/K3
// (analyzePersonName/generateForm/fullParadigm with the G1-G20 goldens)
// builds ON these primitives — documented next step on this branch.

import { genderFromAdjectivalSurname, isForeignName } from './paradigms.js';

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
