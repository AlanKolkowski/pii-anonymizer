// Sample document data — Polish legal/medical contexts
const SAMPLE_DOCS = [
  {
    id: 'doc-1',
    name: 'umowa-najmu.txt',
    size: '2.4 KB',
    status: 'anonymized',
    type: 'paste',
    body: [
      { t: 'Umowa najmu lokalu mieszkalnego zawarta dnia ' },
      { e: 'DATE_OF_BIRTH', n: 1, orig: '15 marca 2024 r.' },
      { t: ' w ' },
      { e: 'LOCATION', n: 1, orig: 'Warszawie' },
      { t: ' pomiędzy:\n\n' },
      { e: 'PERSON_NAME', n: 1, orig: 'Janem Kowalskim' },
      { t: ', zamieszkałym pod adresem ' },
      { e: 'POSTAL_ADDRESS', n: 1, orig: 'ul. Marszałkowska 10/5, 00-001 Warszawa' },
      { t: ', PESEL ' },
      { e: 'PERSON_IDENTIFIER', n: 1, orig: '85031512345' },
      { t: ', a\n\n' },
      { e: 'PERSON_NAME', n: 2, orig: 'Anną Nowak' },
      { t: ', adres email ' },
      { e: 'EMAIL_ADDRESS', n: 1, orig: 'anna.nowak@example.com' },
      { t: ', telefon ' },
      { e: 'PHONE_NUMBER', n: 1, orig: '+48 600 123 456' },
      { t: '.\n\nMiesięczny czynsz wynosi ' },
      { e: 'FINANCIAL_AMOUNT', n: 1, orig: '3 500 PLN' },
      { t: ' i jest płatny na rachunek ' },
      { e: 'BANK_ACCOUNT_IDENTIFIER', n: 1, orig: 'PL61 1090 1014 0000 0712 1981 2874' },
      { t: ' prowadzony w ' },
      { e: 'ORGANIZATION_NAME', n: 1, orig: 'PKO Banku Polskim' },
      { t: '.' },
    ],
  },
  {
    id: 'doc-2',
    name: 'wypis-szpitalny.pdf',
    size: '5.1 KB',
    status: 'anonymized',
    type: 'upload',
    body: [
      { t: 'Pacjent: ' },
      { e: 'PERSON_NAME', n: 3, orig: 'Tomasz Wiśniewski' },
      { t: ', urodzony ' },
      { e: 'DATE_OF_BIRTH', n: 2, orig: '4 lipca 1972' },
      { t: '\nNumer karty: ' },
      { e: 'ACCOUNT_IDENTIFIER', n: 1, orig: 'KP-2024-04421' },
      { t: '\n\nRozpoznanie: ' },
      { e: 'HEALTH_DATA', n: 1, orig: 'cukrzyca typu 2, nadciśnienie tętnicze' },
      { t: '. Lekarz prowadzący: ' },
      { e: 'PERSON_ROLE_OR_TITLE', n: 1, orig: 'dr Maria Lewandowska' },
      { t: '.' },
    ],
  },
  {
    id: 'doc-3',
    name: 'pozew.docx',
    size: '8.7 KB',
    status: 'pending',
    type: 'upload',
    body: null,
  },
];

const ENTITY_CATEGORIES = [
  { id: 'identity', label: 'Tożsamość', count: '4/6', open: true, items: [
    { code: 'PERSON_NAME', name: 'Imię i nazwisko', on: true },
    { code: 'DATE_OF_BIRTH', name: 'Data urodzenia', on: true },
    { code: 'PERSON_ATTRIBUTE', name: 'Cechy osobowe', on: false },
    { code: 'PERSON_ALIAS', name: 'Pseudonim', on: false },
    { code: 'PERSON_IDENTIFIER', name: 'Identyfikator (PESEL, NIP)', on: true },
    { code: 'PERSON_ROLE_OR_TITLE', name: 'Stanowisko / rola', on: true },
  ]},
  { id: 'org', label: 'Organizacje', count: '2/2', open: false, items: [
    { code: 'ORGANIZATION_NAME', name: 'Nazwa organizacji', on: true },
    { code: 'ORGANIZATION_IDENTIFIER', name: 'NIP, KRS, REGON', on: true },
  ]},
  { id: 'contact', label: 'Kontakt i lokalizacja', count: '4/6', open: true, items: [
    { code: 'EMAIL_ADDRESS', name: 'Adres email', on: true },
    { code: 'PHONE_NUMBER', name: 'Numer telefonu', on: true },
    { code: 'CONTACT_HANDLE', name: 'Identyfikator komunikatora', on: false },
    { code: 'POSTAL_ADDRESS', name: 'Adres pocztowy', on: true },
    { code: 'LOCATION', name: 'Miejscowość, region', on: true },
    { code: 'GEO_LOCATION', name: 'Współrzędne GPS', on: false },
  ]},
  { id: 'tech', label: 'Identyfikatory techniczne', count: '0/5', open: false, items: [
    { code: 'IP_ADDRESS', name: 'Adres IP', on: false },
    { code: 'DEVICE_IDENTIFIER', name: 'MAC, IMEI', on: false },
    { code: 'COOKIE_IDENTIFIER', name: 'Cookie ID', on: false },
    { code: 'ACCOUNT_IDENTIFIER', name: 'Numer konta użytkownika', on: false },
    { code: 'AUTH_SECRET', name: 'Hasło, klucz API', on: false },
  ]},
  { id: 'fin', label: 'Finanse', count: '4/7', open: false, items: [
    { code: 'BANK_ACCOUNT_IDENTIFIER', name: 'IBAN', on: true },
    { code: 'PAYMENT_CARD', name: 'Numer karty', on: true },
    { code: 'PAYMENT_CARD_SECURITY', name: 'CVV, data ważności', on: true },
    { code: 'DOCUMENT_REFERENCE', name: 'Numer faktury', on: true },
    { code: 'FINANCIAL_AMOUNT', name: 'Kwota', on: false },
    { code: 'INCOME_COMPENSATION', name: 'Wynagrodzenie', on: false },
    { code: 'VEHICLE_IDENTIFIER', name: 'Numer rejestracyjny, VIN', on: false },
  ]},
  { id: 'health', label: 'Zdrowie i biometria', count: '1/3', special: true, open: false, items: [
    { code: 'HEALTH_DATA', name: 'Dane medyczne', on: true },
    { code: 'GENETIC_DATA', name: 'Dane genetyczne', on: false },
    { code: 'BIOMETRIC_DATA', name: 'Dane biometryczne', on: false },
  ]},
  { id: 'special', label: 'Kategorie szczególne', count: '0/6', special: true, open: false, items: [
    { code: 'RELIGION_OR_BELIEF', name: 'Wyznanie', on: false },
    { code: 'POLITICAL_OPINION', name: 'Poglądy polityczne', on: false },
    { code: 'SEXUAL_ORIENTATION', name: 'Orientacja seksualna', on: false },
    { code: 'TRADE_UNION_MEMBERSHIP', name: 'Przynależność do związków', on: false },
    { code: 'ETHNIC_ORIGIN', name: 'Pochodzenie etniczne', on: false },
    { code: 'CRIMINAL_OFFENCE_DATA', name: 'Dane karne', on: false },
  ]},
];

