// Holdout value pools (everything except people — see holdout-people.mjs)
// for test-data/adversarial-holdout. RECALL-90-DESIGN.md §3.2/§3.4: disjoint
// from the dev corpus (test-data/adversarial). Dev's documents cluster
// around Toruń/Kujawsko-Pomorskie (Toruń, Chełmno, Grudziądz, Golub-Dobrzyń,
// Chełmża, Bydgoszcz, Gdańsk) — holdout deliberately uses a different
// regional cluster (Wielkopolska) so no city/street/court name collides by
// construction, not just by luck.
import { int, pick, digits } from './rng.mjs';
import { generatePesel, generateNip, generateRegon9, generateRegon14, generateIban, generateVin } from './checksums.mjs';

// ── Roles / titles (PERSON_ROLE_OR_TITLE, manifest target 100) ──────────
// Matches B4-lite's lexicon vocabulary (RECALL-90-DESIGN.md §2.4) — using
// terms the lexicon actually models is what makes this corpus a meaningful
// recall measurement for that module, not just plausible-looking text.
export const ROLES = [
  'adwokat', 'radca prawny', 'notariusz', 'komornik sądowy', 'biegły sądowy',
  'sędzia', 'prokurator', 'referendarz sądowy', 'aplikant radcowski', 'aplikant adwokacki',
  'asesor notarialny', 'mecenas', 'prezes zarządu', 'wiceprezes zarządu', 'członek zarządu',
  'prokurent', 'dyrektor finansowy', 'dyrektor generalny', 'kierownik działu kadr',
  'główna księgowa', 'główny księgowy', 'sekretarz sądowy', 'starszy sekretarz sądowy',
  'protokolant', 'kurator sądowy', 'syndyk', 'likwidator spółki', 'rzeczoznawca majątkowy',
  'tłumacz przysięgły', 'specjalista ds. kadr i płac',
  // abbreviations
  'adw.', 'r.pr.', 'not.', 'prok.', 'sędzia SR', 'sędzia SO', 'sekr. sąd.', 'asyst. sęd.',
];

// ── Organizations (ORGANIZATION_NAME, manifest target 80) ───────────────
// Some entries are deliberately full-uppercase (wersaliki) — the B2 case-
// folding attack vector (RECALL-90-DESIGN.md §2.2), analogous to dev's ZUS
// example but using different institutions so it's not a literal repeat.
export const COURTS = [
  'Sąd Rejonowy w Poznaniu', 'Sąd Rejonowy w Kaliszu', 'Sąd Rejonowy w Koninie',
  'Sąd Okręgowy w Poznaniu, XIV Wydział Cywilny', 'Sąd Rejonowy Poznań-Stare Miasto w Poznaniu',
  'Sąd Rejonowy w Lesznie', 'Sąd Rejonowy w Gnieźnie', 'Sąd Okręgowy w Koninie',
];

export const COMPANIES = [
  'Wielkopolskie Zakłady Metalowe sp. z o.o.', 'Przedsiębiorstwo Budowlane „Jarocin" S.A.',
  'Hurtownia Spożywcza „Wągrowianka" sp. z o.o.', 'Zakład Stolarski Ignacy Wróbel',
  'Piekarnia „Pod Kogutem" Wacław Kogut', 'Bank Wielkopolski Spółka Akcyjna',
  'Spółdzielnia Mleczarska „Kaliszanka"', 'Przedsiębiorstwo Transportowe Emil Dzięcioł',
  'Kancelaria Radcy Prawnego „Górska i Wspólnicy"', 'Zakład Usług Komunalnych w Śremie sp. z o.o.',
];

export const UPPERCASE_INSTITUTIONS = [
  'URZĄD SKARBOWY W POZNANIU', 'POWIATOWY URZĄD PRACY W KALISZU', 'ZAKŁAD UBEZPIECZEŃ SPOŁECZNYCH',
  'PAŃSTWOWA INSPEKCJA PRACY', 'WIELKOPOLSKI URZĄD WOJEWÓDZKI',
];

