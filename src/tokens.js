// Canonical token grammar (SHARED-FOUNDATION-DESIGN.md S1 §3.2), replacing the
// three divergent copies in anonymizer.js, mcp/listings.js and
// ui/deanon-workspace/index.js. Pure functions only, zero dependencies, no
// exported RegExp instance (a shared `g`-flagged pattern would leak lastIndex
// state across independent callers) — every call builds its own regex.
//
// Optional case annotation (decyzja 17, PRODUCT-DECISIONS.md): `[TYP_IDX]` or
// `[TYP_IDX|PRZYPADEK]`. The parser is strict — `PRZYPADEK` must be exactly one
// of the seven case codes below, or the whole bracketed span is not a token at
// all (falls back to plain text), never a token with garbage trailing content.
// "Ms" is listed before "M" so the alternation's first successful branch is the
// two-letter code, not a one-letter partial match that only succeeds via
// backtracking once "]" fails to follow.
const CASE_CODES = 'Ms|M|D|C|B|N|W';
const TOKEN_SOURCE = String.raw`\[([A-Z][A-Z0-9_]*_\d+)(?:\|(${CASE_CODES}))?\]`;

function tokenRegex() {
  return new RegExp(TOKEN_SOURCE, 'g');
}

function fullTokenRegex() {
  return new RegExp(`^${TOKEN_SOURCE}$`);
}

export function containsToken(text) {
  return tokenRegex().test(text);
}

// tokenId always excludes the case annotation, so `[${tokenId}]` reconstructs
// the canonical legend key regardless of whether the source text carried a
// case hint — legend lookups never need to know about annotations.
export function findTokens(text) {
  const out = [];
  for (const match of text.matchAll(tokenRegex())) {
    const tokenId = match[1];
    const entry = { token: `[${tokenId}]`, tokenId, type: tokenType(tokenId), index: match.index };
    if (match[2]) entry.case = match[2];
    out.push(entry);
  }
  return out;
}

export function splitTokenParts(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(tokenRegex())) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const tokenId = match[1];
    parts.push({ token: `[${tokenId}]`, tokenId, type: tokenType(tokenId) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function isTokenLiteral(str) {
  return fullTokenRegex().test(str);
}

export function tokenType(tokenId) {
  return tokenId.replace(/_\d+$/, '');
}
