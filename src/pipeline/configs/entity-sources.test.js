import { describe, it, expect } from 'vitest';
import {
  SOURCES,
  ENTITY_SOURCES,
  ENTITY_LABELS,
  ENTITY_CATEGORIES,
  DEFAULT_ENABLED_CATEGORIES,
  allEntityTypes,
  defaultEnabledEntities,
  requiredSources,
} from './entity-sources.js';
import { findRegexEntities } from '../../anonymizer.js';

describe('entity-sources config', () => {
  it('every alias used in ENTITY_SOURCES exists in SOURCES', () => {
    const aliases = new Set(Object.keys(SOURCES));
    for (const [entity, sources] of Object.entries(ENTITY_SOURCES)) {
      for (const alias of sources) {
        expect(aliases.has(alias), `${entity} references unknown source "${alias}"`).toBe(true);
      }
    }
  });

  it('every entity in ENTITY_CATEGORIES exists in ENTITY_SOURCES', () => {
    const known = new Set(Object.keys(ENTITY_SOURCES));
    for (const cat of ENTITY_CATEGORIES) {
      for (const entity of cat.entities) {
        expect(known.has(entity), `category "${cat.id}" references unknown entity "${entity}"`).toBe(true);
      }
    }
  });

  it('every entity in ENTITY_SOURCES has a label', () => {
    for (const entity of Object.keys(ENTITY_SOURCES)) {
      expect(ENTITY_LABELS[entity], `missing label for ${entity}`).toBeTypeOf('string');
    }
  });

  it('every DEFAULT_ENABLED_CATEGORIES id exists in ENTITY_CATEGORIES', () => {
    const catIds = new Set(ENTITY_CATEGORIES.map(c => c.id));
    for (const id of DEFAULT_ENABLED_CATEGORIES) {
      expect(catIds.has(id), `unknown default category "${id}"`).toBe(true);
    }
  });

  it('allEntityTypes returns every key in ENTITY_SOURCES', () => {
    expect(allEntityTypes().sort()).toEqual(Object.keys(ENTITY_SOURCES).sort());
  });

  it('defaultEnabledEntities returns union of entities in default categories', () => {
    const expected = ENTITY_CATEGORIES
      .filter(c => DEFAULT_ENABLED_CATEGORIES.includes(c.id))
      .flatMap(c => c.entities);
    expect(defaultEnabledEntities().sort()).toEqual(expected.sort());
  });

  // Regression guard for audit finding α / decision 20 (A12): art. 9-10 RODO
  // must be masked out of the box. The union test above passes for ANY default
  // set, so it can't catch a silent removal of these categories — this one can.
  it('default config masks art. 9-10 RODO categories out of the box (A12)', () => {
    expect(DEFAULT_ENABLED_CATEGORIES).toContain('health-biometric');
    expect(DEFAULT_ENABLED_CATEGORIES).toContain('special-categories');
    const def = defaultEnabledEntities();
    for (const type of ['HEALTH_DATA', 'BIOMETRIC_DATA', 'CRIMINAL_OFFENCE_DATA', 'TRADE_UNION_MEMBERSHIP', 'ETHNIC_ORIGIN']) {
      expect(def, `${type} must be enabled by default`).toContain(type);
    }
  });

  // A12 is "free": enabling art. 9-10 adds no model beyond the two already
  // required by the identity/contact defaults, so it costs nothing at load time.
  // 'lexicon' (B4-lite), 'case-folded' (B2) and 'gazetteer' (SG-lite) are
  // listed alongside but are not HF models either — bundled JSON data and a
  // relabeling of the two existing models' own output, zero download cost —
  // so none of them breaks "free".
  it('enabling art. 9-10 by default adds no new model source (A12 is free)', () => {
    expect(requiredSources(defaultEnabledEntities()).sort())
      .toEqual(['case-folded', 'gazetteer', 'lexicon', 'multilang-fp32', 'polish-fp16', 'regex']);
  });

  it('requiredSources is empty for empty selection', () => {
    expect(requiredSources([])).toEqual([]);
  });

  it('requiredSources returns union of aliases for selected entities', () => {
    const got = requiredSources(['PERSON_NAME', 'EMAIL_ADDRESS']).sort();
    expect(got).toEqual(['case-folded', 'gazetteer', 'multilang-fp32', 'polish-fp16', 'regex'].sort());
  });

  it('requiredSources ignores unknown entity types', () => {
    expect(requiredSources(['NOT_A_REAL_TYPE'])).toEqual([]);
  });

  it('VITE_MODEL_DTYPE from process.env overrides dtype in Node (eval↔desktop parity)', async () => {
    vi.resetModules();
    process.env.VITE_MODEL_DTYPE = 'q8';
    try {
      const mod = await import('./entity-sources.js');
      expect(mod.SOURCES['multilang-fp32'].dtype).toBe('q8');
      expect(mod.SOURCES['multilang-fp32'].backends).toEqual(['wasm']);
      expect(mod.SOURCES['multilang-fp32'].sizeBytes).toBe(0);
      expect(mod.SOURCES.regex).toEqual({ kind: 'regex' });
    } finally {
      delete process.env.VITE_MODEL_DTYPE;
      vi.resetModules();
    }
  });
});

