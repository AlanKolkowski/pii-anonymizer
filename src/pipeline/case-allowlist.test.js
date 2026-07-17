import { parseSignature, buildSignatureRegex, findAllowlistedSignatures } from './case-allowlist.js';

function spansText(text, entries) {
  return findAllowlistedSignatures(text, entries).map(({ start, end }) => text.slice(start, end));
}

describe('parseSignature', () => {
  it('parses the canonical shapes', () => {
    expect(parseSignature('I C 1552/23')).toEqual({ division: 'I', repertorium: 'C', number: '1552', year: '23', upr: false });
    expect(parseSignature('II Ca 210/24 upr')).toEqual({ division: 'II', repertorium: 'Ca', number: '210', year: '24', upr: true });
    expect(parseSignature('KM 1552/25')).toEqual({ division: null, repertorium: 'KM', number: '1552', year: '25', upr: false });
    expect(parseSignature('XVII AmC 1552/2023')).toEqual({ division: 'XVII', repertorium: 'AmC', number: '1552', year: '2023', upr: false });
    expect(parseSignature('C 1552/23')).toEqual({ division: null, repertorium: 'C', number: '1552', year: '23', upr: false });
  });

  it('normalizes NBSP, tabs, extra whitespace and slash spacing before parsing', () => {
    expect(parseSignature('I C  1552 / 23')).toEqual({ division: 'I', repertorium: 'C', number: '1552', year: '23', upr: false });
    expect(parseSignature('  ii ca 210/24  ')).toEqual({ division: 'II', repertorium: 'ca', number: '210', year: '24', upr: false });
  });

  it('accepts a repertorium that merely looks like a roman numeral', () => {
    expect(parseSignature('X 123/23')).toEqual({ division: null, repertorium: 'X', number: '123', year: '23', upr: false });
  });

  it('accepts the hyphenated e-court repertorium "Nc-e" (EPU)', () => {
    expect(parseSignature('VI Nc-e 1234567/23')).toEqual({ division: 'VI', repertorium: 'Nc-e', number: '1234567', year: '23', upr: false });
    expect(parseSignature('Nc-e 1234567/23')).toEqual({ division: null, repertorium: 'Nc-e', number: '1234567', year: '23', upr: false });
  });

  it('rejects non-signatures', () => {
    expect(parseSignature('')).toBeNull();
    expect(parseSignature('Jan Kowalski')).toBeNull();
    expect(parseSignature('I C 1552')).toBeNull();
    expect(parseSignature('1552/23')).toBeNull();
    expect(parseSignature('I C 1552/3')).toBeNull();
    expect(parseSignature('I C 1552/023')).toBeNull();
    expect(parseSignature('Sygn. akt I C 1552/23 z dnia')).toBeNull();
    expect(parseSignature(null)).toBeNull();
  });

  it('rejects a two-token entry whose first token is not a roman division', () => {
    expect(parseSignature('Foo C 1552/23')).toBeNull();
  });
});

