import { createRng } from './rng.mjs';
import {
  ROLES, ORGANIZATIONS, UPPERCASE_INSTITUTIONS, CITIES, CITIES_LOCATIVE, generateAddress,
  generateAmountWords, generateAmountDigits, generateDocketNumber, generateInvoiceNumber,
  generateDowodOsobisty, generatePaszport, generatePrawoJazdy, generateRejestracja,
  generateIdentifier, HEALTH_PHRASES, CRIMINAL_PHRASES, UNION_PHRASES, RELIGION_PHRASES,
  POLITICAL_PHRASES, SEXUAL_ORIENTATION_PHRASES, ETHNIC_ORIGIN_PHRASES,
  CITATION_TRAPS, STATUTE_TRAPS, COMMON_NOUN_PLACE_TRAPS, GENERIC_ROLE_TRAPS, RATE_TRAPS,
} from './holdout-pools.mjs';
import { findRegexEntities } from '../../src/anonymizer.js';
import {
  peselChecksumValid, nipChecksumValid, regon9ChecksumValid, regon14ChecksumValid, ibanChecksumValid,
} from './checksums.mjs';

function manyRng(seedPrefix, n) {
  return Array.from({ length: n }, (_, i) => createRng(`${seedPrefix}/${i}`));
}

// Every phrase/name pool should have no internal duplicates and no blanks —
// cheap structural checks that catch copy-paste mistakes in a long hand-
// authored list.
const NAMED_STRING_POOLS = {
  ROLES, ORGANIZATIONS, UPPERCASE_INSTITUTIONS, CITIES,
  HEALTH_PHRASES, CRIMINAL_PHRASES, UNION_PHRASES, RELIGION_PHRASES, POLITICAL_PHRASES,
  SEXUAL_ORIENTATION_PHRASES, ETHNIC_ORIGIN_PHRASES,
  CITATION_TRAPS, STATUTE_TRAPS, COMMON_NOUN_PLACE_TRAPS, GENERIC_ROLE_TRAPS, RATE_TRAPS,
};

describe('string pools: no duplicates, no blanks', () => {
  for (const [name, pool] of Object.entries(NAMED_STRING_POOLS)) {
    it(`${name} (${pool.length} entries) has no duplicates or empty strings`, () => {
      expect(pool.every((s) => typeof s === 'string' && s.trim().length > 0)).toBe(true);
      expect(new Set(pool).size).toBe(pool.length);
    });
  }
});

describe('CITIES_LOCATIVE', () => {
  it('has a locative form for every city in CITIES, and only those', () => {
    expect(Object.keys(CITIES_LOCATIVE).sort()).toEqual([...CITIES].sort());
  });
});

describe('generateAddress', () => {
  it('produces a well-formed "ul. X N[/M], NN-NNN Miasto" address, deterministically', () => {
    for (const rng of manyRng('address', 30)) {
      const addr = generateAddress(rng);
      expect(addr).toMatch(/^ul\. [\p{L} ]+ \d{1,2}(\/\d{1,2})?, \d{2}-\d{3} .+$/u);
    }
    expect(generateAddress(createRng('address/fixed'))).toBe(generateAddress(createRng('address/fixed')));
  });
});

describe('financial amount generators', () => {
  it('generateAmountWords always ends in "złotych 00/100"', () => {
    for (const rng of manyRng('amount-words', 20)) {
      expect(generateAmountWords(rng)).toMatch(/złotych 00\/100$/);
    }
  });

  it('generateAmountDigits is detected by the app as FINANCIAL_AMOUNT for every numeric style', () => {
    for (const style of ['dot-thousands', 'space-thousands', 'eur', 'pln-prefix', 'plain']) {
      for (const rng of manyRng(`amount-${style}`, 10)) {
        const amount = generateAmountDigits(rng, { style });
        const text = `Do zapłaty pozostaje ${amount} tytułem należności głównej.`;
        const hit = findRegexEntities(text).find((e) => e.entity_group === 'FINANCIAL_AMOUNT');
        expect(hit, `"${amount}" (style=${style}) not detected as FINANCIAL_AMOUNT in "${text}"`).toBeTruthy();
      }
    }
  });
});

describe('generateDocketNumber', () => {
  it('is detected by the app as DOCUMENT_REFERENCE, with and without a roman division prefix', () => {
    let sawWithDivision = false;
    let sawWithoutDivision = false;
    for (const rng of manyRng('docket', 60)) {
      const docket = generateDocketNumber(rng);
      const text = `Sprawa prowadzona jest pod sygnaturą ${docket} przed sądem właściwym.`;
      const hit = findRegexEntities(text).find((e) => e.entity_group === 'DOCUMENT_REFERENCE');
      expect(hit, `"${docket}" not detected as DOCUMENT_REFERENCE in "${text}"`).toBeTruthy();
      if (/^[IVX]+ /.test(docket)) sawWithDivision = true; else sawWithoutDivision = true;
    }
    expect(sawWithDivision).toBe(true);
    expect(sawWithoutDivision).toBe(true);
  });
});

