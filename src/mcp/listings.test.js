import { describe, it, expect } from 'vitest';
import { buildSourceListing, buildOutcomeListing, createLabelSequence } from './listings.js';

describe('buildSourceListing', () => {
  const seen = { 'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]' };

  function readySource(overrides = {}) {
    return {
      id: 's1',
      label: 'Jan_Kowalski_pozew.pdf',
      mcpLabel: 'Źródło 1',
      text: 'Pozew Jan Kowalski.',
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.99 }],
      status: 'ready',
      ...overrides,
    };
  }

  it('emits the synthetic mcpLabel and never the private filename', () => {
    const listing = buildSourceListing([readySource()], seen);
    expect(listing).toEqual([
      { id: 's1', label: 'Źródło 1', char_count: 'Pozew [PERSON_NAME_1].'.length },
    ]);
    expect(JSON.stringify(listing)).not.toContain('Kowalski');
    expect(JSON.stringify(listing)).not.toContain('.pdf');
  });

  it('emits a user-shared mcpLabel verbatim', () => {
    const listing = buildSourceListing([readySource({ mcpLabel: 'Sprawa rozwodowa' })], seen);
    expect(listing[0].label).toBe('Sprawa rozwodowa');
  });

  it('excludes sources that are not ready', () => {
    const listing = buildSourceListing(
      [readySource(), readySource({ id: 's2', status: 'pending' })],
      seen,
    );
    expect(listing.map((x) => x.id)).toEqual(['s1']);
  });
});

describe('buildOutcomeListing', () => {
  it('emits mcpLabel and never the private label', () => {
    const outcomes = [
      { id: 'o1', label: 'Moja prywatna notatka', mcpLabel: 'Wynik 1', text: 'Witaj [PERSON_NAME_1].' },
    ];
    const listing = buildOutcomeListing(outcomes);
    expect(listing).toEqual([
      { id: 'o1', label: 'Wynik 1', char_count: 'Witaj [PERSON_NAME_1].'.length },
    ]);
    expect(JSON.stringify(listing)).not.toContain('prywatna');
  });
});

describe('createLabelSequence', () => {
  it('produces stable, monotonically increasing labels', () => {
    const next = createLabelSequence('Źródło');
    expect([next(), next(), next()]).toEqual(['Źródło 1', 'Źródło 2', 'Źródło 3']);
  });

  it('keeps independent sequences independent', () => {
    const sources = createLabelSequence('Źródło');
    const outcomes = createLabelSequence('Wynik');
    expect(sources()).toBe('Źródło 1');
    expect(outcomes()).toBe('Wynik 1');
    expect(sources()).toBe('Źródło 2');
  });
});
