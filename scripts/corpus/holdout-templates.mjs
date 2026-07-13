// Holdout document templates for test-data/adversarial-holdout —
// RECALL-90-DESIGN.md §3.4: templates disjoint from the dev corpus's 38
// hand-written documents (new sentence/document shapes, not just new names
// plugged into old sentences — otherwise holdout measures template
// memorization, not generalization). Each template is a function
// `(rng, ...) => { name, attack, parts }`, the same `parts` shape as
// scripts/generate-adversarial-corpus.mjs's DOCS array, so it plugs into
// the exact same offset-computing build()/selfCheck() machinery — just fed
// by pool-selected values instead of hardcoded literals.
import { createRng } from './rng.mjs';
import { int, pick, pickN, chance } from './rng.mjs';
import {
  ODMIANA_PEOPLE, DWUCZLONOWE_PEOPLE, INICJALY_PEOPLE, POSPOLITE_PEOPLE,
} from './holdout-people.mjs';
import {
  ROLES, COURTS, COMPANIES, UPPERCASE_INSTITUTIONS, CITIES,
  generateAddress, generateAmountWords, generateAmountDigits,
  generateDocketNumber, generateInvoiceNumber, generateIdentifier,
  HEALTH_PHRASES, CRIMINAL_PHRASES, UNION_PHRASES, RELIGION_PHRASES,
  POLITICAL_PHRASES, SEXUAL_ORIENTATION_PHRASES, ETHNIC_ORIGIN_PHRASES,
  CITATION_TRAPS, STATUTE_TRAPS, COMMON_NOUN_PLACE_TRAPS, GENERIC_ROLE_TRAPS, RATE_TRAPS,
} from './holdout-pools.mjs';
import { substituteGlyphs, spacedOut, joinWords, hyphenatedLineBreak } from './ocr-transforms.mjs';
import { hasEligibleChar, degradeDiacritics, selectDegradedOccurrences } from './diacritics.mjs';

// ── Entity markers (mirrors scripts/generate-adversarial-corpus.mjs's E/PN/
// ROLE/... helpers exactly, plus an optional 3rd `tag` arg used ONLY by this
// generator's own quota self-check — never written to expected.json, which
// stays in dev's exact {entity_group,start,end,text} shape). ────────────
const E = (entity_group, text, tag) => ({ entity_group, text, tag });
const PN = (t, tag) => E('PERSON_NAME', t, tag);
const ROLE = (t, tag) => E('PERSON_ROLE_OR_TITLE', t, tag);
const ORG = (t, tag) => E('ORGANIZATION_NAME', t, tag);
const ADR = (t, tag) => E('POSTAL_ADDRESS', t, tag);
const LOC = (t, tag) => E('LOCATION', t, tag);
const AMT = (t, tag) => E('FINANCIAL_AMOUNT', t, tag);
const TEL = (t, tag) => E('PHONE_NUMBER', t, tag);
const MAIL = (t, tag) => E('EMAIL_ADDRESS', t, tag);
const REF = (t, tag) => E('DOCUMENT_REFERENCE', t, tag);
const DOB = (t, tag) => E('DATE_OF_BIRTH', t, tag);
const ATTR = (t, tag) => E('PERSON_ATTRIBUTE', t, tag);
const HEALTH = (t, tag) => E('HEALTH_DATA', t, tag);
const CRIME = (t, tag) => E('CRIMINAL_OFFENCE_DATA', t, tag);
const UNION = (t, tag) => E('TRADE_UNION_MEMBERSHIP', t, tag);
const RELIGION = (t, tag) => E('RELIGION_OR_BELIEF', t, tag);
const POLITICAL = (t, tag) => E('POLITICAL_OPINION', t, tag);
const SEXORIENT = (t, tag) => E('SEXUAL_ORIENTATION', t, tag);
const ETHNIC = (t, tag) => E('ETHNIC_ORIGIN', t, tag);
// Identifier results carry their own entity_group (PERSON_IDENTIFIER /
// ORGANIZATION_IDENTIFIER / BANK_ACCOUNT_IDENTIFIER / VEHICLE_IDENTIFIER) —
// this generic marker uses whatever generateIdentifier() actually returned,
// so the subtype->entity_group mapping lives in exactly one place
// (holdout-pools.mjs's generateIdentifier), not duplicated per call site.
const EG = (idResult, tag) => E(idResult.entityGroup, idResult.value, tag);

const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const randomDate = (rng) => `${int(rng, 1, 28)} ${pick(rng, MONTHS)} 2026 r.`;
const pad2 = (n) => String(n).padStart(2, '0');
const randomDob = (rng) => `${int(rng, 1, 28)}.${pad2(int(rng, 1, 12))}.${int(rng, 1950, 2002)} r.`;

