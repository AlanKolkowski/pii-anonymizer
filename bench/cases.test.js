import { deriveCases, uniqueModelAliases } from './cases.js';

const SOURCES = {
  'multilang-q8':   { kind: 'hf', id: 'm/x', dtype: 'q8',   sizeMB: 280 },
  'multilang-fp32': { kind: 'hf', id: 'm/x', dtype: 'fp32', sizeMB: 1100 },
  'polish-q8':      { kind: 'hf', id: 'p/x', dtype: 'q8',   sizeMB: 280 },
  'polish-fp32':    { kind: 'hf', id: 'p/x', dtype: 'fp32', sizeMB: 1100 },
  'regex':          { kind: 'regex' },
};

describe('deriveCases', () => {
  it('returns one case per unique model-source combo plus an all-entities case', () => {
    const entitySources = {
      A: ['multilang-q8'],
      B: ['multilang-q8'],
      C: ['polish-q8'],
      D: ['multilang-q8', 'polish-q8'],
      E: ['multilang-q8', 'polish-q8', 'regex'],
    };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['A', 'B', 'C', 'D', 'E'] });
    const labels = cases.map((c) => c.label);
    expect(labels).toContain('multilang-q8');
    expect(labels).toContain('polish-q8');
    expect(labels).toContain('multilang-q8+polish-q8');
    expect(labels).toContain('all-entities');
  });

  it('strips regex from sources but keeps a single-entity representative', () => {
    const entitySources = { X: ['multilang-q8', 'regex'] };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['X'] });
    const single = cases.find((c) => c.kind === 'single-entity');
    expect(single.sources).toEqual(['multilang-q8']);
    expect(single.representativeEntity).toBe('X');
  });

  it('treats different sources arrays with same set as one combo', () => {
    const entitySources = {
      A: ['multilang-q8', 'polish-q8'],
      B: ['polish-q8', 'multilang-q8'],
    };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['A', 'B'] });
    const singles = cases.filter((c) => c.kind === 'single-entity');
    expect(singles).toHaveLength(1);
  });

  it('skips entities with only regex (no model)', () => {
    const entitySources = { R: ['regex'] };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['R'] });
    const single = cases.find((c) => c.kind === 'single-entity');
    expect(single).toBeUndefined();
  });

  it('orders single-entity cases by sizeMB ascending', () => {
    const entitySources = {
      A: ['multilang-fp32'],
      B: ['polish-q8'],
      C: ['multilang-q8', 'polish-q8'],
    };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['A', 'B', 'C'] });
    const singles = cases.filter((c) => c.kind === 'single-entity');
    const sizes = singles.map((c) => c.sizeMB);
    const sorted = [...sizes].sort((a, b) => a - b);
    expect(sizes).toEqual(sorted);
  });

  it('computes sizeMB as the sum of model source sizes', () => {
    const entitySources = { A: ['multilang-q8', 'polish-fp32'] };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['A'] });
    const single = cases.find((c) => c.kind === 'single-entity');
    expect(single.sizeMB).toBe(280 + 1100);
  });

  it('uniqueModelAliases returns a sorted union of all model aliases across cases', () => {
    const entitySources = {
      A: ['multilang-q8'],
      B: ['polish-q8'],
    };
    const cases = deriveCases({ entitySources, sources: SOURCES, entityTypes: ['A', 'B'] });
    const aliases = uniqueModelAliases(cases);
    expect(aliases).toEqual(['multilang-q8', 'polish-q8']);
  });
});

describe('deriveCases against real ENTITY_SOURCES', () => {
  it('produces 4 cases for the current codebase (3 unique combos + all-entities)', () => {
    const cases = deriveCases();
    expect(cases).toHaveLength(4);
    expect(cases[cases.length - 1].kind).toBe('all-entities');
  });
});
