import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trimTrailingPunctuationStep } from './trim-trailing-punctuation.js';

const mockRules = { trimTrailingPunctuation: true };
vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: () => mockRules,
}));

beforeEach(() => {
  mockRules.trimTrailingPunctuation = true;
});

function makeCtx({ text, entities, segments }) {
  return { text, entities, segments, anonymized: '', legend: {} };
}

describe('trimTrailingPunctuationStep', () => {
  it('trims trailing period when entity ends at segment end', () => {
    const text = 'Pozdrawia Jan Kowalski.';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Pozdrawia Jan Kowalski.', offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 10, end: 23, score: 0.9, word: 'Jan Kowalski.' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(22);
    expect(result.entities[0].word).toBe('Jan Kowalski');
  });

  it('does NOT trim period inside entity not at segment end', () => {
    const text = 'Pismo od J. Kowalskiego do sądu.';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Pismo od J. Kowalskiego do sądu.', offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 9, end: 23, score: 0.9, word: 'J. Kowalskiego' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(23);
    expect(result.entities[0].word).toBe('J. Kowalskiego');
  });

  it('leaves entity unchanged when it does not end with trim punctuation', () => {
    const text = 'Jan Kowalski mieszka tu';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Jan Kowalski mieszka tu', offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, word: 'Jan Kowalski' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(12);
  });

  it('trims when entity is followed only by whitespace until segment end', () => {
    const text = 'Jan Kowalski.   ';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Jan Kowalski.   ', offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.9, word: 'Jan Kowalski.' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(12);
    expect(result.entities[0].word).toBe('Jan Kowalski');
  });

  it('works with non-zero segment offset', () => {
    const text = 'Pierwsze zdanie. Jan Kowalski.';
    const ctx = makeCtx({
      text,
      segments: [
        { text: 'Pierwsze zdanie.', offset: 0 },
        { text: 'Jan Kowalski.', offset: 17 },
      ],
      entities: [
        { entity_group: 'PERSON_NAME', start: 17, end: 30, score: 0.9, word: 'Jan Kowalski.' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(29);
    expect(result.entities[0].word).toBe('Jan Kowalski');
  });

  it('handles empty entities array', () => {
    const ctx = makeCtx({
      text: 'Hello.',
      segments: [{ text: 'Hello.', offset: 0 }],
      entities: [],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities).toEqual([]);
  });

  it('does NOT trim when trailing period belongs to a known abbreviation', () => {
    const text = 'Firma XYZ sp. z o.o.';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Firma XYZ sp. z o.o.', offset: 0 }],
      entities: [
        { entity_group: 'ORGANIZATION_NAME', start: 6, end: 20, score: 0.9, word: 'XYZ sp. z o.o.' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(20);
    expect(result.entities[0].word).toBe('XYZ sp. z o.o.');
  });

  it('does NOT trim when last token is a CAT_B abbreviation like "r."', () => {
    const text = 'Pismo z 2020 r.';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Pismo z 2020 r.', offset: 0 }],
      entities: [
        { entity_group: 'DATE', start: 8, end: 15, score: 0.9, word: '2020 r.' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(15);
  });

  it('does not trim when entity ends with period mid-segment (followed by more text)', () => {
    const text = 'Firma XYZ sp. z o.o. działa tu.';
    const ctx = makeCtx({
      text,
      segments: [{ text: 'Firma XYZ sp. z o.o. działa tu.', offset: 0 }],
      entities: [
        { entity_group: 'ORGANIZATION', start: 6, end: 20, score: 0.9, word: 'XYZ sp. z o.o.' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(20);
  });

  it('leaves entities untouched when rules.trimTrailingPunctuation is false', () => {
    mockRules.trimTrailingPunctuation = false;
    const text = 'Pozdrawia Jan Kowalski.';
    const result = trimTrailingPunctuationStep(makeCtx({
      text,
      segments: [{ text, offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 10, end: 23, score: 0.9, word: 'Jan Kowalski.' },
      ],
    }));
    expect(result.entities[0].end).toBe(23);
    expect(result.entities[0].word).toBe('Jan Kowalski.');
  });

  it.each([
    { char: ',', label: 'comma' },
    { char: ';', label: 'semicolon' },
    { char: ':', label: 'colon' },
    { char: '!', label: 'exclamation' },
    { char: '?', label: 'question mark' },
  ])('trims trailing $label', ({ char }) => {
    const text = `Jan Kowalski${char}`;
    const ctx = makeCtx({
      text,
      segments: [{ text, offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: text.length, score: 0.9, word: `Jan Kowalski${char}` },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(text.length - 1);
    expect(result.entities[0].word).toBe('Jan Kowalski');
  });

  it('does NOT invoke abbreviation check for non-period punctuation', () => {
    const text = 'Firma XYZ sp,';
    const ctx = makeCtx({
      text,
      segments: [{ text, offset: 0 }],
      entities: [
        { entity_group: 'ORGANIZATION_NAME', start: 6, end: 13, score: 0.9, word: 'XYZ sp,' },
      ],
    });
    const result = trimTrailingPunctuationStep(ctx);
    expect(result.entities[0].end).toBe(12);
    expect(result.entities[0].word).toBe('XYZ sp');
  });
});