/** Builds document text + expected.json entries (dev-compatible shape) from
 * a `parts` array, exactly like the dev generator's own build(), plus a
 * parallel `tagCounts` map for this generator's own quota self-check. */
export function buildHoldoutDoc(parts) {
  let text = '';
  const expected = [];
  const tagCounts = {};
  for (const p of parts) {
    if (typeof p === 'string') { text += p; continue; }
    expected.push({ entity_group: p.entity_group, start: text.length, end: text.length + p.text.length, text: p.text });
    if (p.tag) tagCounts[p.tag] = (tagCounts[p.tag] || 0) + 1;
    text += p.text;
  }
  return { text, expected, tagCounts };
}

// ── Templates ─────────────────────────────────────────────────────────

// Declension attack (mirrors adw_01/02): person introduced once, then
// referred to by declined bare surname alone on every repeat mention.
function odmianaPismo(rng, person, idx) {
  const role = pick(rng, ROLES);
  const addr = generateAddress(rng);
  const amount = generateAmountDigits(rng);
  const docket = generateDocketNumber(rng);
  return {
    name: `hold_odmiana_${pad2(idx)}`,
    attack: `Odmiana nazwiska "${person.surname}" przez przypadki (dopełniacz/celownik/narzędnik) w piśmie procesowym — mirrors adw_01/02 on new values.`,
    parts: [
      'W sprawie z powództwa ', PN(person.nom, 'personName:odmiana'), ', zam. ', ADR(addr),
      ', wnoszę o wezwanie ', PN(person.surnameGen, 'personName:odmiana'), ' do złożenia wyjaśnień w terminie 14 dni.\n\n',
      'Pełnomocnik ', ROLE(role), ' przekazał ', PN(person.surnameDat, 'personName:odmiana'),
      ' odpis pisma wraz z załącznikami. Kwota roszczenia wynosi ', AMT(amount),
      ' i została wskazana w piśmie oznaczonym sygnaturą ', REF(docket), '.\n\n',
      'Zdaniem ', PN(person.surnameGen, 'personName:odmiana'),
      ' żądanie pozwu jest bezzasadne, o czym pełnomocnik reprezentujący ',
      PN(person.surnameInst, 'personName:odmiana'), ' został poinformowany pisemnie.\n',
    ],
  };
}

// Compound-surname attack (mirrors adw_03): fixed clan prefix + declined
// second element, same pattern dev's own "Krzemień-Zawadzka" already uses.
function dwuczlonowePostanowienie(rng, person, idx) {
  const role = pick(rng, ROLES);
  const court = pick(rng, COURTS);
  const org = pick(rng, COMPANIES);
  const addr = generateAddress(rng);
  return {
    name: `hold_dwuczlonowe_${pad2(idx)}`,
    attack: `Nazwisko dwuczłonowe "${person.surname}" odmieniane w kilku przypadkach — mirrors adw_03 on new values/template.`,
    parts: [
      ORG(court), '\n\nPOSTANOWIENIE\n\n',
      'Sąd, po rozpoznaniu wniosku ', PN(person.nom, 'personName:dwuczlonowe'), ', zam. ', ADR(addr), ', postanawia:\n\n',
      '1. ustanowić dla ', PN(person.surnameGen, 'personName:dwuczlonowe'), ' pełnomocnika z urzędu w osobie ', ROLE(role), ';\n',
      '2. doręczyć odpis postanowienia ', PN(person.surnameDat, 'personName:dwuczlonowe'), ' oraz ', ORG(org), ';\n',
      '3. zobowiązać ', PN(person.surnameInst, 'personName:dwuczlonowe'),
      ' do złożenia dokumentów potwierdzających sytuację majątkową w terminie 7 dni.\n',
    ],
  };
}

