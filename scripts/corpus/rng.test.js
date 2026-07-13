import { createRng, int, pick, pickN, shuffle, digits, chance } from './rng.mjs';

describe('createRng: determinism', () => {
  it('same string seed produces the same sequence every time', () => {
    const a = createRng('holdout/doc/007');
    const b = createRng('holdout/doc/007');
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('same integer seed produces the same sequence every time', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('different seeds produce different sequences', () => {
    const a = createRng('dev/pool');
    const b = createRng('holdout/pool');
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('every draw is in [0, 1)', () => {
    const rng = createRng('range-check');
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('int', () => {
  it('stays within [min, max] inclusive over many draws', () => {
    const rng = createRng('int-bounds');
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 2000; i++) {
      const v = int(rng, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      if (v === 3) sawMin = true;
      if (v === 7) sawMax = true;
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it('degenerates correctly when min === max', () => {
    const rng = createRng('int-degenerate');
    for (let i = 0; i < 20; i++) expect(int(rng, 5, 5)).toBe(5);
  });
});

describe('pick / pickN / shuffle', () => {
  it('pick always returns a member of the array', () => {
    const rng = createRng('pick-membership');
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(rng, arr));
  });

  it('pickN returns n distinct elements from the source array', () => {
    const rng = createRng('pickn-distinct');
    const arr = ['a', 'b', 'c', 'd', 'e'];
    const got = pickN(rng, arr, 3);
    expect(got.length).toBe(3);
    expect(new Set(got).size).toBe(3);
    for (const v of got) expect(arr).toContain(v);
  });

  it('pickN throws when asked for more distinct elements than exist', () => {
    const rng = createRng('pickn-overflow');
    expect(() => pickN(rng, ['a', 'b'], 3)).toThrow();
  });

  it('shuffle does not mutate the input array', () => {
    const rng = createRng('shuffle-purity');
    const arr = [1, 2, 3, 4, 5];
    const copy = arr.slice();
    shuffle(rng, arr);
    expect(arr).toEqual(copy);
  });

  it('shuffle is a permutation (same multiset of elements)', () => {
    const rng = createRng('shuffle-permutation');
    const arr = [1, 2, 3, 4, 5, 6];
    const out = shuffle(rng, arr);
    expect([...out].sort()).toEqual([...arr].sort());
  });
});

describe('digits', () => {
  it('produces a fixed-length numeric string, zero-padding preserved', () => {
    const rng = createRng('digits-length');
    for (let i = 0; i < 50; i++) {
      const d = digits(rng, 11);
      expect(d.length).toBe(11);
      expect(/^\d{11}$/.test(d)).toBe(true);
    }
  });
});

describe('chance', () => {
  it('p=0 never fires, p=1 always fires', () => {
    const rng = createRng('chance-edges');
    for (let i = 0; i < 50; i++) {
      expect(chance(rng, 0)).toBe(false);
      expect(chance(rng, 1)).toBe(true);
    }
  });

  it('p=0.5 fires roughly half the time over a large sample', () => {
    const rng = createRng('chance-distribution');
    let trues = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (chance(rng, 0.5)) trues++;
    expect(trues / N).toBeGreaterThan(0.4);
    expect(trues / N).toBeLessThan(0.6);
  });
});
