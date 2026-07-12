import { describe, it, expect } from 'vitest';
import * as listings from './listings.js';

const { buildSourceListing, buildOutcomeListing, createLabelSequence } = listings;

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
  it('excludes ready sources with zero detected entities', () => {
    const listing = buildSourceListing(
      [
        readySource(),
        readySource({
          id: 's-passport',
          mcpLabel: 'Źródło 2',
          text: 'Paszport AB1234567.',
          entities: [],
        }),
      ],
      seen,
    );

    expect(listing.map((x) => x.id)).toEqual(['s1']);
  });
});

describe('buildReadSourceContent', () => {
  it('denies ready sources with zero detected entities without returning raw text', () => {
    const source = {
      id: 's-passport',
      label: 'paszport.txt',
      mcpLabel: 'Źródło 1',
      text: 'Paszport AB1234567.',
      entities: [],
      status: 'ready',
    };

    const response = listings.buildReadSourceContent?.([source], {}, source.id);

    expect(response).toEqual({ content: [{ type: 'text', text: expect.any(String) }] });

    let body;
    try {
      body = JSON.parse(response.content[0].text);
    } catch {
      throw new Error('read_source zero-entity denial must be JSON error content, not raw text');
    }

    expect(body).toEqual({ error: expect.any(String) });
    expect(response.content[0].text).not.toContain(source.text);
    expect(response.content[0].text).not.toContain('AB1234567');
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

  it('includes an outcome whose only token is case-annotated (decyzja 17: containsToken recognizes [TYP_IDX|PRZYPADEK])', () => {
    // Text below carries no plain [TYP_IDX] token anywhere -- the ONLY
    // token-shaped span is the annotated form. Before decyzja 17,
    // containsToken had no notion of the |PRZYPADEK suffix, so this outcome
    // would have been (wrongly) treated as tokenless freeform text and
    // dropped from the listing.
    const outcomes = [
      { id: 'o1', label: 'notatka', mcpLabel: 'Wynik 1', text: 'Pismo doręczono dla [PERSON_NAME_1|D].' },
    ];
    const listing = buildOutcomeListing(outcomes);
    expect(listing.map((x) => x.id)).toEqual(['o1']);
  });
});

describe('buildReadOutcomeContent', () => {
  it('does not reject an outcome whose only token is case-annotated as "brak tokenów" (decyzja 17)', () => {
    const outcome = { id: 'o1', label: 'notatka', mcpLabel: 'Wynik 1', text: 'Pismo doręczono dla [PERSON_NAME_1|D].' };
    const response = listings.buildReadOutcomeContent([outcome], outcome.id);
    expect(response).toEqual({ content: [{ type: 'text', text: outcome.text }] });
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