// Initials/parafka-dense protocol (mirrors adw_06/30): nominative-only,
// same precedent as dev's own initials examples.
function inicjalyProtokol(rng, idx) {
  const officials = pickN(rng, INICJALY_PEOPLE, 5);
  const roles = [pick(rng, ROLES), pick(rng, ROLES), pick(rng, ROLES)];
  const court = pick(rng, COURTS);
  const addr = generateAddress(rng);
  const docket = generateDocketNumber(rng);
  const attr1 = `lat ${int(rng, 20, 75)}`;
  const attr2 = pick(rng, ['stanu wolnego', 'żonaty, jedno dziecko', 'zamężna, dwoje dzieci', 'rozwiedziony', 'wdowa']);
  return {
    name: `hold_inicjaly_${pad2(idx)}`,
    attack: 'Inicjały i skróty imion (parafki, protokolanci, biegli) w gęstym protokole — mirrors adw_06/adw_30 on new values.',
    parts: [
      ORG(court), '\nSygn. akt ', REF(docket), '\n\nPROTOKÓŁ ROZPRAWY\n\n',
      'Przewodniczący: ', ROLE(roles[0]), ' ', PN(officials[0].nom, 'personName:inicjaly'), '\n',
      'Protokolant: ', ROLE(roles[1]), ' ', PN(officials[1].nom, 'personName:inicjaly'), '\n',
      'Biegły: ', PN(officials[2].nom, 'personName:inicjaly'), ', ', ATTR(attr1), '\n\n',
      'Stawił się świadek ', PN(officials[3].nom, 'personName:inicjaly'), ', ', ATTR(attr2), ', zam. ', ADR(addr),
      '. Kopię protokołu potwierdził za zgodność z oryginałem ', ROLE(roles[2]), ' ', PN(officials[4].nom, 'personName:inicjaly'), '.\n',
    ],
  };
}

// Common-noun-surname disambiguation trap (mirrors adw_05/33): full name
// once, bare surname reused verbatim (no declension) — same precedent dev
// itself follows for this subclass.
function pospoliteZeznania(rng, idx) {
  const people = pickN(rng, POSPOLITE_PEOPLE, 3);
  const roles = [pick(rng, ROLES), pick(rng, ROLES)];
  const loc1 = pick(rng, CITIES);
  const loc2 = pick(rng, CITIES.filter((c) => c !== loc1));
  return {
    name: `hold_pospolite_${pad2(idx)}`,
    attack: 'Nazwiska będące wyrazami pospolitymi jako pułapka dezambiguacji — mirrors adw_05/33 on new common-noun surnames.',
    parts: [
      'Świadek ', PN(people[0].nom, 'personName:pospolite'), ' zeznał, że w dniu zdarzenia przebywał w ', LOC(loc1), '. ',
      PN(people[0].surnameNom, 'personName:pospolite'), ' potwierdził swoje zeznania podpisem.\n\n',
      ROLE(roles[0]), ' ', PN(people[1].nom, 'personName:pospolite'),
      ' złożył opinię z zakresu księgowości. ', PN(people[1].surnameNom, 'personName:pospolite'),
      ' wskazał na rozbieżności w dokumentacji.\n\n',
      'Pozwany ', PN(people[2].nom, 'personName:pospolite'), ', zam. w ', LOC(loc2),
      ', ustanowił pełnomocnikiem ', ROLE(roles[1]), '. ',
      PN(people[2].surnameNom, 'personName:pospolite'), ' nie stawił się osobiście na rozprawę.\n',
    ],
  };
}

// Full identifier-family showcase (mirrors adw_09-14/31 combined): all 10
// manifest subtypes in one document, each with a genuine checksum where the
// app models one.
function identifierShowcase(rng, idx) {
  const person = pick(rng, [...ODMIANA_PEOPLE, ...POSPOLITE_PEOPLE]);
  const pesel = generateIdentifier(rng, 'pesel');
  const dowod = generateIdentifier(rng, 'dowodOsobisty');
  const paszport = generateIdentifier(rng, 'paszport');
  const prawoJazdy = generateIdentifier(rng, 'prawoJazdy');
  const nip = generateIdentifier(rng, 'nip');
  const regon = generateIdentifier(rng, 'regon');
  const krs = generateIdentifier(rng, 'krs');
  const iban = generateIdentifier(rng, 'ibanNrb');
  const vin = generateIdentifier(rng, 'vin');
  const rejestracja = generateIdentifier(rng, 'rejestracja');
  const org = pick(rng, COMPANIES);
  const docket = generateDocketNumber(rng);
  return {
    name: `hold_identyfikatory_${pad2(idx)}`,
    attack: 'Zestawienie pełnej rodziny identyfikatorów (PESEL, dowód, paszport, prawo jazdy, NIP, REGON, KRS, IBAN/NRB, VIN, rejestracja) — mirrors adw_09-14/31 combined, poprawne sumy kontrolne.',
    parts: [
      'Sygn. akt ', REF(docket), '\n\n',
      'Dane strony postępowania: ', PN(person.nom), ', PESEL ', EG(pesel, 'identifier:pesel'),
      ', dowód osobisty seria i nr ', EG(dowod, 'identifier:dowodOsobisty'),
      ', paszport nr ', EG(paszport, 'identifier:paszport'),
      ', prawo jazdy nr ', EG(prawoJazdy, 'identifier:prawoJazdy'), '.\n\n',
      'Kontrahent: ', ORG(org), ', NIP ', EG(nip, 'identifier:nip'),
      ', REGON ', EG(regon, 'identifier:regon'),
      ', KRS ', EG(krs, 'identifier:krs'), '.\n\n',
      'Rachunek bankowy do rozliczeń: ', EG(iban, 'identifier:ibanNrb'), '.\n\n',
      'Pojazd służący do wykonania umowy: VIN ', EG(vin, 'identifier:vin'),
      ', nr rejestracyjny ', EG(rejestracja, 'identifier:rejestracja'), '.\n',
    ],
  };
}

