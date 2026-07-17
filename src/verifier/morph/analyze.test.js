import { parseNameStructure, resolveGender } from './analyze.js';

// Hand-written test fixture — the same shape load.js produces; no external
// dataset content (O-3 discipline).
const IMIONA = new Map([
  ['konrad', { rodzaj: 'm', paradygmat: null, frek: 4 }],
  ['halina', { rodzaj: 'f', paradygmat: null, frek: 4 }],
  ['maria', { rodzaj: 'm/f', paradygmat: null, frek: 6 }],
  ['aniela', { rodzaj: 'f', paradygmat: null, frek: 3 }],
]);

function types(value) {
  const parsed = parseNameStructure(value, IMIONA);
  return parsed.status === 'ok' ? parsed.slowa.map((s) => s.typ) : parsed;
}

describe('parseNameStructure (§2.2 pkt 1-2)', () => {
  it('types the allowed v1 structures positionally', () => {
    expect(types('Konrad Żurawski')).toEqual(['imię', 'nazwisko']);
    expect(types('Konrad Jan Żurawski')).toEqual(['imię', 'imię', 'nazwisko']);
    expect(types('K. Żurawski')).toEqual(['inicjał', 'nazwisko']);
    expect(types('Halina Mroczek-Sowińska')).toEqual(['imię', 'nazwisko-dwuczłonowe']);
  });

  it('single word: the dictionary decides imię, otherwise nazwisko', () => {
    expect(types('Konrad')).toEqual(['imię']);
    expect(types('Żurawski')).toEqual(['nazwisko']);
  });

  it('bare initials are legal input but flagged struktura (G14)', () => {
    const parsed = parseNameStructure('J. M.', IMIONA);
    expect(parsed.status).toBe('flaga');
    expect(parsed.powod).toBe('struktura');
  });

  it('flags everything outside the closed structure list', () => {
    for (const bad of [
      'Jan i Anna Kowalscy',      // conjunction (lowercase word)
      'Jan/Kowalski',
      'Jan Kowalski 3',
      'Jan Maria Konrad Anna Kowalski', // > 4 words
      'jan kowalski',
      '',
      'Żurawski K.',              // initial after the surname
    ]) {
      expect(parseNameStructure(bad, IMIONA).status, bad).toBe('flaga');
    }
  });
});

describe('resolveGender (§2.3) — first decisive source wins', () => {
  const parsed = (value) => parseNameStructure(value, IMIONA).slowa;

  it('1: the first given name decides via the dictionary', () => {
    expect(resolveGender(parsed('Konrad Wilk'), IMIONA)).toEqual({ rodzaj: 'm', zrodlo: 'imię-słownik' });
    expect(resolveGender(parsed('Aniela Wilk'), IMIONA)).toEqual({ rodzaj: 'f', zrodlo: 'imię-słownik' });
  });

  it('an m/f dictionary name falls through to the surname form', () => {
    expect(resolveGender(parsed('Maria Zawadzka'), IMIONA))
      .toEqual({ rodzaj: 'f', zrodlo: 'nazwisko-przymiotnikowe' });
  });

  it('2: adjectival surname carries gender — the only path for initials (G13)', () => {
    expect(resolveGender(parsed('K. Żurawski'), IMIONA))
      .toEqual({ rodzaj: 'm', zrodlo: 'nazwisko-przymiotnikowe' });
    expect(resolveGender(parsed('K. Mroczek-Sowińska'), IMIONA))
      .toEqual({ rodzaj: 'f', zrodlo: 'nazwisko-przymiotnikowe' });
  });

  it('3: an unambiguous attested adjectival form decides', () => {
    expect(resolveGender(parsed('K. Wilk'), IMIONA, ['Halinie Mroczek-Sowińskiej']))
      .toEqual({ rodzaj: 'f', zrodlo: 'poświadczone' });
  });

  it('no source → flaga rodzaj-niejednoznaczny, zero proposals (G15)', () => {
    expect(resolveGender(parsed('K. Wilk'), IMIONA))
      .toEqual({ status: 'flaga', powod: 'rodzaj-niejednoznaczny' });
  });
});
