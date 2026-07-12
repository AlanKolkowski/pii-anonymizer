import { describe, it, expect } from 'vitest';
import { normalizeWhitespace } from './preprocess.js';
import { segmentStep } from './segment.js';
import { snapStep } from './snap.js';
import { maxLengthStep } from './max-length.js';
import { dedupStep } from './dedup.js';
import { mergeStep } from './merge.js';
import { createRegexStep } from './regex.js';
import { backfillOccurrencesStep } from './backfill.js';
import { tokenizeStep } from './tokenize.js';
import { createNerStep } from './ner.js';

describe('normalizeWhitespace', () => {
  it('passes text through unchanged (no-op)', () => {
    const ctx = {
      text: '  hello\n\nworld  ',
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = normalizeWhitespace(ctx);
    expect(result.text).toBe('  hello\n\nworld  ');
  });
});

describe('segmentStep', () => {
  it('chunks short text into a single segment', () => {
    const ctx = {
      text: 'short text',
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = segmentStep(ctx);
    expect(result.segments).toEqual([{ text: 'short text', offset: 0 }]);
  });

  it('chunks long text into multiple segments', () => {
    const para1 = 'A'.repeat(700);
    const para2 = 'B'.repeat(700);
    const para3 = 'C'.repeat(700);
    const text = para1 + '\n\n' + para2 + '\n\n' + para3;
    const ctx = {
      text,
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = segmentStep(ctx);
    expect(result.segments.length).toBeGreaterThan(1);
    for (const seg of result.segments) {
      expect(text.slice(seg.offset, seg.offset + seg.text.length)).toBe(seg.text);
    }
  });
});

describe('snapStep', () => {
  it('snaps entity boundaries to word boundaries', () => {
    const text = 'notariusz Jan Kowalski';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 10, end: 13, score: 0.9 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = snapStep(ctx);
    expect(result.entities[0].start).toBe(10);
    expect(result.entities[0].end).toBe(13);
  });
});

describe('maxLengthStep', () => {
  it('flags oversized entities of weight>=3 types instead of removing them', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9 },
        { entity_group: 'PERSON_NAME', start: 0, end: 100, score: 0.8 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = maxLengthStep(ctx);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].end).toBe(10);
    expect(result.entities[0].oversized).toBeUndefined();
    expect(result.entities[1].end).toBe(100);
    expect(result.entities[1].oversized).toBe(true);
  });
});

describe('dedupStep', () => {
  it('removes overlapping entities keeping higher-priority', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.8 },
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.95 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = dedupStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.95);
  });

  it('lets precise regex spans replace wider same-type candidates before deduping', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'DOCUMENT_REFERENCE', start: 0, end: 15, score: 0.98, source: 'polish-q8' },
        { entity_group: 'FINANCIAL_AMOUNT', start: 10, end: 25, score: 0.99, source: 'multilang-q8' },
        { entity_group: 'FINANCIAL_AMOUNT', start: 18, end: 25, score: 1.0, source: 'regex' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = dedupStep(ctx);
    expect(result.entities).toHaveLength(2);
    expect(result.entities.map(e => e.entity_group)).toEqual(['DOCUMENT_REFERENCE', 'FINANCIAL_AMOUNT']);
    expect(result.entities[1].source).toBe('regex');
  });
});

describe('mergeStep', () => {
  it('merges address with a following location by default', () => {
    const text = 'ul. Kwiatowa 5, Warszawa';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'POSTAL_ADDRESS', start: 0, end: 14, score: 0.9 },
        { entity_group: 'LOCATION', start: 16, end: 24, score: 0.85 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = mergeStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(24);
  });

  it('does not merge location before address by default', () => {
    const text = 'Warszawa, ul. Kwiatowa 5';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'LOCATION', start: 0, end: 8, score: 0.85 },
        { entity_group: 'POSTAL_ADDRESS', start: 10, end: 24, score: 0.9 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = mergeStep(ctx);
    expect(result.entities).toHaveLength(2);
    expect(result.entities.map(e => e.entity_group)).toEqual(['LOCATION', 'POSTAL_ADDRESS']);
  });
});

