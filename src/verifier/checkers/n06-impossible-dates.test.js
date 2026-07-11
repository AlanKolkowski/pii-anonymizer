import { describe, it, expect } from 'vitest';
import { checkImpossibleDates } from './n06-impossible-dates.js';

describe('checkImpossibleDates (N-6)', () => {
  it('flags February 31st (named month form)', () => {
    const findings = checkImpossibleDates('Wezwanie z dnia 31 lutego 2026 r.');
    expect(findings.some((f) => f.message.includes('niemożliwa'))).toBe(true);
  });

  it('flags February 30th in a non-leap year (numeric form)', () => {
    const findings = checkImpossibleDates('Termin: 30.02.2025');
    expect(findings.some((f) => f.message.includes('niemożliwa'))).toBe(true);
  });

  it('accepts February 29th in a leap year', () => {
    expect(checkImpossibleDates('29 lutego 2024 r.')).toEqual([]);
  });

  it('flags February 29th in a non-leap year', () => {
    const findings = checkImpossibleDates('29 lutego 2025 r.');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('accepts a normal valid date', () => {
    expect(checkImpossibleDates('Toruń, dnia 10 lipca 2026 r.')).toEqual([]);
  });

  it('flags a month number outside 1-12', () => {
    const findings = checkImpossibleDates('15.13.2026');
    expect(findings.some((f) => f.message.includes('miesiąc'))).toBe(true);
  });

  it('flags a "termin" date chronologically before the document date', () => {
    const text = 'Toruń, dnia 10 lipca 2026 r. Termin płatności upływa 10 czerwca 2026 r.';
    const findings = checkImpossibleDates(text);
    expect(findings.some((f) => f.message.includes('wypada przed datą pisma'))).toBe(true);
  });

  it('does not flag a later, sensible termin date', () => {
    const text = 'Toruń, dnia 10 lipca 2026 r. Termin płatności upływa 10 sierpnia 2026 r.';
    expect(checkImpossibleDates(text)).toEqual([]);
  });

  it('returns no findings for text with no dates', () => {
    expect(checkImpossibleDates('Tekst bez żadnych dat.')).toEqual([]);
  });
});
