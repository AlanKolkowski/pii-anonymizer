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

  describe('Block: paragraph boundary', () => {
    it('blocks R3 merge when there is a double newline between segments', () => {
      const text = '1.\n\nPismo z dnia.';
      const ctx = makeCtx(text, [
        { text: '1.', offset: 0 },
        { text: 'Pismo z dnia.', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '1.', offset: 0 },
        { text: 'Pismo z dnia.', offset: 4 },
      ]);
    });

    it('blocks merge when double newline has whitespace between newlines', () => {
      const text = '1. \n \n Pismo.';
      const ctx = makeCtx(text, [
        { text: '1. ', offset: 0 },
        { text: 'Pismo.', offset: 7 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });
  });

  describe('R1a: dictionary Cat A (always merge)', () => {
    it('merges "adw." followed by uppercase name', () => {
      const text = 'adw. Kowalski';
      const ctx = makeCtx(text, [
        { text: 'adw. ', offset: 0 },
        { text: 'Kowalski', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'adw. Kowalski', offset: 0 }]);
    });

    it('merges "ul." followed by a street name', () => {
      const text = 'ul. Mickiewicza 5';
      const ctx = makeCtx(text, [
        { text: 'ul. ', offset: 0 },
        { text: 'Mickiewicza 5', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'ul. Mickiewicza 5', offset: 0 }]);
    });

    it('matches case-insensitively', () => {
      const text = 'Ul. Różana';
      const ctx = makeCtx(text, [
        { text: 'Ul. ', offset: 0 },
        { text: 'Różana', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'Ul. Różana', offset: 0 }]);
    });

    it('matches multi-word suffix "r.pr."', () => {
      const text = 'r.pr. Jan Nowak';
      const ctx = makeCtx(text, [
        { text: 'r.pr. ', offset: 0 },
        { text: 'Jan Nowak', offset: 6 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'r.pr. Jan Nowak', offset: 0 }]);
    });

    it('merges "ds." followed by uppercase noun (never sentence-final)', () => {
      const text = 'Kierownik ds. Marketingu odpowiada';
      const ctx = makeCtx(text, [
        { text: 'Kierownik ds. ', offset: 0 },
        { text: 'Marketingu odpowiada', offset: 14 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Kierownik ds. Marketingu odpowiada', offset: 0 },
      ]);
    });

    it('merges "m.in." followed by uppercase (never sentence-final)', () => {
      const text = 'dotyczy m.in. Jana Kowalskiego';
      const ctx = makeCtx(text, [
        { text: 'dotyczy m.in. ', offset: 0 },
        { text: 'Jana Kowalskiego', offset: 14 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'dotyczy m.in. Jana Kowalskiego', offset: 0 },
      ]);
    });

    it('merges "tj." followed by uppercase', () => {
      const text = 'należność tj. Pozostałą kwotę';
      const ctx = makeCtx(text, [
        { text: 'należność tj. ', offset: 0 },
        { text: 'Pozostałą kwotę', offset: 14 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'należność tj. Pozostałą kwotę', offset: 0 },
      ]);
    });

    it('merges "tzw." followed by uppercase', () => {
      const text = 'tzw. Klauzula abuzywna';
      const ctx = makeCtx(text, [
        { text: 'tzw. ', offset: 0 },
        { text: 'Klauzula abuzywna', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'tzw. Klauzula abuzywna', offset: 0 },
      ]);
    });

    it('merges "tzn." followed by uppercase', () => {
      const text = 'sygnatura tzn. Dział I';
      const ctx = makeCtx(text, [
        { text: 'sygnatura tzn. ', offset: 0 },
        { text: 'Dział I', offset: 15 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'sygnatura tzn. Dział I', offset: 0 },
      ]);
    });

    it('merges "np." followed by uppercase', () => {
      const text = 'dokumenty np. Umowa sprzedaży';
      const ctx = makeCtx(text, [
        { text: 'dokumenty np. ', offset: 0 },
        { text: 'Umowa sprzedaży', offset: 14 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'dokumenty np. Umowa sprzedaży', offset: 0 },
      ]);
    });

    it('does NOT merge when paragraph break is present', () => {
      const text = 'ul.\n\nKowalski';
      const ctx = makeCtx(text, [
        { text: 'ul.', offset: 0 },
        { text: 'Kowalski', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });
  });

  describe('R1b: dictionary Cat B (merge only if lowercase follows)', () => {
    it('merges "r." when followed by lowercase', () => {
      const text = '12 września 2023 r. na rachunek';
      const ctx = makeCtx(text, [
        { text: '12 września 2023 r. ', offset: 0 },
        { text: 'na rachunek', offset: 20 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '12 września 2023 r. na rachunek', offset: 0 },
      ]);
    });

    it('does NOT merge "r." when followed by uppercase (real sentence end)', () => {
      const text = 'Zmarł w 2020 r. Jego syn odziedziczył';
      const ctx = makeCtx(text, [
        { text: 'Zmarł w 2020 r. ', offset: 0 },
        { text: 'Jego syn odziedziczył', offset: 16 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('merges "ust." followed by digit', () => {
      const text = '§ 4 ust. 1 umowy';
      const ctx = makeCtx(text, [
        { text: '§ 4 ust. ', offset: 0 },
        { text: '1 umowy', offset: 9 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '§ 4 ust. 1 umowy', offset: 0 },
      ]);
    });

    it('merges "sp." with "z o.o." (lowercase z follows)', () => {
      const text = 'firma ABC sp. z o.o. powstała';
      const ctx = makeCtx(text, [
        { text: 'firma ABC sp. ', offset: 0 },
        { text: 'z o.o. ', offset: 14 },
        { text: 'powstała', offset: 21 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'firma ABC sp. z o.o. powstała', offset: 0 },
      ]);
    });

    it('does NOT merge "sp. z o.o." when uppercase sentence follows', () => {
      const text = 'firma ABC sp. z o.o. Następnie zatrudnił';
      const ctx = makeCtx(text, [
        { text: 'firma ABC sp. ', offset: 0 },
        { text: 'z o.o. ', offset: 14 },
        { text: 'Następnie zatrudnił', offset: 21 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'firma ABC sp. z o.o. ', offset: 0 },
        { text: 'Następnie zatrudnił', offset: 21 },
      ]);
    });
  });

  describe('R2: unknown-abbreviation heuristic', () => {
    it('merges unknown "xyz." followed by lowercase', () => {
      const text = 'skrót xyz. niski';
      const ctx = makeCtx(text, [
        { text: 'skrót xyz. ', offset: 0 },
        { text: 'niski', offset: 11 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'skrót xyz. niski', offset: 0 }]);
    });

    it('does NOT merge unknown "xyz." followed by uppercase', () => {
      const text = 'skrót xyz. Wielkie';
      const ctx = makeCtx(text, [
        { text: 'skrót xyz. ', offset: 0 },
        { text: 'Wielkie', offset: 11 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('does NOT merge when previous segment does not end with word+dot', () => {
      const text = 'Pierwsze zdanie? drugie';
      const ctx = makeCtx(text, [
        { text: 'Pierwsze zdanie? ', offset: 0 },
        { text: 'drugie', offset: 17 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
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
