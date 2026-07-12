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
  PERSON_IDENTIFIER:        { ...IDENTIFIER_RULE, threshold: 0.9 },
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
  VEHICLE_IDENTIFIER:       { ...IDENTIFIER_RULE, maxLength: 40, threshold: 0.7 },
  LOCATION:                 { maxLength: 100, threshold: 0.9, mergeWithAdjacent: [] },
  POSTAL_ADDRESS:           { maxLength: 100, threshold: 0.6, mergeWithFollowing: ['LOCATION'] },
  PERSON_ATTRIBUTE:         { maxLength: 80, threshold: 0.6 },
};

export function rulesFor(type) {
  return { ...DEFAULT_RULE, ...(ENTITY_RULES[type] || {}) };
}
