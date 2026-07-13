import { createRng } from './rng.mjs';
import { substituteGlyphs, spacedOut, joinWords, hyphenatedLineBreak } from './ocr-transforms.mjs';
import { generatePesel, generateNip, generateIban } from './checksums.mjs';
import { findRegexEntities } from '../../src/anonymizer.js';

function manyRng(seedPrefix, n) {
  return Array.from({ length: n }, (_, i) => createRng(`${seedPrefix}/${i}`));
}

describe('substituteGlyphs', () => {
  it('never changes length and only touches 0/1 digits', () => {
    const rng = createRng('glyphs-length');
    const value = '85030712349';
    const out = substituteGlyphs(rng, value, { fraction: 1 });
    expect(out.length).toBe(value.length);
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== value[i]) {
        expect(value[i]).toMatch(/[01]/);
        expect(out[i]).toBe(value[i] === '1' ? 'l' : 'O');
      }
    }
  });

  it('is a no-op on a string with no 0/1 digits', () => {
    const rng = createRng('glyphs-noop');
    expect(substituteGlyphs(rng, 'ABCDEF-XYZ', { fraction: 1 })).toBe('ABCDEF-XYZ');
  });

  it('is deterministic for a given seed', () => {
    const a = substituteGlyphs(createRng('glyphs-det'), '10102030', { fraction: 0.5 });
    const b = substituteGlyphs(createRng('glyphs-det'), '10102030', { fraction: 0.5 });
    expect(a).toBe(b);
  });

  it('glyph-substituted PESEL/NIP/IBAN are still detected and checksum-validated by the app (R-1 contract)', () => {
    for (const rng of manyRng('glyphs-pesel-detect', 20)) {
      const pesel = generatePesel(rng);
      const corrupted = substituteGlyphs(rng, pesel, { fraction: 0.5 });
      if (corrupted === pesel) continue; // no eligible digit landed in this particular value; skip
      const text = `PESEL: ${corrupted}.`;
      const hit = findRegexEntities(text).find((e) => e.entity_group === 'PERSON_IDENTIFIER');
      expect(hit, `corrupted PESEL "${corrupted}" (from "${pesel}") not detected in "${text}"`).toBeTruthy();
      expect(hit.score).toBe(1.0);
    }

    for (const rng of manyRng('glyphs-iban-detect', 20)) {
      const { iban } = generateIban(rng);
      const corrupted = substituteGlyphs(rng, iban, { fraction: 0.5 });
      if (corrupted === iban) continue;
      const text = `Rachunek: ${corrupted}.`;
      const hit = findRegexEntities(text).find((e) => e.entity_group === 'BANK_ACCOUNT_IDENTIFIER');
      expect(hit, `corrupted IBAN "${corrupted}" (from "${iban}") not detected in "${text}"`).toBeTruthy();
    }
  });
});

describe('spacedOut', () => {
  it('matches the dev corpus convention: single space in-word, triple space between words', () => {
    expect(spacedOut('Konrad Żurawski')).toBe('K o n r a d   Ż u r a w s k i');
  });

  it('round-trips length predictably: n letters + (n-1) intra-word spaces + 3*(wordCount-1) inter-word spaces', () => {
    const value = 'Zakład Ubezpieczeń';
    const words = value.split(' ');
    const letterCount = words.join('').length;
    const expectedLength = letterCount + (letterCount - words.length) + 3 * (words.length - 1);
    expect(spacedOut(value).length).toBe(expectedLength);
  });
});

describe('joinWords', () => {
  it('removes all whitespace', () => {
    expect(joinWords('ul. Polnej 3/5')).toBe('ul.Polnej3/5');
    expect(joinWords('Konrad Żurawski')).toBe('KonradŻurawski');
  });

  it('is idempotent (already-joined text is unchanged)', () => {
    expect(joinWords('KonradŻurawski')).toBe('KonradŻurawski');
  });
});

describe('hyphenatedLineBreak', () => {
  it('inserts exactly one "-\\n" and preserves all original characters', () => {
    for (const rng of manyRng('linewrap', 50)) {
      const word = 'Żurawskiego';
      const wrapped = hyphenatedLineBreak(rng, word);
      expect(wrapped.replace('-\n', '')).toBe(word);
      expect(wrapped).toMatch(/^.+-\n.+$/s);
    }
  });

  it('never breaks at the very first or last two characters (no degenerate one-letter fragment)', () => {
    for (const rng of manyRng('linewrap-edges', 50)) {
      const wrapped = hyphenatedLineBreak(rng, 'Podgórskiemu');
      const [before, after] = wrapped.split('-\n');
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect(after.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves words shorter than 6 characters unchanged', () => {
    const rng = createRng('linewrap-short');
    expect(hyphenatedLineBreak(rng, 'Kos')).toBe('Kos');
    expect(hyphenatedLineBreak(rng, 'Adamk')).toBe('Adamk');
  });

  it('is deterministic for a given seed', () => {
    const a = hyphenatedLineBreak(createRng('linewrap-det'), 'Zdrojewskiego');
    const b = hyphenatedLineBreak(createRng('linewrap-det'), 'Zdrojewskiego');
    expect(a).toBe(b);
  });
});
