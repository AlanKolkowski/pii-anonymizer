// K1/K3 (FLEKSJA-IMPL-PLAN.md SS2.4): analyzePersonName — the generation
// half of K1 the ported analyze.js comment flagged as "documented next step
// on this branch". Builds on parseNameStructure/resolveGender (K1-lite,
// already ported+tested) and paradigms.js (W1, already ported+tested).
//
// Mini-fixture only (no SGJP compile — FL-1b is explicitly out of scope for
// this turn): src/verifier/morph/fixtures/mini-lexicon.js.
import { loadMorphData } from './load.js';
import { MINI_LEXICON } from './fixtures/mini-lexicon.js';
import { analyzePersonName } from './analyze.js';

const morph = loadMorphData(MINI_LEXICON);

describe('analyzePersonName — structure + gender + lemma reconstruction', () => {
  it('nominative value: regular rule-governed surname + dictionary given name', () => {
    const a = analyzePersonName('Jan Kowalski', [], morph);
    expect(a.status).toBe('ok');
    expect(a.rodzaj).toBe('m');
    expect(a.lematM).toBe('Jan Kowalski');
    expect(a.inputPrzypadek).toBe('M');
  });

  it('oblique (genitive) value reconstructs the nominative lemma (G12 core problem)', () => {
    const a = analyzePersonName('Jana Kowalskiego', [], morph);
    expect(a.status).toBe('ok');
    expect(a.lematM).toBe('Jan Kowalski');
    expect(a.inputPrzypadek).toBe('D');
  });

  it('a nominative attested variant is recorded under poswiadczoneWgPrzypadka.M', () => {
    // Legend holds the first-seen (genitive) form; a later occurrence in
    // the source was seen in the nominative — deriveAttested would surface
    // both as attested surface forms for the same token.
    const a = analyzePersonName('Jana Kowalskiego', ['Jan Kowalski', 'Jana Kowalskiego'], morph);
    expect(a.poswiadczoneWgPrzypadka.M).toBe('Jan Kowalski');
    expect(a.poswiadczoneWgPrzypadka.D).toBe('Jana Kowalskiego');
  });

  it('gender-ambiguous given name falls through to the adjectival surname (resolveGender SS2.3)', () => {
    const a = analyzePersonName('Maria Zawadzka', [], morph);
    expect(a.rodzaj).toBe('f');
    expect(a.rodzajZrodlo).toBe('nazwisko-przymiotnikowe');
  });

  it('no gender signal at all → rodzaj null + explicit flag, case detection still proceeds', () => {
    // "Kozioł" is a noun-class surname (no adjectival ending) with no given
    // name attached and no attested form to lean on.
    const a = analyzePersonName('Kozioł', [], morph);
    expect(a.status).toBe('ok');
    expect(a.rodzaj).toBeNull();
    expect(a.rodzajFlaga).toBe('rodzaj-niejednoznaczny');
  });

  it('foreign surname is marked unresolvable at the word level, never guessed', () => {
    const a = analyzePersonName('John Smith', [], morph);
    expect(a.status).toBe('ok');
    const surname = a.slowa.find((s) => s.typ === 'nazwisko');
    expect(surname.przypadki).toEqual([]);
    expect(surname.zrodloLematu).toBe('obce');
  });

  it('unparseable structure flags struktura and stops there (no partial analysis)', () => {
    expect(analyzePersonName('jan kowalski', [], morph)).toEqual({ status: 'flaga', powod: 'struktura' });
    expect(analyzePersonName('', [], morph)).toEqual({ status: 'flaga', powod: 'struktura' });
  });

  it('a dictionary-known given name with no compiled paradigm still types correctly', () => {
    const a = analyzePersonName('Konrad Kowalski', [], morph);
    const imie = a.slowa.find((s) => s.typ === 'imię');
    expect(imie.lemat).toBe('Konrad');
    expect(a.rodzaj).toBe('m'); // rodzaj known from the dictionary even without a paradigm
  });
});
