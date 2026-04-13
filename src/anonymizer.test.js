import { describe, it, expect } from 'vitest';
import { buildTokenMap, anonymizeText, deanonymizeText, aggregateEntities, chunkText, deduplicateEntities, couldBeSamePerson, findRegexEntities } from './anonymizer.js';

describe('buildTokenMap', () => {
  it('assigns indexed tokens per entity type', () => {
    const text = 'Jan Kowalski and Anna Nowak';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 17, end: 27, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[PERSON_NAME_2]': 'Anna Nowak',
    });
  });

  it('reuses token when same value repeats', () => {
    const text = 'Jan Kowalski called Jan Kowalski';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 20, end: 32, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
    });
  });

  it('handles multiple entity types independently', () => {
    const text = 'Jan Kowalski, email jan@test.com';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'EMAIL_ADDRESS', start: 20, end: 32, score: 0.99 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[EMAIL_ADDRESS_1]': 'jan@test.com',
    });
  });

  it('returns empty legend for no entities', () => {
    const { legend } = buildTokenMap([], 'no PII');
    expect(legend).toEqual({});
  });
});

describe('anonymizeText', () => {
  it('replaces entities with indexed tokens', () => {
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'ORGANIZATION_NAME', start: 22, end: 34, score: 0.95 },
    ];
    const { anonymized, legend } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]');
    expect(legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
    expect(legend['[ORGANIZATION_NAME_1]']).toBe('Example Corp');
  });

  it('uses same token for duplicate entity values', () => {
    const text = 'Jan Kowalski called Jan Kowalski';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 20, end: 32, score: 0.97 },
    ];
    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] called [PERSON_NAME_1]');
  });

  it('handles entities not sorted by position', () => {
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'ORGANIZATION_NAME', start: 22, end: 34, score: 0.95 },
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
    ];
    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]');
  });

  it('returns unchanged text when no entities', () => {
    const { anonymized, legend } = anonymizeText('No PII here', []);
    expect(anonymized).toBe('No PII here');
    expect(legend).toEqual({});
  });
});

describe('deanonymizeText', () => {
  it('replaces tokens with original values', () => {
    const text = '[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]';
    const legend = {
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[ORGANIZATION_NAME_1]': 'Example Corp',
    };
    expect(deanonymizeText(text, legend)).toBe('Jan Kowalski works at Example Corp');
  });

  it('replaces multiple occurrences of same token', () => {
    const text = '[PERSON_NAME_1] called [PERSON_NAME_1]';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    expect(deanonymizeText(text, legend)).toBe('Jan Kowalski called Jan Kowalski');
  });

  it('leaves text unchanged when no tokens match', () => {
    expect(deanonymizeText('no tokens', { '[X_1]': 'val' })).toBe('no tokens');
  });

  it('handles empty legend', () => {
    expect(deanonymizeText('some text', {})).toBe('some text');
  });
});

