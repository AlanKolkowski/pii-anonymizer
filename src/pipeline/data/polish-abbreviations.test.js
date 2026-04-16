import { describe, it, expect } from 'vitest';
import { CAT_A, CAT_B } from './polish-abbreviations.js';

describe('polish-abbreviations dictionary', () => {
  it('CAT_A contains common titles', () => {
    expect(CAT_A.has('adw.')).toBe(true);
    expect(CAT_A.has('prof.')).toBe(true);
    expect(CAT_A.has('ul.')).toBe(true);
  });

  it('CAT_B contains common context-dependent abbreviations', () => {
    expect(CAT_B.has('r.')).toBe(true);
    expect(CAT_B.has('sp.')).toBe(true);
    expect(CAT_B.has('z o.o.')).toBe(true);
    expect(CAT_B.has('art.')).toBe(true);
    expect(CAT_B.has('itp.')).toBe(true);
  });

  it('CAT_A contains never-sentence-final connectors', () => {
    expect(CAT_A.has('ds.')).toBe(true);
    expect(CAT_A.has('m.in.')).toBe(true);
    expect(CAT_A.has('tj.')).toBe(true);
    expect(CAT_A.has('tzw.')).toBe(true);
    expect(CAT_A.has('tzn.')).toBe(true);
    expect(CAT_A.has('np.')).toBe(true);
  });

  it('all tokens are lowercase', () => {
    for (const token of [...CAT_A, ...CAT_B]) {
      expect(token).toBe(token.toLowerCase());
    }
  });

  it('excludes non-dot abbreviations', () => {
    for (const nonDot of ['kg', 'km', 'cm', 'zł', 'dr', 'mgr', 'nr', 'pkt']) {
      expect(CAT_A.has(nonDot)).toBe(false);
      expect(CAT_B.has(nonDot)).toBe(false);
    }
  });

  it('CAT_A and CAT_B are disjoint', () => {
    for (const token of CAT_A) {
      expect(CAT_B.has(token)).toBe(false);
    }
  });
});
