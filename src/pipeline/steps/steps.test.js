import { describe, it, expect } from 'vitest';
import { normalizeWhitespace } from './preprocess.js';
import { segmentStep } from './segment.js';
import { snapStep } from './snap.js';
import { filterStep } from './filter.js';
import { dedupStep } from './dedup.js';
import { mergeStep } from './merge.js';
import { regexStep } from './regex.js';
import { rescanStep } from './rescan.js';
import { tokenizeStep } from './tokenize.js';
import { createNerStep } from './ner.js';
import { allowedTypesStep } from './allowed-types.js';

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

describe('filterStep', () => {
  it('removes oversized entities', () => {
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
    const result = filterStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].end).toBe(10);
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
});

describe('mergeStep', () => {
  it('merges adjacent address entities', () => {
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
});

describe('regexStep', () => {
  it('adds regex-detected entities to existing entities', () => {
    const text = 'Contact jan@test.com for details';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.9 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = regexStep(ctx);
    expect(result.entities.length).toBe(2);
    const email = result.entities.find(e => e.entity_group === 'EMAIL_ADDRESS');
    expect(email).toBeDefined();
    expect(email.score).toBe(1.0);
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

describe('rescanStep', () => {
  it('catches remaining PII in anonymized text', () => {
    const ctx = {
      text: 'original text',
      segments: [],
      entities: [],
      anonymized: 'Pismo od Jana Kowalskiego do sądu',
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
    };
    const result = rescanStep(ctx);
    expect(result.anonymized).toContain('[PERSON_NAME_1]');
    expect(result.anonymized).not.toContain('Jana Kowalskiego');
  });
});

describe('allowedTypesStep', () => {
  it('keeps entities with known types', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9 },
        { entity_group: 'EMAIL_ADDRESS', start: 20, end: 35, score: 1.0 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = allowedTypesStep(ctx);
    expect(result.entities).toHaveLength(2);
  });

  it('drops entities with unknown types', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9 },
        { entity_group: 'UNKNOWN_TYPE', start: 20, end: 30, score: 0.7 },
        { entity_group: 'MISC', start: 40, end: 50, score: 0.6 },
      ],
      anonymized: '',
      legend: {},
    };
    const result = allowedTypesStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
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

    const step = createNerStep([{ id: 'mock-model', dtype: 'q8' }], mockLoadModel);
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

    const step = createNerStep([{ id: 'mock-model', dtype: 'q8' }], mockLoadModel);
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
      [{ id: 'model-a', dtype: 'q8' }, { id: 'model-b', dtype: 'q8' }],
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
});
