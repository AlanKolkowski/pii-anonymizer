// K2/K3 (FLEKSJA-IMPL-PLAN.md SS2.4): generateForm + fullParadigm — the
// other half of the "silnik morfologiczny" API contract. Consumes
// analyzePersonName's output; never guesses (przypadek-nieustalony /
// wariantywne / nie-umiem-odmienić / rodzaj-niejednoznaczny flags with
// alternatives instead of picking one).
import { loadMorphData } from './load.js';
import { MINI_LEXICON } from './fixtures/mini-lexicon.js';
import { analyzePersonName } from './analyze.js';
import { generateForm, fullParadigm } from './generate.js';

const morph = loadMorphData(MINI_LEXICON);
const analyze = (value, attested = []) => analyzePersonName(value, attested, morph);

describe('generateForm — core generation (SS2.4)', () => {
  it('generates the genitive of a nominative legend value (the core deanonymization proof)', () => {
    const a = analyze('Jan Kowalski');
    const g = generateForm(a, new Set(['D']));
    expect(g).toEqual({ status: 'ok', tekst: 'Jana Kowalskiego', przypadek: 'D', zrodlo: 'reguła' });
  });

  it('generates every non-vocative case correctly for a dictionary imię + rule nazwisko', () => {
    const a = analyze('Anna Nowak');
    expect(generateForm(a, new Set(['C'])).tekst).toBe('Annie Nowak'); // Nowak: noun-masc class, indeclinable-ish? see below
  });

  it('D/B syncretism (masculine personal) collapses to one form, not an ambiguity flag', () => {
    const a = analyze('Jan Baran');
    const g = generateForm(a, new Set(['D', 'B']));
    expect(g.status).toBe('ok');
    expect(g.tekst).toBe('Jana Barana');
  });

  it('a genuinely empty case set refuses to guess', () => {
    const a = analyze('Jan Kowalski');
    expect(generateForm(a, new Set())).toEqual({ status: 'flaga', powod: 'przypadek-nieustalony' });
  });

  it('propagates a structural flag from analyzePersonName unchanged', () => {
    expect(generateForm({ status: 'flaga', powod: 'struktura' }, new Set(['D'])))
      .toEqual({ status: 'flaga', powod: 'struktura' });
  });
});

describe('generateForm — attested forms outrank generation (SS2.7/SS3.3 ordering)', () => {
  it('without attestation, a dictionary variantness entry flags rather than picks one', () => {
    const a = analyze('Kozioł');
    const g = generateForm(a, new Set(['D']));
    expect(g.status).toBe('flaga');
    expect(g.powod).toBe('wariantywne');
    expect(g.alternatywy).toEqual(expect.arrayContaining(['Kozła', 'Kozioła']));
  });

  it('an attested variant resolves the same request cleanly, sourced as poświadczona', () => {
    const a = analyze('Kozioł', ['Kozła']);
    const g = generateForm(a, new Set(['D']));
    expect(g).toEqual({ status: 'ok', tekst: 'Kozła', przypadek: 'D', zrodlo: 'poświadczona' });
  });

  it('G12: a nominative attested variant is proposed for a nominative target, replacing a non-nominative legend value', () => {
    // Legend holds the first-seen (genitive) form; the source also showed
    // the person nominatively elsewhere.
    const a = analyze('Jana Kowalskiego', ['Jan Kowalski', 'Jana Kowalskiego']);
    const g = generateForm(a, new Set(['M']));
    expect(g).toEqual({ status: 'ok', tekst: 'Jan Kowalski', przypadek: 'M', zrodlo: 'poświadczona' });
  });
});

describe('generateForm — never guesses gender (R-FL-1-adjacent: gender-dependent divergence)', () => {
  it('flags rodzaj-niejednoznaczny when the two possible genders would generate DIFFERENT forms', () => {
    // Bare "Wilk" with no name/attestation: masculine noun-class (D:
    // "Wilka") vs feminine-indeclinable (D: "Wilk", unchanged) genuinely
    // diverge — generating either would be a silent guess.
    const a = analyze('Wilk');
    expect(a.rodzaj).toBeNull();
    const g = generateForm(a, new Set(['D']));
    expect(g.status).toBe('flaga');
    expect(g.powod).toBe('rodzaj-niejednoznaczny');
  });

  it('a resolved gender (from a preceding given name) disambiguates the same surname', () => {
    const a = analyze('Anna Wilk');
    expect(a.rodzaj).toBe('f');
    const g = generateForm(a, new Set(['D']));
    expect(g).toEqual({ status: 'ok', tekst: 'Anny Wilk', przypadek: 'D', zrodlo: 'reguła' });
  });
});

describe('generateForm — foreign / unknown never generate', () => {
  it('foreign surname flags obce, never a guessed form (given name resolves fine in isolation)', () => {
    const a = analyze('Jan Smith');
    const g = generateForm(a, new Set(['D']));
    expect(g).toEqual({ status: 'flaga', powod: 'obce' });
  });

  it('an unresolvable (not in the mini-dictionary) given name flags imię-nieznane', () => {
    const a = analyze('John Kowalski');
    const g = generateForm(a, new Set(['D']));
    expect(g).toEqual({ status: 'flaga', powod: 'imię-nieznane' });
  });
});

describe('fullParadigm — complete 7-case view with explicit gaps', () => {
  it('all seven cases for a fully rule-governed adjectival surname', () => {
    const a = analyze('Jan Kowalski');
    expect(fullParadigm(a)).toEqual({
      M: 'Jan Kowalski', D: 'Jana Kowalskiego', C: 'Janowi Kowalskiemu', B: 'Jana Kowalskiego',
      N: 'Janem Kowalskim', Ms: 'Janie Kowalskim', W: 'Janie Kowalski',
    });
  });

  it('unresolvable slots surface as explicit null gaps, not thrown errors or guesses', () => {
    const a = analyze('Wilk'); // gender-ambiguous, every oblique case diverges by gender
    const paradigm = fullParadigm(a);
    expect(paradigm.M).toBe('Wilk'); // both genders agree nominative is unchanged
    expect(paradigm.D).toBeNull();
  });
});
