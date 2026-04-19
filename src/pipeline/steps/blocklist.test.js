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
        blocklistPatterns: [/(?:awca|biorca)$/iu],
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
