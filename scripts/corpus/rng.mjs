// Deterministic seeded PRNG for the corpus 2.0 generator (RECALL-90-DESIGN.md
// §3.4: "rozłączne przestrzenie seedów"). Pure integer arithmetic — no
// Math.random(), no Date.now() — so the exact same seed always produces the
// exact same sequence, on any machine, forever. That determinism is what
// lets `--pool=holdout` reproduce byte-identical output on re-run and lets
// dev/holdout use non-overlapping seed spaces instead of hoping two runs of
// Math.random() never collide.
//
// Algorithm: mulberry32 (public domain, tiny, no known statistical defects
// for this non-cryptographic use). Seeds are namespaced strings (e.g.
// "holdout/person/07") hashed to a 32-bit int via FNV-1a, so callers never
// have to hand-manage integer seed allocation — two different namespaced
// strings essentially never collide, and the same string always hashes the
// same way.

/** FNV-1a 32-bit hash of a string, used to turn readable seed labels into a
 * mulberry32 integer seed. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates a deterministic RNG function from a string or integer seed.
 * Calling the returned function advances the internal state and returns a
 * float in [0, 1). */
export function createRng(seed) {
  const intSeed = typeof seed === 'string' ? fnv1a(seed) : seed >>> 0;
  return mulberry32(intSeed);
}

/** Random integer in [min, max], inclusive on both ends. */
export function int(rng, min, max) {
  if (max < min) throw new Error(`int(): max ${max} < min ${min}`);
  return min + Math.floor(rng() * (max - min + 1));
}

/** Random element of a non-empty array. */
export function pick(rng, arr) {
  if (arr.length === 0) throw new Error('pick(): empty array');
  return arr[int(rng, 0, arr.length - 1)];
}

/** Random boolean, true with probability p (default 0.5). */
export function chance(rng, p = 0.5) {
  return rng() < p;
}

/** Fisher-Yates shuffle, returns a new array (does not mutate the input). */
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** n distinct elements of arr (sampling without replacement), order
 * randomized. Throws if n > arr.length — callers must size pools generously
 * enough that this never happens silently. */
export function pickN(rng, arr, n) {
  if (n > arr.length) {
    throw new Error(`pickN(): requested ${n} distinct elements from a pool of only ${arr.length}`);
  }
  return shuffle(rng, arr).slice(0, n);
}

/** Zero-padded random decimal digit string of the given length (leading
 * zeros allowed — these are identifier bodies, not numeric magnitudes). */
export function digits(rng, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += int(rng, 0, 9);
  return out;
}
