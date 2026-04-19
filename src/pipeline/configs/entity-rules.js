export const DEFAULT_RULE = {
  threshold: 0,
  thresholdBySource: {},
  maxLength: null,
  snap: true,
  trimTrailingPunctuation: true,
  backfill: true,
  fuzzyBackfill: false,
  blocklist: [],
  blocklistPatterns: [],
  mergeWithAdjacent: [],
};

export const ENTITY_RULES = {
  PERSON_NAME:              { maxLength: 50, threshold: 0.5, fuzzyBackfill: true },
  PERSON_ROLE_OR_TITLE:     {
    maxLength: 70,
    threshold: 0.9,
    fuzzyBackfill: true,
    blocklist: ['Pan', 'Pani', 'Nadawca'],
    blocklistPatterns: [
      /(?:awca|biorca)$/iu,
      /(?:ujący|ująca|ującej|ującego|ującemu|ującą|ujące|ujących|ującym|ującymi)$/iu,
    ],
  },
  ORGANIZATION_NAME:        { maxLength: 120, threshold: 0.6, thresholdBySource: { 'multilang-fp32': 0.95 } },
  VEHICLE_IDENTIFIER:       { maxLength: 40 },
  LOCATION:                 { maxLength: 100 },
  POSTAL_ADDRESS:           { maxLength: 100, mergeWithAdjacent: ['LOCATION'] },
  PERSON_ATTRIBUTE:         { maxLength: 80 },
};

export function rulesFor(type) {
  return { ...DEFAULT_RULE, ...(ENTITY_RULES[type] || {}) };
}
