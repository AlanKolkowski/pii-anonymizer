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

// ST-6 (SCOPE-TIERS-DESIGN.md §7.1): review-bucket boundary — a source with
// unresolved W2 candidates is invisible to the bridge until the review is
// closed; the refusal carries no candidate data whatsoever.
describe('review-complete boundary (ST-6)', () => {
  const seen = {
    'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]',
    'PERSON_ATTRIBUTE::wdowiec': '[PERSON_ATTRIBUTE_1]',
  };
  const text = 'Pozew Jan Kowalski, wdowiec.';

  function sourceInReview(overrides = {}) {
    return {
      id: 's1',
      label: 'prywatna_nazwa.pdf',
      mcpLabel: 'Źródło 1',
      text,
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.99 }],
      candidates: [{
        entity_group: 'PERSON_ATTRIBUTE',
        start: text.indexOf('wdowiec'),
        end: text.indexOf('wdowiec') + 'wdowiec'.length,
        score: 0.9,
        source: 'ner',
        tier: 'review',
        valueKey: 'PERSON_ATTRIBUTE::wdowiec',
      }],
      reviewDecisions: new Map(),
      status: 'ready',
      ...overrides,
    };
  }

  it('does not list a ready source with pending candidates', () => {
    expect(listings.buildSourceListing([sourceInReview()], seen)).toEqual([]);
  });

  it('read_source refuses with a review message carrying no candidate data', () => {
    const response = listings.buildReadSourceContent([sourceInReview()], seen, 's1');
    const body = response.content[0].text;
    expect(body).toContain('w przeglądzie');
    expect(body).not.toContain('wdowiec');
    expect(body).not.toContain('Kowalski');
    expect(body).not.toMatch(/\d+ kandydat/);
  });

  it('a decision on every valueKey (mask or skip) makes the source readable again', () => {
    const masked = sourceInReview({
      reviewDecisions: new Map([['PERSON_ATTRIBUTE::wdowiec', { decision: 'mask', origin: 'user' }]]),
    });
    expect(listings.buildSourceListing([masked], seen)).toHaveLength(1);

    const skipped = sourceInReview({
      reviewDecisions: new Map([['PERSON_ATTRIBUTE::wdowiec', { decision: 'skip', origin: 'bulk' }]]),
    });
    const response = listings.buildReadSourceContent([skipped], seen, 's1');
    // Skip is a HUMAN decision — the visible value crossing afterwards is
    // the designed behavior (§7.1 pkt 1), not a leak.
    expect(response.content[0].text).toBe('Pozew [PERSON_NAME_1], wdowiec.');
  });

  it('a purely-W2 source (zero mask entities) stays unreadable even after skip-all (§7.1 pkt 3)', () => {
    const pureW2 = sourceInReview({
      entities: [],
      reviewDecisions: new Map([['PERSON_ATTRIBUTE::wdowiec', { decision: 'skip', origin: 'bulk' }]]),
    });
    expect(listings.buildSourceListing([pureW2], seen)).toEqual([]);
    const response = listings.buildReadSourceContent([pureW2], seen, 's1');
    expect(response.content[0].text).toContain('nie zawiera wykrytych encji');
  });

  it('sources without candidate fields (pre-tier world) behave exactly as before', () => {
    const legacy = sourceInReview({ candidates: undefined, reviewDecisions: undefined });
    expect(listings.buildSourceListing([legacy], seen)).toHaveLength(1);
  });
});
