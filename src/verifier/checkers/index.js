// Level-1 verifier checkers (LOCAL-VERIFIER-DESIGN.md W5, §4.1): pure
// functions text -> findings. The catalog is deliberately open — adding a
// checker is just another file exporting a function of this shape plus a
// registration below. Findings never block anything (V2/§9.3): they're
// surfaced to the radca for review, never auto-applied.
export { checkUnresolvedTokens } from './n01-unresolved-tokens.js';
export { checkRawPiiOutsideLegend } from './n02-raw-pii-outside-legend.js';
export { checkGenderAgreement } from './n03-gender-agreement.js';
export { checkRoleConsistency } from './n04-role-consistency.js';
export { checkAmountWordsVsDigits } from './n05-amount-words-vs-digits.js';
export { checkImpossibleDates } from './n06-impossible-dates.js';
export { checkSignatureVariants } from './n07-signature-variants.js';
export { checkLlmArtifacts } from './n08-llm-artifacts.js';
export { checkDuplicateParagraphs } from './n09-duplicate-paragraphs.js';
export { checkStrayBrackets } from './n10-stray-brackets.js';

import { checkUnresolvedTokens } from './n01-unresolved-tokens.js';
import { checkRawPiiOutsideLegend } from './n02-raw-pii-outside-legend.js';
import { checkGenderAgreement } from './n03-gender-agreement.js';
import { checkRoleConsistency } from './n04-role-consistency.js';
import { checkAmountWordsVsDigits } from './n05-amount-words-vs-digits.js';
import { checkImpossibleDates } from './n06-impossible-dates.js';
import { checkSignatureVariants } from './n07-signature-variants.js';
import { checkLlmArtifacts } from './n08-llm-artifacts.js';
import { checkDuplicateParagraphs } from './n09-duplicate-paragraphs.js';
import { checkStrayBrackets } from './n10-stray-brackets.js';

// Checkers that only need the output text.
const TEXT_ONLY_CHECKERS = [
  checkUnresolvedTokens,
  checkGenderAgreement,
  checkRoleConsistency,
  checkAmountWordsVsDigits,
  checkImpossibleDates,
  checkSignatureVariants,
  checkLlmArtifacts,
  checkDuplicateParagraphs,
  checkStrayBrackets,
];

export function runAllCheckers(text, { legend = {} } = {}) {
  const findings = [
    ...TEXT_ONLY_CHECKERS.flatMap((checker) => checker(text)),
    ...checkRawPiiOutsideLegend(text, legend),
  ];
  return findings.sort((a, b) => a.index - b.index);
}
