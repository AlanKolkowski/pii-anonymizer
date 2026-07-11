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
import { findRegexEntities, deduplicateEntities } from '../../anonymizer.js';

export function checkRawPiiOutsideLegend(text, legend = {}) {
  const legendValues = new Set(Object.values(legend));
  const findings = [];

  for (const entity of deduplicateEntities(findRegexEntities(text))) {
    const value = text.slice(entity.start, entity.end);
    if (legendValues.has(value)) continue;
    findings.push({
      checker: 'N-2',
      severity: 'wysoka',
      message: `Wykryto dane (${entity.entity_group}) nieobecne w legendzie: „${value}".`,
      index: entity.start,
      length: value.length,
      quote: value,
    });
  }

  return findings;
}
