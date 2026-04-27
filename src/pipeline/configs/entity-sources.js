export const SOURCES = {
  'multilang-q8':   { kind: 'hf', id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8',   sizeMB: 280 },
  'multilang-fp32': { kind: 'hf', id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'fp32', sizeMB: 1100 },
  'polish-q8':      { kind: 'hf', id: 'bardsai/eu-pii-anonimization',           dtype: 'q8',   sizeMB: 280 },
  'polish-fp32':    { kind: 'hf', id: 'bardsai/eu-pii-anonimization',           dtype: 'fp32', sizeMB: 1100 },
  'regex':          { kind: 'regex' },
};

export const ENTITY_SOURCES = {
  PERSON_NAME:              ['multilang-q8'],
  DATE_OF_BIRTH:            ['multilang-q8', 'polish-q8'],
  PERSON_ATTRIBUTE:         ['multilang-q8', 'polish-q8'],
  PERSON_ALIAS:             ['multilang-q8', 'polish-q8'],
  PERSON_IDENTIFIER:        ['multilang-q8', 'polish-q8', 'regex'],
  PERSON_ROLE_OR_TITLE:     ['polish-q8', 'polish-fp32', 'multilang-fp32'],
  ORGANIZATION_NAME:        ['polish-q8', 'polish-fp32', 'multilang-fp32'],
  ORGANIZATION_IDENTIFIER:  ['multilang-q8', 'regex'],
  EMAIL_ADDRESS:            ['multilang-q8', 'polish-q8', 'regex'],
  PHONE_NUMBER:             ['multilang-q8', 'polish-q8', 'regex'],
  CONTACT_HANDLE:           ['multilang-q8', 'polish-q8'],
  POSTAL_ADDRESS:           ['polish-q8'],
  LOCATION:                 ['polish-q8'],
  GEO_LOCATION:             ['multilang-q8', 'polish-q8'],
  IP_ADDRESS:               ['multilang-q8', 'polish-q8'],
  DEVICE_IDENTIFIER:        ['multilang-q8', 'polish-q8'],
  COOKIE_IDENTIFIER:        ['multilang-q8', 'polish-q8'],
  ACCOUNT_IDENTIFIER:       ['multilang-q8', 'polish-q8'],
  AUTH_SECRET:              ['multilang-q8', 'polish-q8'],
  BANK_ACCOUNT_IDENTIFIER:  ['multilang-q8', 'polish-q8', 'regex'],
  PAYMENT_CARD:             ['multilang-q8', 'polish-q8'],
  PAYMENT_CARD_SECURITY:    ['multilang-q8', 'polish-q8'],
  DOCUMENT_REFERENCE:       ['multilang-q8', 'polish-q8'],
  FINANCIAL_AMOUNT:         ['multilang-q8', 'polish-q8', 'regex'],
  INCOME_COMPENSATION:      ['multilang-q8', 'polish-q8'],
  VEHICLE_IDENTIFIER:       ['multilang-q8', 'polish-q8'],
  HEALTH_DATA:              ['multilang-fp32'],
  GENETIC_DATA:             ['multilang-q8', 'polish-q8'],
  BIOMETRIC_DATA:           ['multilang-q8', 'polish-q8'],
  RELIGION_OR_BELIEF:       ['multilang-q8', 'polish-q8'],
  POLITICAL_OPINION:        ['multilang-q8', 'polish-q8'],
  SEXUAL_ORIENTATION:       ['multilang-q8', 'polish-q8'],
  TRADE_UNION_MEMBERSHIP:   ['multilang-q8', 'polish-q8'],
  ETHNIC_ORIGIN:            ['multilang-q8', 'polish-q8'],
  CRIMINAL_OFFENCE_DATA:    ['multilang-q8', 'polish-q8'],
};

export const ENTITY_LABELS = {
  PERSON_NAME:              'Full name',
  DATE_OF_BIRTH:            'Date of birth',
  PERSON_ATTRIBUTE:         'Age, gender, nationality',
  PERSON_ALIAS:             'Nickname, username',
  PERSON_IDENTIFIER:        'National ID, passport, tax ID',
  PERSON_ROLE_OR_TITLE:     'Job title / role',
  ORGANIZATION_NAME:        'Organization name',
  ORGANIZATION_IDENTIFIER:  'NIP, KRS, REGON',
  EMAIL_ADDRESS:            'Email address',
  PHONE_NUMBER:             'Phone number',
  CONTACT_HANDLE:           'Social handle / messaging ID',
  POSTAL_ADDRESS:           'Postal address',
  LOCATION:                 'City / region / country',
  GEO_LOCATION:             'GPS coordinates',
  IP_ADDRESS:               'IP address',
  DEVICE_IDENTIFIER:        'MAC / IMEI / serial',
  COOKIE_IDENTIFIER:        'Cookie / tracker ID',
  ACCOUNT_IDENTIFIER:       'User / account ID',
  AUTH_SECRET:              'Password / API key',
  BANK_ACCOUNT_IDENTIFIER:  'Bank account / IBAN',
  PAYMENT_CARD:             'Payment card number',
  PAYMENT_CARD_SECURITY:    'Card expiry / CVV',
  DOCUMENT_REFERENCE:       'Invoice / transaction ref',
  FINANCIAL_AMOUNT:         'Monetary amount',
  INCOME_COMPENSATION:      'Salary / compensation',
  VEHICLE_IDENTIFIER:       'License plate / VIN',
  HEALTH_DATA:              'Diagnosis / medical condition',
  GENETIC_DATA:             'Genetic data',
  BIOMETRIC_DATA:           'Biometric data',
  RELIGION_OR_BELIEF:       'Religion / belief',
  POLITICAL_OPINION:        'Political opinion',
  SEXUAL_ORIENTATION:       'Sexual orientation',
  TRADE_UNION_MEMBERSHIP:   'Trade union membership',
  ETHNIC_ORIGIN:            'Ethnic origin',
  CRIMINAL_OFFENCE_DATA:    'Criminal offence data',
};

// Employment (docs category 8) is omitted because its only entity
// (PERSON_ROLE_OR_TITLE) already appears in Personal Identity.
export const ENTITY_CATEGORIES = [
  { id: 'personal-identity',     label: 'Personal Identity',     entities: ['PERSON_NAME', 'DATE_OF_BIRTH', 'PERSON_ATTRIBUTE', 'PERSON_ALIAS', 'PERSON_IDENTIFIER', 'PERSON_ROLE_OR_TITLE'] },
  { id: 'organizations',         label: 'Organizations',         entities: ['ORGANIZATION_NAME', 'ORGANIZATION_IDENTIFIER'] },
  { id: 'contact-location',      label: 'Contact & Location',    entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'CONTACT_HANDLE', 'POSTAL_ADDRESS', 'LOCATION', 'GEO_LOCATION'] },
  { id: 'technical-identifiers', label: 'Technical Identifiers', entities: ['IP_ADDRESS', 'DEVICE_IDENTIFIER', 'COOKIE_IDENTIFIER', 'ACCOUNT_IDENTIFIER', 'AUTH_SECRET'] },
  { id: 'financial',             label: 'Financial',             entities: ['BANK_ACCOUNT_IDENTIFIER', 'PAYMENT_CARD', 'PAYMENT_CARD_SECURITY', 'DOCUMENT_REFERENCE', 'FINANCIAL_AMOUNT', 'INCOME_COMPENSATION', 'VEHICLE_IDENTIFIER'] },
  { id: 'health-biometric',      label: 'Health & Biometric',    entities: ['HEALTH_DATA', 'GENETIC_DATA', 'BIOMETRIC_DATA'] },
  { id: 'special-categories',    label: 'Special Categories',    entities: ['RELIGION_OR_BELIEF', 'POLITICAL_OPINION', 'SEXUAL_ORIENTATION', 'TRADE_UNION_MEMBERSHIP', 'ETHNIC_ORIGIN', 'CRIMINAL_OFFENCE_DATA'] },
];

export const DEFAULT_ENABLED_CATEGORIES = [
  'personal-identity', 'organizations', 'contact-location',
  'technical-identifiers', 'financial',
];

export function allEntityTypes() {
  return Object.keys(ENTITY_SOURCES);
}

export function defaultEnabledEntities() {
  const out = [];
  for (const cat of ENTITY_CATEGORIES) {
    if (DEFAULT_ENABLED_CATEGORIES.includes(cat.id)) {
      out.push(...cat.entities);
    }
  }
  return out;
}

export function requiredSources(enabledEntities) {
  const set = new Set();
  for (const type of enabledEntities) {
    const sources = ENTITY_SOURCES[type];
    if (!sources) continue;
    for (const s of sources) set.add(s);
  }
  return [...set];
}