// OCR mega-document (mirrors adw_23-26 combined): wersaliki rozstrzelone,
// sklejenia, przenoszenie, podmiany glifów, all in one low-quality scan.
function ocrMegaDokument(rng, idx) {
  const candidates = ODMIANA_PEOPLE.filter((p) => hasEligibleChar(p.surnameGen));
  const person = pick(rng, candidates);
  const institution = pick(rng, UPPERCASE_INSTITUTIONS);
  const idA = generateIdentifier(rng, pick(rng, ['pesel', 'nip']));
  const idB = generateIdentifier(rng, 'regon');
  const spacedName = spacedOut(person.surnameNom);
  const spacedInstitution = spacedOut(institution);
  const joinedName = joinWords(`${person.given} ${person.surnameNom}`);
  const wrappedName = hyphenatedLineBreak(rng, person.surnameGen);
  const corruptedA = { ...idA, value: substituteGlyphs(rng, idA.value, { fraction: 0.5 }) };
  const corruptedB = { ...idB, value: substituteGlyphs(rng, idB.value, { fraction: 0.5 }) };
  return {
    name: `hold_ocr_mega_${pad2(idx)}`,
    attack: 'Skan niskiej jakości: wersaliki rozstrzelone, sklejenia, przenoszenie wyrazów i podmiany glifów w jednym dokumencie — mirrors adw_23-26 combined on new values.',
    parts: [
      ORG(spacedInstitution, 'ocr:spacedOut'), '\n\n',
      'Ubezpieczony: ', PN(spacedName, 'ocr:spacedOut'), '\n',
      'Identyfikator: ', EG(corruptedA, 'ocr:glyphSubstitution'), '\n\n',
      'Wnioskodawca', PN(joinedName, 'ocr:joined'), ' zamieszkały pod adresem wskazanym w aktach.\n\n',
      'Zobowiązanie zaciągnięte przez pana ', PN(wrappedName, 'ocr:lineWrap'),
      ' wymaga potwierdzenia numeru: ', EG(corruptedB, 'ocr:glyphSubstitution'), '.\n',
    ],
  };
}

// Diacritic mixture (mirrors the B5 motivation directly, RECALL-90-DESIGN.md
// §2.5): the SAME person's surname appears several times in one document,
// SOME occurrences diacritic-degraded and some not — exactly the
// cross-occurrence coreference failure B5a/B5b defend against.
function diacriticsMixture(rng, idx) {
  const candidates = ODMIANA_PEOPLE.filter((p) => hasEligibleChar(p.surnameNom));
  const person = pick(rng, candidates);
  const mentions = [person.surnameNom, person.surnameGen, person.surnameDat, person.surnameInst];
  const degradedIdx = selectDegradedOccurrences(rng, mentions.length);
  const rendered = mentions.map((m, i) => (degradedIdx.has(i) ? degradeDiacritics(rng, m, { fraction: 0.5 }) : m));
  const tagFor = (i) => (degradedIdx.has(i) ? 'ocr:diacritics' : 'personName:odmiana');
  const addr = generateAddress(rng);
  return {
    name: `hold_diakrytyki_${pad2(idx)}`,
    attack: `Mieszanka form z diakrytykami i bez w obrębie jednego dokumentu ("${person.surname}") — testuje lukę koreferencji z RECALL-90-DESIGN.md §2.5 (B5).`,
    parts: [
      'Ubezpieczony ', PN(`${person.given} ${rendered[0]}`, tagFor(0)), ', zam. ', ADR(addr),
      ', złożył wniosek o ponowne rozpatrzenie sprawy.\n\n',
      'W aktach ubezpieczeniowych ', PN(rendered[1], tagFor(1)),
      ' figuruje pod numerem sprawy wskazanym poniżej. Decyzję doręczono ',
      PN(rendered[2], tagFor(2)), ' w formie papierowej.\n\n',
      'Odwołanie wniesione przez ', PN(rendered[3], tagFor(3)), ' zostało zarejestrowane pod wskazaną sygnaturą.\n',
    ],
  };
}

