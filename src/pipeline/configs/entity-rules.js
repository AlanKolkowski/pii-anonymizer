export const DEFAULT_RULE = {
  threshold: 0,
  thresholdBySource: {},
  maxLength: null,
  snap: true,
  trimTrailingPunctuation: true,
  backfill: true,
  blocklist: [],
  mergeWithAdjacent: [],
};

export const ENTITY_RULES = {
  PERSON_NAME:              { maxLength: 50, threshold: 0.5 },
  PERSON_ROLE_OR_TITLE:     {
    maxLength: 70,
    threshold: 0.6,
    thresholdBySource: { 'polish-q8': 0.75 },
    blocklist: ['Pan', 'Pani', 'Nadawca'],
  },
  ORGANIZATION_NAME:        { maxLength: 120 },
  VEHICLE_IDENTIFIER:       { maxLength: 40 },
  LOCATION:                 { maxLength: 100 },
  POSTAL_ADDRESS:           { maxLength: 100, mergeWithAdjacent: ['LOCATION'] },
  PERSON_ATTRIBUTE:         { maxLength: 80 },
};

export function rulesFor(type) {
  return { ...DEFAULT_RULE, ...(ENTITY_RULES[type] || {}) };
}
