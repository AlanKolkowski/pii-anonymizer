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

  it('requiredSources is empty for empty selection', () => {
    expect(requiredSources([])).toEqual([]);
  });

  it('requiredSources returns union of aliases for selected entities', () => {
    const got = requiredSources(['PERSON_NAME', 'EMAIL_ADDRESS']).sort();
    expect(got).toEqual(['multilang-fp32', 'polish-fp16', 'regex'].sort());
  });

  it('requiredSources ignores unknown entity types', () => {
    expect(requiredSources(['NOT_A_REAL_TYPE'])).toEqual([]);
  });
});