// Financial formats (mirrors adw_15-17/29): 'umowa' flavor is dense
// (6 digit amounts + 1 słownie), 'wezwanie' is lighter (3 + 1 słownie).
function financialPismo(rng, idx, flavor) {
  const person = pick(rng, [...ODMIANA_PEOPLE, ...POSPOLITE_PEOPLE]);
  const org = pick(rng, COMPANIES);
  const addr = generateAddress(rng);
  const docket = generateDocketNumber(rng);
  const nip = generateIdentifier(rng, 'nip');
  const iban = generateIdentifier(rng, 'ibanNrb');
  const wordsAmount = generateAmountWords(rng);
  const amounts = Array.from({ length: flavor === 'umowa' ? 4 : 3 }, () => generateAmountDigits(rng));
  const parts = flavor === 'umowa'
    ? [
        'UMOWA POŻYCZKI NR ', REF(generateInvoiceNumber(rng)), '\n\n',
        'zawarta w ', pick(rng, CITIES), ' pomiędzy ', ORG(org), ', NIP ', EG(nip, 'identifier:nip'),
        ', a ', PN(person.nom), ', zam. ', ADR(addr), '.\n\n',
        '§ 1. Pożyczkodawca udziela pożyczki w kwocie ', AMT(amounts[0]), '.\n',
        '§ 2. Odsetki umowne wynoszą ', AMT(amounts[1]), ' rocznie.\n',
        '§ 3. Rata miesięczna wynosi ', AMT(amounts[2]), ' i jest płatna na rachunek: ', EG(iban, 'identifier:ibanNrb'), '.\n',
        '§ 4. Całkowity koszt pożyczki wynosi ', AMT(amounts[3]), ' (słownie: ', AMT(wordsAmount), ').\n',
      ]
    : [
        'WEZWANIE DO ZAPŁATY\n\nSygn. ', REF(docket), '\n\n',
        'Wzywam ', PN(person.nom), ', zam. ', ADR(addr),
        ', do zapłaty kwoty ', AMT(amounts[0]), ' tytułem zaległego czynszu wraz z odsetkami w kwocie ', AMT(amounts[1]),
        '. Łączna należność wynosi ', AMT(amounts[2]), ' (słownie: ', AMT(wordsAmount),
        '), płatna na rachunek: ', EG(iban, 'identifier:ibanNrb'), '.\n',
      ];
  return { name: `hold_finanse_${flavor}_${pad2(idx)}`, attack: `Formaty kwot (${flavor}) — mirrors adw_15-17/29 on new values.`, parts };
}

// Address block + org comparycja, incl. an uppercase institution header
// (mirrors adw_18/21/29 combined, plus B2's wersaliki case-folding vector).
function addressOrgPismo(rng, idx) {
  const person = pick(rng, [...ODMIANA_PEOPLE, ...DWUCZLONOWE_PEOPLE]);
  const city1 = pick(rng, CITIES);
  const city2 = pick(rng, CITIES.filter((c) => c !== city1));
  const addr1 = generateAddress(rng, city1);
  const addr2 = generateAddress(rng, city2);
  const court = pick(rng, COURTS);
  const org = pick(rng, COMPANIES);
  const upperOrg = pick(rng, UPPERCASE_INSTITUTIONS);
  const nip = generateIdentifier(rng, 'nip');
  const docket = generateDocketNumber(rng);
  return {
    name: `hold_adres_org_${pad2(idx)}`,
    attack: 'Blok adresowy nagłówka + komparycja z organizacją wersalikami — mirrors adw_18/21/29 on new values.',
    parts: [
      LOC(city1), ', dnia ', randomDate(rng), '\n\nSygn. akt ', REF(docket), '\n\n',
      'Strona:\n', PN(person.nom), '\n', ADR(addr1), '\n\n',
      'Kontrahent:\n', ORG(org), '\n', ADR(addr2), '\nNIP: ', EG(nip, 'identifier:nip'), '\n\n',
      ORG(court), '\n\n', ORG(upperOrg), '\n',
    ],
  };
}