describe('createRegexStep', () => {
  it('adds regex-detected entities when active', () => {
    const text = 'Contact jan@test.com for details';
    const step = createRegexStep(true);
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = step(ctx);
    expect(result.entities.length).toBe(2);
    const email = result.entities.find(e => e.entity_group === 'EMAIL_ADDRESS');
    expect(email).toBeDefined();
    expect(email.score).toBe(1.0);
    expect(email.source).toBe('regex');
  });

  it('is a no-op when inactive', () => {
    const text = 'Contact jan@test.com for details';
    const step = createRegexStep(false);
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = step(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
  });
});

describe('tokenizeStep', () => {
  it('produces anonymized text and legend from entities', () => {
    const text = 'Jan Kowalski lives in Warszawa';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9 },
        { entity_group: 'LOCATION', start: 22, end: 30, score: 0.85 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = tokenizeStep(ctx);
    expect(result.anonymized).toContain('[PERSON_NAME_1]');
    expect(result.anonymized).toContain('[LOCATION_1]');
    expect(result.anonymized).not.toContain('Jan Kowalski');
    expect(result.legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
  });
});

describe('backfillOccurrencesStep', () => {
  it('adds exact-word-boundary occurrences of known non-name entity values', () => {
    const text = 'Adw. Nowak pisał. Adw. Nowak podpisał.';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 5, end: 10, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = backfillOccurrencesStep(ctx);
    const added = result.entities.filter(e => e.source === 'rescan');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ entity_group: 'PERSON_NAME', start: 23, end: 28, score: 1.0 });
  });

  it('does not match inside larger words (word-boundary respected)', () => {
    const text = 'Faktura VAT dotyczy VATowca.';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'DOCUMENT_REFERENCE', start: 8, end: 11, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = backfillOccurrencesStep(ctx);
    expect(result.entities).toHaveLength(1);
  });

  it('does not duplicate entities that already exist at the same position', () => {
    const text = 'Nowak i Nowak';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'multilang-q8' },
        { entity_group: 'PERSON_NAME', start: 8, end: 13, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = backfillOccurrencesStep(ctx);
    expect(result.entities).toHaveLength(2);
  });

  it('fuzzy-matches declined PERSON_NAME forms', () => {
    const text = 'pisał Jan Kowalski do Jana Kowalskiego.';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = backfillOccurrencesStep(ctx);
    const added = result.entities.filter(e => e.source === 'rescan');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ entity_group: 'PERSON_NAME', start: 22, end: 38 });
  });

  it('skips occurrences that overlap an existing wider entity', () => {
    const text = 'Napisano w Warszawie. ul. Marszałkowska 47/12, 00-648 Warszawa to adres.';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'LOCATION', start: 11, end: 20, score: 0.9, source: 'multilang-q8' },
        { entity_group: 'POSTAL_ADDRESS', start: 22, end: 61, score: 0.85, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = backfillOccurrencesStep(ctx);
    const added = result.entities.filter(e => e.source === 'rescan');
    expect(added).toHaveLength(0);
  });

  it('returns ctx unchanged when no new occurrences found', () => {
    const text = 'Jan Kowalski tylko raz';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = backfillOccurrencesStep(ctx);
    expect(result.entities).toHaveLength(1);
  });
});