export const ORGANIZATIONS = [...COURTS, ...COMPANIES];

// ── Locations (Wielkopolska cluster) ─────────────────────────────────────
export const CITIES = [
  'Poznań', 'Kalisz', 'Konin', 'Leszno', 'Gniezno', 'Ostrów Wielkopolski', 'Piła', 'Września',
  'Śrem', 'Środa Wielkopolska', 'Wolsztyn', 'Krotoszyn', 'Turek', 'Wągrowiec', 'Oborniki',
  'Grodzisk Wielkopolski', 'Kościan', 'Jarocin', 'Śmigiel', 'Czarnków',
];

// City name declined (locative-ish "w X" usage) — Polish city names in "w
// Poznaniu" style locative are common in court/address text. Hand-picked
// (not mechanically declined — city-name declension has too many patterns
// to generalize safely), only for the subset actually used that way.
export const CITIES_LOCATIVE = {
  'Poznań': 'Poznaniu', 'Kalisz': 'Kaliszu', 'Konin': 'Koninie', 'Leszno': 'Lesznie',
  'Gniezno': 'Gnieźnie', 'Ostrów Wielkopolski': 'Ostrowie Wielkopolskim', 'Piła': 'Pile',
  'Września': 'Wrześni', 'Śrem': 'Śremie', 'Środa Wielkopolska': 'Środzie Wielkopolskiej',
  'Wolsztyn': 'Wolsztynie', 'Krotoszyn': 'Krotoszynie', 'Turek': 'Turku', 'Wągrowiec': 'Wągrowcu',
  'Oborniki': 'Obornikach', 'Grodzisk Wielkopolski': 'Grodzisku Wielkopolskim', 'Kościan': 'Kościanie',
  'Jarocin': 'Jarocinie', 'Śmigiel': 'Śmiglu', 'Czarnków': 'Czarnkowie',
};

const STREET_NAMES = [
  'Klasztorna', 'Ogrodowa', 'Słoneczna', 'Kolejowa', 'Lipowa', 'Sosnowa', 'Brzozowa',
  'Wierzbowa', 'Cicha', 'Spokojna', 'Kwiatowa', 'Parkowa', 'Leśna', 'Wrzosowa', 'Jarzębinowa',
  'Dworcowa', 'Fabryczna', 'Graniczna', 'Widokowa', 'Zielona',
];

/** Deterministic street address in "ul. X N[/M], NN-NNN Miasto" shape,
 * mirroring the dev corpus's own POSTAL_ADDRESS convention. */
export function generateAddress(rng, city = pick(rng, CITIES)) {
  const street = pick(rng, STREET_NAMES);
  const number = int(rng, 1, 98);
  const flat = int(rng, 0, 1) === 1 ? `/${int(rng, 1, 40)}` : '';
  const postal = `${String(int(rng, 60, 64)).padStart(2, '0')}-${digits(rng, 3)}`;
  return `ul. ${street} ${number}${flat}, ${postal} ${city}`;
}

// ── Financial amounts (FINANCIAL_AMOUNT, manifest target 80) ────────────
// Format variety mirrors dev (kropka tysięcy, EUR, PLN prefix, słownie,
// procenty) but with different specific magnitudes.
const AMOUNT_WORDS_ONES = ['jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const AMOUNT_WORDS_TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście'];
const AMOUNT_WORDS_TENS = ['dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt'];

/** A plausible (not exhaustive) spelled-out PLN amount — deliberately
 * simple grammar, enough to exercise the "kwota słownie" detection gap
 * (RECALL-90-DESIGN.md L8) without a full numeral-to-words engine. */
