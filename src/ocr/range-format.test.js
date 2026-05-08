import { formatOcrRanges } from './range-format.js';

describe('formatOcrRanges', () => {
  it('returns null for an empty list', () => {
    expect(formatOcrRanges([])).toBeNull();
  });

  it('renders a single page with singular noun', () => {
    expect(formatOcrRanges([2])).toBe('strona 2');
  });

  it('renders a single contiguous range', () => {
    expect(formatOcrRanges([3, 4, 5, 6, 7])).toBe('strony 3–7');
  });

  it('renders two non-contiguous singles', () => {
    expect(formatOcrRanges([2, 5])).toBe('strony 2, 5');
  });

  it('mixes singles and ranges', () => {
    expect(formatOcrRanges([1, 3, 5, 6, 7])).toBe('strony 1, 3, 5–7');
  });

  it('renders "wszystkie strony" when totalPages is given and matches', () => {
    expect(formatOcrRanges([1, 2, 3], 3)).toBe('wszystkie strony');
  });

  it('does not collapse to "wszystkie strony" when not all pages are listed', () => {
    expect(formatOcrRanges([1, 3], 3)).toBe('strony 1, 3');
  });

  it('sorts unsorted input', () => {
    expect(formatOcrRanges([5, 1, 3])).toBe('strony 1, 3, 5');
  });

  it('ignores duplicates', () => {
    expect(formatOcrRanges([2, 2, 3])).toBe('strony 2–3');
  });
});
