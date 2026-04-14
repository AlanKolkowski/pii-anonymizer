import { describe, it, expect } from 'vitest';
import { normalizeWhitespace } from './preprocess.js';
import { segmentStep } from './segment.js';

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
