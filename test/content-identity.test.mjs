import { describe, it, expect } from 'vitest';
import { sha256HexUtf8, sameBytes, assertShownEqualsSent } from './content-identity.mjs';

describe('sha256HexUtf8', () => {
  it('matches the known SHA-256 test vector for the empty string', async () => {
    expect(await sha256HexUtf8('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known SHA-256 test vector for "abc"', async () => {
    expect(await sha256HexUtf8('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('returns lowercase hex', async () => {
    const hash = await sha256HexUtf8('Zażółć gęślą jaźń');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the UTF-8 bytes, not the UTF-16 code units — differs for visually similar strings', async () => {
    const a = await sha256HexUtf8('Toruń');
    const b = await sha256HexUtf8('Torun');
    expect(a).not.toBe(b);
  });

  it('is deterministic', async () => {
    const text = 'Powód Jan Kowalski wnosi o zapłatę.';
    expect(await sha256HexUtf8(text)).toBe(await sha256HexUtf8(text));
  });
});

describe('sameBytes', () => {
  it('is true for identical byte arrays', () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('is true for two empty arrays', () => {
    expect(sameBytes(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it('is false when lengths differ', () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('is false when a single byte differs', () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toBe(false);
  });
});

describe('assertShownEqualsSent', () => {
  it('resolves without throwing when shown and sent are identical', async () => {
    await expect(assertShownEqualsSent({ shown: 'tekst', sent: 'tekst', label: 'ok' })).resolves.toBeUndefined();
  });

  it('throws on any difference — zero normalization, trailing whitespace counts', async () => {
    await expect(assertShownEqualsSent({ shown: 'tekst', sent: 'tekst ', label: 'test' }))
      .rejects.toThrow();
  });

  it('throws on a line-ending-only difference (\\n vs \\r\\n) — no normalization', async () => {
    await expect(assertShownEqualsSent({ shown: 'a\nb', sent: 'a\r\nb' })).rejects.toThrow();
  });

  it('reports the first difference index and ±20-char context in the error message', async () => {
    const shown = 'Powód Jan Kowalski wnosi o zapłatę kwoty 100 zł.';
    const sent = 'Powód Jan Kowalski wnosi o zapłatę kwoty 200 zł.';
    let error;
    try {
      await assertShownEqualsSent({ shown, sent, label: 'kwota' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toContain('kwota:');
    expect(error.message).toMatch(/first difference at index \d+/);
    expect(error.message).toContain('shown hash:');
    expect(error.message).toContain('sent  hash:');
  });

  it('reports differing lengths when sent is a strict prefix of shown', async () => {
    let error;
    try {
      await assertShownEqualsSent({ shown: 'abcdef', sent: 'abc' });
    } catch (e) {
      error = e;
    }
    expect(error.message).toContain('shown.length=6');
    expect(error.message).toContain('sent.length=3');
  });

  it('works without a label', async () => {
    await expect(assertShownEqualsSent({ shown: 'a', sent: 'b' })).rejects.toThrow(/pokazane ≠ wysłane/);
  });
});
