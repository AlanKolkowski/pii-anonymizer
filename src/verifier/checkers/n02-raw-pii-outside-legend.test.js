import { describe, it, expect } from 'vitest';
import { checkRawPiiOutsideLegend } from './n02-raw-pii-outside-legend.js';

describe('checkRawPiiOutsideLegend (N-2)', () => {
  it('flags a PESEL not present among legend values', () => {
    const findings = checkRawPiiOutsideLegend('PESEL powoda: 92071314764', {});
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-2');
    expect(findings[0].quote).toBe('92071314764');
  });

  it('does not flag a value that IS present in the legend', () => {
    const legend = { '[PERSON_IDENTIFIER_1]': '92071314764' };
    expect(checkRawPiiOutsideLegend('PESEL powoda: 92071314764', legend)).toEqual([]);
  });

  it('flags an email address not in the legend', () => {
    const findings = checkRawPiiOutsideLegend('Kontakt: nowy@przyklad.pl', {});
    expect(findings.some((f) => f.quote === 'nowy@przyklad.pl')).toBe(true);
  });

  it('returns no findings for text with no PII-shaped substrings', () => {
    expect(checkRawPiiOutsideLegend('Zwykły tekst pisma bez danych.', {})).toEqual([]);
  });

  it('defaults to an empty legend when none is passed', () => {
    const findings = checkRawPiiOutsideLegend('PESEL: 92071314764');
    expect(findings).toHaveLength(1);
  });
});