// Art. 9-10 RODO phrases (mirrors adw_38): flavor selects which of the four
// manifest buckets this instance stocks (health/criminal/union/pozostałe).
function art910Pismo(rng, idx, flavor) {
  const person = pick(rng, [...ODMIANA_PEOPLE, ...POSPOLITE_PEOPLE]);
  const loc = pick(rng, CITIES);
  let phraseParts;
  if (flavor === 'health') {
    const chosen = pickN(rng, HEALTH_PHRASES, 3);
    phraseParts = chosen.map((p) => HEALTH(p, 'art910:health'));
  } else if (flavor === 'criminal') {
    const chosen = pickN(rng, CRIMINAL_PHRASES, 3);
    phraseParts = chosen.map((p) => CRIME(p, 'art910:criminal'));
  } else if (flavor === 'union') {
    const chosen = pickN(rng, UNION_PHRASES, 2);
    phraseParts = chosen.map((p) => UNION(p, 'art910:union'));
  } else {
    phraseParts = [
      RELIGION(pick(rng, RELIGION_PHRASES), 'art910:religion'),
      POLITICAL(pick(rng, POLITICAL_PHRASES), 'art910:political'),
      SEXORIENT(pick(rng, SEXUAL_ORIENTATION_PHRASES), 'art910:sexualOrientation'),
      ETHNIC(pick(rng, ETHNIC_ORIGIN_PHRASES), 'art910:ethnicOrigin'),
    ];
  }
  const parts = ['Strona ', PN(person.nom), ' zamieszkała w ', LOC(loc), ' oświadcza, że '];
  phraseParts.forEach((pp, i) => {
    parts.push(pp);
    parts.push(i < phraseParts.length - 1 ? ', a ponadto ' : '.\n');
  });
  return { name: `hold_art910_${flavor}_${pad2(idx)}`, attack: `Frazy opisowe art. 9-10 RODO (${flavor}) — mirrors adw_38, minimalna fraza faktu (§3.5 pkt 2).`, parts };
}

// Contact/attribute strong classes (mirrors adw_13/35/36): phone/e-mail/DOB
// format variety plus person attributes.
function daneOsoboweRejestr(rng, idx) {
  const person = pick(rng, [...ODMIANA_PEOPLE, ...DWUCZLONOWE_PEOPLE, ...POSPOLITE_PEOPLE]);
  const tel1 = `+48 ${int(rng, 500, 799)} ${int(rng, 100, 999)} ${int(rng, 100, 999)}`;
  const tel2 = `(${pick(rng, ['61', '62', '63', '65', '67'])}) ${int(rng, 200, 899)}-${int(rng, 10, 99)}-${int(rng, 10, 99)}`;
  const localPart = `${person.given.toLowerCase()}.${(person.surname || 'osoba').toLowerCase().replace(/[^a-ząćęłńóśźż-]/g, '')}`;
  const mail1 = `${localPart}@poczta-testowa.pl`;
  const companySlug = pick(rng, COMPANIES).toLowerCase().replace(/[^a-ząćęłńóśźż]/g, '').slice(0, 12);
  const mail2 = `kontakt@${companySlug}.pl`;
  const attr1 = `lat ${int(rng, 25, 80)}`;
  const attr2 = pick(rng, ['kawaler', 'panna', 'żonaty', 'zamężna', 'rozwiedziony', 'rozwiedziona', 'wdowiec', 'wdowa']);
  return {
    name: `hold_dane_osobowe_${pad2(idx)}`,
    attack: 'Telefony, e-maile, data urodzenia i atrybuty osobowe w typowych formatach — mirrors adw_13/35/36 on new values.',
    parts: [
      'Dane kontaktowe ', PN(person.nom), ' (ur. ', DOB(randomDob(rng)), ', ', ATTR(attr1), ', ', ATTR(attr2),
      '): telefon komórkowy ', TEL(tel1), ', telefon stacjonarny ', TEL(tel2), ', e-mail ', MAIL(mail1),
      '. Korespondencję firmową prosimy kierować na adres ', MAIL(mail2), '.\n',
    ],
  };
}

