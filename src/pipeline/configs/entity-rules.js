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

export const ENTITY_RULES = {
  PERSON_NAME:              { maxLength: 50, threshold: 0.5, fuzzyBackfill: true },
  // A7 (EVAL-RECALL-AUDIT §8): weight>=3 thresholds were calibrated for
  // precision, not professional secrecy (§7.1) — a passport number at model
  // score 0.78 (adw_14) and a vehicle plate at 0.67 (adw_31, missed the old
  // 0.7 threshold by 0.03) both leaked in full. These are GATE-EVAL-RECALL
  // §6's specified starting points, applied directly rather than
  // fine-tuned against a P/R curve: the measurement script
  // (scripts/measure-thresholds.mjs + cache-ner-for-thresholds.mjs) hit
  // repeated out-of-memory crashes in this session cycling ~90 ONNX
  // sessions in one process (see script comments) — verified instead via
  // the normal tagged eval on both corpora, which the module's own
  // contract phrases its acceptance criteria in terms of anyway.
  PERSON_IDENTIFIER:        { ...IDENTIFIER_RULE, threshold: 0.5 },
  PERSON_ROLE_OR_TITLE:     {
    maxLength: 70,
    threshold: 0.75,
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
  },
  ORGANIZATION_NAME:        { maxLength: 120, threshold: 0.6, thresholdBySource: { 'multilang-fp32': 0.95 }, caseInsensitiveBackfill: true },
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
  LOCATION:                 { maxLength: 100, threshold: 0.75, mergeWithAdjacent: [] },
  POSTAL_ADDRESS:           { maxLength: 100, threshold: 0.6, mergeWithFollowing: ['LOCATION'] },
  PERSON_ATTRIBUTE:         { maxLength: 80, threshold: 0.6 },
};

export function rulesFor(type) {
  return { ...DEFAULT_RULE, ...(ENTITY_RULES[type] || {}) };
}
