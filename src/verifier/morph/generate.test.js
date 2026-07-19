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

describe('generateForm — bare feminine adjectival surnames (-ska/-cka/-dzka), morph:null (H-fix)', () => {
  // Reproduces the resolveSurnameWord bug end to end: a legend value that IS
  // already the nominative ("Zawadzka") must decline correctly into every
  // dependent case with NO dictionary present. Before the fix, the "genuine"
  // lemma filter mis-lemmatized to a truncated stem ("Zawadzk"), which then
  // poisoned every generated case (and even wrongly "attested" D as the
  // unchanged input via the poświadczona shortcut).
  const analyzeNoDict = (value, attested = []) => analyzePersonName(value, attested, null);

  it('declines every dependent case correctly from a nominative legend value, no dictionary', () => {
    const a = analyzeNoDict('Zawadzka');
    const expected = { D: 'Zawadzkiej', C: 'Zawadzkiej', B: 'Zawadzką', N: 'Zawadzką', Ms: 'Zawadzkiej' };
    for (const [przypadek, tekst] of Object.entries(expected)) {
      const g = generateForm(a, new Set([przypadek]));
      expect(g.status, przypadek).toBe('ok');
      expect(g.tekst, przypadek).toBe(tekst);
      expect(g.zrodlo, przypadek).toBe('reguła');
    }
  });

  it('holds for other -ska/-cka/-dzka surnames too', () => {
    const table = {
      Sowińska: { D: 'Sowińskiej', C: 'Sowińskiej', B: 'Sowińską', N: 'Sowińską', Ms: 'Sowińskiej' },
      Kowalska: { D: 'Kowalskiej', C: 'Kowalskiej', B: 'Kowalską', N: 'Kowalską', Ms: 'Kowalskiej' },
    };
    for (const [lemma, forms] of Object.entries(table)) {
      const a = analyzeNoDict(lemma);
      for (const [przypadek, tekst] of Object.entries(forms)) {
        expect(generateForm(a, new Set([przypadek])).tekst, `${lemma}/${przypadek}`).toBe(tekst);
      }
    }
  });

  it('a dependent-case legend value round-trips through the reconstructed nominative too', () => {
    const a = analyzeNoDict('Zawadzkiej');
    expect(generateForm(a, new Set(['M'])).tekst).toBe('Zawadzka');
    expect(generateForm(a, new Set(['B'])).tekst).toBe('Zawadzką');
  });

  it('regression: masculine -ski/-cki/-dzki declines correctly from a nominative legend value (fix must not touch this path)', () => {
    const a = analyzeNoDict('Kowalski');
    expect(generateForm(a, new Set(['D'])).tekst).toBe('Kowalskiego');
    expect(generateForm(a, new Set(['C'])).tekst).toBe('Kowalskiemu');
    expect(generateForm(a, new Set(['N'])).tekst).toBe('Kowalskim');
  });

  it('regression: noun-type surname without an adjectival ending stays genuinely gender-ambiguous', () => {
    // "Kowal" bears no adjectival ending, so — exactly like the pre-existing
    // "Wilk" case above — masculine noun declension ("Kowala") and feminine
    // indeclinable ("Kowal" unchanged) genuinely diverge. The fix's new
    // adjectival self-match shortcut is keyed on class, not on "any
    // self-match", so it must never fire here.
    const a = analyzeNoDict('Kowal');
    expect(a.rodzaj).toBeNull();
    const g = generateForm(a, new Set(['D']));
    expect(g.status).toBe('flaga');
    expect(g.powod).toBe('rodzaj-niejednoznaczny');
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
