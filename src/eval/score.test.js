import { describe, it, expect } from 'vitest';
import { computeSegmentMetrics } from './score.js';

describe('computeSegmentMetrics', () => {
  it('returns P=R=F1=1 for identical segmentations', () => {
    const segs = [
      { start: 0, end: 10, text: 'one' },
      { start: 10, end: 20, text: 'two' },
    ];
    const m = computeSegmentMetrics(segs, segs);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.tp).toBe(2);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
    expect(m.tpPartial).toBe(0);
  });

  it('counts missing expected as FN', () => {
    const expected = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const predicted = [
      { start: 0, end: 10, text: 'a' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(1);
    expect(m.fn).toBe(1);
    expect(m.fp).toBe(0);
  });

  it('counts extra predicted as FP', () => {
    const expected = [
      { start: 0, end: 10, text: 'a' },
    ];
    const predicted = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(1);
    expect(m.fp).toBe(1);
    expect(m.fn).toBe(0);
  });

  it('counts a shifted boundary as partial (FP+FN, tpPartial=1)', () => {
    // Same coverage, different boundaries.
    const expected = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const predicted = [
      { start: 0, end: 12, text: 'a+' },
      { start: 12, end: 20, text: '-b' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(0);
    expect(m.tpPartial).toBe(2);
    expect(m.fp).toBe(2);
    expect(m.fn).toBe(2);
  });

  it('returns zeroes for empty inputs', () => {
    const m = computeSegmentMetrics([], []);
    expect(m.tp).toBe(0);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });
});
