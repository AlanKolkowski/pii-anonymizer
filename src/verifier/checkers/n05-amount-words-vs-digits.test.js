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

  it('fails safe (no finding) when a stray unrecognized word appears, even if that means missing a real mismatch', () => {
    // "sto" (100) would parse fine alone, but an unrecognized word now
    // aborts the whole comparison instead of being silently skipped -- a
    // digit amount of 150 would mismatch a skip-and-continue parse of "sto"
    // (100), so a passing result here proves the parse actually aborted
    // rather than coincidentally agreeing.
    expect(checkAmountWordsVsDigits('150 zł (słownie: sto hakuna-matata 00/100)')).toEqual([]);
  });

  it('does not flag amounts over a million: "milion" is outside the lexicon, so parsing aborts instead of silently dropping the word', () => {
    // Regression for a real false positive: silently skipping "milion" used
    // to parse this phrase down to 250 000, flagging a high-severity
    // mismatch against a correct 1 250 000 zł amount. CHF/EUR sums in
    // frankowe cases routinely exceed one million.
    const text = '1 250 000,00 zł (słownie: jeden milion dwieście pięćdziesiąt tysięcy złotych 00/100)';
    expect(checkAmountWordsVsDigits(text)).toEqual([]);
  });

  it('does not flag amounts using "miliony" or "miliard" either', () => {
    expect(checkAmountWordsVsDigits('2 000 000,00 zł (słownie: dwa miliony złotych 00/100)')).toEqual([]);
    expect(checkAmountWordsVsDigits('1 000 000 000,00 zł (słownie: jeden miliard złotych 00/100)')).toEqual([]);
  });

  it('still detects a real mismatch well within the supported 0-999 999 range', () => {
    const findings = checkAmountWordsVsDigits('900 000 zł (słownie: osiemset tysięcy złotych)');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('900000 zł');
    expect(findings[0].message).toContain('800000 zł');
  });
});