describe('identifier document formatters (format-only, no checksum — same precedent as dev)', () => {
  it('generateDowodOsobisty: "LLL NNNNNN"', () => {
    for (const rng of manyRng('dowod', 30)) expect(generateDowodOsobisty(rng)).toMatch(/^[A-Z]{3} \d{6}$/);
  });
  it('generatePaszport: "LL NNNNNNN"', () => {
    for (const rng of manyRng('paszport', 30)) expect(generatePaszport(rng)).toMatch(/^[A-Z]{2} \d{7}$/);
  });
  it('generatePrawoJazdy: "NNNNN/NN/NNNN"', () => {
    for (const rng of manyRng('prawojazdy', 30)) expect(generatePrawoJazdy(rng)).toMatch(/^\d{5}\/\d{2}\/\d{4}$/);
  });
  it('generateRejestracja: "LL(L) alnum{4,5}"', () => {
    for (const rng of manyRng('rejestracja', 30)) expect(generateRejestracja(rng)).toMatch(/^[A-Z]{2} [A-Z0-9]{4,5}$/);
  });
});

describe('generateIdentifier: dispatch and checksum validity for all 10 manifest subtypes', () => {
  const CHECKSUMMED = {
    pesel: (v) => peselChecksumValid(v),
    nip: (v) => nipChecksumValid(v),
    regon: (v) => (v.length === 9 ? regon9ChecksumValid(v) : regon14ChecksumValid(v)),
    ibanNrb: (v) => ibanChecksumValid(v.startsWith('PL') ? v : `PL${v}`),
  };
  const SUBTYPES = ['pesel', 'dowodOsobisty', 'paszport', 'prawoJazdy', 'nip', 'regon', 'krs', 'ibanNrb', 'vin', 'rejestracja'];

  for (const subtype of SUBTYPES) {
    it(`"${subtype}" produces a value tagged with the right entity_group${CHECKSUMMED[subtype] ? ' and a valid checksum' : ''}`, () => {
      for (const rng of manyRng(`identifier-${subtype}`, 15)) {
        const result = generateIdentifier(rng, subtype);
        expect(result.subtype).toBe(subtype);
        expect(result.value).toBeTruthy();
        expect(['PERSON_IDENTIFIER', 'ORGANIZATION_IDENTIFIER', 'BANK_ACCOUNT_IDENTIFIER', 'VEHICLE_IDENTIFIER']).toContain(result.entityGroup);
        if (CHECKSUMMED[subtype]) expect(CHECKSUMMED[subtype](result.value)).toBe(true);
      }
    });
  }

  it('rejects an unknown subtype', () => {
    expect(() => generateIdentifier(createRng('bad-subtype'), 'nonexistent')).toThrow();
  });
});

// First-pass sanity check against a hand-compiled denylist of place/street
// names from the dev corpus (test-data/adversarial). Same role as
// holdout-people.test.js's denylist check — the mechanical, authoritative
// guard against the actual generated corpora is holdout-disjointness.test.js.
const DEV_CITIES_AND_STREETS = new Set([
  'Toruń', 'Toruniu', 'Torunia', 'Chełmno', 'Chełmnie', 'Grudziądz', 'Grudziądzu',
  'Golub-Dobrzyń', 'Golubiu-Dobrzyniu', 'Chełmża', 'Bydgoszcz', 'Bydgoszczy', 'Gdańsk', 'Gdańsku',
  'ul. Żeglarskiej', 'ul. Klonowa', 'ul. Krucza', 'ul. Polna', 'ul. Przemysłowa',
  'ul. Młodzieżowa', 'ul. Wodna', 'ul. Generalska', 'ul. Szeroka', 'ul. Bydgoska', 'ul. Kowalskiego',
]);

describe('disjointness (first pass, cities/streets vs dev denylist)', () => {
  it('no holdout city matches a dev city', () => {
    expect(CITIES.filter((c) => DEV_CITIES_AND_STREETS.has(c))).toEqual([]);
  });
  it('no holdout street name matches a dev street', () => {
    const holdoutStreets = new Set();
    for (const rng of manyRng('street-collect', 100)) holdoutStreets.add(generateAddress(rng).split(',')[0]);
    const collisions = [...holdoutStreets].filter((s) => DEV_CITIES_AND_STREETS.has(s));
    expect(collisions).toEqual([]);
  });
});
