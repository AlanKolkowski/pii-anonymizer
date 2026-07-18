import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTokenMap, anonymizeText, deanonymizeText, aggregateEntities, chunkText, deduplicateEntities, couldBeSamePerson, findRegexEntities } from './anonymizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  it('skips a generated token whose literal already occurs in the source text', () => {
    const text = 'Szablon [PERSON_NAME_1] i Jan Kowalski';
    const name = 'Jan Kowalski';
    const nameStart = text.indexOf(name);
    const entities = [
      { entity_group: 'PERSON_NAME', start: nameStart, end: nameStart + name.length, score: 0.98 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({ '[PERSON_NAME_2]': 'Jan Kowalski' });
    expect(legend).not.toHaveProperty('[PERSON_NAME_1]');

    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('Szablon [PERSON_NAME_1] i [PERSON_NAME_2]');
    // Round-trip: pre-existing literal survives, real name is restored.
    expect(deanonymizeText(anonymized, legend)).toBe(text);
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

  it('keeps Jan and Janusz as separate PERSON_NAME tokens when deanonymizing', () => {
    const text = 'Pozwany Jan Kowalski oraz świadek Janusz Kowalski stawili się.';
    const jan = 'Jan Kowalski';
    const janusz = 'Janusz Kowalski';
    const janStart = text.indexOf(jan);
    const januszStart = text.indexOf(janusz);
    const entities = [
      { entity_group: 'PERSON_NAME', start: janStart, end: janStart + jan.length, score: 0.98, word: jan },
      { entity_group: 'PERSON_NAME', start: januszStart, end: januszStart + janusz.length, score: 0.97, word: janusz },
    ];

    const { anonymized, legend } = anonymizeText(text, entities);

    expect(anonymized).toBe('Pozwany [PERSON_NAME_1] oraz świadek [PERSON_NAME_2] stawili się.');
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[PERSON_NAME_2]': 'Janusz Kowalski',
    });
    expect(deanonymizeText(anonymized, legend)).toBe(text);
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
  it('returns $& in legend value verbatim (no $-pattern interpolation)', () => {
    expect(
      deanonymizeText('A [FINANCIAL_AMOUNT_1] B', { '[FINANCIAL_AMOUNT_1]': 'USD 100 $&' }),
    ).toBe('A USD 100 $& B');
  });

  it("returns $' in legend value verbatim", () => {
    expect(
      deanonymizeText('A [ORGANIZATION_NAME_1] B', {
        '[ORGANIZATION_NAME_1]': "Firma $' Sp. z o.o.",
      }),
    ).toBe("A Firma $' Sp. z o.o. B");
  });

  it('returns $$ and $` in legend value verbatim', () => {
    expect(
      deanonymizeText('A [FINANCIAL_AMOUNT_1] B', { '[FINANCIAL_AMOUNT_1]': '$$ and $` end' }),
    ).toBe('A $$ and $` end B');
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

  it('keeps wider-span entity when overlapping and scores are close', () => {
    const entities = [
      { start: 0, end: 10, score: 0.87, entity_group: 'PERSON_NAME' },
      { start: 5, end: 12, score: 0.9, entity_group: 'PERSON_NAME' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    // Scores within epsilon (0.05) — wider (span 10) beats narrower (span 7)
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(10);
  });

  it('keeps higher-score narrower entity when wider has meaningfully lower score', () => {
    // Regression: NER sometimes emits a greedy wider candidate with lower
    // confidence (e.g. including trailing punctuation). Score gap > epsilon
    // means the narrower, higher-confidence span wins.
    const entities = [
      { start: 5865, end: 5879, score: 0.999, entity_group: 'PERSON_ROLE_OR_TITLE' },
      { start: 5865, end: 5880, score: 0.871, entity_group: 'PERSON_ROLE_OR_TITLE' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    expect(result[0].end).toBe(5879);
    expect(result[0].score).toBe(0.999);
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

  it('keeps higher-score narrower span when the wider NER candidate is much less confident', () => {
    const entities = [
      { start: 0, end: 30, score: 0.7, entity_group: 'PERSON_NAME' },
      { start: 5, end: 20, score: 0.9, entity_group: 'PERSON_NAME' },
    ];
    const result = deduplicateEntities(entities);
    expect(result).toHaveLength(1);
    // Score gap 0.2 > epsilon (0.05) — narrower wins
    expect(result[0].start).toBe(5);
    expect(result[0].end).toBe(20);
  });
});

describe('deduplicateEntities — A6 trim instead of drop on partial regex overlap', () => {
  it('drops a model entity fully covered by a precise regex match (unchanged behavior)', () => {
    const entities = [
      { start: 5, end: 14, score: 0.95, entity_group: 'ORGANIZATION_IDENTIFIER' },
      { start: 5, end: 14, score: 1.0, source: 'regex', entity_group: 'ORGANIZATION_IDENTIFIER' },
    ];
    const result = deduplicateEntities(entities, 'kontekst 381245999');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('regex');
  });

  it('trims (does not drop) a model span with one extra char glued directly to a precise regex match', () => {
    // "381245999" (REGON, [9,18)) checksum-valid; model additionally caught
    // a trailing "X" glued with no separator ([9,19)).
    const text = 'kontekst 381245999X koniec';
    const modelEntity = { start: 9, end: 19, score: 0.95, entity_group: 'ORGANIZATION_IDENTIFIER' };
    const regexEntity = { start: 9, end: 18, score: 1.0, source: 'regex', entity_group: 'ORGANIZATION_IDENTIFIER' };
    const result = deduplicateEntities([modelEntity, regexEntity], text);
    expect(result).toHaveLength(2);
    const trimmed = result.find((e) => e.source !== 'regex');
    expect(trimmed).toBeDefined();
    expect(text.slice(trimmed.start, trimmed.end)).toBe('X');
  });

  it('drops (does not resurrect) unrelated leading context separated by whitespace from a precise regex match', () => {
    // Model wrongly widened to include "kontekst " ahead of the real REGON;
    // the gap is a real word boundary, not a continuation of the identifier.
    const text = 'kontekst 381245999';
    const modelEntity = { start: 0, end: 18, score: 0.85, entity_group: 'ORGANIZATION_IDENTIFIER' };
    const regexEntity = { start: 9, end: 18, score: 1.0, source: 'regex', entity_group: 'ORGANIZATION_IDENTIFIER' };
    const result = deduplicateEntities([modelEntity, regexEntity], text);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('regex');
  });

  it('falls back to dropping the whole entity when no text is passed (safe default)', () => {
    const modelEntity = { start: 9, end: 19, score: 0.95, entity_group: 'ORGANIZATION_IDENTIFIER' };
    const regexEntity = { start: 9, end: 18, score: 1.0, source: 'regex', entity_group: 'ORGANIZATION_IDENTIFIER' };
    const result = deduplicateEntities([modelEntity, regexEntity]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('regex');
  });
});

describe('deduplicateEntities — ST-2 H-1 tier-aware arbitration (SCOPE-TIERS-DESIGN.md §3.2 pkt 3)', () => {
  const TIERS = { PERSON_NAME: 'mask', ORGANIZATION_NAME: 'pass', PERSON_ROLE_OR_TITLE: 'review' };
  const tierOf = (e) => TIERS[e.entity_group] ?? 'mask';

  it('mask/pass pair: both survive untouched even though spans overlap (nested JDG name)', () => {
    const org = { start: 0, end: 40, score: 0.95, entity_group: 'ORGANIZATION_NAME' };
    const name = { start: 27, end: 39, score: 0.9, entity_group: 'PERSON_NAME' };
    const result = deduplicateEntities([org, name], undefined, tierOf);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([org, name]));
  });

  it('mask/review pair: both survive untouched', () => {
    const role = { start: 0, end: 20, score: 0.9, entity_group: 'PERSON_ROLE_OR_TITLE' };
    const name = { start: 10, end: 25, score: 0.9, entity_group: 'PERSON_NAME' };
    const result = deduplicateEntities([role, name], undefined, tierOf);
    expect(result).toHaveLength(2);
  });

  it('review/pass pair: both survive untouched', () => {
    const org = { start: 0, end: 30, score: 0.9, entity_group: 'ORGANIZATION_NAME' };
    const role = { start: 5, end: 25, score: 0.9, entity_group: 'PERSON_ROLE_OR_TITLE' };
    const result = deduplicateEntities([org, role], undefined, tierOf);
    expect(result).toHaveLength(2);
  });

  it('same-tier pair still arbitrates exactly as without a resolver', () => {
    const wide = { start: 0, end: 10, score: 0.87, entity_group: 'PERSON_NAME' };
    const narrow = { start: 5, end: 12, score: 0.9, entity_group: 'PERSON_NAME' };
    const withResolver = deduplicateEntities([wide, narrow], undefined, tierOf);
    const withoutResolver = deduplicateEntities([wide, narrow]);
    expect(withResolver).toEqual(withoutResolver);
    expect(withResolver).toHaveLength(1);
  });

  it('three-way chain: an unrelated different-tier span sitting between two same-tier spans does not stop them arbitrating against each other', () => {
    // X (mask, 0-10) .. Y (pass, 5-30, bridges) .. Z (mask, 8-15)
    // X and Z directly overlap (8 < 10) and are the SAME tier — they must
    // still arbitrate even though Y (a different tier) is processed between
    // them and would otherwise become the naive "last kept" reference point.
    const x = { start: 0, end: 10, score: 0.7, entity_group: 'PERSON_NAME' };
    const y = { start: 5, end: 30, score: 0.9, entity_group: 'ORGANIZATION_NAME' };
    const z = { start: 8, end: 15, score: 0.95, entity_group: 'PERSON_NAME' };
    const result = deduplicateEntities([x, y, z], undefined, tierOf);
    const maskSurvivors = result.filter((e) => e.entity_group === 'PERSON_NAME');
    expect(maskSurvivors).toHaveLength(1);
    expect(maskSurvivors[0]).toBe(z); // higher score, meaningfully so (0.95 vs 0.7) — z wins
    expect(result).toContainEqual(y);
  });

  it('all-mask mode (resolver returns "mask" for every entity): identical result to no resolver at all — the structural invariance proof', () => {
    const entities = [
      { start: 0, end: 40, score: 0.95, entity_group: 'ORGANIZATION_NAME' },
      { start: 27, end: 39, score: 0.9, entity_group: 'PERSON_NAME' },
      { start: 50, end: 70, score: 0.85, entity_group: 'PERSON_ROLE_OR_TITLE' },
      { start: 60, end: 65, score: 0.99, entity_group: 'FINANCIAL_AMOUNT' },
    ];
    const allMaskResolver = () => 'mask';
    const withAllMaskResolver = deduplicateEntities(entities, undefined, allMaskResolver);
    const legacy = deduplicateEntities(entities);
    expect(withAllMaskResolver).toEqual(legacy);
  });

  it('does not change output order for the single-bucket (no resolver) path — still start-sorted', () => {
    const entities = [
      { start: 20, end: 25, score: 0.9, entity_group: 'X' },
      { start: 0, end: 5, score: 0.9, entity_group: 'X' },
      { start: 10, end: 15, score: 0.9, entity_group: 'X' },
    ];
    const result = deduplicateEntities(entities);
    expect(result.map((e) => e.start)).toEqual([0, 10, 20]);
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

  it('matches Polish ending substitutions without conflating distinct names', () => {
    expect(couldBeSamePerson('Anna Kowalska', 'Anną Kowalską')).toBe(true);
    expect(couldBeSamePerson('Marek Nowak', 'Marka Nowaka')).toBe(true);
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

  it('rejects first names that only share a prefix', () => {
    expect(couldBeSamePerson('Jan', 'Janina')).toBe(false);
    expect(couldBeSamePerson('Jan', 'Janusz')).toBe(false);
  });

  it('rejects gendered surname endings as different people', () => {
    expect(couldBeSamePerson('Jan Kowalski', 'Jan Kowalska')).toBe(false);
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

  it('tags every entity with source="regex"', () => {
    const text = 'email a@b.pl, PESEL 92071314764, phone +48 601 234 567';
    const entities = findRegexEntities(text);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(e.source).toBe('regex');
    }
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

  it('does not let a phone-number suffix displace a bare bank account', () => {
    const text = 'Konto: 61109010140000071219812874 koniec';
    const account = '61109010140000071219812874';
    const start = text.indexOf(account);
    const modelBankAccount = {
      entity_group: 'BANK_ACCOUNT_IDENTIFIER',
      start,
      end: start + account.length,
      score: 0.95,
      source: 'model',
    };

    const entities = deduplicateEntities([
      modelBankAccount,
      ...findRegexEntities(text),
    ]);
    const { anonymized } = anonymizeText(text, entities);

    expect(anonymized).toBe('Konto: [BANK_ACCOUNT_IDENTIFIER_1] koniec');
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
  it('excludes the trailing sentence dot from an email match', () => {
    const text = 'Kontakt: jan.kowalski+prawo@kancelaria-abc.com.pl.';
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toHaveLength(1);
    expect(text.slice(emails[0].start, emails[0].end)).toBe(
      'jan.kowalski+prawo@kancelaria-abc.com.pl',
    );
  });

  it('clamps non-overlapping email matches (a@b.co@c.de → one)', () => {
    const text = 'a@b.co@c.de';
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toHaveLength(1);
    expect(emails[0].start).toBe(0);
    expect(emails[0].end).toBe(6);
    expect(text.slice(emails[0].start, emails[0].end)).toBe('a@b.co');
  });

  it('rejects malformed emails (@nodomain, user@, user@nodot)', () => {
    for (const text of ['@nodomain', 'user@', 'user@nodot']) {
      const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
      expect(emails).toEqual([]);
    }
  });

  it('does not freeze on a very long word-char run without @', () => {
    const text = 'a'.repeat(300000);
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toEqual([]);
  });
});

describe('findRegexEntities — A1 checksum-validated identifiers', () => {
  function findOne(text, type) {
    const matches = findRegexEntities(text).filter((e) => e.entity_group === type);
    expect(matches, `expected exactly one ${type} in ${JSON.stringify(text)}, got ${matches.length}`).toHaveLength(1);
    return matches[0];
  }

  // PESEL — adw_09_pesel_formaty
  it('detects PESEL glued to a label (continuous)', () => {
    const text = 'Konrad Żurawski, PESEL:85030712349 (zapis z systemu bez spacji po dwukropku).';
    const e = findOne(text, 'PERSON_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('85030712349');
    expect(e.score).toBe(1.0);
  });

  it('detects PESEL split by spaces (850 307 123 49)', () => {
    const text = 'W formularzu ręcznym PESEL wpisano z odstępami: 850 307 123 49.';
    const e = findOne(text, 'PERSON_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('850 307 123 49');
  });

  it('detects PESEL broken by a single line break (850307\\n12349)', () => {
    const text = 'W skanie wniosku numer przełamano na końcu wiersza: PESEL 850307\n12349.';
    const e = findOne(text, 'PERSON_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('850307\n12349');
  });

  it('rejects an 11-digit run that fails the PESEL checksum', () => {
    const text = 'numer referencyjny 12345678901 nie jest PESEL-em';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER')).toEqual([]);
  });

  // NIP — adw_10_nip_formaty
  it('detects NIP in 3-3-2-2 grouping (existing format)', () => {
    const text = 'NIP 524-987-12-30 widnieje w rejestrze.';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('524-987-12-30');
  });

  it('detects NIP in 3-2-2-3 grouping (old-stamp format the fixed regex never knew)', () => {
    const text = 'Zakład Ślusarski „Gwint” Eustachy Gwóźdź, NIP 611-87-65-433 (grupowanie jak na starych pieczątkach).';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('611-87-65-433');
  });

  it('detects VAT-EU NIP with PL prefix, including the prefix in the span', () => {
    const text = 'Numer VAT UE nabywcy: PL 9481234560.';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('PL 9481234560');
  });

  it('detects NIP written continuously', () => {
    const text = 'NIP zapisany ciągiem w JPK: 7293847564.';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('7293847564');
  });

  it('rejects a 10-digit run that fails the NIP checksum and has no KRS context', () => {
    const text = 'numer zlecenia 1234567890 w systemie';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'ORGANIZATION_IDENTIFIER')).toEqual([]);
  });

  // REGON / KRS — adw_11_regon_krs
  it('detects 9-digit REGON', () => {
    const text = 'REGON 381245999.';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('381245999');
  });

  it('detects 14-digit REGON', () => {
    const text = 'Oddział samobilansujący spółki posługuje się REGON czternastocyfrowym: 38124599900010.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'ORGANIZATION_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('38124599900010');
  });

  it('detects KRS via literal label context (no checksum exists for KRS)', () => {
    const text = 'Miedziak-Metal sp. z o.o., KRS 0000876123, REGON 381245999, kapitał zakładowy 50 000,00 zł.';
    const entities = findRegexEntities(text).filter((e) => e.entity_group === 'ORGANIZATION_IDENTIFIER');
    const spans = entities.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('0000876123');
    expect(spans).toContain('381245999');
  });

  it('does not treat an arbitrary 10-digit number as KRS without the label', () => {
    // 1234567890 also fails the NIP checksum, so this is a clean negative for both paths.
    const text = 'numer zlecenia 1234567890 w systemie';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'ORGANIZATION_IDENTIFIER')).toEqual([]);
  });

  // adw_32_pulapki_prawne — statute/case-law citations must NOT be caught
  it('does not flag statute article numbers as identifiers', () => {
    const text = 'Zgodnie z art. 385¹ § 1 ustawy z dnia 23 kwietnia 1964 r. – Kodeks cywilny (Dz.U. z 2024 r. poz. 1061 ze zm.) postanowienia umowy...';
    expect(findRegexEntities(text).filter((e) =>
      e.entity_group === 'PERSON_IDENTIFIER' || e.entity_group === 'ORGANIZATION_IDENTIFIER',
    )).toEqual([]);
  });

  it('does not flag Supreme Court docket numbers as identifiers', () => {
    const text = 'Analogiczne stanowisko zajęto w uchwale (sygn. akt III CZP 87/22) oraz w wyroku z dnia 14 maja 2021 r. (V CSKP 12/21).';
    expect(findRegexEntities(text).filter((e) =>
      e.entity_group === 'PERSON_IDENTIFIER' || e.entity_group === 'ORGANIZATION_IDENTIFIER',
    )).toEqual([]);
  });

  // IBAN/NRB — adw_12_iban_lamany
  it('detects bare NRB without PL prefix (mod-97 checked as if PL were prepended)', () => {
    const text = 'Zapłatę należy uiścić na rachunek: 75 1090 2776 0000 0001 9876 5432 (numer krajowy bez prefiksu).';
    const e = findOne(text, 'BANK_ACCOUNT_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('75 1090 2776 0000 0001 9876 5432');
  });

  it('detects IBAN with hyphens', () => {
    const text = 'W umowie wskazano rachunek w formacie z łącznikami: PL41-1140-2004-0000-9876-5432-1098.';
    const e = findOne(text, 'BANK_ACCOUNT_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('PL41-1140-2004-0000-9876-5432-1098');
  });

  it('detects IBAN broken by a single line break', () => {
    const text = 'W skanie aneksu numer przełamano: rachunek PL26 1600 1462 0000\n8765 4321 0987.';
    const e = findOne(text, 'BANK_ACCOUNT_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('PL26 1600 1462 0000\n8765 4321 0987');
  });

  it('rejects a 26-digit run that fails the mod-97 checksum', () => {
    const text = 'numer referencyjny 12345678901234567890123456 w systemie';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'BANK_ACCOUNT_IDENTIFIER')).toEqual([]);
  });

  // OCR glyph substitutions — adw_23_ocr_podmiany
  it('detects PESEL with an OCR "l" substituted for digit 1', () => {
    const text = 'PESEL dłużnika (skan niskiej jakości): 850307l2349 – w oryginale cyfra 1, w skanie mała litera „l”.';
    const e = findOne(text, 'PERSON_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('850307l2349');
  });

  it('detects NIP with an OCR "O" substituted for digit 0', () => {
    const text = 'NIP wierzyciela: 524-987-12-3O (na końcu litera „O” zamiast zera).';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('524-987-12-3O');
  });

  it('detects REGON with an OCR "l" substituted for digit 1', () => {
    const text = 'REGON: 38l245999.';
    const e = findOne(text, 'ORGANIZATION_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('38l245999');
  });

  it('detects IBAN with OCR "lO9O" substituted for digits 1090', () => {
    const text = 'Rachunek: PL75 lO9O 2776 0000 0001 9876 5432.';
    const e = findOne(text, 'BANK_ACCOUNT_IDENTIFIER');
    expect(text.slice(e.start, e.end)).toBe('PL75 lO9O 2776 0000 0001 9876 5432');
  });

  it('does not let two PESELs separated by a single space shadow each other', () => {
    const text = 'Dłużnicy solidarni: 85030712349 92090156781 (oboje wskazani w tytule).';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end)).sort();
    expect(spans).toEqual(['85030712349', '92090156781']);
  });

  // VIN — A1 extension (RECALL-90-DESIGN.md R-2), adw_31_komornik
  it('detects a 17-char VIN by structure alone (no checksum)', () => {
    // HC-2/R-TR (H-3-CLOSURE-DESIGN.md §5.4) now also anchors on "nr rej."
    // in this exact real sentence and correctly catches "CT 4567K" too (it
    // is itself a real VEHICLE_IDENTIFIER in the corpus ground truth,
    // adw_31_komornik.expected.json) — this test only pins down the VIN.
    const text = 'nr rej. CT 4567K, VIN VF1BB05CF12345678, rok prod. 2016';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('VF1BB05CF12345678');
  });

  it('does not treat a plain 17-letter word as a VIN (requires a digit)', () => {
    const text = 'ABCDEFGHJKLMNPRST to nie VIN';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER')).toEqual([]);
  });

  it('does not treat 17 bare digits as a VIN (requires a letter)', () => {
    const text = 'numer referencyjny 12345678901234567 w systemie';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER')).toEqual([]);
  });
});

describe('findRegexEntities — A2 court/bailiff docket numbers', () => {
  function findOne(text, type) {
    const matches = findRegexEntities(text).filter((e) => e.entity_group === type);
    expect(matches, `expected exactly one ${type} in ${JSON.stringify(text)}, got ${matches.length}`).toHaveLength(1);
    return matches[0];
  }

  // adw_37_sygnatury_formaty — own-case docket numbers across repertoria
  it.each([
    ['I C 1445/25'],
    ['VI GC 212/24 upr'],
    ['II K 87/23'],
    ['I Ns 310/24'],
    ['KM 1552/25'],
    ['I Co 219/25'],
  ])('detects own-case docket number %s', (docket) => {
    const text = `Sprawa prowadzona jest pod sygnaturą ${docket} w tutejszym sądzie.`;
    const e = findOne(text, 'DOCUMENT_REFERENCE');
    expect(text.slice(e.start, e.end)).toBe(docket);
    expect(e.score).toBe(1.0);
  });

  // adw_32_pulapki_prawne — published case-law citations are NOT own-case
  // docket numbers and must not be flagged (SN repertoria excluded from the
  // whitelist entirely, not context-gated).
  it('does not flag a Supreme Court civil-chamber citation (CZP)', () => {
    const text = 'Analogiczne stanowisko zajęto w uchwale (sygn. akt III CZP 87/22).';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'DOCUMENT_REFERENCE')).toEqual([]);
  });

  it('does not flag a Supreme Court CSKP citation even with "sygn. akt" context', () => {
    const text = 'w wyroku z dnia 14 maja 2021 r. (sygn. akt V CSKP 12/21).';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'DOCUMENT_REFERENCE')).toEqual([]);
  });

  it('does not flag a bare statute article as a docket number', () => {
    const text = 'Zgodnie z art. 410 § 2 k.c. świadczenie nienależne podlega zwrotowi.';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'DOCUMENT_REFERENCE')).toEqual([]);
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

describe('findRegexEntities — A4 amount formats', () => {
  function findOne(text) {
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(matches, `expected exactly one amount in ${JSON.stringify(text)}, got ${matches.length}`).toHaveLength(1);
    return matches[0];
  }

  // adw_15_kwoty_formaty
  it('detects an amount with dot as thousands separator', () => {
    const text = 'Cena sprzedaży wynosi 15.000,00 zł (zapis z kropką tysięcy ze skanu faktury).';
    const e = findOne(text);
    expect(text.slice(e.start, e.end)).toBe('15.000,00 zł');
  });

  it('detects an amount with no grosze', () => {
    const text = 'Zadatek: 1500 zł, płatny gotówką.';
    const e = findOne(text);
    expect(text.slice(e.start, e.end)).toBe('1500 zł');
  });

  it('detects an EUR amount with space-grouped thousands', () => {
    const text = 'Wartość kontraktu eksportowego: 2 500 000,00 EUR.';
    const e = findOne(text);
    expect(text.slice(e.start, e.end)).toBe('2 500 000,00 EUR');
  });

  it('detects an amount with the currency before the number (PLN)', () => {
    const text = 'W walucie przed liczbą: PLN 4.200 miesięcznie.';
    const e = findOne(text);
    expect(text.slice(e.start, e.end)).toBe('PLN 4.200');
  });

  it('detects an amount with a non-breaking space as thousands separator', () => {
    const text = 'Zapis z twardą spacją: 12 500,00 zł (poprawnie łapany przez wzorzec).';
    const e = findOne(text);
    expect(text.slice(e.start, e.end)).toBe('12 500,00 zł');
  });

  // adw_29_umowa_kredytu
  it('detects real amounts in a credit-agreement fragment', () => {
    const cases = [
      ['Bank udziela Kredytobiorcy kredytu w kwocie 45 000,00 zł na okres 60 miesięcy.', '45 000,00 zł'],
      ['Prowizja za udzielenie kredytu wynosi 1 350,00 zł. RRSO: 13,87%.', '1 350,00 zł'],
      ['Rata kapitałowo-odsetkowa wynosi 989,12 zł i jest płatna do 15. dnia każdego miesiąca.', '989,12 zł'],
      ['średnie miesięczne wynagrodzenie wynosi 9 100,00 zł netto.', '9 100,00 zł'],
    ];
    for (const [text, expected] of cases) {
      const e = findOne(text);
      expect(text.slice(e.start, e.end)).toBe(expected);
    }
  });

  it('does not flag a bare interest-rate percentage (no space before %)', () => {
    const text = 'i wynosi w dniu zawarcia umowy 11,45% w stosunku rocznym, na co składa się wskaźnik referencyjny.';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'FINANCIAL_AMOUNT')).toEqual([]);
  });

  it('does not flag a margin expressed in p.p.', () => {
    const text = 'wskaźnik referencyjny WIRON 1M oraz marża Banku 4,20 p.p.';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'FINANCIAL_AMOUNT')).toEqual([]);
  });

  it('does not flag an RRSO percentage', () => {
    const text = 'Prowizja za udzielenie kredytu wynosi 1 350,00 zł. RRSO: 13,87%.';
    const amounts = findRegexEntities(text).filter((e) => e.entity_group === 'FINANCIAL_AMOUNT');
    expect(amounts).toHaveLength(1);
    expect(text.slice(amounts[0].start, amounts[0].end)).toBe('1 350,00 zł');
  });

  it('does not treat "zł" inside an unrelated word as a currency marker', () => {
    const text = '150 złodziej uciekł z miejsca zdarzenia.';
    expect(findRegexEntities(text).filter((e) => e.entity_group === 'FINANCIAL_AMOUNT')).toEqual([]);
  });
});

describe('applyTokens', () => {
  it('replaces entities using a pre-built seen map', async () => {
    const { applyTokens, buildTokenMap } = await import('./anonymizer.js');
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'ORGANIZATION_NAME', start: 22, end: 34, score: 0.95 },
    ];
    const { seen } = buildTokenMap(entities, text);
    expect(applyTokens(text, entities, seen)).toBe(
      '[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]',
    );
  });
});

describe('buildTokenMapMulti', () => {
  it('shares a token across sources for the same value', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Pisze Jan Kowalski.',
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.98 }],
    };
    const docB = {
      text: 'Także Jan Kowalski był obecny.',
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.97 }],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(legend).toEqual({ '[PERSON_NAME_1]': 'Jan Kowalski' });
  });

  it('reuses one token across declension forms (Polish)', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Jan Kowalski podpisał umowę.',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 }],
    };
    const docB = {
      text: 'Pełnomocnictwo dla Janowi Kowalskiemu.',
      entities: [{ entity_group: 'PERSON_NAME', start: 19, end: 37, score: 0.97 }],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(Object.keys(legend)).toHaveLength(1);
    expect(legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
  });

  it('numbers tokens in insertion order across sources', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Anna Nowak',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.98 }],
    };
    const docB = {
      text: 'Jan Kowalski',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 }],
    };
    const aFirst = buildTokenMapMulti([docA, docB]).legend;
    const bFirst = buildTokenMapMulti([docB, docA]).legend;
    expect(aFirst).toEqual({
      '[PERSON_NAME_1]': 'Anna Nowak',
      '[PERSON_NAME_2]': 'Jan Kowalski',
    });
    expect(bFirst).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[PERSON_NAME_2]': 'Anna Nowak',
    });
  });

  it('returns empty seen and legend for no sources', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    expect(buildTokenMapMulti([])).toEqual({ seen: {}, legend: {} });
  });

  it('skips sources with empty entity lists', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = { text: 'no PII here', entities: [] };
    const docB = {
      text: 'Anna Nowak',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.98 }],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(legend).toEqual({ '[PERSON_NAME_1]': 'Anna Nowak' });
  });

  it('applyTokens with the multi-source seen map renders each source correctly', async () => {
    const { buildTokenMapMulti, applyTokens } = await import('./anonymizer.js');
    const docA = {
      text: 'Jan Kowalski tu jest.',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 }],
    };
    const docB = {
      text: 'I Jan Kowalski tam był.',
      entities: [{ entity_group: 'PERSON_NAME', start: 2, end: 14, score: 0.97 }],
    };
    const { seen } = buildTokenMapMulti([docA, docB]);
    expect(applyTokens(docA.text, docA.entities, seen)).toBe('[PERSON_NAME_1] tu jest.');
    expect(applyTokens(docB.text, docB.entities, seen)).toBe('I [PERSON_NAME_1] tam był.');
  });
  it('reserves a token literal from a later doc against an earlier doc', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Anna Nowak',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.98 }],
    };
    const docB = {
      text: 'Wzór [PERSON_NAME_1] tutaj',
      entities: [],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(legend).toEqual({ '[PERSON_NAME_2]': 'Anna Nowak' });
  });
});

