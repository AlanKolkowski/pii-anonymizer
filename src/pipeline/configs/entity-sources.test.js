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
  // 'lexicon' (B4-lite), 'case-folded' (B2) and 'case-allowlist' (ST-5) are
  // listed alongside but are not HF models either — a bundled JSON lexicon,
  // a relabeling of the two existing models' own output, and a deterministic
  // matcher over user-typed signatures, zero download cost — so none of them
  // breaks "free".
  it('enabling art. 9-10 by default adds no new model source (A12 is free)', () => {
    expect(requiredSources(defaultEnabledEntities()).sort())
      .toEqual(['case-allowlist', 'case-folded', 'lexicon', 'multilang-fp32', 'polish-fp16', 'regex']);
  });

  it('requiredSources is empty for empty selection', () => {
    expect(requiredSources([])).toEqual([]);
  });

  it('requiredSources returns union of aliases for selected entities', () => {
    const got = requiredSources(['PERSON_NAME', 'EMAIL_ADDRESS']).sort();
    expect(got).toEqual(['case-folded', 'multilang-fp32', 'polish-fp16', 'regex'].sort());
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
