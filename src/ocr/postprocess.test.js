import { boxesToText, meanConfidence } from './postprocess.js';

function box(text, x, y, w = 100, h = 20, confidence = 0.95) {
  return { text, confidence, box: { x, y, w, h } };
}

describe('boxesToText', () => {
  it('returns empty string for no boxes', () => {
    expect(boxesToText([])).toBe('');
  });

  it('orders single-line boxes left-to-right', () => {
    const boxes = [box('world', 200, 100), box('Hello', 50, 100)];
    expect(boxesToText(boxes)).toBe('Hello world');
  });

  it('orders multi-line boxes top-to-bottom', () => {
    const boxes = [
      box('first', 50, 100),
      box('second', 50, 200),
      box('third', 50, 300),
    ];
    expect(boxesToText(boxes)).toBe('first\nsecond\nthird');
  });

  it('groups boxes into the same line when their y-centers overlap by line height', () => {
    // Two boxes 5 px apart vertically — same line.
    const boxes = [
      box('Jan', 50, 100, 60, 20),
      box('Kowalski', 130, 105, 100, 20),
    ];
    expect(boxesToText(boxes)).toBe('Jan Kowalski');
  });

  it('separates lines whose y-centers differ by more than a line height', () => {
    const boxes = [
      box('A', 50, 100, 30, 20),
      box('B', 50, 140, 30, 20),
    ];
    expect(boxesToText(boxes)).toBe('A\nB');
  });

  it('drops boxes with empty text', () => {
    const boxes = [box('', 50, 100), box('x', 100, 100)];
    expect(boxesToText(boxes)).toBe('x');
  });
});

describe('meanConfidence', () => {
  it('returns null for empty input', () => {
    expect(meanConfidence([])).toBeNull();
  });

  it('returns the mean confidence', () => {
    const boxes = [box('a', 0, 0, 0, 0, 0.8), box('b', 0, 0, 0, 0, 0.6)];
    expect(meanConfidence(boxes)).toBeCloseTo(0.7, 5);
  });
});