describe('findRegexEntities — HC-2 R-DOW (dowód osobisty, H-3-CLOSURE-DESIGN.md §5.2)', () => {
  // Real sentences from the corpus (test-data/adversarial/adw_14_dokumenty_tozsamosci.txt,
  // test-data/adversarial-holdout/hold_identyfikatory_12.txt) — the exact H-3
  // leak vectors #2-4 from the design's §1.2 inventory. Today (pre-HC-2)
  // findRegexEntities emits NOTHING for any of them (§1.3 triage): no dowód-
  // osobisty pattern exists yet, and findNumericIdentifierEntities only sees
  // pure digit clusters, not 3-letter+6-digit tokens.
  it('detects a dowód osobisty number via the checksum path (DKR 744829, valid check digit)', () => {
    const text = 'Tożsamość mocodawcy ustalono na podstawie dowodu osobistego seria i nr DKR 744829, wydanego przez Prezydenta Miasta Torunia.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('DKR 744829');
    expect(matches[0].score).toBe(1.0);
    expect(matches[0].source).toBe('regex');
  });

  it('detects the same number glued without a separator (DKR744829)', () => {
    const text = 'Zbiorczy zapis z systemu: dow. os. DKR744829 (bez spacji).';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('DKR744829');
  });

  it('detects a dowód osobisty number whose checksum is INVALID via the context-anchor path (BMA 733701)', () => {
    // Design §1.3: BMA 733701 fails the arithmetic checksum (verified by
    // hand: sum mod 10 = 3, actual check digit is 7) — closed only by the
    // "seria i nr" anchor sitting right before it in the real sentence.
    const text = 'Dane strony postępowania: Bożena Wróblewska, PESEL 57020976679, dowód osobisty seria i nr BMA 733701, paszport nr AG 1391751, prawo jazdy nr 92712/00/2780.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('BMA 733701');
  });

  it('does not flag a bare 3-letter+6-digit token with no anchor and a failing checksum', () => {
    const text = 'Numer wewnętrzny zlecenia to XYZ123456 w naszym systemie.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain('XYZ123456');
  });

  it('does not emit via the arithmetic path when the prefix is on the acronym blocklist, even if the checksum happens to validate', () => {
    // NIP + "000000": checksum IS valid by the dowód formula (verified by
    // hand: sum = 240, mod 10 = 0, matches check digit '0') but "NIP" is a
    // blocklisted acronym prefix (O-HC-3) — must not be emitted, and there
    // is no dowód-osobisty context anchor here either.
    const text = 'Numer w rejestrze wewnętrznym: NIP000000 (pole techniczne).';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain('NIP000000');
  });

  // Property test on a wider set of known-good/known-bad numbers than just
  // the two corpus vectors (design §5.8 "Uwaga wykonawcza"): each pair below
  // is the SAME letters + digits with only the check digit (first numeric
  // char) flipped, hand-computed from the §1.3 algorithm (letters A=10..Z=35,
  // weights 7-3-1 for the 3 letters and 7-3-1-7-3 for the 5 digits after the
  // check digit). No anchor context in any of these sentences — only the
  // arithmetic can be responsible for a detection here.
  it.each([
    ['ABC412345', true],  // 7*10+3*11+1*12 + 7*1+3*2+1*3+7*4+3*5 = 174 → check digit 4 ✓
    ['ABC912345', false], // same letters/tail, check digit forced to 9 ≠ 4
    ['XYZ800000', true],  // 7*33+3*34+1*35 = 368 → check digit 8 ✓ (tail all zero)
    ['XYZ100000', false], // same letters/tail, check digit forced to 1 ≠ 8
  ])('checksum property check: %s is detected only when the check digit is actually valid (%s)', (token, shouldMatch) => {
    const text = `W polu technicznym systemu kadrowego zapisano ciąg ${token} bez dalszego opisu.`;
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    if (shouldMatch) {
      expect(spans).toContain(token);
    } else {
      expect(spans).not.toContain(token);
    }
  });
});

