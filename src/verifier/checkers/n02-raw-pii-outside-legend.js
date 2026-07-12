// N-2 (LOCAL-VERIFIER-DESIGN.md §4.1): raw PII-shaped data in the output text
// that wasn't among the values legend produced. Reuses findRegexEntities
// (anonymizer.js) — already the single source of truth for regex-detected
// PII (§2.5 of SHARED-FOUNDATION-DESIGN.md) — rather than a second copy of
// those patterns. A hit here usually means the LLM introduced data that
// wasn't part of the original anonymized document: a hallucinated PESEL, a
// number copied from the conversation rather than the source files, or a
// typo that turned a real legend value into a different-looking one.
//
// deduplicateEntities is required, not optional: several regex patterns can
// match the same digit run under different entity_group labels (an 11-digit
// PESEL is also shaped like the phone-number pattern), same as every other
// consumer of findRegexEntities in the real pipeline.
//
// FINANCIAL_AMOUNT is downgraded to informational: a sum, interest total, or
// court-fee amount the LLM computed itself (not copied from the legend) is
// normal in pisma o zapłatę, not an anomaly -- it's worth a glance, not a
// high-severity alarm. Raw personal PII (PESEL, NIP, e-mail, phone, account
// number) outside the legend stays high severity; that's genuinely suspicious.
import { findRegexEntities, deduplicateEntities } from '../../anonymizer.js';

const INFORMATIONAL_ENTITY_GROUPS = new Set(['FINANCIAL_AMOUNT']);

// NBSP (U+00A0) is a legitimate Polish thousands separator alongside a plain
// space, so amounts spelled with either one must compare equal against the
// legend regardless of which one the LLM happened to emit.
function normalizeWhitespace(value) {
  return value.replace(/\u00a0/g, ' ');
}

export function checkRawPiiOutsideLegend(text, legend = {}) {
  const legendValues = new Set(Object.values(legend).map(normalizeWhitespace));
  const findings = [];

  for (const entity of deduplicateEntities(findRegexEntities(text))) {
    const value = text.slice(entity.start, entity.end);
    if (legendValues.has(normalizeWhitespace(value))) continue;
    findings.push({
      checker: 'N-2',
      severity: INFORMATIONAL_ENTITY_GROUPS.has(entity.entity_group) ? 'informacyjna' : 'wysoka',
      message: `Wykryto dane (${entity.entity_group}) nieobecne w legendzie: „${value}".`,
      index: entity.start,
      length: value.length,
      quote: value,
    });
  }

  return findings;
}
