import { describe, it, expect, vi } from 'vitest';
import { blocklistStep } from './blocklist.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_ROLE_OR_TITLE: {
        blocklist: ['Pan', 'Pani', 'Nadawca'],
        blocklistPatterns: [/(?:aw|bior)c(?:a|y|ę|ą|o|ów|om|ami|ach)$/iu],
        rejectTruncatedWord: true,
      },
      ORGANIZATION_NAME: {
        blocklistPatterns: [/^(?:sp\. z o\.o\.|s\.a\.)$/iu],
      },
    };
    return map[type] || { blocklist: [] };
  },
}));

describe('blocklistStep', () => {
  it('drops standalone exact match', () => {
    const text = 'Pan mieszka tu.';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('drops standalone match regardless of case', () => {
    const text = 'pan mieszka tu.';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('trims leading blocklisted word followed by whitespace', () => {
    const text = 'Pan Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(4);
    expect(result.entities[0].end).toBe(12);
  });

  it('trims trailing blocklisted word preceded by whitespace', () => {
    const text = 'Kowalski Pan';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(8);
  });

  it('iteratively trims multiple blocklisted words at the edge', () => {
    const text = 'Pan Pani Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 17, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(9);
    expect(result.entities[0].end).toBe(17);
  });

  it('drops entity when trimming consumes the whole span', () => {
    const text = 'Pan Pani';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 8, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('does not touch entities whose type has an empty blocklist', () => {
    const text = 'Pan Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(12);
  });

  it('does not trim when blocklisted token is not at an edge', () => {
    const text = 'Kowalski Pan Nowak';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 18, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(18);
  });

  it('trims leading blocklisted word followed by punctuation + whitespace', () => {
    const text = 'Nadawca:\nadw.';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 13, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(9);
    expect(result.entities[0].end).toBe(13);
  });

  it('trims trailing blocklisted word preceded by punctuation only', () => {
    const text = 'Kowalski, Pan';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 13, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(8);
  });

  it('drops entity that is a blocklisted word plus trailing punctuation', () => {
    const text = 'Nadawca:';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 8, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('drops entity whose final slice matches a blocklist pattern', () => {
    const text = 'Pożyczkobiorca zobowiązuje się';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 14, score: 0.9, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('drops entity whose final slice matches a blocklist pattern after word trimming', () => {
    const text = 'Pan Pożyczkodawca';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 17, score: 0.9, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('keeps entity whose final slice does not match any pattern', () => {
    const text = 'Kierownik';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 9, score: 0.9, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  // A9 — oblique-case forms of -awca/-biorca, not just nominative singular
  it.each([
    ['Kredytobiorcy', 'genitive/dative/locative'],
    ['Kredytobiorcę', 'accusative'],
    ['Kredytobiorcą', 'instrumental'],
    ['Kredytobiorców', 'genitive/accusative plural'],
    ['Kredytobiorcom', 'dative plural'],
    ['Wykonawcy', 'genitive/dative/locative'],
    ['Wykonawcą', 'instrumental'],
  ])('drops declined role form %s (%s)', (word) => {
    const result = blocklistStep(ctx(word, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: word.length, score: 0.9, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  // A9 — truncated mid-word prefix of a longer word ("Wniosko" cut out of
  // "Wnioskodawca")
  it('drops a span truncated mid-word (no boundary before the next letter)', () => {
    const text = 'Wnioskodawca zwraca się z prośbą';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 7, score: 0.9, source: 'multilang-q8' }, // "Wniosko"
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('does not reject a span ending exactly at the true end of the word', () => {
    const text = 'Wnioskodawczyni złożyła pismo';
    const result = blocklistStep(ctx(text, [
      // "Wnioskodawczyni" in full — ends right before a space, so the
      // truncation gate must not fire (whether or not something else later
      // in the pipeline would still flag this specific word).
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 15, score: 0.9, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('does not reject a short role ending at a real word boundary', () => {
    const text = 'Kierownik działu wyjechał';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 9, score: 0.9, source: 'multilang-q8' }, // "Kierownik"
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('does not apply the truncation check to types that do not opt in', () => {
    const text = 'Kowalskimiszcze';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 9, score: 0.9, source: 'polish-q8' }, // "Kowalski" + "m..." glued
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('applies patterns even when exact blocklist is empty', () => {
    const text = 'Sp. z o.o.';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'ORGANIZATION_NAME', start: 0, end: 10, score: 0.9, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('skips entity type with empty blocklist and empty patterns', () => {
    const text = 'Pan Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
  });
});
