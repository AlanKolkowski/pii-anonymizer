import {
  PROTO_VERSION,
  generateSecret,
  generateNonce,
  computeClientMac,
  computeServerMac,
  macEquals,
  serverCreateHello,
  clientCreateAuth,
  serverVerifyAuth,
  clientVerifyAuthOk,
} from './auth.mjs';

// MCP-BRIDGE-DESIGN.md §4.3 / MOST-IMPL-PLAN.md §3 M2 (O-3): mutual
// HMAC-SHA-256 challenge-response, entirely without I/O — no `\\.\pipe\`
// involved anywhere in this file. The real named-pipe transport
// (pipe-server.mjs / pipe-client.mjs) is a BUILD-phase task; this module is
// the transport-independent protocol core, testable (and tested here) as a
// full in-memory handshake.

describe('generateSecret / generateNonce', () => {
  it('produce 256-bit hex strings (64 hex chars) from node:crypto randomBytes', () => {
    expect(generateSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateNonce()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats across calls (CSPRNG, not a fixture)', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateSecret()));
    expect(secrets.size).toBe(20);
  });
});

describe('full handshake round-trip (happy path)', () => {
  it('lets a legitimate client and server complete the three-frame handshake', () => {
    const secret = generateSecret();

    const hello = serverCreateHello();
    expect(hello).toEqual({ t: 'hello', nonceS: expect.any(String), proto: PROTO_VERSION });

    const auth = clientCreateAuth(secret, hello);
    expect(auth.t).toBe('auth');
    expect(auth.mac).toBe(computeClientMac(secret, hello.nonceS, auth.nonceC));

    const serverResult = serverVerifyAuth(secret, hello.nonceS, auth);
    expect(serverResult.ok).toBe(true);
    expect(serverResult.authOk.t).toBe('auth-ok');

    expect(clientVerifyAuthOk(secret, auth.nonceC, hello.nonceS, serverResult.authOk)).toBe(true);
  });

  it('never puts the secret itself inside any of the three wire frames (byte-level check)', () => {
    const secret = generateSecret();
    const hello = serverCreateHello();
    const auth = clientCreateAuth(secret, hello);
    const serverResult = serverVerifyAuth(secret, hello.nonceS, auth);

    for (const frame of [hello, auth, serverResult.authOk]) {
      expect(JSON.stringify(frame)).not.toContain(secret);
    }
  });
});

describe('rejection paths (O-3: an impostor must be caught before any tool frame)', () => {
  it('server rejects an auth frame computed with the wrong secret', () => {
    const realSecret = generateSecret();
    const clientsWrongSecret = generateSecret();
    const hello = serverCreateHello();

    const auth = clientCreateAuth(clientsWrongSecret, hello);
    const result = serverVerifyAuth(realSecret, hello.nonceS, auth);

    expect(result).toEqual({ ok: false, reason: 'mac-mismatch' });
  });

  it('client refuses an auth-ok from an impostor server that does not know the secret', () => {
    const realSecret = generateSecret();
    const hello = serverCreateHello();
    const auth = clientCreateAuth(realSecret, hello);

    // The impostor cannot produce a valid auth-ok without the real secret —
    // simulate its best attempt: a syntactically valid frame computed with
    // whatever secret it guessed/fabricated.
    const impostorAuthOk = { t: 'auth-ok', mac: computeServerMac(generateSecret(), auth.nonceC, hello.nonceS) };

    expect(clientVerifyAuthOk(realSecret, auth.nonceC, hello.nonceS, impostorAuthOk)).toBe(false);
  });

  it('detects a single tampered character in the client nonce', () => {
    const secret = generateSecret();
    const hello = serverCreateHello();
    const auth = clientCreateAuth(secret, hello);
    const flipped = auth.nonceC[0] === '0' ? '1' : '0';
    const tampered = { ...auth, nonceC: flipped + auth.nonceC.slice(1) };

    expect(serverVerifyAuth(secret, hello.nonceS, tampered)).toEqual({ ok: false, reason: 'mac-mismatch' });
  });

  it('rejects malformed frames without throwing', () => {
    const secret = generateSecret();
    expect(serverVerifyAuth(secret, 'nonce', null)).toEqual({ ok: false, reason: 'malformed-auth-frame' });
    expect(serverVerifyAuth(secret, 'nonce', { t: 'auth' })).toEqual({ ok: false, reason: 'malformed-auth-frame' });
    expect(serverVerifyAuth(secret, 'nonce', { t: 'hello', nonceC: 'x', mac: 'y' })).toEqual({
      ok: false,
      reason: 'malformed-auth-frame',
    });
    expect(clientVerifyAuthOk(secret, 'a', 'b', null)).toBe(false);
    expect(clientVerifyAuthOk(secret, 'a', 'b', { t: 'hello' })).toBe(false);
  });

  it('clientCreateAuth refuses a malformed hello frame rather than crafting a MAC over garbage', () => {
    expect(() => clientCreateAuth('secret', { t: 'not-hello' })).toThrow();
    expect(() => clientCreateAuth('secret', null)).toThrow();
  });
});

describe('macEquals (constant-time comparison)', () => {
  it('returns true for identical hex digests', () => {
    const mac = computeClientMac(generateSecret(), 'a', 'b');
    expect(macEquals(mac, mac)).toBe(true);
  });

  it('returns false for a different digest of the same length, without throwing', () => {
    const a = computeClientMac(generateSecret(), 'a', 'b');
    const b = computeClientMac(generateSecret(), 'a', 'b');
    expect(() => macEquals(a, b)).not.toThrow();
    expect(macEquals(a, b)).toBe(false);
  });

  it('returns false (not a thrown RangeError) for mismatched lengths or non-string input', () => {
    expect(macEquals('ab', 'abcd')).toBe(false);
    expect(macEquals('', '')).toBe(false);
    expect(macEquals(null, 'abcd')).toBe(false);
    expect(macEquals(undefined, undefined)).toBe(false);
    expect(macEquals(123, 123)).toBe(false);
  });
});