describe('aggregateEntities', () => {
  it('merges B- and I- tokens into single entity with character positions', () => {
    const text = 'Jan Kowalski lives here';
    const raw = [
      { entity: 'B-PERSON_NAME', score: 0.98, index: 1, word: 'Jan' },
      { entity: 'I-PERSON_NAME', score: 0.97, index: 2, word: 'Ko' },
      { entity: 'I-PERSON_NAME', score: 0.96, index: 3, word: 'wal' },
      { entity: 'I-PERSON_NAME', score: 0.95, index: 4, word: 'ski' },
    ];
    const result = aggregateEntities(raw, text);
    expect(result).toHaveLength(1);
    expect(result[0].entity_group).toBe('PERSON_NAME');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(12);
  });

  it('splits on different entity types', () => {
    const text = 'Jan in Warsaw';
    const raw = [
      { entity: 'B-PERSON_NAME', score: 0.98, index: 1, word: 'Jan' },
      { entity: 'B-LOCATION', score: 0.99, index: 3, word: 'Wars' },
      { entity: 'I-LOCATION', score: 0.97, index: 4, word: 'aw' },
    ];
    const result = aggregateEntities(raw, text);
    expect(result).toHaveLength(2);
    expect(result[0].entity_group).toBe('PERSON_NAME');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(3);
    expect(result[1].entity_group).toBe('LOCATION');
    expect(result[1].start).toBe(7);
    expect(result[1].end).toBe(13);
  });

  it('merges consecutive B- tokens of same type (email pattern)', () => {
    const text = 'email jan@test.com here';
    const raw = [
      { entity: 'B-EMAIL_ADDRESS', score: 0.99, index: 2, word: 'jan' },
      { entity: 'B-EMAIL_ADDRESS', score: 0.98, index: 3, word: '@' },
      { entity: 'B-EMAIL_ADDRESS', score: 0.97, index: 4, word: 'test' },
      { entity: 'B-EMAIL_ADDRESS', score: 0.96, index: 5, word: '.' },
      { entity: 'B-EMAIL_ADDRESS', score: 0.95, index: 6, word: 'com' },
    ];
    const result = aggregateEntities(raw, text);
    expect(result).toHaveLength(1);
    expect(result[0].entity_group).toBe('EMAIL_ADDRESS');
    expect(result[0].start).toBe(6);
    expect(result[0].end).toBe(18);
  });

  it('handles token index gaps within same entity (phone pattern)', () => {
    const text = 'call +48 600 456';
    const raw = [
      { entity: 'B-PHONE_NUMBER', score: 0.99, index: 2, word: '+' },
      { entity: 'I-PHONE_NUMBER', score: 0.98, index: 3, word: '48' },
      { entity: 'I-PHONE_NUMBER', score: 0.97, index: 4, word: '600' },
      { entity: 'I-PHONE_NUMBER', score: 0.96, index: 6, word: '456' },
    ];
    const result = aggregateEntities(raw, text);
    expect(result).toHaveLength(1);
    expect(result[0].entity_group).toBe('PHONE_NUMBER');
    expect(result[0].start).toBe(5);
    expect(result[0].end).toBe(16);
  });

  it('splits entities with large index gaps', () => {
    const text = 'Jan lives in Warsaw';
    const raw = [
      { entity: 'B-PERSON_NAME', score: 0.98, index: 1, word: 'Jan' },
      { entity: 'B-LOCATION', score: 0.99, index: 10, word: 'Wars' },
      { entity: 'I-LOCATION', score: 0.97, index: 11, word: 'aw' },
    ];
    const result = aggregateEntities(raw, text);
    expect(result).toHaveLength(2);
  });
});

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('hello world', 100);
    expect(chunks).toEqual([{ text: 'hello world', offset: 0 }]);
  });

  it('splits text without newlines by character boundary', () => {
    const text = 'a'.repeat(100);
    const chunks = chunkText(text, 40);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual({ text: 'a'.repeat(40), offset: 0 });
    expect(chunks[2].offset + chunks[2].text.length).toBe(100);
  });

  it('splits at paragraph boundaries when available', () => {
    const text = 'para1 content\n\npara2 content\n\npara3 content';
    // 14 + 2 + 14 + 2 + 14 = 46 chars
    const chunks = chunkText(text, 20);
    // Each paragraph (~14 chars) fits in 20, so should split at \n\n
    expect(chunks.length).toBe(3);
    expect(chunks[0].text).toBe('para1 content\n\n');
    expect(chunks[1].text).toBe('para2 content\n\n');
    expect(chunks[2].text).toBe('para3 content');
  });

  it('falls back to line breaks when no paragraphs', () => {
    const text = 'aaaa\nbbbb\ncccc\ndddd\neeee\n';
    const chunks = chunkText(text, 12);
    // Should split at \n boundaries
    for (const chunk of chunks) {
      if (chunk.offset > 0) {
        expect(text[chunk.offset - 1]).toBe('\n');
      }
    }
  });

  it('covers the entire text without gaps', () => {
    const text = 'aaa\n\nbbb\n\nccc\n\nddd\n\neee';
    const chunks = chunkText(text, 10);
    for (let i = 0; i < text.length; i++) {
      const covered = chunks.some(
        (c) => i >= c.offset && i < c.offset + c.text.length,
      );
      expect(covered).toBe(true);
    }
  });

  it('last chunk reaches end of text', () => {
    const text = 'x'.repeat(250);
    const chunks = chunkText(text, 100);
    const last = chunks[chunks.length - 1];
    expect(last.offset + last.text.length).toBe(text.length);
  });

  it('handles oversized paragraph gracefully', () => {
    const text = 'a'.repeat(50) + '\n\nshort\n\nother';
    const chunks = chunkText(text, 30);
    // The 50-char paragraph exceeds maxChars but gets included as one chunk
    expect(chunks[0].text).toBe('a'.repeat(50) + '\n\n');
    expect(chunks[0].offset).toBe(0);
    // Remaining paragraphs follow
    const last = chunks[chunks.length - 1];
    expect(last.offset + last.text.length).toBe(text.length);
  });
});

