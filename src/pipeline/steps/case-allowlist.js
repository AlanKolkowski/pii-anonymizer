import { findAllowlistedSignatures } from '../case-allowlist.js';

export const CASE_ALLOWLIST_SOURCE = 'case-allowlist';

/**
 * ST-5 (SCOPE-TIERS-DESIGN.md §5.2 pkt 3): ner-phase step that marks the
 * user's own case signatures for masking. Only signatures the user typed in
 * are ever matched — every other DOCUMENT_REFERENCE in the document (cited
 * rulings, other cases) is untouched by this step. Emitted candidates carry
 * score 1.0 (deterministic match, same rationale as the regex tier) and
 * forceTier 'mask', so the tier partition masks them even though the type's
 * configured tier is 'pass' (§3.2 pkt 1); under the allMask profile the flag
 * is irrelevant (allMask already masks everything detected).
 *
 * Inactive (hard no-op) when the allowlist is empty — the zero-entry world
 * must stay byte-for-byte today's world (§5.3 pkt 4).
 *
 * @param {string[]} allowlist - raw entries as typed by the user
 */
export function createCaseAllowlistStep(allowlist) {
  const entries = (allowlist ?? []).filter((raw) => typeof raw === 'string' && raw.trim() !== '');
  const active = entries.length > 0;

  return function caseAllowlistStep(ctx) {
    if (!active) return ctx;
    const found = findAllowlistedSignatures(ctx.text, entries);
    if (found.length === 0) return ctx;
    const candidates = found.map(({ start, end }) => ({
      entity_group: 'DOCUMENT_REFERENCE',
      start,
      end,
      score: 1.0,
      source: CASE_ALLOWLIST_SOURCE,
      forceTier: 'mask',
    }));
    return { ...ctx, entities: [...ctx.entities, ...candidates] };
  };
}
