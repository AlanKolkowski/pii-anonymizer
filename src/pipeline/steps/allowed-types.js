/**
 * Allowed entity types from docs/entity-categories.md.
 * Entities with an entity_group not in this set are dropped.
 */
const ALLOWED_TYPES = new Set([
  // Personal Identity
  'PERSON_NAME',
  'DATE_OF_BIRTH',
  'PERSON_ATTRIBUTE',
  'PERSON_ALIAS',
  'PERSON_IDENTIFIER',
  'PERSON_ROLE_OR_TITLE',
  // Organizations
  'ORGANIZATION_NAME',
  'ORGANIZATION_IDENTIFIER',
  // Contact & Location
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'CONTACT_HANDLE',
  'POSTAL_ADDRESS',
  'LOCATION',
  'GEO_LOCATION',
  // Technical Identifiers
  'IP_ADDRESS',
  'DEVICE_IDENTIFIER',
  'COOKIE_IDENTIFIER',
  'ACCOUNT_IDENTIFIER',
  'AUTH_SECRET',
  // Financial
  'BANK_ACCOUNT_IDENTIFIER',
  'PAYMENT_CARD',
  'PAYMENT_CARD_SECURITY',
  'DOCUMENT_REFERENCE',
  'FINANCIAL_AMOUNT',
  'INCOME_COMPENSATION',
  'VEHICLE_IDENTIFIER',
  // Health & Biometric
  'HEALTH_DATA',
  'GENETIC_DATA',
  'BIOMETRIC_DATA',
  // Special Categories
  'RELIGION_OR_BELIEF',
  'POLITICAL_OPINION',
  'SEXUAL_ORIENTATION',
  'TRADE_UNION_MEMBERSHIP',
  'ETHNIC_ORIGIN',
  'CRIMINAL_OFFENCE_DATA',
]);

export function allowedTypesStep(ctx) {
  const filtered = ctx.entities.filter(e => ALLOWED_TYPES.has(e.entity_group));
  return { ...ctx, entities: filtered };
}
