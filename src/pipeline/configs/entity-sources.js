// `backends` is the ordered list of inference backends a source can run on.
// First entry = preferred when available; later entries = fallbacks.
// q8 is wasm-only because ORT-Web's WebNN EP doesn't broadcast `scale` to
// input rank for per-tensor int8 dequantize and MLGraphBuilder rejects the
// rank mismatch. fp32 runs on either; we prefer GPU when available.
export const SOURCES = {
  'multilang-q8': { kind: 'hf', id: 'wjarka/eu-pii-anonimization-multilang', dtype: 'q8', sizeMB: 280, backends: ['wasm'] },
  'multilang-fp16': { kind: 'hf', id: 'wjarka/eu-pii-anonimization-multilang', dtype: 'fp16',   sizeMB: 550,  backends: ['webnn-gpu', 'wasm'] },
  'multilang-fp32': { kind: 'hf', id: 'wjarka/eu-pii-anonimization-multilang', dtype: 'fp32', sizeMB: 1100, backends: ['webnn-gpu', 'wasm'] },
  'polish-q8':      { kind: 'hf', id: 'wjarka/eu-pii-anonimization-pl',        dtype: 'q8',   sizeMB: 280,  backends: ['wasm'] },
  'polish-fp16':    { kind: 'hf', id: 'wjarka/eu-pii-anonimization-pl',        dtype: 'fp16', sizeMB: 550, backends: ['webnn-gpu', 'wasm'] },
  'polish-fp32':    { kind: 'hf', id: 'wjarka/eu-pii-anonimization-pl',        dtype: 'fp32', sizeMB: 1100, backends: ['webnn-gpu', 'wasm'] },
  'regex':          { kind: 'regex' },
};

export const ENTITY_SOURCES = {
  PERSON_NAME:              ['multilang-fp16'],
  DATE_OF_BIRTH:            ['multilang-fp16', 'polish-fp16'],
  PERSON_ATTRIBUTE:         ['multilang-fp16'],
  PERSON_ALIAS:             ['multilang-fp16', 'polish-fp16'],
  PERSON_IDENTIFIER:        ['multilang-fp16', 'polish-fp16', 'regex'],
  PERSON_ROLE_OR_TITLE:     ['polish-q8', 'polish-fp32', 'multilang-fp32'],
  ORGANIZATION_NAME:        ['polish-q8', 'polish-fp32', 'multilang-fp32'],
  ORGANIZATION_IDENTIFIER:  ['multilang-fp16', 'regex'],
  EMAIL_ADDRESS:            ['multilang-fp16', 'polish-fp16', 'regex'],
  PHONE_NUMBER:             ['multilang-fp16', 'polish-fp16', 'regex'],
  CONTACT_HANDLE:           ['multilang-fp16', 'polish-fp16'],
  POSTAL_ADDRESS:           ['polish-fp16'],
  LOCATION:                 ['polish-fp16'],
  GEO_LOCATION:             ['multilang-fp16', 'polish-fp16'],
  IP_ADDRESS:               ['multilang-fp16', 'polish-fp16'],
  DEVICE_IDENTIFIER:        ['multilang-fp16', 'polish-fp16'],
  COOKIE_IDENTIFIER:        ['multilang-fp16', 'polish-fp16'],
  ACCOUNT_IDENTIFIER:       ['multilang-fp16', 'polish-fp16'],
  AUTH_SECRET:              ['multilang-fp16', 'polish-fp16'],
  BANK_ACCOUNT_IDENTIFIER:  ['multilang-fp16', 'polish-fp16', 'regex'],
  PAYMENT_CARD:             ['multilang-fp16', 'polish-fp16'],
  PAYMENT_CARD_SECURITY:    ['multilang-fp16', 'polish-fp16'],
  DOCUMENT_REFERENCE:       ['multilang-fp16', 'polish-fp16'],
  FINANCIAL_AMOUNT:         ['multilang-fp16', 'polish-fp16', 'regex'],
  INCOME_COMPENSATION:      ['multilang-fp16', 'polish-fp16'],
  VEHICLE_IDENTIFIER:       ['multilang-fp16', 'polish-fp16'],
  HEALTH_DATA:              ['multilang-fp32'], // The only model that catches all
  GENETIC_DATA:             ['multilang-fp16', 'polish-fp16'],
  BIOMETRIC_DATA:           ['multilang-fp16', 'polish-fp16'],
  RELIGION_OR_BELIEF:       ['multilang-fp16', 'polish-fp16'],
  POLITICAL_OPINION:        ['multilang-fp16', 'polish-fp16'],
  SEXUAL_ORIENTATION:       ['multilang-fp16', 'polish-fp16'],
  TRADE_UNION_MEMBERSHIP:   ['multilang-fp16', 'polish-fp16'],
  ETHNIC_ORIGIN:            ['multilang-fp16', 'polish-fp16'],
  CRIMINAL_OFFENCE_DATA:    ['multilang-fp16', 'polish-fp16'],
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
