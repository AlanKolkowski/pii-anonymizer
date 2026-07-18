export const DEFAULT_RULE = {
  threshold: 0,
  thresholdBySource: {},
  maxLength: null,
  snap: true,
  trimTrailingPunctuation: true,
  trimLeadingOpeningBrackets: false,
  trimTrailingClosingBrackets: false,
  backfill: true,
  fuzzyBackfill: false,
  caseInsensitiveBackfill: false,
  rejectTruncatedWord: false,
  blocklist: [],
  blocklistPatterns: [],
  mergeWithAdjacent: [],
  mergeWithFollowing: [],
};

const IDENTIFIER_RULE = {
  trimLeadingOpeningBrackets: true,
  trimTrailingClosingBrackets: true,
};

// B2 (RECALL-90-DESIGN.md §2.2 pkt 4): starting threshold for the
// case-folded source, applied uniformly across its five contract types —
// higher than each type's own baseline (mostly 0.5-0.75) because the folded
// text's sentence context is disrupted (a Title-Cased header/komparycja is
// not what the models were trained on, even once case is restored) and the
// closed type list already does most of the precision work; measured, not
// asserted (npm run eval on both corpora — see RECALL-B2-NOTES.md).
const CASE_FOLDED_THRESHOLD = 0.8;

// MF-1 (MASK-FLOOR-DESIGN.md §2.2 pkt 2): a single global floor for the
// `mask` tier's per-type thresholds, consumed by createThresholdStep
// (threshold.js) — when tiering is active (allMask:false) and this is not
// null, a mask-tier entity's effective threshold is clamped down to
// min(threshold, MASK_FLOOR); it never raises a threshold, never touches
// review/pass, and never overrides a source-specific threshold
// (thresholdBySource: case-folded/despaced/multilang-fp32 stay measured
// bars of their own, §2.2 pkt 3).
//
// Starting value: null (disabled). The mechanism can ship on main ahead of
// the measurement — with MASK_FLOOR null, createThresholdStep's floor
// branch never fires, so behavior is byte-for-byte identical to today even
// in tiered mode (allMask:false). Only GATE-MF's sweep (§5, PC-side) sets a
// real value here; that is a config-only change, not a code change — see
// entity-rules.test.js for the domain check (null or a number in (0, 1]).
export const MASK_FLOOR = null;

