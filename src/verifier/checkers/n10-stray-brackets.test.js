import { describe, it, expect } from 'vitest';
import { checkStrayBrackets } from './n10-stray-brackets.js';

describe('checkStrayBrackets (N-10)', () => {
  it('flags a bracketed placeholder that is not a valid token', () => {
    const findings = checkStrayBrackets('Sygn. akt [sygnatura] z dnia...');
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-10');
    expect(findings[0].quote).toBe('[sygnatura]');
  });

  it('does not flag a real, valid token literal', () => {
    expect(checkStrayBrackets('Powód [PERSON_NAME_1] wnosi o.')).toEqual([]);
  });

  it('does not flag a valid case-annotated token', () => {
    expect(checkStrayBrackets('Doręczono [PERSON_NAME_1|C].')).toEqual([]);
  });

  it('flags multiple distinct stray brackets', () => {
    const findings = checkStrayBrackets('[uzupełnić] oraz [do ustalenia] w piśmie.');
    expect(findings).toHaveLength(2);
  });

  it('returns no findings for text with no brackets', () => {
    expect(checkStrayBrackets('Zwykły tekst bez nawiasów.')).toEqual([]);
  });
});
