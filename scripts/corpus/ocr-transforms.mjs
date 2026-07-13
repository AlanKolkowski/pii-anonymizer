// OCR-artifact transforms for the corpus 2.0 "Klasy OCR" quota (manifest
// ocrClasses: glyphSubstitution, spacedOut, joined, lineWrap — diacritics
// has its own dedicated module, diacritics.mjs). Mirrors the four non-
// diacritic attack vectors already proven in the dev corpus
// (adw_23_ocr_podmiany, adw_24_ocr_rozstrzelone, adw_25_ocr_sklejone,
// adw_26_ocr_przenoszenie) so holdout measures the same failure classes on
// fresh values, not new failure classes.
import { int } from './rng.mjs';

/** Digit->letter-lookalike substitution ('1'->'l', '0'->'O'), the direction
 * the app's own OCR-tolerant identifier scanner expects (src/anonymizer.js
 * digitPositions()/toDigitChar() fold 'l'->'1' and 'O'->'0' before checksum
 * validation — so a corrupted identifier is still detected and validated,
 * exactly R-1's contract). Only digits are eligible; a fraction of them
 * flip, never all (same "mixture within one document" principle as
 * diacritics — a real low-DPI scan doesn't corrupt every digit uniformly). */
export function substituteGlyphs(rng, text, { fraction = 0.4, minFlips = 1 } = {}) {
  const MAP = { '1': 'l', '0': 'O' };
  const chars = [...text];
  const eligible = [];
  for (let i = 0; i < chars.length; i++) if (MAP[chars[i]] !== undefined) eligible.push(i);
  if (eligible.length === 0) return text;
  const count = Math.min(eligible.length, Math.max(minFlips, Math.round(eligible.length * fraction)));
  const pool = eligible.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = new Set(pool.slice(0, count));
  return chars.map((ch, i) => (chosen.has(i) ? MAP[ch] : ch)).join('');
}

/** Spaced-out ("rozstrzelone") rendering: one space between every letter
 * within a word, three spaces between words — matches dev's own
 * "K o n r a d   Ż u r a w s k i" convention exactly (the triple space marks
 * where a real word boundary was, distinguishing it from an in-word gap). */
export function spacedOut(text) {
  return text
    .split(' ')
    .map((word) => [...word].join(' '))
    .join('   ');
}

/** Joined ("sklejone") rendering: all whitespace removed, matching dev's
 * "KonradŻurawski" / "ul.Polnej3/5" convention. */
export function joinWords(text) {
  return text.replace(/[ \t]+/g, '');
}

/** Hard line-wrap ("przenoszenie") in the middle of a single word, matching
 * dev's "Żuraw-\nskiego" / "Mroczek-Sowiń-ska" convention: a hyphen followed
 * by a hard newline, inserted at a deterministic interior position (never
 * the first or last two characters, so the break never produces a
 * degenerate one-letter fragment). Only meaningful for words of at least 6
 * characters — shorter words are returned unchanged (nothing sensible to
 * wrap), so callers should pick eligible values themselves. */
export function hyphenatedLineBreak(rng, word) {
  if (word.length < 6) return word;
  const pos = int(rng, 2, word.length - 3);
  return `${word.slice(0, pos)}-\n${word.slice(pos)}`;
}
