import { describe, it, expect } from 'vitest';
import { crc32, createCrc32 } from './crc32.js';

const encoder = new TextEncoder();

// Deterministic pseudo-random byte generator (mulberry32) so "randomly split"
// coverage is reproducible across runs instead of depending on Math.random().
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pseudoRandomBytes(length, seed) {
  const rand = mulberry32(seed);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}

describe('crc32', () => {
  it('returns 0 for an empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('matches the standard CRC-32 check value for "123456789"', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('matches a known check value for a longer ASCII string', () => {
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is sensitive to a single-byte change', () => {
    const a = crc32(encoder.encode('123456789'));
    const b = crc32(encoder.encode('123456780'));
    expect(a).not.toBe(b);
  });
});

describe('createCrc32', () => {
  it('digest() of a single update matches crc32() of the same bytes', () => {
    const data = pseudoRandomBytes(4096, 1);
    const streaming = createCrc32();
    streaming.update(data);
    expect(streaming.digest()).toBe(crc32(data));
  });

  it('matches crc32() when fed via many small chunks split at random points', () => {
    const data = pseudoRandomBytes(5000, 42);
    const rand = mulberry32(7);
    const streaming = createCrc32();
    let offset = 0;
    while (offset < data.length) {
      const remaining = data.length - offset;
      const chunkSize = Math.max(1, Math.floor(rand() * Math.min(37, remaining)) + 1);
      streaming.update(data.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    }
    expect(streaming.digest()).toBe(crc32(data));
  });

  it('matches crc32() when a chunk boundary falls exactly at the end', () => {
    const data = pseudoRandomBytes(64, 3);
    const streaming = createCrc32();
    streaming.update(data.subarray(0, 64));
    expect(streaming.digest()).toBe(crc32(data));
  });

  it('handles zero-length updates without affecting the digest', () => {
    const data = pseudoRandomBytes(200, 9);
    const streaming = createCrc32();
    streaming.update(data.subarray(0, 100));
    streaming.update(new Uint8Array());
    streaming.update(data.subarray(100));
    expect(streaming.digest()).toBe(crc32(data));
  });

  it('returns the empty-input value when nothing was ever fed', () => {
    expect(createCrc32().digest()).toBe(0);
  });
});