export const ENTITY_RULES = {
  PERSON_NAME:              { maxLength: 50, threshold: 0.5, fuzzyBackfill: true, thresholdBySource: { 'case-folded': CASE_FOLDED_THRESHOLD } },
  // A7 (EVAL-RECALL-AUDIT §8): weight>=3 thresholds were calibrated for
  // precision, not professional secrecy (§7.1) — a passport number at model
  // score 0.78 (adw_14) and a vehicle plate at 0.67 (adw_31, missed the old
  // 0.7 threshold by 0.03) both leaked in full. These were originally
  // GATE-EVAL-RECALL §6's specified starting points, applied directly
  // because the measurement script hit repeated out-of-memory crashes
  // cycling ~90 ONNX sessions in one process.
  //
  // recall-b (2026-07-12): completed the full P/R curve (0.3-0.9, step 0.1)
  // by splitting cache-ner-for-thresholds.mjs into one process per corpus
  // + disposing model sessions between docs (fixed the OOM at the source)
  // — see scripts/cache-ner-for-thresholds.mjs / measure-thresholds.mjs,
  // artifact test-data/results/threshold-sweep.json (gitignored,
  // reproduction commands in script headers). Result: PERSON_IDENTIFIER
  // (0.5), VEHICLE_IDENTIFIER (0.5) and LOCATION (0.75) are ALREADY at
  // their optimal point — flat P/R across the whole 0.3-0.8 range on both
  // corpora, with any move to 0.9 costing recall for no compensating gain.
  // DEVICE_IDENTIFIER (below, via IDENTIFIER_RULE i.e. no threshold) is a
  // pure detection-layer gap (0% recall at EVERY threshold on synthetic,
  // no adversarial examples at all) — no threshold fixes a missing
  // candidate, confirming the standing "no change" call. Left unchanged.
  PERSON_IDENTIFIER:        { ...IDENTIFIER_RULE, threshold: 0.5 },
  // PERSON_ROLE_OR_TITLE is the one real mover: 0.75 sits in a flat zone
  // (0.3-0.8 identical: synthetic 84.4%P/96.4%R, adversarial recall pinned
  // at 64.7% while precision merely drifts with FP noise volume) — 0.9 is
  // a dominant win, not a tradeoff: synthetic 100%P/100%R (28/0/0),
  // adversarial 63.2%P/70.6%R (12/7/5 vs 11/16-20/6 across 0.3-0.7).
  // Mechanism: B4-lite's lexicon scores 0.95 (LEXICON_SCORE, lexicon.js),
  // so it clears 0.9 with room to spare; raising the threshold instead
  // filters out the *lower*-confidence multilang-fp32 candidates that were
  // winning dedup's "close scores → wider span" arbitration against a
  // correct, narrower lexicon match on pure span width — same root cause
  // documented in RECALL-B-NOTES.md, fixed here from the threshold side
  // instead of touching shared dedup logic.
  PERSON_ROLE_OR_TITLE:     {
    maxLength: 70,
    threshold: 0.9,
    fuzzyBackfill: true,
    rejectTruncatedWord: true,
    blocklist: ['Pan', 'Pani', 'Nadawca'],
    blocklistPatterns: [
      // -awca/-biorca ("wykonawca", "kredytobiorca", …) across the full
      // declension paradigm, not just nominative singular — A9
      // (EVAL-RECALL-AUDIT §8): "Kredytobiorcą" (instrumental) previously
      // slipped through because the blocklist only knew "-biorca".
      /(?:aw|bior)c(?:a|y|ę|ą|o|ów|om|ami|ach)$/iu,
      /(?:ujący|ująca|ującej|ującego|ującemu|ującą|ujące|ujących|ującym|ującymi)$/iu,
    ],
    // NOTE: CASE_FOLDED_THRESHOLD (0.8) is *below* this type's own base
    // (0.9, set by A7 specifically to out-compete lower-confidence
    // multilang-fp32 candidates in dedup's "close scores -> wider span"
    // arbitration against B4-lite's 0.95 lexicon match — see the A7 comment
    // above). Applied literally per RECALL-90-DESIGN.md §2.2 pkt 4 and
    // checked for regression by eval, not raised pre-emptively without
    // evidence — see RECALL-B2-NOTES.md for the measured outcome.
    thresholdBySource: { 'case-folded': CASE_FOLDED_THRESHOLD },
  },
  ORGANIZATION_NAME:        { maxLength: 120, threshold: 0.6, thresholdBySource: { 'multilang-fp32': 0.95, 'case-folded': CASE_FOLDED_THRESHOLD }, caseInsensitiveBackfill: true },
  ORGANIZATION_IDENTIFIER:  IDENTIFIER_RULE,
  CONTACT_HANDLE:           IDENTIFIER_RULE,
  IP_ADDRESS:               IDENTIFIER_RULE,
  DEVICE_IDENTIFIER:        IDENTIFIER_RULE,
  COOKIE_IDENTIFIER:        IDENTIFIER_RULE,
  ACCOUNT_IDENTIFIER:       IDENTIFIER_RULE,
  AUTH_SECRET:              IDENTIFIER_RULE,
  BANK_ACCOUNT_IDENTIFIER:  IDENTIFIER_RULE,
  PAYMENT_CARD:             IDENTIFIER_RULE,
  PAYMENT_CARD_SECURITY:    IDENTIFIER_RULE,
  DOCUMENT_REFERENCE:       IDENTIFIER_RULE,
  VEHICLE_IDENTIFIER:       { ...IDENTIFIER_RULE, maxLength: 40, threshold: 0.5 },
  LOCATION:                 { maxLength: 100, threshold: 0.75, mergeWithAdjacent: [], thresholdBySource: { 'case-folded': CASE_FOLDED_THRESHOLD } },
  POSTAL_ADDRESS:           { maxLength: 100, threshold: 0.6, mergeWithFollowing: ['LOCATION'], thresholdBySource: { 'case-folded': CASE_FOLDED_THRESHOLD } },
  PERSON_ATTRIBUTE:         { maxLength: 80, threshold: 0.6 },
};

export function rulesFor(type) {
  return { ...DEFAULT_RULE, ...(ENTITY_RULES[type] || {}) };
}
