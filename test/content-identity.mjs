// Shared "shown = sent/copied/exported" identity helper (SHARED-FOUNDATION-
// DESIGN.md S3 §5). Test-only code — never imported by any production
// artifact — used by the bridge (C-BR-7), the verifier (C-VER-4), and DOCX
// (sameBytes, C-DOCX-10) to make three independently-specified guarantees
// comparable instead of each test defining "hash of the text" differently.
//
// Rules (§5.2), load-bearing for the guarantee, not just style:
//   1. Zero normalization — no trimming, no line-ending unification, no
//      NFC/NFD. The whole point is comparing raw bytes as they really are.
//   2. When a caller extracts `shown` from the DOM, it must use
//      `textContent` — never `innerText`, which normalizes whitespace
//      according to layout and would silently defeat rule 1.
//   3. USE ONLY ON SYNTHETIC DATA (test-data/synthetic/, golden DOCX
//      fixtures): assertShownEqualsSent's failure message embeds up to 40
//      characters of the compared content as diagnostic context.
import { webcrypto } from 'node:crypto';

const cryptoImpl = globalThis.crypto ?? webcrypto;

export async function sha256HexUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function firstDifferenceIndex(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : len;
}

function contextAround(str, index, radius = 20) {
  const start = Math.max(0, index - radius);
  const end = Math.min(str.length, index + radius);
  return str.slice(start, end);
}

export async function assertShownEqualsSent({ shown, sent, label }) {
  const rawEqual = shown === sent;
  const [shownHash, sentHash] = await Promise.all([sha256HexUtf8(shown), sha256HexUtf8(sent)]);
  const hashEqual = shownHash === sentHash;

  if (rawEqual && hashEqual) return;

  const diffIndex = Math.max(0, firstDifferenceIndex(shown, sent));
  const prefix = label ? `${label}: ` : '';
  throw new Error(
    `${prefix}pokazane ≠ wysłane (assertShownEqualsSent)\n` +
    `  raw equal: ${rawEqual}, hash equal: ${hashEqual}\n` +
    `  shown hash: ${shownHash}\n` +
    `  sent  hash: ${sentHash}\n` +
    `  first difference at index ${diffIndex} (shown.length=${shown.length}, sent.length=${sent.length})\n` +
    `  shown context: ${JSON.stringify(contextAround(shown, diffIndex))}\n` +
    `  sent  context: ${JSON.stringify(contextAround(sent, diffIndex))}`,
  );
}
