// N-4 (LOCAL-VERIFIER-DESIGN.md §4.1): the same person named on both sides of
// a dispute within one document — e.g. "[PERSON_NAME_1]" (now a real name
// after deanonymization) appearing once as claimant, once as respondent.
// Matches names by exact string (a deliberate simplification — a full
// identity resolution across declined forms is W2/W3, a later phase) against
// the nearest preceding role word, then flags any name seen on both sides.
const SIDE_A = ['powód', 'powódka', 'wnioskodawca', 'wnioskodawczyni', 'wierzyciel', 'wierzycielka'];
const SIDE_B = ['pozwany', 'pozwana', 'uczestnik', 'uczestniczka', 'dłużnik', 'dłużniczka'];

function sideOf(roleWord) {
  const lower = roleWord.toLowerCase();
  if (SIDE_A.includes(lower)) return 'A';
  if (SIDE_B.includes(lower)) return 'B';
  return null;
}

function buildRolePattern() {
  const words = [...SIDE_A, ...SIDE_B];
  return new RegExp(`\\b(${words.join('|')})\\b\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)?)`, 'gi');
}

export function checkRoleConsistency(text) {
  const occurrences = [];
  for (const match of text.matchAll(buildRolePattern())) {
    const [full, roleWord, name] = match;
    const side = sideOf(roleWord);
    if (!side) continue;
    occurrences.push({ name, side, index: match.index, length: full.length, quote: full });
  }

  const sidesByName = new Map();
  for (const occ of occurrences) {
    if (!sidesByName.has(occ.name)) sidesByName.set(occ.name, new Set());
    sidesByName.get(occ.name).add(occ.side);
  }

  const findings = [];
  for (const occ of occurrences) {
    const sides = sidesByName.get(occ.name);
    if (sides.size > 1) {
      findings.push({
        checker: 'N-4',
        severity: 'wysoka',
        message: `„${occ.name}" występuje w piśmie w rolach po przeciwnych stronach sporu.`,
        index: occ.index,
        length: occ.length,
        quote: occ.quote,
      });
    }
  }
  return findings;
}
