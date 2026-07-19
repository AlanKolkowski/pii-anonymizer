// PII control scan (MOST-IMPL-PLAN.md §3 M4, §5; MCP-BRIDGE-DESIGN.md §6.3).
// The second layer above the renderer's own token discipline (W1): runs
// independently, in the main process, on payloads the renderer has already
// produced — so a bug or a compromise in the renderer does not get a free
// pass through the gate. Zero I/O, zero Electron: reuses the exact
// regex/token logic the pipeline already ships, per the R-3 closed import
// list (this file + mcp-stdio.mjs are the only electron/ modules allowed to
// reach into src/):
//   src/anonymizer.js   -> findRegexEntities
//   src/tokens.js       -> containsToken
// (src/substitution.js and identifier-patterns.json are anonymizer.js's own
// transitive, environment-clean dependencies — see
// electron/bridge/src-import-closure.test.js for the standing proof that
// this chain never reaches DOM/window or anything outside this list.)
//
// This scan WARNS; it never auto-blocks — EXCEPT the token assertion on
// outbound payloads, which is a hard, structural rule (W1), not a
// heuristic: a read_source/read_outcome/list_* payload with zero
// anonymization tokens has failed tokenization, full stop, and the gate
// must not even open for it.
import { findRegexEntities, deduplicateEntities } from '../../src/anonymizer.js';
import { containsToken } from '../../src/tokens.js';

// §5 classification table, keyed by entity_group — that is what
// findRegexEntities emits and what the (future) gate window highlights
// against, so classifying by entity_group is the only thing worth doing
// here; classifying by "which specific regex fired" would just be a longer
// way to say the same thing.
const HARD_ENTITY_GROUPS = new Set([
  'PERSON_IDENTIFIER', // PESEL, dowód osobisty, paszport, prawo jazdy (all emit this group)
  'ORGANIZATION_IDENTIFIER', // NIP, REGON, KRS
  'BANK_ACCOUNT_IDENTIFIER', // IBAN / NRB
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
]);
const SOFT_ENTITY_GROUPS = new Set([
  'FINANCIAL_AMOUNT',
  'DOCUMENT_REFERENCE', // sygnatury — legitimately common in tokenized legal text
  'VEHICLE_IDENTIFIER', // tablice rejestracyjne, VIN
  'LAND_REGISTER_IDENTIFIER', // numer księgi wieczystej
]);

// An entity_group this scan doesn't recognize defaults to "hard" — fail
// toward more scrutiny (one extra forced checkbox), never toward less. The
// scan never auto-blocks on tier regardless, so the only cost of the
// default is UI emphasis, not a dropped payload.
export function classifyEntityGroup(entityGroup) {
  if (SOFT_ENTITY_GROUPS.has(entityGroup)) return 'soft';
  return 'hard';
}
// Exported for callers that want the raw sets (e.g. a future gate window's
// hard/soft color key) without re-deriving them from classifyEntityGroup.
// NOTE: unrelated to the deanonymization "legend" (token -> raw PII map) —
// deliberately not using that word here to keep it unambiguous for anyone
// grepping this codebase for that security-sensitive term.
export { HARD_ENTITY_GROUPS, SOFT_ENTITY_GROUPS };

export function scanForPii(text) {
  // findRegexEntities runs each identifier family independently and does not
  // dedupe across them, so a single 11-digit PESEL also structurally matches
  // the generic PHONE_NUMBER pattern (both are valid "precise" regex reads
  // of the same span) — expected at that layer, where a later pipeline step
  // is responsible for arbitration. A gate-window highlight is that later
  // step for this scan: two overlapping highlights over identical
  // characters would be confusing, not more informative, so the same
  // dedup pass the main pipeline already uses (deduplicateEntities, no
  // tierOf => single bucket, precise-regex-vs-precise-regex ties broken by
  // whichever finder ran first) collapses them to one hit per span before
  // classification.
  return deduplicateEntities(findRegexEntities(text), text)
    .map((e) => ({
      start: e.start,
      end: e.end,
      entity_group: e.entity_group,
      tier: classifyEntityGroup(e.entity_group),
    }))
    .sort((a, b) => a.start - b.start);
}

export function hasHardHit(hits) {
  return hits.some((h) => h.tier === 'hard');
}

// W1, structural: true iff the payload contains at least one anonymization
// token (including the case-annotated form, decyzja 17 — containsToken
// already understands both).
export function assertTokensPresent(text) {
  return containsToken(text);
}

// Outbound direction (read_source / read_outcome / list_*): the payload the
// renderer produced is what leaves the machine if the human approves it.
// The token assertion mirrors the renderer's own rule as defense in depth;
// the regex scan on top is informational only (never blocks) — its result
// drives the gate window's highlighting and forced checkbox (§5/§6.2).
export function checkOutboundPayload(text) {
  if (!assertTokensPresent(text)) {
    return { ok: false, reason: 'no-tokens', hits: [] };
  }
  return { ok: true, hits: scanForPii(text) };
}

// Inbound direction (write_outcome): text authored by the LLM/client. No
// token assertion — legitimate assistant prose has no tokens on most lines —
// but the same regex scan runs to surface "the client knows more than it
// should" (MCP-BRIDGE-DESIGN.md §6.3: a raw PESEL arriving FROM the client
// is a signal, not proof of a leak this app caused). Never blocks.
export function checkInboundPayload(text) {
  return { ok: true, hits: scanForPii(text) };
}

// §3 M4 "Walidacja kształtu wyniku": exactly
// {content:[{type:'text', text:string}], isError?:boolean} — one content
// element, no extra fields anywhere. Applies to whatever the renderer
// (listings.js builders) handed back, independent of the PII scan above.
export function validateToolResultShape(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, reason: 'not-an-object' };
  }
  const allowedTopKeys = new Set(['content', 'isError']);
  if (Object.keys(result).some((k) => !allowedTopKeys.has(k))) {
    return { ok: false, reason: 'extra-fields' };
  }
  if (!Array.isArray(result.content) || result.content.length !== 1) {
    return { ok: false, reason: 'content-shape' };
  }
  const [item] = result.content;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, reason: 'content-shape' };
  }
  const allowedItemKeys = new Set(['type', 'text']);
  if (Object.keys(item).some((k) => !allowedItemKeys.has(k))) {
    return { ok: false, reason: 'content-shape' };
  }
  if (item.type !== 'text' || typeof item.text !== 'string') {
    return { ok: false, reason: 'content-shape' };
  }
  if (result.isError !== undefined && typeof result.isError !== 'boolean') {
    return { ok: false, reason: 'content-shape' };
  }
  return { ok: true };
}