describe('findRegexEntities — HC-2 R-PJ (prawo jazdy, H-3-CLOSURE-DESIGN.md §5.3)', () => {
  // Real sentences (test-data/adversarial-holdout/hold_identyfikatory_12.txt,
  // test-data/adversarial/adw_14_dokumenty_tozsamosci.txt) — leak vectors #1
  // and #2 from the design's §1.2 inventory. Today findRegexEntities emits
  // nothing: the 5/2/4 digit clusters get split apart by "/" at the numeric-
  // identifier scan (ID_SEPARATOR doesn't include "/"), and no other pattern
  // reaches for this shape at all (§1.3).
  it('detects a driving-licence number anchored by "prawo jazdy nr" (92712/00/2780)', () => {
    const text = 'Dane strony postępowania: Bożena Wróblewska, PESEL 57020976679, dowód osobisty seria i nr BMA 733701, paszport nr AG 1391751, prawo jazdy nr 92712/00/2780.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('92712/00/2780');
  });

  it('detects a driving-licence number anchored by "prawa jazdy nr" (00123/22/0611)', () => {
    const text = 'W aktach znajduje się kopia paszportu nr EJ 1234567 oraz prawa jazdy nr 00123/22/0611 kat. B.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('00123/22/0611');
  });

  it('does not flag the same 5/2/4 shape with no "prawo/prawa jazdy" anchor anywhere nearby (invoice-number collision, §5.3)', () => {
    const text = 'Faktura VAT nr 12345/07/2024 płatna w terminie 14 dni od daty wystawienia.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain('12345/07/2024');
  });

  it('enforces the 40-char window: an anchor further back than the window does not license a match', () => {
    const filler = 'x'.repeat(45);
    const prefix = `Kredytobiorca okazał prawa jazdy ${filler} `;
    const number = '12345/07/2024';
    const text = `${prefix}a numer ${number} dotyczy zupełnie innej sprawy.`;
    const gap = text.indexOf(number) - (prefix.indexOf('jazdy') + 'jazdy'.length);
    expect(gap).toBeGreaterThan(40); // sanity check on the fixture itself

    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain(number);
  });
});

