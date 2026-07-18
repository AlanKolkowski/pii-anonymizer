// SS3.2 (FLEKSJA-IMPL-PLAN.md): deriveAttested — a pure inversion of the
// EXISTING `seen` map (src/anonymizer.js's buildTokenMap/buildTokenMapMulti
// output), never a new collection point. `seen` already retains every raw
// surface variant of a name seen across ingested sources — this module only
// reads it back out, grouped by token. RAM-only, no I/O, no persistence;
// the caller decides the result's lifetime (SS3.2: "wynik żyje WYŁĄCZNIE w
// RAM"). Zero changes to anonymizer.js/tokenization — this runs strictly
// after the fact, on data tokenization already produced.
//
// Minimal variant only (SS3.2: "wariant minimalny... wystarcza dla
// PERSON_NAME") — no source-context attribution for non-PERSON_NAME types
// (SS3.3's attributeAttestedCase); that is explicitly out of this turn's
// scope.

/**
 * @param {Record<string,string>|null|undefined} seen - "TYPE::rawValue" -> "[TYPE_N]"
 * @returns {Record<string,string[]>} token -> deduplicated raw surface forms seen for it
 */
export function deriveAttested(seen) {
  const byToken = new Map();
  for (const [key, token] of Object.entries(seen ?? {})) {
    const sep = key.indexOf('::');
    if (sep === -1) continue; // malformed key (no type separator) — skip, never throws
    const value = key.slice(sep + 2);
    if (!byToken.has(token)) byToken.set(token, new Set());
    byToken.get(token).add(value);
  }
  const out = {};
  for (const [token, forms] of byToken) out[token] = [...forms];
  return out;
}
