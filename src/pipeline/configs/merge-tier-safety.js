// Merge tier-safety guard (H-3-CLOSURE-DESIGN.md, finding 6.5 – closes the
// last structural H-3 gap flagged during HC-2/HC-1).
//
// mergeStep (src/pipeline/steps/merge.js) is tier-blind: canMergePair
// (merge.js:11-23) always makes the RULE OWNER the host of the merged span
// (lines 17/20/21 all return host = owner) and re-tags the absorbed type onto
// the owner's tier. So the only thing standing between today's safe behavior
// and a fresh H-3 leak is the CONTENT of ENTITY_RULES: nothing at runtime
// stops a merge rule from letting a less-protective type swallow a
// more-protective one.
//
// This module makes that implicit invariant explicit and testable WITHOUT
// touching mergeStep at runtime: it is a pure function the test suite runs
// against the real ENTITY_RULES on every CI pass (merge-tier-safety.test.js),
// so any future rule edit that would open a leak fails the build before it
// ships. It intentionally does NOT thread tiers into merge.js, which would be
// an invasive behavior change, the standing test is sufficient.
//
// Protection order, most protective first: mask > review > pass.
//   mask (W1): always masked, the strongest protection,
//   review (W2): surfaced to the radca for a decision, not auto-masked,
//   pass (W3): never masked.
// A merge is safe only when the owner (= merge host) is at least as
// protective as the type it absorbs. A less-protective owner swallowing a
// more-protective type is the violation:
//   mask absorbed by review or pass: the personal datum stops being masked (a leak),
//   review absorbed by pass: the item silently disappears, the radca never
//     sees the position to decide on (a silent skip).
// The safe direction, a more-protective owner absorbing a less-protective
// type (e.g. POSTAL_ADDRESS [mask] mergeWithFollowing [LOCATION [review]], the
// one real cross-type rule today), is fine: over-masking is reversible, a
// leak is not.
export const TIER_PROTECTION_RANK = { mask: 2, review: 1, pass: 0 };

const MERGE_RULE_KEYS = ['mergeWithFollowing', 'mergeWithAdjacent'];

// `rules`: a type -> rule map shaped like ENTITY_RULES (each rule may carry
//   `mergeWithFollowing` and/or `mergeWithAdjacent` arrays of absorbed type
//   names). Both rule kinds re-tag the absorbed span onto the owner's tier
//   (canMergePair), so both are checked identically.
// `tierFor`: (type) => 'mask' | 'review' | 'pass'.
// Returns one entry { owner, absorbed, via, ownerTier, absorbedTier } per
// unsafe (owner, absorbed) pair, or [] when every merge rule is tier-safe.
export function findUnsafeMergeRules(rules, tierFor) {
  const violations = [];
  for (const [owner, rule] of Object.entries(rules)) {
    if (!rule) continue;
    const ownerTier = tierFor(owner);
    const ownerRank = TIER_PROTECTION_RANK[ownerTier];
    for (const via of MERGE_RULE_KEYS) {
      for (const absorbed of rule[via] ?? []) {
        const absorbedTier = tierFor(absorbed);
        if (ownerRank < TIER_PROTECTION_RANK[absorbedTier]) {
          violations.push({ owner, absorbed, via, ownerTier, absorbedTier });
        }
      }
    }
  }
  return violations;
}
