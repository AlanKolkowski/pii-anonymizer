// N-10 (LOCAL-VERIFIER-DESIGN.md §4.1): square brackets left in the output
// that are NOT a token per the shared grammar (S1) — e.g. "[sygnatura]", a
// placeholder the LLM invented instead of using the real anonymization
// token. Complements N-1 (which only catches genuine, unresolved tokens):
// this one catches bracketed text that never was a token at all.
import { isTokenLiteral } from '../../tokens.js';

const BRACKET_PATTERN = /\[[^[\]\n]*\]/g;

export function checkStrayBrackets(text) {
  const findings = [];
  for (const match of text.matchAll(BRACKET_PATTERN)) {
    const literal = match[0];
    if (isTokenLiteral(literal)) continue;
    findings.push({
      checker: 'N-10',
      severity: 'informacyjna',
      message: `Nawias kwadratowy niebędący tokenem: „${literal}".`,
      index: match.index,
      length: literal.length,
      quote: literal,
    });
  }
  return findings;
}
