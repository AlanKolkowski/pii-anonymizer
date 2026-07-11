// N-1 (LOCAL-VERIFIER-DESIGN.md §4.1): tokens still visible in text that has
// already been through deanonymization — formalizes the existing
// countTokenStats "unresolved" counter (src/ui/deanon-workspace/index.js) as
// a standalone finding. Any token findTokens still sees here is by
// definition unresolved: a resolved one would already have been replaced by
// its value and would no longer look like a token.
import { findTokens } from '../../tokens.js';

export function checkUnresolvedTokens(text) {
  return findTokens(text).map((t) => ({
    checker: 'N-1',
    severity: 'wysoka',
    message: `Token „${t.token}" pozostał nierozwiązany w tekście wynikowym.`,
    index: t.index,
    length: t.token.length,
    quote: t.token,
  }));
}