export function generateAmountWords(rng) {
  const thousands = pick(rng, ['jedenaście', 'siedemnaście', 'dwadzieścia dwa', 'trzydzieści cztery']);
  const hundreds = pick(rng, ['sto', 'dwieście', 'czterysta', 'sześćset', 'osiemset']);
  const tens = pick(rng, AMOUNT_WORDS_TENS);
  const ones = pick(rng, AMOUNT_WORDS_ONES);
  return `${thousands} tysięcy ${hundreds} ${tens} ${ones} złotych 00/100`;
}

export function generateAmountDigits(rng, { style = pick(rng, ['dot-thousands', 'space-thousands', 'plain', 'eur', 'pln-prefix']) } = {}) {
  const whole = int(rng, 1, 89);
  const thousands = int(rng, 1, 999);
  const cents = String(int(rng, 0, 99)).padStart(2, '0');
  switch (style) {
    case 'dot-thousands': return `${whole}.${String(thousands).padStart(3, '0')},${cents} zł`;
    case 'space-thousands': return `${whole} ${String(thousands).padStart(3, '0')},${cents} zł`;
    case 'eur': return `${whole} ${String(thousands).padStart(3, '0')},${cents} EUR`;
    case 'pln-prefix': return `PLN ${whole}.${String(thousands).padStart(3, '0')}`;
    default: return `${thousands} zł`;
  }
}

