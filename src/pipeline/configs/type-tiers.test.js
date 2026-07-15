import { describe, it, expect } from 'vitest';
import { TYPE_TIERS, tierFor, effectiveTier } from './type-tiers.js';
import { TYPE_WEIGHTS } from './type-weights.js';
import { allEntityTypes } from './entity-sources.js';

// Literal lists from ZAKRES-ANONIMIZACJI.md §3 / SCOPE-TIERS-DESIGN.md §2.2
// pkt 3. Asserted as literal arrays (not "every type has *some* tier") so an
// unintentional edit to TYPE_TIERS trips this test — "zamierzona zmiana
// wymaga zmiany testu" (SCOPE-TIERS-DESIGN.md §2.3).
const EXPECTED_MASK = [
  'PERSON_NAME', 'PERSON_ALIAS', 'PERSON_IDENTIFIER', 'POSTAL_ADDRESS',
  'EMAIL_ADDRESS', 'PHONE_NUMBER', 'CONTACT_HANDLE', 'BANK_ACCOUNT_IDENTIFIER',
  'PAYMENT_CARD', 'PAYMENT_CARD_SECURITY', 'ACCOUNT_IDENTIFIER',
  'DEVICE_IDENTIFIER', 'VEHICLE_IDENTIFIER', 'DATE_OF_BIRTH',
  'ORGANIZATION_IDENTIFIER', 'AUTH_SECRET', 'IP_ADDRESS', 'GEO_LOCATION',
  'COOKIE_IDENTIFIER',
];

const EXPECTED_REVIEW = [
  'PERSON_ROLE_OR_TITLE', 'PERSON_ATTRIBUTE', 'HEALTH_DATA', 'GENETIC_DATA',
  'BIOMETRIC_DATA', 'RELIGION_OR_BELIEF', 'POLITICAL_OPINION',
  'SEXUAL_ORIENTATION', 'TRADE_UNION_MEMBERSHIP', 'ETHNIC_ORIGIN',
  'CRIMINAL_OFFENCE_DATA', 'FINANCIAL_AMOUNT', 'INCOME_COMPENSATION',
  'LOCATION',
];

const EXPECTED_PASS = ['DOCUMENT_REFERENCE', 'ORGANIZATION_NAME'];

describe('TYPE_TIERS config', () => {
  it('matches the mask (W1) list from ZAKRES-ANONIMIZACJI.md §3 exactly', () => {
    const actual = Object.keys(TYPE_TIERS).filter(t => TYPE_TIERS[t] === 'mask').sort();
    expect(actual).toEqual([...EXPECTED_MASK].sort());
  });

  it('matches the review (W2) list from ZAKRES-ANONIMIZACJI.md §3 exactly', () => {
    const actual = Object.keys(TYPE_TIERS).filter(t => TYPE_TIERS[t] === 'review').sort();
    expect(actual).toEqual([...EXPECTED_REVIEW].sort());
  });

  it('matches the pass (W3) list from ZAKRES-ANONIMIZACJI.md §3 exactly', () => {
    const actual = Object.keys(TYPE_TIERS).filter(t => TYPE_TIERS[t] === 'pass').sort();
    expect(actual).toEqual([...EXPECTED_PASS].sort());
  });

  it('every value is one of mask/review/pass', () => {
    for (const [type, tier] of Object.entries(TYPE_TIERS)) {
      expect(['mask', 'review', 'pass'], `${type} has invalid tier "${tier}"`).toContain(tier);
    }
  });

  it('every type in ENTITY_SOURCES (allEntityTypes) has an explicit tier — no gaps', () => {
    const missing = allEntityTypes().filter(t => !(t in TYPE_TIERS));
    expect(missing).toEqual([]);
  });

  it('has no ghost types beyond ENTITY_SOURCES', () => {
    const known = new Set(allEntityTypes());
    const ghosts = Object.keys(TYPE_TIERS).filter(t => !known.has(t));
    expect(ghosts).toEqual([]);
  });

  it('accounts for exactly the 35 types of the ZAKRES §3 matrix', () => {
    expect(Object.keys(TYPE_TIERS)).toHaveLength(35);
    expect(allEntityTypes()).toHaveLength(35);
  });
});

describe('tierFor', () => {
  it('returns the configured tier for known types', () => {
    expect(tierFor('PERSON_NAME')).toBe('mask');
    expect(tierFor('LOCATION')).toBe('review');
    expect(tierFor('ORGANIZATION_NAME')).toBe('pass');
  });

  it('fail-safe: an unknown type is always "mask", never passed through', () => {
    expect(tierFor('SOME_FUTURE_TYPE_NOBODY_HAS_SEEN')).toBe('mask');
    expect(tierFor(undefined)).toBe('mask');
    expect(tierFor('')).toBe('mask');
  });
});

describe('effectiveTier (ST-2, SCOPE-TIERS-DESIGN.md §3.2 pkt 1)', () => {
  it('falls back to the static TYPE_TIERS map when nothing else applies', () => {
    expect(effectiveTier({ entity_group: 'PERSON_NAME' }, {})).toBe('mask');
    expect(effectiveTier({ entity_group: 'LOCATION' }, {})).toBe('review');
    expect(effectiveTier({ entity_group: 'ORGANIZATION_NAME' }, {})).toBe('pass');
  });

  it('defaults opts to {} — calling with no second argument is safe', () => {
    expect(effectiveTier({ entity_group: 'PERSON_NAME' })).toBe('mask');
  });

  it('a tierOverrides entry beats the static default', () => {
    const opts = { tierOverrides: { LOCATION: 'pass' } };
    expect(effectiveTier({ entity_group: 'LOCATION' }, opts)).toBe('pass');
    // Unrelated types are untouched by the override.
    expect(effectiveTier({ entity_group: 'PERSON_NAME' }, opts)).toBe('mask');
  });

  it('a per-entity forceTier beats both tierOverrides and the static default', () => {
    const entity = { entity_group: 'ORGANIZATION_NAME', forceTier: 'mask' };
    expect(effectiveTier(entity, {})).toBe('mask');
    expect(effectiveTier(entity, { tierOverrides: { ORGANIZATION_NAME: 'review' } })).toBe('mask');
  });

  it('GS-5: allMask wins even over a per-entity forceTier — the single-tier profile has no exceptions', () => {
    const entity = { entity_group: 'ORGANIZATION_NAME', forceTier: 'review' };
    expect(effectiveTier(entity, { allMask: true })).toBe('mask');
    expect(effectiveTier(entity, { allMask: true, tierOverrides: { ORGANIZATION_NAME: 'pass' } })).toBe('mask');
  });

  it('allMask masks every type regardless of its configured tier', () => {
    for (const type of allEntityTypes()) {
      expect(effectiveTier({ entity_group: type }, { allMask: true })).toBe('mask');
    }
  });
});

describe('cross-guard: TYPE_TIERS vs TYPE_WEIGHTS', () => {
  // A weight-5 type (PESEL-grade identifiers, art. 9-10 categories) landing
  // in 'pass' by a config typo would silently stop masking/reviewing the
  // most damaging leak class there is. This guard makes that a red test,
  // not a silent config drift — art. 9-10 categories are 'review' by design
  // (ZAKRES §2: they don't identify alone), identifiers are 'mask'; neither
  // is ever 'pass'.
  it('no type with TYPE_WEIGHTS severity 5 is tiered "pass"', () => {
    const offenders = Object.entries(TYPE_WEIGHTS)
      .filter(([, weight]) => weight === 5)
      .map(([type]) => type)
      .filter(type => tierFor(type) === 'pass');
    expect(offenders).toEqual([]);
  });
});
