// Scope tier of each entity type — 'mask' (W1, maskuj automatycznie),
// 'review' (W2, do decyzji radcy) or 'pass' (W3, nie maskuj) — per the
// three-layer model in ZAKRES-ANONIMIZACJI.md §3 (source of truth for the
// assignment) and SCOPE-TIERS-DESIGN.md §2.2 pkt 3 (contract for this
// file). Changing a type's tier is a one-line edit here — never pipeline
// logic — but BOTH documents must be updated together, same discipline as
// TYPE_WEIGHTS ↔ analyze.js (type-weights.js).
//
// This file is DATA only. It is consumed by the eval scorer (tier-based
// W1/W2/W3 split, src/eval/score-tiers.js) today; the pipeline partition
// step (ST-2, SCOPE-TIERS-DESIGN.md §3) and UI (ST-4) will consume it too
// once built.
export const TYPE_TIERS = {
  // mask (W1) — rdzeń danych osobowych, maskowane automatycznie.
  PERSON_NAME: 'mask',
  PERSON_ALIAS: 'mask',
  PERSON_IDENTIFIER: 'mask',
  POSTAL_ADDRESS: 'mask',
  EMAIL_ADDRESS: 'mask',
  PHONE_NUMBER: 'mask',
  CONTACT_HANDLE: 'mask',
  BANK_ACCOUNT_IDENTIFIER: 'mask',
  PAYMENT_CARD: 'mask',
  PAYMENT_CARD_SECURITY: 'mask',
  ACCOUNT_IDENTIFIER: 'mask',
  DEVICE_IDENTIFIER: 'mask',
  VEHICLE_IDENTIFIER: 'mask',
  DATE_OF_BIRTH: 'mask',
  ORGANIZATION_IDENTIFIER: 'mask',
  AUTH_SECRET: 'mask',
  IP_ADDRESS: 'mask',
  GEO_LOCATION: 'mask',
  COOKIE_IDENTIFIER: 'mask',

  // review (W2) — nieidentyfikujące samodzielnie; wykryte i pokazane radcy.
  PERSON_ROLE_OR_TITLE: 'review',
  PERSON_ATTRIBUTE: 'review',
  HEALTH_DATA: 'review',
  GENETIC_DATA: 'review',
  BIOMETRIC_DATA: 'review',
  RELIGION_OR_BELIEF: 'review',
  POLITICAL_OPINION: 'review',
  SEXUAL_ORIENTATION: 'review',
  TRADE_UNION_MEMBERSHIP: 'review',
  ETHNIC_ORIGIN: 'review',
  CRIMINAL_OFFENCE_DATA: 'review',
  FINANCIAL_AMOUNT: 'review',
  INCOME_COMPENSATION: 'review',
  LOCATION: 'review',

  // pass (W3) — nie są danymi osobowymi; nie maskowane domyślnie.
  DOCUMENT_REFERENCE: 'pass',
  ORGANIZATION_NAME: 'pass',
};

// Fail-safe: a type absent from the map (new/unforeseen) is masked, never
// passed through — mirror of weightFor's default, but toward the safe side.
export function tierFor(type) {
  return TYPE_TIERS[type] ?? 'mask';
}