// ── Document references (DOCUMENT_REFERENCE, manifest target 80) ────────
// Repertorium codes mirror the app's own whitelist (src/anonymizer.js
// COURT_REPERTORIUM) so these are genuinely detectable, not just plausible.
const REPERTORIA = ['ACa', 'GC', 'KM', 'Nc', 'Ns', 'Co', 'C', 'K'];
// Matches the app's own ROMAN_DIVISION alternation exactly (src/anonymizer.js:
// `X{1,2}|IX|IV|V?I{1,3}`) — note bare "V" is NOT accepted by that pattern
// (it requires at least one trailing I), so it's deliberately excluded here.
const ROMAN_DIVISIONS = ['I', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function generateDocketNumber(rng) {
  const withDivision = int(rng, 0, 1) === 1;
  const division = withDivision ? `${pick(rng, ROMAN_DIVISIONS)} ` : '';
  const repertorium = pick(rng, REPERTORIA);
  const number = int(rng, 1, 9999);
  const year = int(rng, 23, 26);
  const upr = int(rng, 0, 4) === 0 ? ' upr' : '';
  return `${division}${repertorium} ${number}/${year}${upr}`;
}

export function generateInvoiceNumber(rng) {
  const prefix = pick(rng, ['FV', 'UD', 'ZK', 'WZ']);
  const year = int(rng, 2024, 2026);
  const month = String(int(rng, 1, 12)).padStart(2, '0');
  const seq = String(int(rng, 1, 999)).padStart(4, '0');
  return `${prefix}/${year}/${month}/${seq}`;
}

// ── Identifier document formats (no checksum — same precedent as dev: ───
// dowód/paszport/prawo jazdy/rejestracja aren't regex-checksummed by the
// app either, so format-only is the right fidelity level here too.
const ID_LETTERS = 'ABDEFGHKLMNPRSTWZ'.split(''); // avoid visually confusing I/O/Q/U/V/C/J/X/Y
export function generateDowodOsobisty(rng) {
  const letters = Array.from({ length: 3 }, () => pick(rng, ID_LETTERS)).join('');
  return `${letters} ${digits(rng, 6)}`;
}
export function generatePaszport(rng) {
  const letters = Array.from({ length: 2 }, () => pick(rng, ID_LETTERS)).join('');
  return `${letters} ${digits(rng, 7)}`;
}
export function generatePrawoJazdy(rng) {
  return `${digits(rng, 5)}/${digits(rng, 2)}/${digits(rng, 4)}`;
}
const PLATE_PREFIXES = ['PO', 'PK', 'PN', 'PC', 'PS', 'PJ', 'PT', 'PL', 'PG', 'PZ'];
export function generateRejestracja(rng) {
  const prefix = pick(rng, PLATE_PREFIXES);
  const bodyLen = int(rng, 4, 5);
  const alnum = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'.split('');
  const body = Array.from({ length: bodyLen }, () => pick(rng, alnum)).join('');
  return `${prefix} ${body}`;
}

// ── Identifier family generators, bundled with a human-readable subtype ──
// tag for the manifest's identifierSubtypes self-check (holdout-manifest.json).
export function generateIdentifier(rng, subtype) {
  switch (subtype) {
    case 'pesel': return { subtype, value: generatePesel(rng), entityGroup: 'PERSON_IDENTIFIER' };
    case 'dowodOsobisty': return { subtype, value: generateDowodOsobisty(rng), entityGroup: 'PERSON_IDENTIFIER' };
    case 'paszport': return { subtype, value: generatePaszport(rng), entityGroup: 'PERSON_IDENTIFIER' };
    case 'prawoJazdy': return { subtype, value: generatePrawoJazdy(rng), entityGroup: 'PERSON_IDENTIFIER' };
    case 'nip': return { subtype, value: generateNip(rng), entityGroup: 'ORGANIZATION_IDENTIFIER' };
    case 'regon': return {
      subtype,
      value: int(rng, 0, 1) === 0 ? generateRegon9(rng) : generateRegon14(rng),
      entityGroup: 'ORGANIZATION_IDENTIFIER',
    };
    case 'krs': return { subtype, value: digits(rng, 10), entityGroup: 'ORGANIZATION_IDENTIFIER', needsKrsContext: true };
    case 'ibanNrb': {
      const { iban, nrb } = generateIban(rng);
      return { subtype, value: int(rng, 0, 1) === 0 ? iban : nrb, entityGroup: 'BANK_ACCOUNT_IDENTIFIER' };
    }
    case 'vin': return { subtype, value: generateVin(rng), entityGroup: 'VEHICLE_IDENTIFIER' };
    case 'rejestracja': return { subtype, value: generateRejestracja(rng), entityGroup: 'VEHICLE_IDENTIFIER' };
    default: throw new Error(`generateIdentifier: unknown subtype "${subtype}"`);
  }
}

// ── Art. 9-10 RODO phrases (HEALTH_DATA / CRIMINAL_OFFENCE_DATA / ───────
// TRADE_UNION_MEMBERSHIP + pozostałe). Written from the definition of the
// fact (a minimal phrase carrying it), NOT from B3's lexicon patterns —
// RECALL-90-DESIGN.md §3.5 point 2 is explicit that GT must never be
// written "pod wzorce B3": a rewrite here should never be motivated by
// "would B3 catch this", only by "is this the minimal fact-bearing span".
export const HEALTH_PHRASES = [
  'cierpi na przewlekłą niewydolność nerek', 'zdiagnozowano u niej stwardnienie rozsiane',
  'leczy się psychiatrycznie od pięciu lat', 'przebył zawał mięśnia sercowego',
  'orzeczenie o niepełnosprawności w stopniu znacznym', 'pozostaje pod stałą opieką kardiologiczną',
  'cierpi na chorobę Parkinsona', 'zdiagnozowano nowotwór złośliwy piersi',
  'leczy się z powodu nadciśnienia tętniczego', 'przebywał na zwolnieniu lekarskim z powodu depresji',
  'cierpi na astmę oskrzelową', 'jest uzależniony od alkoholu',
  'przeszedł operację kardiochirurgiczną', 'zdiagnozowano u niego padaczkę',
  'korzysta z rehabilitacji po udarze mózgu',
];
export const CRIMINAL_PHRASES = [
  'skazany wyrokiem za kradzież z włamaniem', 'był uprzednio karany za znęcanie się nad rodziną',
  'toczy się przeciwko niemu postępowanie karne o oszustwo', 'odbywał karę pozbawienia wolności',
  'figuruje w Krajowym Rejestrze Karnym', 'skazany prawomocnie za jazdę w stanie nietrzeźwości',
  'postawiono mu zarzut fałszowania dokumentów', 'wyrokiem nakazowym ukarany za wykroczenie drogowe',
  'toczyło się przeciwko niej dochodzenie o zniesławienie', 'był tymczasowo aresztowany w sprawie o rozbój',
];
export const UNION_PHRASES = [
  'jest członkiem Niezależnego Samorządnego Związku Zawodowego «Metalowcy»',
  'pełni funkcję przewodniczącego zakładowej organizacji związkowej',
  'należy do Związku Zawodowego Pracowników Oświaty',
  'korzysta z ochrony związkowej jako działacz OPZZ',
  'jest członkinią Związku Nauczycielstwa Polskiego',
  'przystąpiła do związku zawodowego «Solidarność» w zakładzie pracy',
  'reprezentuje pracowników jako delegat związkowy',
];
export const RELIGION_PHRASES = [
  'jest wyznania grekokatolickiego', 'praktykuje jako świadek Jehowy',
  'deklaruje przynależność do Kościoła Ewangelicko-Augsburskiego', 'jest osobą niewierzącą',
];
export const POLITICAL_PHRASES = [
  'jest członkiem partii politycznej o profilu lewicowym', 'otwarcie popiera ruch libertariański',
  'działa w lokalnej strukturze partyjnej', 'uczestniczył w wiecach organizacji o poglądach konserwatywnych',
];
export const SEXUAL_ORIENTATION_PHRASES = [
  'pozostaje w związku jednopłciowym', 'ujawniła swoją orientację homoseksualną w toku zeznań',
  'żyje w nieformalnym związku partnerskim z osobą tej samej płci', 'określa się jako osoba biseksualna',
];
export const ETHNIC_ORIGIN_PHRASES = [
  'jest pochodzenia romskiego', 'deklaruje przynależność do mniejszości niemieckiej',
  'posiada korzenie tatarskie', 'identyfikuje się jako osoba pochodzenia ukraińskiego',
];

// ── FP traps (no ground-truth entity by design; ~12% volume target) ─────
// Fresh case-law signatures / statute citations / common-noun place names /
// generic procedural roles — distinct literal values from dev's own trap
// set (adw_32/33/34), same mechanism.
export const CITATION_TRAPS = [
  'uchwale składu siedmiu sędziów (sygn. akt III CZP 41/23)',
  'wyroku z dnia 9 września 2022 r. (II CSKP 331/22)',
  'postanowieniu Sądu Najwyższego (sygn. I NSNc 88/21)',
  'wyroku Trybunału Sprawiedliwości Unii Europejskiej z dnia 21 grudnia 2016 r. (C-154/15)',
];
export const STATUTE_TRAPS = [
  'art. 358¹ § 3 Kodeksu cywilnego', 'art. 720 § 1 k.c.', 'art. 6 ust. 1 lit. b RODO',
  'art. 189 k.p.c.', 'ustawie z dnia 12 maja 2011 r. o kredycie konsumenckim (Dz.U. z 2024 r. poz. 1497 ze zm.)',
];
export const COMMON_NOUN_PLACE_TRAPS = [
  'nad Wartą', 'przy Rynku Głównym', 'w pobliżu dawnego Zamku Górków', 'działce nr 88/6',
  'ulicy Kowalskiej (nazwa nie pochodzi od nazwiska strony)',
];
export const GENERIC_ROLE_TRAPS = [
  'Powód', 'Pozwany', 'Wnioskodawca', 'Uczestnik postępowania', 'Wierzyciel', 'Dłużnik',
  'Zamawiający', 'Wykonawca', 'Najemca', 'Wynajmujący', 'Kredytobiorca', 'Kredytodawca',
];
export const RATE_TRAPS = ['8,75%', '2,10 p.p.', 'WIBOR 3M', '12,40% w skali roku', 'RRSO 14,02%'];