describe('findAllowlistedSignatures — golden 5.3 pkt 1-2', () => {
  const ENTRY = ['I C 1552/23'];

  it('matches the exact form and its whitespace variants', () => {
    expect(spansText('sygn. akt I C 1552/23, dalej', ENTRY)).toEqual(['I C 1552/23']);
    expect(spansText('sygn. akt I C 1552/23, dalej', ENTRY)).toEqual(['I C 1552/23']);
    expect(spansText('sygn. akt I C 1552 / 23, dalej', ENTRY)).toEqual(['I C 1552 / 23']);
    expect(spansText('sygn. akt I C 1552/2023, dalej', ENTRY)).toEqual(['I C 1552/2023']);
    expect(spansText('sygn. akt I C\n1552/23, dalej', ENTRY)).toEqual(['I C\n1552/23']);
    expect(spansText('sygn. akt i c 1552/23, dalej', ENTRY)).toEqual(['i c 1552/23']);
  });

  it('does not match another division, number or year', () => {
    expect(spansText('sygn. akt II C 1552/23', ENTRY)).toEqual([]);
    expect(spansText('sygn. akt I C 1553/23', ENTRY)).toEqual([]);
    expect(spansText('sygn. akt I C 1552/24', ENTRY)).toEqual([]);
    expect(spansText('sygn. akt I C 1552/1923', ENTRY)).toEqual([]);
    expect(spansText('sygn. akt I C 11552/23 oraz I C 1552/230', ENTRY)).toEqual([]);
  });

  it('leaves a cited ruling of another case alone in the same document', () => {
    const text = 'W sprawie I C 1552/23 powód powołał wyrok SN III CZP 6/21.';
    expect(spansText(text, ENTRY)).toEqual(['I C 1552/23']);
  });

  it('does not match across a blank line', () => {
    expect(spansText('I C\n\n1552/23', ENTRY)).toEqual([]);
  });

  it('matches the upr suffix when it stands in the text (entry without upr)', () => {
    expect(spansText('sygn. II Ca 210/24 upr, doręczono', ['II Ca 210/24'])).toEqual(['II Ca 210/24 upr']);
  });

  it('an entry with upr also matches the occurrence without it', () => {
    expect(spansText('sygn. II Ca 210/24, doręczono', ['II Ca 210/24 upr'])).toEqual(['II Ca 210/24']);
  });

  it('an entry without a division matches the divisioned occurrence, span extended', () => {
    expect(spansText('sygn. akt I C 1552/23', ['C 1552/23'])).toEqual(['I C 1552/23']);
    expect(spansText('sygn. akt XVII AmC 155/20', ['AmC 155/20'])).toEqual(['XVII AmC 155/20']);
  });

  it('an entry with a division does not match another division', () => {
    expect(spansText('sygn. akt II C 1552/23', ['I C 1552/23'])).toEqual([]);
  });

  it('a 4-digit-year entry matches the 2-digit occurrence', () => {
    expect(spansText('sygn. akt I C 1552/23', ['I C 1552/2023'])).toEqual(['I C 1552/23']);
  });

  it('skips unparseable entries without matching anything', () => {
    expect(spansText('cokolwiek I C 1552/23', ['nie-sygnatura'])).toEqual([]);
  });

  it('finds all occurrences across the document', () => {
    const text = 'sygn. I C 1552/23; ponownie I C 1552/2023 oraz I C 1552 / 23.';
    expect(spansText(text, ENTRY)).toEqual(['I C 1552/23', 'I C 1552/2023', 'I C 1552 / 23']);
  });
});

describe('findAllowlistedSignatures — hyphenated e-court repertorium (Nc-e)', () => {
  const ENTRY = ['VI Nc-e 1234567/23'];

  it('matches the exact hyphenated-repertorium occurrence', () => {
    expect(spansText('sygn. akt VI Nc-e 1234567/23, dalej', ENTRY)).toEqual(['VI Nc-e 1234567/23']);
  });

  it('does not match a different repertorium (own signature must not over-match "Nc")', () => {
    expect(spansText('sygn. akt VI Nc 1234567/23', ENTRY)).toEqual([]);
  });

  it('does not match a different number under the same hyphenated repertorium', () => {
    expect(spansText('sygn. akt VI Nc-e 9999999/23', ENTRY)).toEqual([]);
  });
});

// Property (§5.4): an entry NEVER matches a different number or year.
describe('case-allowlist property — no cross-number/year matches', () => {
  function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('500 random near-miss signatures never match the entry', () => {
    const rng = makeRng(0xBADCAFE);
    const entry = 'I C 1552/23';
    const regexSanity = buildSignatureRegex(parseSignature(entry));
    expect('I C 1552/23'.match(regexSanity)).not.toBeNull();

    const divisions = ['I', 'II', 'III', 'IV', 'XI'];
    const reps = ['C', 'Ca', 'Co', 'K', 'AmC'];
    for (let i = 0; i < 500; i++) {
      const division = divisions[Math.floor(rng() * divisions.length)];
      const rep = reps[Math.floor(rng() * reps.length)];
      const number = String(1 + Math.floor(rng() * 9999));
      const year = String(10 + Math.floor(rng() * 90));
      const candidate = `${division} ${rep} ${number}/${year}`;
      const sameCase = division === 'I' && rep.toUpperCase() === 'C' && number === '1552' && (year === '23' || year === '2023');
      const matched = spansText(`sygn. akt ${candidate} w aktach`, [entry]);
      if (sameCase) {
        expect(matched).toEqual([candidate]);
      } else {
        expect(matched, `entry "${entry}" must not match "${candidate}"`).toEqual([]);
      }
    }
  });
});
