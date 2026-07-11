import { describe, it, expect } from 'vitest';
import { checkUnresolvedTokens } from './n01-unresolved-tokens.js';

describe('checkUnresolvedTokens (N-1)', () => {
  it('flags a token literal remaining in output text', () => {
    const findings = checkUnresolvedTokens('Pozwany [PERSON_NAME_3] wnosi o.');
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-1');
    expect(findings[0].quote).toBe('[PERSON_NAME_3]');
    expect(findings[0].index).toBe(8);
  });

  it('returns no findings for fully deanonymized text', () => {
    expect(checkUnresolvedTokens('Pozwany Jan Kowalski wnosi o.')).toEqual([]);
  });

  it('flags every unresolved token, in order', () => {
    const findings = checkUnresolvedTokens('[A_1] i [B_2]');
    expect(findings.map((f) => f.quote)).toEqual(['[A_1]', '[B_2]']);
  });
});