describe('findRegexEntities — HC-2 R-TR (tablica rejestracyjna, H-3-CLOSURE-DESIGN.md §5.4)', () => {
  // Real sentence (test-data/adversarial/adw_31_komornik.txt) — leak vector
  // #5 from the design's §1.2 inventory. Today findRegexEntities emits
  // nothing for a plate this short: the only vehicle pattern is the
  // 17-char VIN (§1.3).
  it('detects a vehicle plate anchored by "nr rej." (CTR 88812)', () => {
    const text = 'przyczepa lekka, nr rej. CTR 88812.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('CTR 88812');
  });

  it('detects a second, shorter anchored plate in the same document (CT 4567K)', () => {
    const text = 'samochód osobowy marki Astra Kombi, nr rej. CT 4567K, VIN VF1BB05CF12345678, rok prod. 2016.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('CT 4567K');
  });

  it('does not flag the identical shape as a currency amount with no plate anchor nearby (USD 88812)', () => {
    // Same 3-letters+5-digits shape as the real CTR 88812 leak above — only
    // the anchor (absent here) may distinguish an amount from a plate.
    const text = 'Zobowiązanie wyrażone jest w walucie obcej: USD 88812 na dzień wymagalności.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain('USD 88812');
  });

  it('does not flag a Supreme Court/KIO-style docket as a plate with no anchor nearby (KIO 2345/21)', () => {
    // 3 letters + 4 digits also fits the bare shape (before the "/21" breaks
    // it) — same near-miss as the currency case, closed only by the anchor.
    const text = 'Analogiczne stanowisko potwierdza wyrok (sygn. akt KIO 2345/21).';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'VEHICLE_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain('KIO 2345');
  });
});

