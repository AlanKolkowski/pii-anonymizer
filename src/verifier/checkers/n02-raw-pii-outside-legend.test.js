import { describe, it, expect } from 'vitest';
import { checkRawPiiOutsideLegend } from './n02-raw-pii-outside-legend.js';

describe('checkRawPiiOutsideLegend (N-2)', () => {
  it('flags a PESEL not present among legend values', () => {
    const findings = checkRawPiiOutsideLegend('PESEL powoda: 92071314764', {});
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-2');
    expect(findings[0].quote).toBe('92071314764');
    expect(findings[0].severity).toBe('wysoka');
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

  it('flags a LLM-computed amount outside the legend as informational, not high severity', () => {
    const findings = checkRawPiiOutsideLegend('Suma odsetek wynosi 12 345,67 zł.', {});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('informacyjna');
    expect(findings[0].message).toContain('FINANCIAL_AMOUNT');
  });

  it('does not flag an amount in the legend that differs only by NBSP vs plain space', () => {
    const legend = { '[FINANCIAL_AMOUNT_1]': '51 890,74 zł' };
    const text = 'Zadłużenie: 51\u00a0890,74 zł.';
    expect(checkRawPiiOutsideLegend(text, legend)).toEqual([]);
  });
});
