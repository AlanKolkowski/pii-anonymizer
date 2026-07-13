// Checksum generation for the corpus 2.0 identifier family (PESEL, NIP,
// REGON-9, REGON-14, IBAN/NRB) — RECALL-90-DESIGN.md §3.4 point 4: "wszystkie
// wartości w 100% fikcyjne (sumy kontrolne poprawne, przynależność żadna)".
//
// The *ChecksumValid validators below are a deliberate, exact mirror of the
// private helpers in src/anonymizer.js (A1, EVAL-RECALL-AUDIT §8) — same
// weights, same modulus, same edge-case handling — so every identifier this
// generator emits validates against the app's own detector, not just against
// itself. If those algorithms ever change, update both places together
// (checksums.test.js cross-checks against the app's findRegexEntities to
// catch drift).
//
// Only PESEL/NIP/REGON/IBAN get real checksums, matching A1's contract
// (RECALL-90-DESIGN.md §8.1 excerpt in EVAL-RECALL-AUDIT.md: "PESEL wagi
// 1-3-7-9…, NIP mod 11, REGON mod 11, IBAN mod 97"). KRS, dowód osobisty,
// paszport, prawo jazdy and vehicle plates have no checksum in the app
// either — they stay format-only, same precedent as the existing dev corpus.
import { int, digits } from './rng.mjs';

// ── Validators (mirror src/anonymizer.js) ──────────────────────────────

export function peselChecksumValid(d) {
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  return ((10 - (sum % 10)) % 10) === (d.charCodeAt(10) - 48);
}

export function nipChecksumValid(d) {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  const check = sum % 11;
  return check !== 10 && check === (d.charCodeAt(9) - 48);
}

export function regon9ChecksumValid(d) {
  const weights = [8, 9, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  const check = sum % 11;
  return (check === 10 ? 0 : check) === (d.charCodeAt(8) - 48);
}

export function regon14ChecksumValid(d) {
  const weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += weights[i] * (d.charCodeAt(i) - 48);
  const check = sum % 11;
  return (check === 10 ? 0 : check) === (d.charCodeAt(13) - 48);
}

// compact: "PL" + 26 digits, no separators (mirrors anonymizer.js exactly).
export function ibanChecksumValid(compact) {
  if (!/^[A-Z]{2}\d+$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

// ── Generators ──────────────────────────────────────────────────────────

/** 11-digit PESEL with a valid check digit. Century encoding (month + 20 for
 * 2000s etc.) is intentionally skipped — every generated person is "born"
 * 1945-1999, which needs no offset — since nothing in the pipeline or the
 * scoring cross-checks PESEL-encoded birth date against an annotated
 * DATE_OF_BIRTH entity. */
export function generatePesel(rng, opts = {}) {
  const year = opts.year ?? int(rng, 1945, 1999);
  const month = opts.month ?? int(rng, 1, 12);
  const day = opts.day ?? int(rng, 1, 28);
  const sex = opts.sex ?? (int(rng, 0, 1) === 0 ? 'M' : 'F');
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const serial = digits(rng, 3);
  const sexDigits = sex === 'M' ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8];
  const sexDigit = sexDigits[int(rng, 0, 4)];
  const body = `${yy}${mm}${dd}${serial}${sexDigit}`;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += weights[i] * (body.charCodeAt(i) - 48);
  const check = (10 - (sum % 10)) % 10;
  const pesel = body + check;
  if (!peselChecksumValid(pesel)) throw new Error(`generatePesel: internal error, produced invalid PESEL ${pesel}`);
  return pesel;
}

/** 10-digit NIP with a valid check digit. sum%11===10 has no valid check
 * digit under the algorithm (0-9 only) — retry with a fresh body on that
 * roll (~1/11 chance) rather than silently emitting something invalid. */
export function generateNip(rng) {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  for (let attempt = 0; attempt < 50; attempt++) {
    const body = digits(rng, 9);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += weights[i] * (body.charCodeAt(i) - 48);
    const check = sum % 11;
    if (check === 10) continue;
    const nip = body + check;
    if (!nipChecksumValid(nip)) throw new Error(`generateNip: internal error, produced invalid NIP ${nip}`);
    return nip;
  }
  throw new Error('generateNip: exhausted retries (should be ~1/11 per draw)');
}

/** 9-digit REGON with a valid check digit. Unlike NIP, sum%11===10 is
 * defined to mean check digit 0 — every random body is usable. */
export function generateRegon9(rng) {
  const weights = [8, 9, 2, 3, 4, 5, 6, 7];
  const body = digits(rng, 8);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += weights[i] * (body.charCodeAt(i) - 48);
  const check = sum % 11;
  const regon = body + (check === 10 ? 0 : check);
  if (!regon9ChecksumValid(regon)) throw new Error(`generateRegon9: internal error, produced invalid REGON9 ${regon}`);
  return regon;
}

/** 14-digit REGON extending a valid 9-digit REGON (realistic: real REGON-14
 * numbers are always a valid REGON-9 "parent" + 4-digit local-unit suffix +
 * a fresh check digit over all 13 preceding digits). The app's own
 * regon14ChecksumValid doesn't require the REGON-9 nesting — only that the
 * 13-weight sum matches — but nesting it anyway costs nothing and is what a
 * careful reviewer would expect from "100% fikcyjne, sumy kontrolne
 * poprawne". */
export function generateRegon14(rng, regon9 = generateRegon9(rng)) {
  const weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  const suffix = digits(rng, 4);
  const body13 = regon9 + suffix;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += weights[i] * (body13.charCodeAt(i) - 48);
  const check = sum % 11;
  const regon = body13 + (check === 10 ? 0 : check);
  if (!regon14ChecksumValid(regon)) throw new Error(`generateRegon14: internal error, produced invalid REGON14 ${regon}`);
  return regon;
}

/** Polish IBAN ("PL" + 26 digits) with valid mod-97 check digits, and the
 * bare 26-digit NRB (Poland's domestic check digits ARE the IBAN check
 * digits — see comment on ibanChecksumValid). Standard "insert placeholder
 * 00, solve for the true check via 98 - remainder" derivation. */
export function generateIban(rng, opts = {}) {
  const bankSort = opts.bankSort ?? digits(rng, 8);
  const account = opts.account ?? digits(rng, 16);
  const bban = bankSort + account; // 24 digits
  const rearranged = `${bban}2521${'00'}`; // BBAN + "PL"(→25,21) + placeholder check
  const remainder = Number(BigInt(rearranged) % 97n);
  const check = 98 - remainder; // always in [2, 98] for remainder in [0, 96]
  const checkStr = String(check).padStart(2, '0');
  const nrb = checkStr + bban; // 26 digits
  const iban = `PL${nrb}`;
  if (!ibanChecksumValid(iban)) throw new Error(`generateIban: internal error, produced invalid IBAN ${iban}`);
  return { iban, nrb };
}

/** 17-char VIN: uppercase letters minus I/O/Q plus digits, at least one of
 * each — matches VIN_RE in src/anonymizer.js exactly (structural precision,
 * no checksum in this app). */
const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'.split('');
export function generateVin(rng) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let vin = '';
    for (let i = 0; i < 17; i++) vin += VIN_ALPHABET[int(rng, 0, VIN_ALPHABET.length - 1)];
    if (/\d/.test(vin) && /[A-Z]/.test(vin)) return vin;
  }
  throw new Error('generateVin: exhausted retries (should be extremely rare)');
}
