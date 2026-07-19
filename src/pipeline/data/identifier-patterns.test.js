// O-HC-1 (H-3-CLOSURE-DESIGN.md §5.4/§9.1, decyzja Alana 2026-07-19): the
// property test Alan asked for BY NAME — "whitelista_powiatów ∩ ISO-4217 =
// ∅" — proving the R-TR bare-variant whitelist (tablicaRejestracyjna.
// countyPrefixes) can never collide with a currency amount written
// ISO-code-first ("CHF 250 000", "USD 88812", "PLN 12345", ...). This is a
// STRUCTURAL guarantee on the data itself, independent of anonymizer.js's
// matching logic (covered separately by the findRegexEntities tests in
// src/anonymizer.test.js) — two independently-sourced data files (this
// county whitelist derived from Załącznik nr 13 to the vehicle-registration
// regulation; the currency list from the ISO 4217 Wikipedia article) are
// asserted disjoint.
import { describe, it, expect } from 'vitest';
import identifierPatterns from './identifier-patterns.json' with { type: 'json' };
import iso4217 from './iso-4217-currency-codes.json' with { type: 'json' };

const { countyPrefixes, countyPrefixesCurrencyExclusions } = identifierPatterns.tablicaRejestracyjna;
const ALL_CURRENCY_CODES = new Set([...iso4217.active, ...iso4217.historical]);

describe('identifier-patterns.json — tablicaRejestracyjna.countyPrefixes (O-HC-1 whitelist)', () => {
  it('loads a non-trivial whitelist (sanity check on the data file itself)', () => {
    // 380 administrative units (314 powiaty + 66 miasta na prawach powiatu,
    // Poland's well-known national total) each contribute 1-15 prefixes
    // (voivodeship letter(s) x county/city code(s)) — comfortably above 650
    // even after the 7 currency-collision exclusions below. A loose lower
    // bound, not an exact count, so the list can still grow via the normal
    // leak-register discipline without touching this test.
    expect(countyPrefixes.length).toBeGreaterThanOrEqual(650);
  });

  it('every prefix matches the exact shape TR_CANDIDATE_RE expects (2-3 uppercase letters)', () => {
    for (const prefix of countyPrefixes) {
      expect(prefix).toMatch(/^[A-Z]{2,3}$/);
    }
  });

  it('contains no duplicate entries', () => {
    expect(new Set(countyPrefixes).size).toBe(countyPrefixes.length);
  });

  it.each([
    ['WA', 'Warszawa (m.st. Warszawa, Mazowieckie)'],
    ['KR', 'Kraków (miasto, Małopolskie)'],
    ['GD', 'Gdańsk (miasto, Pomorskie)'],
    ['CT', 'Toruń (miasto, Kujawsko-Pomorskie)'],
    ['CTR', 'toruński (powiat ziemski, Kujawsko-Pomorskie)'],
  ])('contains the real, well-known plate prefix %s (%s)', (prefix) => {
    expect(countyPrefixes).toContain(prefix);
  });

  // THE property test: no ISO-4217 code (active OR historical/withdrawn) is
  // also a whitelisted county prefix. This is what makes the R-TR bare
  // variant safe against currency amounts written ISO-code-first, by
  // construction rather than by enumerating trap sentences.
  it('is disjoint from the full ISO-4217 currency code set (active + historical) — whitelista_powiatów ∩ ISO-4217 = ∅', () => {
    const collisions = countyPrefixes.filter((prefix) => ALL_CURRENCY_CODES.has(prefix));
    expect(collisions).toEqual([]);
  });

  it.each([
    'CHF', 'USD', 'PLN', 'EUR', 'GBP', 'JPY', 'CZK', 'DKK', 'NOK', 'SEK', 'HUF',
  ])('specifically excludes the currency code named in Alan\'s request: %s', (code) => {
    expect(countyPrefixes).not.toContain(code);
  });

  describe('countyPrefixesCurrencyExclusions (defense in depth, O-HC-3-style blocklist)', () => {
    it('lists the 7 real county/city codes that were excluded because they collide with an ISO-4217 code', () => {
      expect(countyPrefixesCurrencyExclusions.sort()).toEqual(
        ['AOR', 'ARA', 'GWE', 'LKR', 'MNT', 'PKR', 'TOP'].sort(),
      );
    });

    it('every excluded prefix is genuinely absent from the shipped whitelist (the exclusion actually took effect)', () => {
      for (const prefix of countyPrefixesCurrencyExclusions) {
        expect(countyPrefixes).not.toContain(prefix);
      }
    });

    it('every excluded prefix is a REAL ISO-4217 code (the exclusion rationale is not fabricated)', () => {
      for (const prefix of countyPrefixesCurrencyExclusions) {
        expect(ALL_CURRENCY_CODES.has(prefix)).toBe(true);
      }
    });
  });
});

describe('iso-4217-currency-codes.json — reference data sanity', () => {
  it('active codes include the core currencies named in the O-HC-1 request', () => {
    for (const code of ['CHF', 'USD', 'PLN', 'EUR', 'GBP', 'JPY', 'CZK']) {
      expect(iso4217.active).toContain(code);
    }
  });

  it('has no duplicate codes within or across active/historical', () => {
    const combined = [...iso4217.active, ...iso4217.historical];
    expect(new Set(combined).size).toBe(combined.length);
  });

  it('every code is a 3-letter uppercase string (ISO-4217 alphabetic code shape)', () => {
    for (const code of [...iso4217.active, ...iso4217.historical]) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });
});
