import { describe, it, expect } from 'vitest';
import { mergeAbbreviationsStep } from './merge-abbreviations.js';

function makeCtx(text, segments) {
  return { text, segments, entities: [], anonymized: '', legend: {} };
}

describe('mergeAbbreviationsStep', () => {
  describe('R3: list marker', () => {
    it('merges a lone arabic-numeral marker with the next segment', () => {
      const text = '1. Pismo z dnia 15 kwietnia.';
      const ctx = makeCtx(text, [
        { text: '1. ', offset: 0 },
        { text: 'Pismo z dnia 15 kwietnia.', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '1. Pismo z dnia 15 kwietnia.', offset: 0 },
      ]);
    });

    it('merges a lone Roman-numeral marker with the next segment', () => {
      const text = 'I. PODSTAWA PRAWNA';
      const ctx = makeCtx(text, [
        { text: 'I. ', offset: 0 },
        { text: 'PODSTAWA PRAWNA', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'I. PODSTAWA PRAWNA', offset: 0 },
      ]);
    });

    it('merges a lone single-letter marker with the next segment', () => {
      const text = 'a. pierwszy punkt.';
      const ctx = makeCtx(text, [
        { text: 'a. ', offset: 0 },
        { text: 'pierwszy punkt.', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'a. pierwszy punkt.', offset: 0 },
      ]);
    });

    it('does NOT merge a segment that is not a standalone marker', () => {
      const text = 'To jest zdanie 1. Następne zdanie.';
      const ctx = makeCtx(text, [
        { text: 'To jest zdanie 1. ', offset: 0 },
        { text: 'Następne zdanie.', offset: 18 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'To jest zdanie 1. ', offset: 0 },
        { text: 'Następne zdanie.', offset: 18 },
      ]);
    });
  });

  describe('empty/single segment passthrough', () => {
    it('returns empty segments unchanged', () => {
      const ctx = makeCtx('', []);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([]);
    });

    it('returns single segment unchanged', () => {
      const ctx = makeCtx('hello', [{ text: 'hello', offset: 0 }]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'hello', offset: 0 }]);
    });
  });
});
