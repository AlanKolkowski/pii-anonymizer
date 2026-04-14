import { describe, it, expect } from 'vitest';
import { buildTokenMap, anonymizeText, deanonymizeText, aggregateEntities, chunkText, deduplicateEntities, couldBeSamePerson, findRegexEntities, filterOversizedEntities, mergeAdjacentEntities, rescanForKnownPii } from './anonymizer.js';

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

  it('keeps text without newlines as single chunk', () => {
    const text = 'a'.repeat(100);
    const chunks = chunkText(text, 40);
    // No newlines = no split points, single chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe(text);
  });

  it('splits at line boundaries', () => {
    const text = 'line1\nline2\nline3\nline4\nline5\n';
    const chunks = chunkText(text, 14);
    // Every chunk starts at a line boundary
    for (const chunk of chunks) {
      if (chunk.offset > 0) {
        expect(text[chunk.offset - 1]).toBe('\n');
      }
    }
    // All text covered
    const last = chunks[chunks.length - 1];
    expect(last.offset + last.text.length).toBe(text.length);
  });

  it('packs complete lines into chunks', () => {
    const text = 'aaaa\nbbbb\ncccc\ndddd\neeee\n';
    const chunks = chunkText(text, 12);
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

  it('handles oversized line gracefully', () => {
    const text = 'a'.repeat(50) + '\nshort\nother';
    const chunks = chunkText(text, 30);
    // First line exceeds maxChars but no newline to split at yet
    expect(chunks[0].offset).toBe(0);
    // All text is covered
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

  it('keeps wider-span entity when overlapping', () => {
    const entities = [
      { start: 0, end: 10, score: 0.7, entity_group: 'PERSON_NAME' },
      { start: 5, end: 12, score: 0.9, entity_group: 'PERSON_NAME' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    // First entity spans 10 chars, second 7 — wider wins
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(10);
  });

  it('keeps higher-score entity when same span size', () => {
    const entities = [
      { start: 0, end: 10, score: 0.7, entity_group: 'PERSON_NAME' },
      { start: 2, end: 12, score: 0.9, entity_group: 'PERSON_NAME' },
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

  it('prefers perfect-score (regex) entity over wider NER entity', () => {
    // NER detects "457 dni): 4 503,29 zł" as one wide entity
    // Regex detects "4 503,29 zł" precisely with score 1.0
    const entities = [
      { start: 0, end: 30, score: 0.85, entity_group: 'FINANCIAL_AMOUNT' },
      { start: 18, end: 30, score: 1.0, entity_group: 'FINANCIAL_AMOUNT' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1.0);
    expect(result[0].start).toBe(18);
  });

  it('keeps wider span when both are perfect-score', () => {
    const entities = [
      { start: 0, end: 30, score: 1.0, entity_group: 'EMAIL_ADDRESS' },
      { start: 5, end: 25, score: 1.0, entity_group: 'EMAIL_ADDRESS' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(30);
  });

  it('keeps wider span when both are NER (non-perfect score)', () => {
    const entities = [
      { start: 0, end: 30, score: 0.7, entity_group: 'PERSON_NAME' },
      { start: 5, end: 20, score: 0.9, entity_group: 'PERSON_NAME' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(30);
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

  it('detects PESEL (11-digit identifier)', () => {
    const text = 'PESEL: 92071314764';
    const entities = findRegexEntities(text);
    const pesel = entities.find((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(pesel).toBeDefined();
    expect(text.slice(pesel.start, pesel.end)).toBe('92071314764');
    expect(pesel.score).toBe(1.0);
  });

  it('detects NIP with dashes', () => {
    const text = 'NIP: 123-456-78-19';
    const entities = findRegexEntities(text);
    const nip = entities.find((e) => e.entity_group === 'ORGANIZATION_IDENTIFIER');
    expect(nip).toBeDefined();
    expect(text.slice(nip.start, nip.end)).toBe('123-456-78-19');
    expect(nip.score).toBe(1.0);
  });

  it('detects NIP without separators', () => {
    const text = 'NIP: 1234567819';
    const entities = findRegexEntities(text);
    const nip = entities.find((e) => e.entity_group === 'ORGANIZATION_IDENTIFIER');
    expect(nip).toBeDefined();
    expect(text.slice(nip.start, nip.end)).toBe('1234567819');
  });

  it('detects Polish IBAN', () => {
    const text = 'Konto: PL61 1090 1014 0000 0712 1981 2874';
    const entities = findRegexEntities(text);
    const iban = entities.find((e) => e.entity_group === 'BANK_ACCOUNT_IDENTIFIER');
    expect(iban).toBeDefined();
    expect(text.slice(iban.start, iban.end)).toBe('PL61 1090 1014 0000 0712 1981 2874');
    expect(iban.score).toBe(1.0);
  });

  it('detects IBAN without spaces', () => {
    const text = 'Konto: PL61109010140000071219812874';
    const entities = findRegexEntities(text);
    const iban = entities.find((e) => e.entity_group === 'BANK_ACCOUNT_IDENTIFIER');
    expect(iban).toBeDefined();
    expect(text.slice(iban.start, iban.end)).toBe('PL61109010140000071219812874');
  });

  it('detects phone number with country code', () => {
    const text = 'Tel: +48 600 123 45 67';
    const entities = findRegexEntities(text);
    const phone = entities.find((e) => e.entity_group === 'PHONE_NUMBER');
    expect(phone).toBeDefined();
    expect(text.slice(phone.start, phone.end)).toBe('+48 600 123 45 67');
    expect(phone.score).toBe(1.0);
  });

  it('detects phone number without country code', () => {
    const text = 'Tel: 48 600 123 45 67';
    const entities = findRegexEntities(text);
    const phone = entities.find((e) => e.entity_group === 'PHONE_NUMBER');
    expect(phone).toBeDefined();
    expect(text.slice(phone.start, phone.end)).toBe('48 600 123 45 67');
  });

  it('detects mobile phone in 3+3+3 format', () => {
    const text = 'tel.: +48 722 334 556';
    const entities = findRegexEntities(text);
    const phone = entities.find((e) => e.entity_group === 'PHONE_NUMBER');
    expect(phone).toBeDefined();
    expect(text.slice(phone.start, phone.end)).toBe('+48 722 334 556');
  });

  it('detects mobile 3+3+3 without plus sign', () => {
    const text = 'tel.: 48 722 334 556';
    const entities = findRegexEntities(text);
    const phone = entities.find((e) => e.entity_group === 'PHONE_NUMBER');
    expect(phone).toBeDefined();
    expect(text.slice(phone.start, phone.end)).toBe('48 722 334 556');
  });

  it('detects mobile 3+3+3 with dashes', () => {
    const text = 'tel.: +48-722-334-556';
    const entities = findRegexEntities(text);
    const phone = entities.find((e) => e.entity_group === 'PHONE_NUMBER');
    expect(phone).toBeDefined();
    expect(text.slice(phone.start, phone.end)).toBe('+48-722-334-556');
  });
});

describe('filterOversizedEntities', () => {
  it('drops PERSON_NAME exceeding 50 chars', () => {
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 65, score: 0.8 },
      { entity_group: 'PERSON_NAME', start: 100, end: 115, score: 0.9 },
    ];
    const result = filterOversizedEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(100);
  });

  it('drops PERSON_ROLE_OR_TITLE exceeding 70 chars', () => {
    const entities = [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 155, score: 0.7 },
    ];
    expect(filterOversizedEntities(entities)).toHaveLength(0);
  });

  it('keeps entities within limits', () => {
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 20, score: 0.9 },
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 25, end: 60, score: 0.85 },
      { entity_group: 'ORGANIZATION_NAME', start: 70, end: 180, score: 0.8 },
    ];
    expect(filterOversizedEntities(entities)).toHaveLength(3);
  });

  it('drops ORGANIZATION_NAME exceeding 120 chars', () => {
    const entities = [
      { entity_group: 'ORGANIZATION_NAME', start: 0, end: 200, score: 0.7 },
      { entity_group: 'ORGANIZATION_NAME', start: 300, end: 400, score: 0.9 },
    ];
    const result = filterOversizedEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(300);
  });

  it('drops VEHICLE_IDENTIFIER exceeding 40 chars', () => {
    const entities = [
      { entity_group: 'VEHICLE_IDENTIFIER', start: 0, end: 300, score: 0.8 },
    ];
    expect(filterOversizedEntities(entities)).toHaveLength(0);
  });

  it('does not filter types without limits', () => {
    const entities = [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 200, score: 0.9 },
      { entity_group: 'FINANCIAL_AMOUNT', start: 300, end: 500, score: 0.8 },
    ];
    expect(filterOversizedEntities(entities)).toHaveLength(2);
  });

  it('keeps entities exactly at the limit', () => {
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 50, score: 0.9 },
    ];
    expect(filterOversizedEntities(entities)).toHaveLength(1);
  });
});

describe('findRegexEntities — financial amounts', () => {
  it('detects simple amount with zł', () => {
    const text = 'kwota: 200,00 zł';
    const entities = findRegexEntities(text);
    const amount = entities.find((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(amount).toBeDefined();
    expect(text.slice(amount.start, amount.end)).toBe('200,00 zł');
  });

  it('detects amount with thousands separator', () => {
    const text = 'kwota: 45 000,00 zł';
    const entities = findRegexEntities(text);
    const amount = entities.find((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(amount).toBeDefined();
    expect(text.slice(amount.start, amount.end)).toBe('45 000,00 zł');
  });

  it('detects amount without space before zł', () => {
    const text = 'kwota: 200,00zł';
    const entities = findRegexEntities(text);
    const amount = entities.find((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(amount).toBeDefined();
    expect(text.slice(amount.start, amount.end)).toBe('200,00zł');
  });

  it('detects multiple amounts', () => {
    const text = '200,00 zł i 45 000,00 zł';
    const amounts = findRegexEntities(text).filter((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(amounts).toHaveLength(2);
  });

  it('has score 1.0', () => {
    const text = '200,00 zł';
    const amount = findRegexEntities(text).find((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(amount.score).toBe(1.0);
  });
});

describe('rescanForKnownPii', () => {
  it('replaces exact legend values still present in anonymized text', () => {
    const anonymized = 'Podpis: Sebastian Grabowski';
    const legend = { '[PERSON_NAME_1]': 'Sebastian Grabowski' };
    expect(rescanForKnownPii(anonymized, legend)).toBe('Podpis: [PERSON_NAME_1]');
  });

  it('replaces declined name forms via fuzzy matching', () => {
    // Legend has genitive form, text has nominative
    const anonymized = 'Podpis: Marcin Jabłoński';
    const legend = { '[PERSON_NAME_1]': 'Marcina Jabłońskiego' };
    expect(rescanForKnownPii(anonymized, legend)).toBe('Podpis: [PERSON_NAME_1]');
  });

  it('replaces addresses by exact match', () => {
    const anonymized = 'Adres: ul. Ułańska 7/11, 60-748 Poznań';
    const legend = { '[POSTAL_ADDRESS_1]': 'ul. Ułańska 7/11, 60-748 Poznań' };
    expect(rescanForKnownPii(anonymized, legend)).toBe('Adres: [POSTAL_ADDRESS_1]');
  });

  it('does not replace text already tokenized', () => {
    const anonymized = 'Podpis: [PERSON_NAME_1]';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    expect(rescanForKnownPii(anonymized, legend)).toBe('Podpis: [PERSON_NAME_1]');
  });

  it('replaces multiple occurrences of same value', () => {
    const anonymized = 'Jan Kowalski i potem Jan Kowalski';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    expect(rescanForKnownPii(anonymized, legend)).toBe(
      '[PERSON_NAME_1] i potem [PERSON_NAME_1]',
    );
  });

  it('does not fuzzy-match single-word sequences', () => {
    // Single capitalized word should NOT be fuzzy-matched (too risky)
    const anonymized = 'Mówił Kowalski że tak';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    // "Kowalski" alone (1 word) should not be matched by fuzzy phase
    // But exact match won't match either since legend has "Jan Kowalski"
    expect(rescanForKnownPii(anonymized, legend)).toBe('Mówił Kowalski że tak');
  });

  it('handles hyphenated surnames', () => {
    const anonymized = 'Podpis: Marta Lewandowska-Ostrów';
    const legend = { '[PERSON_NAME_1]': 'Marta Lewandowska-Ostrów' };
    expect(rescanForKnownPii(anonymized, legend)).toBe('Podpis: [PERSON_NAME_1]');
  });

  it('replaces longer values before shorter ones', () => {
    const anonymized = 'ul. Długa 22, 80-828 Gdańsk jest ok';
    const legend = {
      '[POSTAL_ADDRESS_1]': 'ul. Długa 22, 80-828 Gdańsk',
      '[LOCATION_1]': 'Gdańsk',
    };
    const result = rescanForKnownPii(anonymized, legend);
    expect(result).toBe('[POSTAL_ADDRESS_1] jest ok');
  });

  it('returns text unchanged when no matches', () => {
    const anonymized = 'Brak danych osobowych tutaj.';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    expect(rescanForKnownPii(anonymized, legend)).toBe(anonymized);
  });
});

describe('mergeAdjacentEntities', () => {
  it('merges adjacent POSTAL_ADDRESS and LOCATION into one POSTAL_ADDRESS', () => {
    const text = 'ul. Marszałkowska 47/12, 00-648 Warszawa';
    const entities = [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 23, score: 0.85 },
      { entity_group: 'LOCATION', start: 25, end: 40, score: 0.90 },
    ];
    const result = mergeAdjacentEntities(entities, text);
    expect(result).toHaveLength(1);
    expect(result[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(40);
    expect(result[0].score).toBe(0.90);
  });

  it('merges multiple address fragments into one', () => {
    const text = 'ul. Marszałkowska 47/12, 00-648 Warszawa';
    const entities = [
      { entity_group: 'LOCATION', start: 0, end: 3, score: 0.80 },
      { entity_group: 'POSTAL_ADDRESS', start: 4, end: 23, score: 0.85 },
      { entity_group: 'LOCATION', start: 25, end: 40, score: 0.90 },
    ];
    const result = mergeAdjacentEntities(entities, text);
    expect(result).toHaveLength(1);
    expect(result[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(40);
  });

  it('does not merge entities with gap > 3 characters', () => {
    const text = 'ul. Marszałkowska 47      00-648 Warszawa';
    const entities = [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 18, score: 0.85 },
      { entity_group: 'LOCATION', start: 24, end: 41, score: 0.90 },
    ];
    const result = mergeAdjacentEntities(entities, text);
    expect(result).toHaveLength(2);
  });

  it('does not merge non-address entity types', () => {
    const text = 'Jan Kowalski Warszawa';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.95 },
      { entity_group: 'LOCATION', start: 13, end: 21, score: 0.90 },
    ];
    const result = mergeAdjacentEntities(entities, text);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(mergeAdjacentEntities([], '')).toEqual([]);
  });

  it('returns single entity unchanged', () => {
    const entities = [{ entity_group: 'POSTAL_ADDRESS', start: 0, end: 10, score: 0.9 }];
    const result = mergeAdjacentEntities(entities, 'some text.');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entities[0]);
  });

  it('does not merge gap with non-whitespace/comma chars', () => {
    const text = 'ul. Marszałkowska i Warszawa';
    const entities = [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 17, score: 0.85 },
      { entity_group: 'LOCATION', start: 20, end: 28, score: 0.90 },
    ];
    const result = mergeAdjacentEntities(entities, text);
    expect(result).toHaveLength(2);
  });
});
