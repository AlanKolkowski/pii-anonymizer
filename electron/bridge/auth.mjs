// Pure HMAC-SHA-256 challenge-response handshake (MCP-BRIDGE-DESIGN.md §4.3,
// MOST-IMPL-PLAN.md §3 M2, O-3). Zero I/O: every export is a pure
// transformation over strings/buffers via node:crypto. This is deliberately
// NOT the `\\.\pipe\` transport — that's pipe-server.mjs / pipe-client.mjs,
// a BUILD-phase task (see the report handed back with this change): those
// files will be thin wrappers moving the frames built here over the wire,
// so this module can be fully unit-tested today without any socket, and
// reused unchanged once the real pipe exists.
//
// Wire schema (unchanged from the design doc):
//   S->C: { t: 'hello',   nonceS, proto: 1 }
//   C->S: { t: 'auth',    nonceC, mac: HMAC(secret, 'pii-b1-c2s' || nonceS || nonceC) }
//   S->C: { t: 'auth-ok', mac: HMAC(secret, 'pii-b1-s2c' || nonceC || nonceS) }
// The secret never appears in a frame — only nonces and MACs cross the wire
// (verified byte-for-byte in auth.test.js).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PROTO_VERSION = 1;
export const SECRET_BYTES = 32;
export const NONCE_BYTES = 32;
export const CONTEXT_C2S = 'pii-b1-c2s';
export const CONTEXT_S2C = 'pii-b1-s2c';

export function generateSecret() {
  return randomBytes(SECRET_BYTES).toString('hex');
}

export function generateNonce() {
  return randomBytes(NONCE_BYTES).toString('hex');
}

function hmacHex(secretHex, context, ...parts) {
  const mac = createHmac('sha256', Buffer.from(secretHex, 'hex'));
  mac.update(context, 'utf8');
  for (const part of parts) mac.update(part, 'utf8');
  return mac.digest('hex');
}

export function computeClientMac(secretHex, nonceS, nonceC) {
  return hmacHex(secretHex, CONTEXT_C2S, nonceS, nonceC);
}

export function computeServerMac(secretHex, nonceC, nonceS) {
  return hmacHex(secretHex, CONTEXT_S2C, nonceC, nonceS);
}

// Constant-time comparison of two hex MAC digests. Never throws — every
// malformed shape (wrong type, empty, mismatched length) fails closed the
// same way instead of raising, which matters here specifically because the
// input can come from an unauthenticated peer: a comparison that throws on
// garbage is one more thing every call site has to remember to catch, and a
// forgotten catch would be a crash-based DoS at best and a behavioural
// oracle at worst. Length alone leaks nothing secret (HMAC-SHA-256 digests
// are always 32 bytes for both sides), so rejecting a length mismatch
// up front is safe, not a shortcut around timing-safety.
export function macEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let bufA, bufB;
  try {
    bufA = Buffer.from(a, 'hex');
    bufB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// --- Frame-level helpers ---------------------------------------------------
// Building/verifying the three frames directly lets a test run the whole
// handshake in memory (no socket) and lets the future pipe-server.mjs /
// pipe-client.mjs be thin: they just move these plain objects over the wire
// instead of re-implementing the protocol next to the transport code.

export function serverCreateHello() {
  return { t: 'hello', nonceS: generateNonce(), proto: PROTO_VERSION };
}

export function clientCreateAuth(secretHex, helloMsg) {
  if (helloMsg?.t !== 'hello' || typeof helloMsg.nonceS !== 'string') {
    throw new Error('invalid hello frame');
  }
  const nonceC = generateNonce();
  return { t: 'auth', nonceC, mac: computeClientMac(secretHex, helloMsg.nonceS, nonceC) };
}

// Returns { ok: true, authOk } or { ok: false, reason }. Never throws on
// attacker-controlled input — a malformed or forged auth frame is just a
// failed handshake, not an exception every caller has to remember to catch.
export function serverVerifyAuth(secretHex, nonceS, authMsg) {
  if (authMsg?.t !== 'auth' || typeof authMsg.nonceC !== 'string' || typeof authMsg.mac !== 'string') {
    return { ok: false, reason: 'malformed-auth-frame' };
  }
  const expected = computeClientMac(secretHex, nonceS, authMsg.nonceC);
  if (!macEquals(authMsg.mac, expected)) {
    return { ok: false, reason: 'mac-mismatch' };
  }
  return { ok: true, authOk: { t: 'auth-ok', mac: computeServerMac(secretHex, authMsg.nonceC, nonceS) } };
}

// Client-side verification of the server's auth-ok reply — the step that
// lets a legitimate client detect and disconnect from an impostor server
// BEFORE sending any tool frame (MCP-BRIDGE-DESIGN.md §4.3 / §9.2 SB row
// "podszycie się pod serwer potoku").
export function clientVerifyAuthOk(secretHex, nonceC, nonceS, authOkMsg) {
  if (authOkMsg?.t !== 'auth-ok' || typeof authOkMsg.mac !== 'string') return false;
  const expected = computeServerMac(secretHex, nonceC, nonceS);
  return macEquals(authOkMsg.mac, expected);
}