// Long composite document (mirrors adw_27): kitchen-sink pozew, satisfying
// §3.3's "~15% dokumentów długich testują chunking i powtórzenia" note.
function dlugiZlozonyDokument(rng, idx) {
  const person = pick(rng, ODMIANA_PEOPLE);
  const person2 = pick(rng, DWUCZLONOWE_PEOPLE);
  const role1 = pick(rng, ROLES);
  const role2 = pick(rng, ROLES.filter((r) => r !== role1));
  const role3 = pick(rng, ROLES.filter((r) => r !== role1 && r !== role2));
  const court = pick(rng, COURTS);
  const org = pick(rng, COMPANIES);
  const extraCompany = pick(rng, COMPANIES.filter((c) => c !== org));
  const city = pick(rng, CITIES);
  const city2 = pick(rng, CITIES.filter((c) => c !== city));
  const addr1 = generateAddress(rng, city);
  const addr2 = generateAddress(rng, city2);
  const nip = generateIdentifier(rng, 'nip');
  const pesel = generateIdentifier(rng, 'pesel');
  const iban = generateIdentifier(rng, 'ibanNrb');
  const amounts = Array.from({ length: 4 }, () => generateAmountDigits(rng));
  const wordsAmount = generateAmountWords(rng);
  const healthPhrase = pick(rng, HEALTH_PHRASES);
  return {
    name: `hold_zlozony_${pad2(idx)}`,
    attack: 'Długi dokument złożony (pozew z kumulacją mechanizmów) — mirrors adw_27; §3.3 wymaga ~15% korpusu jako dokumenty długie testujące chunking i powtórzenia.',
    parts: [
      LOC(city), ', dnia 3 marca 2026 r.\n\n',
      ORG(court), '\n', ADR(addr1), '\n\n',
      'Powód: ', PN(person.nom), ', PESEL ', EG(pesel, 'identifier:pesel'), ', ur. ', DOB(randomDob(rng)),
      ', zam. ', ADR(addr1), ',\nreprezentowany przez ', ROLE(role1), ' ', PN(person.surnameGen, 'personName:odmiana'),
      ', ', ORG(extraCompany), '\n\n',
      'Pozwana: ', ORG(org), ', NIP ', EG(nip, 'identifier:nip'), ', z siedzibą w ', LOC(city2), ', ', ADR(addr2), '\n\n',
      'Wartość przedmiotu sporu: ', AMT(amounts[0]), '\n\n',
      'POZEW O ZAPŁATĘ\n\nUZASADNIENIE\n\n',
      'Strony łączyła umowa nr ', REF(generateInvoiceNumber(rng)), ' z dnia 2 stycznia 2026 r. Powód ',
      PN(person.surnameNom, 'personName:odmiana'), ' wykonał zlecenie w całości, co potwierdził ', ROLE(role2),
      ' pozwanej, pan ', PN(person2.nom), '.\n\n',
      'Powód od kilku lat ', HEALTH(healthPhrase, 'art910:health'),
      ', co utrudniło mu dochodzenie roszczenia we wcześniejszym terminie.\n\n',
      'Wezwanie do zapłaty na kwotę ', AMT(amounts[1]), ' pozostało bezskuteczne. Odsetki za opóźnienie wynoszą ',
      AMT(amounts[2]), '. Łączne roszczenie wynosi ', AMT(amounts[3]), ' (słownie: ', AMT(wordsAmount), ').\n\n',
      'Zapłata winna nastąpić na rachunek: ', EG(iban, 'identifier:ibanNrb'), '.\n\n',
      'W rozmowie telefonicznej ', ROLE(role3), ' pozwanej obiecał ', PN(person.surnameDat, 'personName:odmiana'),
      ' zapłatę „do końca miesiąca", czego nie dotrzymał.\n\n',
      ROLE(role1), ' ', PN(person.surnameNom, 'personName:odmiana'), '\n',
    ],
  };
}

// ── FP traps (RECALL-90-DESIGN.md §3.3: ~12% of volume, zero or minimal
// ground-truth entities by design — mirrors adw_32/33/34). ──────────────

function trapCytowania(rng, idx) {
  const citations = pickN(rng, CITATION_TRAPS, 2);
  const statutes = pickN(rng, STATUTE_TRAPS, 2);
  const withPerson = chance(rng, 0.4);
  const parts = [
    'Zgodnie z ', statutes[0], ' oraz ', statutes[1],
    ', a także w świetle stanowiska wyrażonego w ', citations[0],
    ' i podtrzymanego w ', citations[1], ', roszczenie zasługuje na uwzględnienie.\n',
  ];
  if (withPerson) {
    const person = pick(rng, ODMIANA_PEOPLE);
    parts.push('Pełnomocnik powoda ', PN(person.nom), ' podnosi te zarzuty z ostrożności procesowej.\n');
  }
  return { name: `hold_pulapka_cytowania_${pad2(idx)}`, attack: 'Cytowania orzecznictwa i przepisów jako pułapka FP — mirrors adw_32, zero lub jedna encja realna.', parts };
}

