import { describe, it, expect } from 'vitest';
import { sha256Hex } from './cache-orchestrator.js';

describe('sha256Hex', () => {
  it('produces the standard SHA-256 hex digest of a string', async () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(await sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces different digests for different inputs', async () => {
    const a = await sha256Hex('alpha');
    const b = await sha256Hex('beta');
    expect(a).not.toBe(b);
  });

  it('handles long inputs', async () => {
    const long = 'x'.repeat(100_000);
    const hash = await sha256Hex(long);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
