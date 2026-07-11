import { describe, it, expect } from 'vitest';
import { checkGenderAgreement } from './n03-gender-agreement.js';

describe('checkGenderAgreement (N-3)', () => {
  it('flags a feminine role next to a masculine-looking name', () => {
    const findings = checkGenderAgreement('Powódka Jan Kowalski wnosi o zapłatę.');
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-3');
    expect(findings[0].quote).toBe('Powódka Jan');
  });

  it('flags a masculine role next to a feminine-looking name', () => {
    const findings = checkGenderAgreement('Pozwany Anna Kowalska wnosi o oddalenie.');
    expect(findings).toHaveLength(1);
  });

  it('does not flag matching gender (masculine role, masculine name)', () => {
    expect(checkGenderAgreement('Powód Jan Kowalski wnosi o zapłatę.')).toEqual([]);
  });

  it('does not flag matching gender (feminine role, feminine name)', () => {
    expect(checkGenderAgreement('Powódka Anna Kowalska wnosi o zapłatę.')).toEqual([]);
  });

  it('does not flag male names ending in "-a" from the exception list', () => {
    expect(checkGenderAgreement('Powód Kuba Nowak wnosi o zapłatę.')).toEqual([]);
    expect(checkGenderAgreement('Powód Barnaba Wiśniewski wnosi o zapłatę.')).toEqual([]);
  });

  it('does not flag an epicene role (świadek) regardless of the following name', () => {
    expect(checkGenderAgreement('Świadek Anna Kowalska zeznała, że...')).toEqual([]);
  });
});