describe('findRegexEntities — HC-2 R-PASZ (paszport, H-3-CLOSURE-DESIGN.md §8 O-HC-2)', () => {
  // Real sentences (test-data/adversarial-holdout/hold_identyfikatory_12.txt,
  // test-data/adversarial/adw_14_dokumenty_tozsamosci.txt) — the same two
  // corpus sentences already used by the R-DOW/R-PJ tests above, each of
  // which also carries a passport number findRegexEntities emits NOTHING for
  // today: no 2-letter+7-digit pattern exists yet, only the shape-disjoint
  // 3L+6D (R-DOW) and 5/2/4 (R-PJ) formats are covered.
  it('detects a passport number anchored by "paszport nr" (AG 1391751)', () => {
    const text = 'Dane strony postępowania: Bożena Wróblewska, PESEL 57020976679, dowód osobisty seria i nr BMA 733701, paszport nr AG 1391751, prawo jazdy nr 92712/00/2780.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('AG 1391751');
  });

  it('detects a passport number anchored by "paszportu nr" (EJ 1234567)', () => {
    const text = 'W aktach znajduje się kopia paszportu nr EJ 1234567 oraz prawa jazdy nr 00123/22/0611 kat. B.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain('EJ 1234567');
  });

  it('does not flag the same 2-letter+7-digit shape with no "paszport" anchor anywhere nearby', () => {
    const text = 'Numer wewnętrzny zlecenia to EJ 1234567 w naszym systemie.';
    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain('EJ 1234567');
  });

  it('enforces the 40-char window: an anchor further back than the window does not license a match', () => {
    const filler = 'x'.repeat(45);
    const prefix = `Okazano paszport ${filler} `;
    const number = 'EJ 1234567';
    const text = `${prefix}a numer ${number} dotyczy zupełnie innej sprawy.`;
    const gap = text.indexOf(number) - (prefix.indexOf('paszport') + 'paszport'.length);
    expect(gap).toBeGreaterThan(40); // sanity check on the fixture itself

    const matches = findRegexEntities(text).filter((e) => e.entity_group === 'PERSON_IDENTIFIER');
    expect(matches.map((e) => text.slice(e.start, e.end))).not.toContain(number);
  });
});