// Self-validating regex-floor coverage guard (IDENTIFIER-COVERAGE-AUDIT.md,
// R-CARD entity-sources gap found 2026-07-19). sourceFilterStep drops any
// candidate whose source alias isn't listed for its type — the "we do not lean
// on the A8 net" rule stated at the top of ENTITY_SOURCES. So a find*Entities
// that emits a type whose ENTITY_SOURCES entry omits 'regex' is silently
// dropped (weight < 4, e.g. DATE_OF_BIRTH before R-DATE) or passed through
// mis-flagged unauthoritativeSource (weight >= 4, e.g. PAYMENT_CARD after
// R-CARD): fragile and one weight change from a dead floor. R-CARD's own green
// suite couldn't catch it — the unit tests exercise findRegexEntities in
// isolation, never through sourceFilterStep. This guard runs the REAL
// findRegexEntities over real vectors and asserts 'regex' coverage for every
// type it ACTUALLY emits — including the variable-emitted ones
// (ORGANIZATION_IDENTIFIER, PERSON_IDENTIFIER) that a hand-written manifest of
// literal `entity_group:` strings would miss. Self-validating: it only checks
// types that are truly emitted, so it can never give a false PASS; its reach
// equals the fixture's coverage, and each new R-* is expected to extend the
// fixture with its own positive vector.
describe('ENTITY_SOURCES — regex-floor coverage (self-validating)', () => {
  // Real, checksum-valid vectors lifted from anonymizer.test.js — one line per
  // regex family, kept separate so a long digit run in one line can't bleed
  // into another family's shape.
  const REGEX_FLOOR_FIXTURE = [
    'Dane strony: Bożena Wróblewska, PESEL 57020976679, dowód osobisty seria i nr BMA 733701, paszport nr AG 1391751, prawo jazdy nr 92712/00/2780.',
    'Pojazd: nr rej. CT 4567K, VIN VF1BB05CF12345678, rok prod. 2016.',
    'Konto: PL61109010140000071219812874',
    'NIP 524-987-12-30 oraz REGON 381245999 w rejestrze.',
    'Kontakt: jan@test.com, tel. +48 600 123 45 67.',
    'Dla nieruchomości Sąd Rejonowy prowadzi KW nr TO1T/00012345/6.',
    'Karta: 4111 1111 1111 1111 (do rozliczenia).',
    'Powód urodzony 7.03.1985 w Toruniu.',
    'Analogiczne stanowisko w uchwale (sygn. akt III CZP 87/22).',
    'Zasądzono kwotę 45 000,00 zł tytułem odszkodowania.',
    // R-DEV (DEVICE-IDENTIFIER-DESIGN.md §6 pt 2): IMEI anchored path B
    // (Luhn-invalid corpus value, licensed only by the "IMEI:" anchor) and a
    // bare MAC address in the same line — one line per regex family, per the
    // convention above.
    'Telefon służbowy Samsung Galaxy S23, IMEI: 354871234567890, adres karty sieciowej 00:1A:2B:3C:4D:5E.',
  ];

  it("lists 'regex' for every type findRegexEntities actually emits", () => {
    const emitted = new Set();
    for (const line of REGEX_FLOOR_FIXTURE) {
      for (const e of findRegexEntities(line)) emitted.add(e.entity_group);
    }

    // Fixture must keep its teeth: a broken fixture that emits nothing would
    // make the coverage loop below vacuously pass. Pin the regression subject
    // (PAYMENT_CARD) and a broad floor explicitly.
    expect(emitted.has('PAYMENT_CARD'), 'fixture no longer exercises PAYMENT_CARD').toBe(true);
    expect(emitted.size).toBeGreaterThanOrEqual(8);

    for (const type of emitted) {
      expect(
        ENTITY_SOURCES[type],
        `findRegexEntities emits ${type} but it has no ENTITY_SOURCES entry — sourceFilterStep drops it outright`,
      ).toBeDefined();
      expect(
        ENTITY_SOURCES[type],
        `findRegexEntities emits ${type} but ENTITY_SOURCES['${type}'] does not list 'regex' — sourceFilterStep silently drops it (weight<4) or passes it mis-flagged unauthoritativeSource (weight>=4). Add 'regex'.`,
      ).toContain('regex');
    }
  });
});
