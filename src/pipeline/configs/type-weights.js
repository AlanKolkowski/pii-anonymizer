// Severity of a full leak of one entity of the given type, on a 1–5 scale
// anchored in professional-secrecy damage, not model taxonomy:
// 5 = identyfikator osoby / kategorie szczególne art. 9-10 RODO,
// 4 = bezpośrednie namiary na osobę (nazwisko, adres, kontakt, konto),
// 3 = pośrednio identyfikujące (sygnatura sprawy, data urodzenia w parze
//     z innymi danymi, atrybuty, kwoty roszczeń),
// 2 = dane podmiotów gospodarczych i lokalizacje,
// 1 = role i tytuły zawodowe.
//
// Shared between src/eval/analyze.js (leak severity reporting) and
// src/pipeline (enforcement, e.g. maxLengthStep/A5) so the two can never
// silently drift apart — a type reported as high-severity in the audit must
// be the same type the pipeline treats as high-severity when deciding
// whether to drop or over-mask.
export const TYPE_WEIGHTS = {
  PERSON_IDENTIFIER: 5,
  AUTH_SECRET: 5,
  HEALTH_DATA: 5,
  GENETIC_DATA: 5,
  BIOMETRIC_DATA: 5,
  RELIGION_OR_BELIEF: 5,
  POLITICAL_OPINION: 5,
  SEXUAL_ORIENTATION: 5,
  TRADE_UNION_MEMBERSHIP: 5,
  ETHNIC_ORIGIN: 5,
  CRIMINAL_OFFENCE_DATA: 5,
  PERSON_NAME: 4,
  POSTAL_ADDRESS: 4,
  EMAIL_ADDRESS: 4,
  PHONE_NUMBER: 4,
  CONTACT_HANDLE: 4,
  PERSON_ALIAS: 4,
  BANK_ACCOUNT_IDENTIFIER: 4,
  PAYMENT_CARD: 4,
  PAYMENT_CARD_SECURITY: 4,
  DEVICE_IDENTIFIER: 4,
  VEHICLE_IDENTIFIER: 4,
  // KW-detection request (2026-07-18): same weight and same reasoning as
  // VEHICLE_IDENTIFIER just above — a land-register number identifies a
  // PROPERTY, not a person directly, so it sits at 4 ("bezpośrednie namiary"
  // via the asset/registry it names) rather than 5 (reserved for identifiers
  // OF a person / art. 9-10 categories). Not lower either: Poland's public
  // KW lookup portal (ekw.ms.gov.pl) resolves a bare KW number straight to
  // the owner's name for free, at least as direct a re-identification path
  // as a vehicle plate through CEPiK.
  LAND_REGISTER_IDENTIFIER: 4,
  ACCOUNT_IDENTIFIER: 4,
  DATE_OF_BIRTH: 3,
  DOCUMENT_REFERENCE: 3,
  PERSON_ATTRIBUTE: 3,
  INCOME_COMPENSATION: 3,
  FINANCIAL_AMOUNT: 3,
  IP_ADDRESS: 3,
  GEO_LOCATION: 3,
  COOKIE_IDENTIFIER: 3,
  ORGANIZATION_NAME: 2,
  ORGANIZATION_IDENTIFIER: 2,
  LOCATION: 2,
  PERSON_ROLE_OR_TITLE: 1,
};

export function weightFor(type) {
  return TYPE_WEIGHTS[type] ?? 3;
}