function trapNazwyPospolite(rng, idx) {
  const places = pickN(rng, COMMON_NOUN_PLACE_TRAPS, 2);
  const rate = pick(rng, RATE_TRAPS);
  const person = pick(rng, POSPOLITE_PEOPLE);
  return {
    name: `hold_pulapka_nazwy_${pad2(idx)}`,
    attack: 'Pułapka na nazwy pospolite (rzeka, działka, stopa procentowa) obok nazwiska-pułapki — mirrors adw_33.',
    parts: [
      'Nieruchomość położona jest ', places[0], ', w pobliżu ', places[1],
      '. Oprocentowanie kredytu wynosi ', rate, ' w stosunku rocznym. Pan ',
      PN(person.nom, 'personName:pospolite'), ' potwierdza powyższe ustalenia w swoim oświadczeniu.\n',
    ],
  };
}

function trapRoleGeneryczne(rng, idx) {
  const roles = pickN(rng, GENERIC_ROLE_TRAPS, 6);
  return {
    name: `hold_pulapka_role_${pad2(idx)}`,
    attack: 'Wyłącznie role procesowe generyczne, zero nazwisk — mirrors adw_34, czysty test FP.',
    parts: [
      `${roles[0]} wniósł o oddalenie powództwa. ${roles[1]} zażądał zabezpieczenia roszczenia. `,
      `${roles[2]} nie stawił się na termin. ${roles[3]} poinformował o bezskuteczności egzekucji. `,
      `${roles[4]} cofnął wniosek dowodowy, a ${roles[5]} przychylił się do stanowiska.\n`,
    ],
  };
}

// ── Assembly ──────────────────────────────────────────────────────────
// Every instance gets its own namespaced seed (`holdout/<template>/<i>`) so
// re-running the whole assembly is byte-identical, and bumping one
// template's instance count doesn't perturb any other template's draws.

export function assembleHoldoutDocs() {
  const docs = [];

  ODMIANA_PEOPLE.forEach((person, i) => docs.push(odmianaPismo(createRng(`holdout/odmiana/${i}`), person, i)));
  DWUCZLONOWE_PEOPLE.forEach((person, i) => docs.push(dwuczlonowePostanowienie(createRng(`holdout/dwuczlonowe/${i}`), person, i)));
  for (let i = 0; i < 10; i++) docs.push(inicjalyProtokol(createRng(`holdout/inicjaly/${i}`), i));
  for (let i = 0; i < 7; i++) docs.push(pospoliteZeznania(createRng(`holdout/pospolite/${i}`), i));
  for (let i = 0; i < 16; i++) docs.push(identifierShowcase(createRng(`holdout/identyfikatory/${i}`), i));
  for (let i = 0; i < 21; i++) docs.push(ocrMegaDokument(createRng(`holdout/ocr/${i}`), i));
  for (let i = 0; i < 12; i++) docs.push(diacriticsMixture(createRng(`holdout/diakrytyki/${i}`), i));
  for (let i = 0; i < 8; i++) docs.push(financialPismo(createRng(`holdout/finanse-umowa/${i}`), i, 'umowa'));
  for (let i = 0; i < 9; i++) docs.push(financialPismo(createRng(`holdout/finanse-wezwanie/${i}`), i, 'wezwanie'));
  for (let i = 0; i < 16; i++) docs.push(addressOrgPismo(createRng(`holdout/adres-org/${i}`), i));
  for (let i = 0; i < 10; i++) docs.push(art910Pismo(createRng(`holdout/art910-health/${i}`), i, 'health'));
  for (let i = 0; i < 11; i++) docs.push(art910Pismo(createRng(`holdout/art910-criminal/${i}`), i, 'criminal'));
  for (let i = 0; i < 9; i++) docs.push(art910Pismo(createRng(`holdout/art910-union/${i}`), i, 'union'));
  for (let i = 0; i < 5; i++) docs.push(art910Pismo(createRng(`holdout/art910-pozostale/${i}`), i, 'pozostale'));
  for (let i = 0; i < 18; i++) docs.push(daneOsoboweRejestr(createRng(`holdout/dane-osobowe/${i}`), i));
  for (let i = 0; i < 8; i++) docs.push(dlugiZlozonyDokument(createRng(`holdout/zlozony/${i}`), i));
  for (let i = 0; i < 8; i++) docs.push(trapCytowania(createRng(`holdout/pulapka-cytowania/${i}`), i));
  for (let i = 0; i < 6; i++) docs.push(trapNazwyPospolite(createRng(`holdout/pulapka-nazwy/${i}`), i));
  for (let i = 0; i < 6; i++) docs.push(trapRoleGeneryczne(createRng(`holdout/pulapka-role/${i}`), i));

  const names = docs.map((d) => d.name);
  if (new Set(names).size !== names.length) {
    throw new Error('assembleHoldoutDocs: duplicate document name detected');
  }
  return docs;
}
