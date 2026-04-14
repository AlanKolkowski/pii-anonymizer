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

describe('normalizeWhitespace', () => {
  it('passes text through unchanged (no-op)', () => {
    const ctx = {
      text: '  hello\n\nworld  ',
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = normalizeWhitespace(ctx);
    expect(result.text).toBe('  hello\n\nworld  ');
    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('normalizeWhitespace');
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
      debug: [],
    };
    const result = segmentStep(ctx);
    expect(result.segments).toEqual([{ text: 'short text', offset: 0 }]);
    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('segment');
    expect(result.debug[0].out.segmentCount).toBe(1);
  });

  it('chunks long text into multiple segments', () => {
    // Two 700-char paragraphs — second break at 1404 exceeds maxChars from start
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
      debug: [],
    };
    const result = segmentStep(ctx);
    expect(result.segments.length).toBeGreaterThan(1);
    // Each segment should have correct offset
    for (const seg of result.segments) {
      expect(text.slice(seg.offset, seg.offset + seg.text.length)).toBe(seg.text);
    }
  });
});

describe('snapStep', () => {
  it('snaps entity boundaries to word boundaries', () => {
    // "Jan" is already at word boundaries
    const text = 'notariusz Jan Kowalski';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 10, end: 13, score: 0.9 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = snapStep(ctx);
    expect(result.entities[0].start).toBe(10);
    expect(result.entities[0].end).toBe(13);
    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('snap');
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
      debug: [],
    };
    const result = filterStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].end).toBe(10);
    expect(result.debug[0].step).toBe('filter');
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
      debug: [],
    };
    const result = dedupStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.95);
    expect(result.debug[0].step).toBe('dedup');
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
      debug: [],
    };
    const result = mergeStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(24);
    expect(result.debug[0].step).toBe('merge');
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
      debug: [],
    };
    const result = regexStep(ctx);
    // Should have original entity + the email
    expect(result.entities.length).toBe(2);
    const email = result.entities.find(e => e.entity_group === 'EMAIL_ADDRESS');
    expect(email).toBeDefined();
    expect(email.score).toBe(1.0);
    expect(result.debug[0].step).toBe('regex');
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
      debug: [],
    };
    const result = tokenizeStep(ctx);
    expect(result.anonymized).toContain('[PERSON_NAME_1]');
    expect(result.anonymized).toContain('[LOCATION_1]');
    expect(result.anonymized).not.toContain('Jan Kowalski');
    expect(result.legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
    expect(result.debug[0].step).toBe('tokenize');
  });
});

describe('rescanStep', () => {
  it('catches remaining PII in anonymized text', () => {
    // Simulate: tokenize found "Jan Kowalski" but missed "Jana Kowalskiego" (declined form)
    const ctx = {
      text: 'original text',
      segments: [],
      entities: [],
      anonymized: 'Pismo od Jana Kowalskiego do sądu',
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      debug: [],
    };
    const result = rescanStep(ctx);
    expect(result.anonymized).toContain('[PERSON_NAME_1]');
    expect(result.anonymized).not.toContain('Jana Kowalskiego');
    expect(result.debug[0].step).toBe('rescan');
  });
});