describe('createNerStep', () => {
  it('runs model inference on segments and produces entities', async () => {
    const mockLoadModel = async () => ({
      infer: async (text) => [
        { word: 'Jan', entity: 'B-PERSON_NAME', score: 0.95, index: 0 },
        { word: 'Kowalski', entity: 'I-PERSON_NAME', score: 0.93, index: 1 },
      ],
      dispose: async () => {},
    });

    const step = createNerStep([{ alias: 'mock', id: 'mock-model', dtype: 'q8' }], mockLoadModel);
    const ctx = {
      text: 'Jan Kowalski jest notariuszem',
      segments: [{ text: 'Jan Kowalski jest notariuszem', offset: 0 }],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = await step(ctx);
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
  });

  it('offsets entities by segment offset', async () => {
    const mockLoadModel = async () => ({
      infer: async (text) => [
        { word: 'Anna', entity: 'B-PERSON_NAME', score: 0.9, index: 0 },
      ],
      dispose: async () => {},
    });

    const step = createNerStep([{ alias: 'mock', id: 'mock-model', dtype: 'q8' }], mockLoadModel);
    const ctx = {
      text: 'Prefix text. Anna Nowak lives here',
      segments: [{ text: 'Anna Nowak lives here', offset: 13 }],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = await step(ctx);
    expect(result.entities[0].start).toBeGreaterThanOrEqual(13);
  });

  it('merges entities from multiple models', async () => {
    let callCount = 0;
    const mockLoadModel = async () => ({
      infer: async (text) => {
        callCount++;
        if (callCount === 1) {
          return [{ word: 'Jan', entity: 'B-PERSON_NAME', score: 0.9, index: 0 }];
        }
        return [{ word: 'Warszawa', entity: 'B-LOCATION', score: 0.85, index: 0 }];
      },
      dispose: async () => {},
    });

    const step = createNerStep(
      [{ alias: 'a', id: 'model-a', dtype: 'q8' }, { alias: 'b', id: 'model-b', dtype: 'q8' }],
      mockLoadModel,
    );
    const ctx = {
      text: 'Jan z Warszawa',
      segments: [{ text: 'Jan z Warszawa', offset: 0 }],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = await step(ctx);
    expect(result.entities.length).toBe(2);
  });

  it('writes entity.source = alias (not raw HF id)', async () => {
    const mockLoadModel = async () => ({
      infer: async () => [
        { word: 'Jan', entity: 'B-PERSON_NAME', score: 0.9, index: 0 },
      ],
      dispose: async () => {},
    });

    const step = createNerStep(
      [{ alias: 'multilang-q8', id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' }],
      mockLoadModel,
    );
    const ctx = {
      text: 'Jan',
      segments: [{ text: 'Jan', offset: 0 }],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = await step(ctx);
    expect(result.entities[0].source).toBe('multilang-q8');
  });
});

describe('nerStep token budget', () => {
  it('splits over-budget segments so every infer call fits the token budget', async () => {
    const seen = [];
    const stub = {
      infer: async (text) => { seen.push(text); return []; },
      countTokens: async (t) => t.length,
      dispose: async () => {},
    };
    const segment = { text: ('ab '.repeat(400)).trim(), offset: 100 };
    const step = createNerStep([{ alias: 'a', id: 'x', dtype: 'q8' }], async () => stub);
    await step({ text: '', segments: [segment], entities: [] });

    for (const t of seen) expect(t.length).toBeLessThanOrEqual(512);
    expect(seen.join('')).toBe(segment.text);
  });

  it('maps per-piece entity offsets back to the original segment coordinates', async () => {
    const stub = {
      infer: async () => [{ entity_group: 'X', start: 0, end: 2, score: 0.9, word: 'ab' }],
      countTokens: async (t) => t.length,
      dispose: async () => {},
    };
    const segment = { text: ('ab '.repeat(400)).trim(), offset: 100 };
    const step = createNerStep([{ alias: 'a', id: 'x', dtype: 'q8' }], async () => stub);
    const result = await step({ text: '', segments: [segment], entities: [] });

    const starts = result.entities.map((e) => e.start);
    expect(new Set(starts).size).toBeGreaterThan(1);
    for (const e of result.entities) {
      expect(e.end - e.start).toBe(2);
      expect(e.start).toBeGreaterThanOrEqual(100);
      expect(segment.text.slice(e.start - 100, e.end - 100)).toBe('ab');
    }
  });

  it('does not split when the handle lacks countTokens (fallback)', async () => {
    const seen = [];
    const stub = {
      infer: async (text) => { seen.push(text); return []; },
      dispose: async () => {},
    };
    const segment = { text: ('ab '.repeat(400)).trim(), offset: 100 };
    const step = createNerStep([{ alias: 'a', id: 'x', dtype: 'q8' }], async () => stub);
    await step({ text: '', segments: [segment], entities: [] });

    expect(seen).toEqual([segment.text]);
  });
});