// Map entity code → CSS variables for color
const ENTITY_PALETTE = {
  PERSON_NAME:        { bg: 'oklch(0.95 0.04 165)', ink: 'oklch(0.36 0.10 165)', line: 'oklch(0.84 0.07 165)' },
  DATE_OF_BIRTH:      { bg: 'oklch(0.95 0.04 50)',  ink: 'oklch(0.42 0.12 50)',  line: 'oklch(0.84 0.08 50)'  },
  PERSON_IDENTIFIER:  { bg: 'oklch(0.95 0.04 350)', ink: 'oklch(0.42 0.12 350)', line: 'oklch(0.84 0.08 350)' },
  PERSON_ROLE_OR_TITLE:{bg: 'oklch(0.95 0.03 220)', ink: 'oklch(0.40 0.10 220)', line: 'oklch(0.84 0.07 220)' },
  POSTAL_ADDRESS:     { bg: 'oklch(0.95 0.04 250)', ink: 'oklch(0.42 0.12 250)', line: 'oklch(0.84 0.08 250)' },
  LOCATION:           { bg: 'oklch(0.95 0.04 140)', ink: 'oklch(0.40 0.10 140)', line: 'oklch(0.84 0.07 140)' },
  EMAIL_ADDRESS:      { bg: 'oklch(0.95 0.04 305)', ink: 'oklch(0.42 0.12 305)', line: 'oklch(0.84 0.08 305)' },
  PHONE_NUMBER:       { bg: 'oklch(0.95 0.04 75)',  ink: 'oklch(0.44 0.12 75)',  line: 'oklch(0.84 0.08 75)'  },
  ORGANIZATION_NAME:  { bg: 'oklch(0.95 0.04 195)', ink: 'oklch(0.40 0.10 195)', line: 'oklch(0.84 0.07 195)' },
  FINANCIAL_AMOUNT:   { bg: 'oklch(0.95 0.04 95)',  ink: 'oklch(0.42 0.12 95)',  line: 'oklch(0.84 0.08 95)'  },
  BANK_ACCOUNT_IDENTIFIER:{bg:'oklch(0.95 0.04 270)',ink:'oklch(0.42 0.12 270)', line: 'oklch(0.84 0.08 270)' },
  HEALTH_DATA:        { bg: 'oklch(0.95 0.04 25)',  ink: 'oklch(0.44 0.14 25)',  line: 'oklch(0.84 0.08 25)'  },
  ACCOUNT_IDENTIFIER: { bg: 'oklch(0.95 0.03 15)',  ink: 'oklch(0.42 0.10 15)',  line: 'oklch(0.84 0.07 15)'  },
};

const ENTITY_LABEL = {
  PERSON_NAME: 'OSOBA',
  DATE_OF_BIRTH: 'DATA',
  PERSON_IDENTIFIER: 'PESEL',
  PERSON_ROLE_OR_TITLE: 'ROLA',
  POSTAL_ADDRESS: 'ADRES',
  LOCATION: 'MIEJSCE',
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'TEL',
  ORGANIZATION_NAME: 'ORG',
  FINANCIAL_AMOUNT: 'KWOTA',
  BANK_ACCOUNT_IDENTIFIER: 'IBAN',
  HEALTH_DATA: 'ZDROWIE',
  ACCOUNT_IDENTIFIER: 'KONTO',
};

// Collect legend rows from sample doc
function buildLegend(docs) {
  const rows = [];
  const seen = new Set();
  for (const d of docs) {
    if (!d.body) continue;
    for (const part of d.body) {
      if (!part.e) continue;
      const tok = `${part.e}_${part.n}`;
      if (seen.has(tok)) continue;
      seen.add(tok);
      rows.push({ token: tok, type: part.e, orig: part.orig, src: d.name });
    }
  }
  return rows;
}

window.SAMPLE_DOCS = SAMPLE_DOCS;
window.ENTITY_CATEGORIES = ENTITY_CATEGORIES;
window.ENTITY_PALETTE = ENTITY_PALETTE;
window.ENTITY_LABEL = ENTITY_LABEL;
window.buildLegend = buildLegend;