describe('findRegexEntities — HC-2 R-EM (e-mail IDN, H-3-CLOSURE-DESIGN.md §5.5)', () => {
  // Real sentences (test-data/adversarial-holdout/hold_dane_osobowe_09.txt
  // and hold_dane_osobowe_11.txt) — leak vector #6 from the design's §1.2
  // inventory. Today EMAIL_ANCHORED_RE/EMAIL_LOCAL_CHAR/EMAIL_DOMAIN_CHAR
  // are ASCII-only (`\w`), so domain expansion stops dead at "ę"/"ó" (§1.3
  // triage: "regex jest ASCII-owy... kandydat odpada").
  it('detects an email whose domain contains a Polish diacritic (kontakt@przedsiębior.pl)', () => {
    const text = 'Korespondencję firmową prosimy kierować na adres kontakt@przedsiębior.pl.';
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toHaveLength(1);
    expect(text.slice(emails[0].start, emails[0].end)).toBe('kontakt@przedsiębior.pl');
  });

  it('detects an email whose LOCAL part contains Polish diacritics (bożena.wróblewska@poczta-testowa.pl)', () => {
    const text = 'e-mail bożena.wróblewska@poczta-testowa.pl. Korespondencję firmową...';
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toHaveLength(1);
    expect(text.slice(emails[0].start, emails[0].end)).toBe('bożena.wróblewska@poczta-testowa.pl');
  });

  it('keeps matching plain-ASCII emails unchanged (regression control from §1.3)', () => {
    const text = 'kontakt@bankwielkopo.pl';
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toHaveLength(1);
    expect(text.slice(emails[0].start, emails[0].end)).toBe('kontakt@bankwielkopo.pl');
  });

  it('keeps excluding a trailing sentence dot on a non-ASCII domain, same as the existing ASCII behavior', () => {
    const text = 'Adres: kontakt@przedsiębior.pl.';
    const emails = findRegexEntities(text).filter((e) => e.entity_group === 'EMAIL_ADDRESS');
    expect(emails).toHaveLength(1);
    expect(text.slice(emails[0].start, emails[0].end)).toBe('kontakt@przedsiębior.pl');
  });
});

