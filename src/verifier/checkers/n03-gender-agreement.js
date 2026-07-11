// N-3 (LOCAL-VERIFIER-DESIGN.md §4.1): procedural-role word vs. the
// grammatical gender of the name right after it — e.g. "powódka Jan
// Kowalski" (feminine role, masculine name). This is a light heuristic, not
// the full morphology engine (W2, a later phase): a small role lexicon plus
// a name-gender guess (a short hardcoded exception list for male names
// ending in "-a", per LOCAL-VERIFIER §3.2 K1 — "Kuba/Kosma/Barnaba w danych,
// nie w regule 'końcówka -a'"; otherwise names ending in "-a" are treated as
// feminine). Findings are informational nudges for a human to double-check,
// not a claim of certainty.
const ROLE_PAIRS = [
  ['powód', 'powódka'],
  ['pozwany', 'pozwana'],
  ['wnioskodawca', 'wnioskodawczyni'],
  ['uczestnik', 'uczestniczka'],
  ['dłużnik', 'dłużniczka'],
  ['wierzyciel', 'wierzycielka'],
  ['kredytobiorca', 'kredytobiorczyni'],
  ['pełnomocnik', 'pełnomocniczka'],
  ['świadek', null], // epicene by convention — no gendered counterpart to compare against
];

const MALE_NAME_EXCEPTIONS = new Set([
  'kuba', 'kosma', 'barnaba', 'bonawentura', 'jarema', 'boryna', 'aleksa',
]);

function guessNameGender(name) {
  const lower = name.toLowerCase();
  if (MALE_NAME_EXCEPTIONS.has(lower)) return 'm';
  return lower.endsWith('a') ? 'f' : 'm';
}

function buildRolePattern() {
  const words = ROLE_PAIRS.flatMap(([m, f]) => [m, f]).filter(Boolean);
  return new RegExp(`\\b(${words.join('|')})\\b\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)`, 'gi');
}

function roleGender(roleWord) {
  const lower = roleWord.toLowerCase();
  for (const [m, f] of ROLE_PAIRS) {
    if (lower === m) return 'm';
    if (f && lower === f) return 'f';
  }
  return null;
}

export function checkGenderAgreement(text) {
  const findings = [];
  for (const match of text.matchAll(buildRolePattern())) {
    const [full, roleWord, name] = match;
    const expected = roleGender(roleWord);
    if (!expected) continue; // epicene role (e.g. świadek) — nothing to compare
    const actual = guessNameGender(name);
    if (expected !== actual) {
      findings.push({
        checker: 'N-3',
        severity: 'średnia',
        message: `Możliwa niezgodność rodzaju: „${roleWord}" (rodzaj ${expected === 'f' ? 'żeński' : 'męski'}) obok imienia „${name}" (wygląda na rodzaj ${actual === 'f' ? 'żeński' : 'męski'}).`,
        index: match.index,
        length: full.length,
        quote: full,
      });
    }
  }
  return findings;
}
