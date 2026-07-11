import { describe, it, expect } from 'vitest';
import { checkSignatureVariants } from './n07-signature-variants.js';

describe('checkSignatureVariants (N-7)', () => {
  it('flags two near-identical signatures differing by one digit', () => {
    const text = 'W sprawie o sygn. akt I C 123/26 ... jak wskazano w I C 123/25.';
    const findings = checkSignatureVariants(text);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.checker === 'N-7')).toBe(true);
  });

  it('does not flag a signature repeated identically', () => {
    const text = 'Sygn. akt I C 123/26. Dalej powołuje się na I C 123/26.';
    expect(checkSignatureVariants(text)).toEqual([]);
  });

  it('does not flag two genuinely different, unrelated signatures', () => {
    const text = 'Sygn. akt I C 123/26 oraz XVII AmC 9999/20.';
    expect(checkSignatureVariants(text)).toEqual([]);
  });

  it('returns no findings when only one signature appears', () => {
    expect(checkSignatureVariants('Sygn. akt I C 123/26.')).toEqual([]);
  });

  it('returns no findings for text with no signatures', () => {
    expect(checkSignatureVariants('Zwykły tekst bez sygnatur.')).toEqual([]);
  });
});
