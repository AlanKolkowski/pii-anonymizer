import { describe, it, expect } from 'vitest';
import { createSourceFilterStep } from './source-filter.js';

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

describe('createSourceFilterStep', () => {
  const entitySources = {
    PERSON_NAME:    ['multilang-q8', 'polish-q8'],
    EMAIL_ADDRESS:  ['multilang-q8', 'regex'],
  };

  it('keeps entities whose source is authoritative for the type', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME', 'EMAIL_ADDRESS'],
      entitySources,
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'polish-q8' },
      { entity_group: 'EMAIL_ADDRESS', start: 10, end: 25, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('drops entities whose source is not authoritative for the type', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources: { PERSON_NAME: ['polish-q8'] },
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'multilang-q8' },
      { entity_group: 'PERSON_NAME', start: 6, end: 10, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].source).toBe('polish-q8');
  });

  it('drops entities whose type is not in enabledEntities', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources,
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'polish-q8' },
      { entity_group: 'EMAIL_ADDRESS', start: 10, end: 25, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
  });

  it('treats array-valued source as intersection with authoritative set', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources: { PERSON_NAME: ['polish-q8'] },
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: ['multilang-q8', 'polish-q8'] },
      { entity_group: 'PERSON_NAME', start: 6, end: 10, score: 0.9, source: ['multilang-q8', 'regex'] },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
  });

  it('drops entities without a source', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources,
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9 },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('drops all entities when enabledEntities is empty', () => {
    const step = createSourceFilterStep({ enabledEntities: [], entitySources });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });
});
