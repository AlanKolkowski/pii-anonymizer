// Disjointness guard between the dev corpus (test-data/adversarial) and the
// holdout corpus (test-data/adversarial-holdout) — RECALL-90-DESIGN.md
// §3.4 point 1: "twarda asercja rozłączności wartości (żadne nazwisko/
// PESEL/IBAN z dev nie występuje w holdout)".
//
// Scoped to entity types that carry identifying-value semantics — PERSON_NAME
// (nazwisko) and the identifier family (PESEL/dowód/paszport/prawo jazdy via
// PERSON_IDENTIFIER, NIP/REGON/KRS via ORGANIZATION_IDENTIFIER, IBAN/NRB via
// BANK_ACCOUNT_IDENTIFIER, VIN/rejestracja via VEHICLE_IDENTIFIER) — exactly
// the "nazwisko/PESEL/IBAN" examples in the design doc, extended to their
// natural siblings in the same family. Deliberately EXCLUDES
// ORGANIZATION_NAME (public institutions like courts or ZUS are singular
// real-world entities that legitimately recur in any Polish legal corpus —
// their reuse is not template memorization) and PERSON_ROLE_OR_TITLE
// (generic professional vocabulary, expected to overlap by design so B4's
// lexicon is actually exercised).
const IDENTIFYING_TYPES = new Set([
  'PERSON_NAME', 'PERSON_IDENTIFIER', 'ORGANIZATION_IDENTIFIER', 'BANK_ACCOUNT_IDENTIFIER', 'VEHICLE_IDENTIFIER',
]);

/** Collects every distinct identifying-value string across a list of built
 * documents (anything with an `.expected` array of {entity_group, text}). */
export function collectIdentifyingValues(builtDocs) {
  const values = new Set();
  for (const { expected } of builtDocs) {
    for (const e of expected) {
      if (IDENTIFYING_TYPES.has(e.entity_group)) values.add(e.text);
    }
  }
  return values;
}

/** Returns the list of holdout identifying values that also appear in
 * `devValues` (a Set, typically from collectIdentifyingValues() run over the
 * dev corpus). Empty array = disjoint, the contract is satisfied. */
export function findDisjointnessViolations(devValues, holdoutBuiltDocs) {
  const holdoutValues = collectIdentifyingValues(holdoutBuiltDocs);
  return [...holdoutValues].filter((v) => devValues.has(v));
}