describe('deduplicateEntities', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateEntities([])).toEqual([]);
  });

  it('keeps non-overlapping entities', () => {
    const entities = [
      { start: 0, end: 5, score: 0.9, entity_group: 'PERSON_NAME' },
      { start: 10, end: 15, score: 0.8, entity_group: 'LOCATION' },
    ];
    expect(deduplicateEntities(entities)).toHaveLength(2);
  });

  it('keeps higher-score entity when overlapping', () => {
    const entities = [
      { start: 0, end: 10, score: 0.7, entity_group: 'PERSON_NAME' },
      { start: 5, end: 12, score: 0.9, entity_group: 'PERSON_NAME' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
  });

  it('keeps lower-start entity when scores tie (first wins)', () => {
    const entities = [
      { start: 0, end: 10, score: 0.9, entity_group: 'PERSON_NAME' },
      { start: 5, end: 12, score: 0.8, entity_group: 'PERSON_NAME' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0);
  });

  it('handles single entity', () => {
    const entities = [{ start: 0, end: 5, score: 0.9, entity_group: 'X' }];
    expect(deduplicateEntities(entities)).toEqual(entities);
  });
});

describe('couldBeSamePerson', () => {
  it('matches Polish nominative vs genitive (full name)', () => {
    expect(couldBeSamePerson('Marcin Jabłoński', 'Marcina Jabłońskiego')).toBe(true);
  });

  it('matches nominative vs instrumental', () => {
    expect(couldBeSamePerson('Tomasz Wiśniewski', 'Tomaszem Wiśniewskim')).toBe(true);
  });

  it('matches nominative vs genitive (short surname)', () => {
    expect(couldBeSamePerson('Tomasz Wiśniewski', 'Tomasza Wiśniewskiego')).toBe(true);
  });

  it('matches single surname forms', () => {
    expect(couldBeSamePerson('Nowak', 'Nowaka')).toBe(true);
  });

  it('matches last name only vs full name', () => {
    expect(couldBeSamePerson('Wiśniewski', 'Tomasz Wiśniewski')).toBe(true);
  });

  it('rejects completely different names', () => {
    expect(couldBeSamePerson('Anna Nowak', 'Tomasz Wiśniewski')).toBe(false);
  });

  it('rejects names with same-length but different stems', () => {
    expect(couldBeSamePerson('Kowalski', 'Kowalczyk')).toBe(false);
  });

  it('rejects different first names even with similar surnames', () => {
    expect(couldBeSamePerson('Jan Kowalski', 'Adam Kowalski')).toBe(false);
  });
});

describe('buildTokenMap with Polish declension', () => {
  it('assigns same token to declined forms of the same name', () => {
    const text = 'Marcin Jabłoński i Marcina Jabłońskiego';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 16, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 19, end: 39, score: 0.97 },
    ];
    const { seen, legend } = buildTokenMap(entities, text);
    // Both forms should map to the same token
    expect(seen['PERSON_NAME::Marcin Jabłoński']).toBe(
      seen['PERSON_NAME::Marcina Jabłońskiego'],
    );
    // Legend should have only one entry for this person
    const personTokens = Object.keys(legend).filter((k) =>
      k.startsWith('[PERSON_NAME_'),
    );
    expect(personTokens).toHaveLength(1);
  });

  it('keeps different tokens for genuinely different people', () => {
    const text = 'Jan Kowalski i Anna Nowak';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 15, end: 24, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    const personTokens = Object.keys(legend).filter((k) =>
      k.startsWith('[PERSON_NAME_'),
    );
    expect(personTokens).toHaveLength(2);
  });

  it('does not normalize non-PERSON_NAME entities', () => {
    const text = 'Warszawa and Warszawy';
    const entities = [
      { entity_group: 'LOCATION', start: 0, end: 8, score: 0.98 },
      { entity_group: 'LOCATION', start: 13, end: 21, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    const locTokens = Object.keys(legend).filter((k) =>
      k.startsWith('[LOCATION_'),
    );
    expect(locTokens).toHaveLength(2);
  });
});

describe('findRegexEntities', () => {
  it('detects email addresses', () => {
    const text = 'contact biuro@nowak-wspolnicy.pl for info';
    const entities = findRegexEntities(text);
    expect(entities).toHaveLength(1);
    expect(entities[0].entity_group).toBe('EMAIL_ADDRESS');
    expect(text.slice(entities[0].start, entities[0].end)).toBe(
      'biuro@nowak-wspolnicy.pl',
    );
  });

  it('detects multiple emails', () => {
    const text = 'a@b.com and c@d.pl';
    expect(findRegexEntities(text)).toHaveLength(2);
  });

  it('returns empty for text without emails', () => {
    expect(findRegexEntities('no emails here')).toEqual([]);
  });
});