describe('findRegexEntities — HC-2 pułapkownik (H-3-CLOSURE-DESIGN.md §5.6, zero FP)', () => {
  // Precision is load-bearing: an unanchored/imprecise regex here would map
  // real dates/amounts/docket-numbers/invoice-numbers onto [DRIVER_LICENSE]-
  // style tokens. This reads test-data/traps/h3-pulapki.txt (data, not code
  // — a "living registry": a future measured FP gets a new line here first,
  // red, then a pattern fix) and asserts each line contributes ZERO
  // PERSON_IDENTIFIER (R-DOW/R-PJ) or VEHICLE_IDENTIFIER (R-TR) candidates.
  function loadTraps() {
    const raw = readFileSync(join(__dirname, '../test-data/traps/h3-pulapki.txt'), 'utf-8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  const traps = loadTraps();

  it('loads a non-trivial trap corpus (sanity check on the fixture itself)', () => {
    expect(traps.length).toBeGreaterThanOrEqual(25);
  });

  it.each(traps)('zero HC-2 false positives on: %s', (trapText) => {
    const hits = findRegexEntities(trapText).filter(
      (e) => e.entity_group === 'PERSON_IDENTIFIER' || e.entity_group === 'VEHICLE_IDENTIFIER',
    );
    expect(
      hits.map((e) => ({ type: e.entity_group, value: trapText.slice(e.start, e.end) })),
    ).toEqual([]);
  });
});

describe('findRegexEntities — H-3 re-analiza: 6/6 wycieków case-(a) z korpusu (H-3-CLOSURE-DESIGN.md §1.2-§1.3)', () => {
  // The design's own re-measurement discipline (§7 laptop step 2): re-run
  // findRegexEntities directly on the corpus SENTENCES containing the six
  // measured H-3 leak values (no models, no eval, laptop-safe) and assert
  // every one now gets a "mask"-tier (PERSON_IDENTIFIER/EMAIL_ADDRESS/
  // VEHICLE_IDENTIFIER) candidate — the exact proof HC-2 is supposed to
  // deliver. All six sentences are copied verbatim from the corpus.
  const CASE_A_LEAKS = [
    {
      id: '#1 92712/00/2780 (PERSON_IDENTIFIER, hold_identyfikatory_12)',
      text: 'Dane strony postępowania: Bożena Wróblewska, PESEL 57020976679, dowód osobisty seria i nr BMA 733701, paszport nr AG 1391751, prawo jazdy nr 92712/00/2780.',
      value: '92712/00/2780',
      type: 'PERSON_IDENTIFIER',
    },
    {
      id: '#2 00123/22/0611 (PERSON_IDENTIFIER, adw_14_dokumenty_tozsamosci)',
      text: 'W aktach znajduje się kopia paszportu nr EJ 1234567 oraz prawa jazdy nr 00123/22/0611 kat. B.',
      value: '00123/22/0611',
      type: 'PERSON_IDENTIFIER',
    },
    {
      id: '#3 DKR 744829 (PERSON_IDENTIFIER, adw_14_dokumenty_tozsamosci)',
      text: 'Tożsamość mocodawcy ustalono na podstawie dowodu osobistego seria i nr DKR 744829, wydanego przez Prezydenta Miasta Torunia.',
      value: 'DKR 744829',
      type: 'PERSON_IDENTIFIER',
    },
    {
      id: '#4 DKR744829 sklejone (PERSON_IDENTIFIER, adw_14_dokumenty_tozsamosci)',
      text: 'Zbiorczy zapis z systemu: dow. os. DKR744829 (bez spacji).',
      value: 'DKR744829',
      type: 'PERSON_IDENTIFIER',
    },
    {
      id: '#5 CTR 88812 (VEHICLE_IDENTIFIER, adw_31_komornik)',
      text: 'przyczepa lekka, nr rej. CTR 88812.',
      value: 'CTR 88812',
      type: 'VEHICLE_IDENTIFIER',
    },
    {
      id: '#6 kontakt@przedsiębior.pl (EMAIL_ADDRESS, hold_dane_osobowe_09/11/16)',
      text: 'Korespondencję firmową prosimy kierować na adres kontakt@przedsiębior.pl.',
      value: 'kontakt@przedsiębior.pl',
      type: 'EMAIL_ADDRESS',
    },
  ];

  it.each(CASE_A_LEAKS)('$id now gets a same-type regex "mask" candidate', ({ text, value, type }) => {
    const matches = findRegexEntities(text).filter((e) => e.entity_group === type);
    const spans = matches.map((e) => text.slice(e.start, e.end));
    expect(spans).toContain(value);
  });

  it('all 6/6 case-(a) leak values from the design §1.2 inventory now have a regex mask candidate', () => {
    const results = CASE_A_LEAKS.map(({ id, text, value, type }) => {
      const found = findRegexEntities(text)
        .filter((e) => e.entity_group === type)
        .some((e) => text.slice(e.start, e.end) === value);
      return { id, found };
    });
    expect(results.filter((r) => r.found)).toHaveLength(6);
  });
});

