// Tier-safety guards for the whole class of tier-blind drop/re-type channels
// in the postprocess tail (H-3-CLOSURE-DESIGN.md, finding 6.5 and the
// follow-up structural audit).
//
// The activated three-tier model (allMask:false) differs from today's
// allMask:true world in exactly one place: tierPartitionStep drops the pass
// tier. So any PRE-PARTITION step that drops or re-types an entity on a proxy
// OTHER than its tier can silently discard a mask-tier entity once tiers go
// live, a leak that today's config avoids only by coincidence. Three such
// channels exist, and each gets a pure lint the test suite runs against the
// real config on every CI pass (tier-safety.test.js), so a future config edit
// that would open a leak fails the build before it ships. None of these
// functions touch runtime, they read the same config tables the runtime uses:
//
//   1. merge (re-type) – mergeStep re-tags an absorbed span onto the rule
//      owner's tier: findUnsafeMergeRules.
//   2. maxLength (drop) – maxLengthStep drops an over-long entity whose weight
//      is below OVERSIZE_WEIGHT_THRESHOLD: findMaskTypesDroppableByMaxLength.
//   3. blocklist (drop) – blocklistStep drops an entity matching a blocklist
//      value/pattern or ending inside a word: findMaskTypesWithDropBlocklist.
//
// Protection order, most protective first: mask (2) > review (1) > pass (0).
//   mask (W1): always masked, the strongest protection,
//   review (W2): surfaced to the radca for a decision, not auto-masked,
//   pass (W3): never masked.

export const TIER_PROTECTION_RANK = { mask: 2, review: 1, pass: 0 };

// ── Guard 1: merge (re-type) ───────────────────────────────────────────────
//
// mergeStep (src/pipeline/steps/merge.js) is tier-blind: canMergePair
// (merge.js:11-23, lines 17/20/21) always makes the RULE OWNER the host of the
// merged span and re-tags the absorbed type onto the owner's tier. A merge is
// safe only when the owner (= host) is at least as protective as the type it
// absorbs. A less-protective owner swallowing a more-protective type is the
// violation:
//   mask absorbed by review or pass: the personal datum stops being masked (a leak),
//   review absorbed by pass: the item silently disappears, the radca never
//     sees the position to decide on (a silent skip).
// The safe direction, a more-protective owner absorbing a less-protective type
// (e.g. POSTAL_ADDRESS [mask] mergeWithFollowing [LOCATION [review]], the one
// real cross-type rule today), is fine: over-masking is reversible, a leak is
// not.
const MERGE_RULE_KEYS = ['mergeWithFollowing', 'mergeWithAdjacent'];

// `rules`: a type -> rule map shaped like ENTITY_RULES (each rule may carry
//   `mergeWithFollowing` and/or `mergeWithAdjacent` arrays of absorbed type
//   names). Both rule kinds re-tag onto the owner's tier, so both are checked
//   identically.
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

// ── Guard 2: maxLength (drop) ──────────────────────────────────────────────
//
// maxLengthStep (src/pipeline/steps/max-length.js), for an entity longer than
// its type's maxLength: weight >= OVERSIZE_WEIGHT_THRESHOLD over-masks (keeps
// it, oversized:true), weight below the threshold is DROPPED outright. A
// mask-tier type that is both droppable (a non-null maxLength) and below the
// threshold would leak its over-long instances after activation. Today safe
// only by coincidence: the one mask type with weight < 3
// (ORGANIZATION_IDENTIFIER, weight 2) has maxLength null (IDENTIFIER_RULE), so
// the drop never reaches it.
//
// `weightFor`: (type) => number.
// `threshold`: the real OVERSIZE_WEIGHT_THRESHOLD (the standing test imports it
//   from max-length.js and passes it here, so this guard tracks the actual
//   runtime value rather than a stale copy).
// Returns one entry { type, maxLength, weight } per droppable mask type, or [].
export function findMaskTypesDroppableByMaxLength(rules, tierFor, weightFor, threshold) {
  const offenders = [];
  for (const [type, rule] of Object.entries(rules)) {
    if (!rule) continue;
    if (tierFor(type) !== 'mask') continue;
    // `!= null` treats a missing key (undefined) the same as an explicit null,
    // matching rulesFor's DEFAULT_RULE fallback (maxLength: null) that the
    // runtime actually sees. A maxLength of 0 is a real, droppable bound.
    if (rule.maxLength == null) continue;
    const weight = weightFor(type);
    if (weight < threshold) {
      offenders.push({ type, maxLength: rule.maxLength, weight });
    }
  }
  return offenders;
}

// ── Guard 3: blocklist (drop) ──────────────────────────────────────────────
//
// blocklistStep (src/pipeline/steps/blocklist.js) DROPS an entity when its
// value equals a blocklist entry, matches a blocklistPattern, or
// (rejectTruncatedWord) ends inside a longer word. Edge trimming is a reshape,
// not a drop, and is out of scope. A mask-tier type carrying any of these drop
// triggers could discard a real datum: false positives on a mask type belong
// at DETECTION (regex precision), never a post-hoc value blocklist that might
// catch genuine PII. Today safe: only PERSON_ROLE_OR_TITLE (review tier)
// declares any of them.
const DROP_BLOCKLIST_FLAGS = [
  { reason: 'blocklist', triggered: (rule) => (rule.blocklist?.length ?? 0) > 0 },
  { reason: 'blocklistPatterns', triggered: (rule) => (rule.blocklistPatterns?.length ?? 0) > 0 },
  { reason: 'rejectTruncatedWord', triggered: (rule) => rule.rejectTruncatedWord === true },
];

// `tierFor`: (type) => 'mask' | 'review' | 'pass'.
// Returns one entry { type, reasons: string[] } per mask type carrying at
// least one drop trigger (reasons lists which ones), or [].
export function findMaskTypesWithDropBlocklist(rules, tierFor) {
  const offenders = [];
  for (const [type, rule] of Object.entries(rules)) {
    if (!rule) continue;
    if (tierFor(type) !== 'mask') continue;
    const reasons = DROP_BLOCKLIST_FLAGS.filter(({ triggered }) => triggered(rule)).map(({ reason }) => reason);
    if (reasons.length > 0) offenders.push({ type, reasons });
  }
  return offenders;
}
