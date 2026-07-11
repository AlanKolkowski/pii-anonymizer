import { describe, it, expect } from 'vitest';
import { checkAmountWordsVsDigits } from './n05-amount-words-vs-digits.js';

describe('checkAmountWordsVsDigits (N-5)', () => {
  it('does not flag a correct simple amount (real fixture phrasing, pismo_01)', () => {
    expect(checkAmountWordsVsDigits('kwota 45 000,00 zł (słownie: czterdzieści pięć tysięcy złotych 00/100)')).toEqual([]);
  });

  it('does not flag a correct amount using genitive hundreds/tens (real fixture phrasing style)', () => {
    // pięćdziesiąt jeden (51) tysięcy -> 51000; ośmiuset (800, genitive) +
    // dziewięćdziesięciu (90, genitive) -> 890; total 51890.
    const text = 'zadłużenie: 51 890,74 zł (słownie: pięćdziesiąt jeden tysięcy ośmiuset dziewięćdziesięciu złotych 74/100)';
    expect(checkAmountWordsVsDigits(text)).toEqual([]);
  });

  it('flags LOCAL-VERIFIER-DESIGN.md\'s own illustrative mismatch example', () => {
    const findings = checkAmountWordsVsDigits('10 500 zł (słownie: dziesięć tysięcy złotych)');
    expect(findings).toHaveLength(1);
    expect(findings[0].checker).toBe('N-5');
    expect(findings[0].message).toContain('10500 zł');
    expect(findings[0].message).toContain('10000 zł');
  });

  it('flags a mismatch even with grosze present', () => {
    const findings = checkAmountWordsVsDigits('1 200,00 zł (słownie: tysiąc sto złotych 00/100)');
    expect(findings).toHaveLength(1);
  });

  it('does not flag when there is no amount-with-words pattern at all', () => {
    expect(checkAmountWordsVsDigits('Zwykły tekst pisma bez kwot słownie.')).toEqual([]);
  });

  it('handles a bare "tysiąc" (1000) without a leading "jeden"', () => {
    expect(checkAmountWordsVsDigits('1 000,00 zł (słownie: tysiąc złotych 00/100)')).toEqual([]);
  });

  it('does not flag when the words phrase has no recognizable numeral at all (fails safe, no guessing)', () => {
    expect(checkAmountWordsVsDigits('100 zł (słownie: nieczytelne odręcznie 00/100)')).toEqual([]);
  });

  it('tolerates a stray unrecognized word alongside otherwise-parseable numerals', () => {
    // "sto" (100) parses fine; the nonsense word is simply skipped rather
    // than aborting the whole comparison.
    expect(checkAmountWordsVsDigits('100 zł (słownie: sto hakuna-matata 00/100)')).toEqual([]);
  });
});
