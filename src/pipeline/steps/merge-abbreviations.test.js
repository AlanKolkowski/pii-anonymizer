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

  describe('Block: next segment starts a new list item', () => {
    it('does NOT merge when prev ends with Cat A abbreviation but next starts with a numbered marker', () => {
      const text = '1. Kopia umowy z dnia 1 marca 2022 r.\n  2. Zestawienie zaległości.';
      const ctx = makeCtx(text, [
        { text: '1. Kopia umowy z dnia 1 marca 2022 r.', offset: 0 },
        { text: '  2. Zestawienie zaległości.', offset: 38 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '1. Kopia umowy z dnia 1 marca 2022 r.', offset: 0 },
        { text: '  2. Zestawienie zaległości.', offset: 38 },
      ]);
    });

    it('does NOT merge when next is a lone list marker like "2. " (after sentencex splits markers standalone)', () => {
      // Sentencex often emits standalone markers "2. ", "3. ". With a Cat-A
      // abbreviation at the tail of the previous item, R1a would otherwise
      // pull them in.
      const text = 'Kopia umowy z dnia 1 marca 2022 r.\n  2. ';
      const ctx = makeCtx(text, [
        { text: 'Kopia umowy z dnia 1 marca 2022 r.\n  ', offset: 0 },
        { text: '2. ', offset: 37 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('does NOT merge when prev ends with word-dot but next starts with a numbered marker', () => {
      const text = '2. Zestawienie (wyciąg).\n  3. Kopia wezwania.';
      const ctx = makeCtx(text, [
        { text: '2. Zestawienie (wyciąg).', offset: 0 },
        { text: '  3. Kopia wezwania.', offset: 25 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('does NOT merge when next starts with a letter marker like "a)"', () => {
      const text = 'Wynagrodzenie: 100 zł.\n  a) netto,\n  b) brutto.';
      const ctx = makeCtx(text, [
        { text: 'Wynagrodzenie: 100 zł.', offset: 0 },
        { text: '  a) netto,', offset: 23 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });

    it('still allows R3 merge when prev IS a lone list marker (next does not start with a marker)', () => {
      const text = '1. Kopia umowy.';
      const ctx = makeCtx(text, [
        { text: '1. ', offset: 0 },
        { text: 'Kopia umowy.', offset: 3 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: '1. Kopia umowy.', offset: 0 }]);
    });

    it('does not misfire on mid-text numeric tokens like "2.10.2024" (not a list marker)', () => {
      const text = 'Data wpłaty. 2.10.2024 – rozmowa telefoniczna.';
      const ctx = makeCtx(text, [
        { text: 'Data wpłaty.', offset: 0 },
        { text: '2.10.2024 – rozmowa telefoniczna.', offset: 13 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      // "2.10.2024" has "2." followed by "1" (no whitespace) → NOT treated as list marker;
      // the existing R2 (word-dot + digit-start continuation) still merges them.
      expect(result.segments.length).toBe(1);
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

  describe('continuation punctuation (R1b/R2 extension)', () => {
    it('merges "tel." when followed by colon', () => {
      const text = 'Kontakt\nTel.: +48 22 456 78 90';
      const ctx = makeCtx(text, [
        { text: 'Kontakt\nTel.', offset: 0 },
        { text: ': +48 22 456 78 90', offset: 12 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Kontakt\nTel.: +48 22 456 78 90', offset: 0 },
      ]);
    });

    it('merges "r." when followed by comma', () => {
      const text = '30 stycznia 2025 r., nr DEC/O/ŁD/2025';
      const ctx = makeCtx(text, [
        { text: '30 stycznia 2025 r.', offset: 0 },
        { text: ', nr DEC/O/ŁD/2025', offset: 19 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '30 stycznia 2025 r., nr DEC/O/ŁD/2025', offset: 0 },
      ]);
    });

    it('merges "r." when followed by opening paren', () => {
      const text = '1 marca 2022 r. (zwaną dalej Umową)';
      const ctx = makeCtx(text, [
        { text: '1 marca 2022 r. ', offset: 0 },
        { text: '(zwaną dalej Umową)', offset: 16 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '1 marca 2022 r. (zwaną dalej Umową)', offset: 0 },
      ]);
    });

    it('merges "r." when followed by en-dash', () => {
      const text = '10 kwietnia 2025 r. – 31 lipca 2025 r.';
      const ctx = makeCtx(text, [
        { text: '10 kwietnia 2025 r. ', offset: 0 },
        { text: '– 31 lipca 2025 r.', offset: 20 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '10 kwietnia 2025 r. – 31 lipca 2025 r.', offset: 0 },
      ]);
    });

    it('merges "pon." when followed by en-dash (date range)', () => {
      const text = 'pon.–pt.';
      const ctx = makeCtx(text, [
        { text: 'pon.', offset: 0 },
        { text: '–pt.', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'pon.–pt.', offset: 0 }]);
    });

    it('merges "obr." when followed by slash', () => {
      const text = 'powyżej 600 obr./min.';
      const ctx = makeCtx(text, [
        { text: 'powyżej 600 obr.', offset: 0 },
        { text: '/min.', offset: 16 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'powyżej 600 obr./min.', offset: 0 },
      ]);
    });
  });

  describe('R1a: new CAT_A entries', () => {
    it('merges "tel." followed by colon+number', () => {
      const text = 'Tel.: +48 601 234 567';
      const ctx = makeCtx(text, [
        { text: 'Tel.', offset: 0 },
        { text: ': +48 601 234 567', offset: 4 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Tel.: +48 601 234 567', offset: 0 },
      ]);
    });

    it('merges "sygn." followed by uppercase reference', () => {
      const text = 'sygn. KL/2025/ŁD/00291';
      const ctx = makeCtx(text, [
        { text: 'sygn. ', offset: 0 },
        { text: 'KL/2025/ŁD/00291', offset: 6 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'sygn. KL/2025/ŁD/00291', offset: 0 },
      ]);
    });

    it('merges "Rep." followed by uppercase', () => {
      const text = 'Rep. A nr 1042/2025';
      const ctx = makeCtx(text, [
        { text: 'Rep. ', offset: 0 },
        { text: 'A nr 1042/2025', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Rep. A nr 1042/2025', offset: 0 },
      ]);
    });

    it('merges "rad." followed by name', () => {
      const text = 'lek. rad. Pawła Sikorskiego';
      const ctx = makeCtx(text, [
        { text: 'lek. rad. ', offset: 0 },
        { text: 'Pawła Sikorskiego', offset: 10 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'lek. rad. Pawła Sikorskiego', offset: 0 },
      ]);
    });

    it('merges "zam." followed by address', () => {
      const text = 'Pan Robert Zając, zam. ul. Topolowa 3';
      const ctx = makeCtx(text, [
        { text: 'Pan Robert Zając, zam. ', offset: 0 },
        { text: 'ul. Topolowa 3', offset: 23 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Pan Robert Zając, zam. ul. Topolowa 3', offset: 0 },
      ]);
    });
  });

  describe('R1b: new CAT_B entries (legal codes)', () => {
    it('merges "k.c." followed by comma', () => {
      const text = 'art. 560 § 1 k.c., kupujący';
      const ctx = makeCtx(text, [
        { text: 'art. 560 § 1 k.c.', offset: 0 },
        { text: ', kupujący', offset: 17 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'art. 560 § 1 k.c., kupujący', offset: 0 },
      ]);
    });

    it('merges "k.p.c." followed by lowercase', () => {
      const text = 'art. 477 k.p.c. mówi o terminie';
      const ctx = makeCtx(text, [
        { text: 'art. 477 k.p.c. ', offset: 0 },
        { text: 'mówi o terminie', offset: 16 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'art. 477 k.p.c. mówi o terminie', offset: 0 },
      ]);
    });
  });

  describe('R4: multi-letter company/legal abbreviations (S.A., P.P., etc.)', () => {
    it('merges "Bank X S." + "A." split by sentencex', () => {
      const text = 'Bank: Bank Zachodni WBK S.A.\nWłaściciel';
      const ctx = makeCtx(text, [
        { text: 'Bank: Bank Zachodni WBK S.', offset: 0 },
        { text: 'A.\n', offset: 26 },
        { text: 'Właściciel', offset: 29 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments[0].text).toBe('Bank: Bank Zachodni WBK S.A.\n');
      expect(result.segments[1].text).toBe('Właściciel');
    });

    it('merges "PZU S." + "A."', () => {
      const text = 'PZU S.A.';
      const ctx = makeCtx(text, [
        { text: 'PZU S.', offset: 0 },
        { text: 'A.', offset: 6 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([{ text: 'PZU S.A.', offset: 0 }]);
    });

    it('does NOT merge when next segment has multi-letter word starting with uppercase', () => {
      const text = 'Zdanie A. Następne zdanie';
      const ctx = makeCtx(text, [
        { text: 'Zdanie A.', offset: 0 },
        { text: 'Następne zdanie', offset: 10 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments.length).toBe(2);
    });
  });

  describe('R3 extension: list marker at end of segment', () => {
    it('merges when prev ends with "\\n  3." marker', () => {
      const text = 'na kwotę 45 000,00 zł.\n  3. Kopię pełnomocnictwa';
      const ctx = makeCtx(text, [
        { text: 'na kwotę 45 000,00 zł.\n  3. ', offset: 0 },
        { text: 'Kopię pełnomocnictwa', offset: 28 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'na kwotę 45 000,00 zł.\n  3. Kopię pełnomocnictwa', offset: 0 },
      ]);
    });

    it('merges when prev ends with "§ 1." paragraph marker', () => {
      const text = '§ 1. PRZEDMIOT UMOWY';
      const ctx = makeCtx(text, [
        { text: '§ 1. ', offset: 0 },
        { text: 'PRZEDMIOT UMOWY', offset: 5 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: '§ 1. PRZEDMIOT UMOWY', offset: 0 },
      ]);
    });

    it('merges when prev ends with label+marker "Załączniki:\\n  1."', () => {
      const text = 'Załączniki:\n  1. Kopia umowy';
      const ctx = makeCtx(text, [
        { text: 'Załączniki:\n  1. ', offset: 0 },
        { text: 'Kopia umowy', offset: 17 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Załączniki:\n  1. Kopia umowy', offset: 0 },
      ]);
    });
  });

  describe('R5: single-letter name initial', () => {
    it('merges "T." followed by uppercase surname', () => {
      const text = 'Spłata pożyczki – T. Wiśniewski';
      const ctx = makeCtx(text, [
        { text: 'Spłata pożyczki – T. ', offset: 0 },
        { text: 'Wiśniewski', offset: 21 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      expect(result.segments).toEqual([
        { text: 'Spłata pożyczki – T. Wiśniewski', offset: 0 },
      ]);
    });

    it('does NOT merge when next word starts with lowercase (handled by R2 anyway)', () => {
      const text = 'Koniec zdania. następne';
      const ctx = makeCtx(text, [
        { text: 'Koniec zdania. ', offset: 0 },
        { text: 'następne', offset: 15 },
      ]);
      const result = mergeAbbreviationsStep(ctx);
      // R2 handles this - merges
      expect(result.segments).toEqual([
        { text: 'Koniec zdania. następne', offset: 0 },
      ]);
    });
  });

  describe('leader-dot segments (signature lines)', () => {
    it('does not treat leader dots as an abbreviation', () => {
      const text = '..........................\nJan Kowalski';
      const ctx = makeCtx(text, [
        { text: '..........................\n', offset: 0 },
        { text: 'Jan Kowalski', offset: 27 },
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
