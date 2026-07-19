// FL-5-LIVE-WIRING-DESIGN.md §3.1: the one construction point that wires the
// proven, unmodified flexion engine (createFlexionResolver, case-detector,
// morph/*) into every LIVE deanonymization sink (U1-U4). Two pure, stateless
// functions — zero shared state, zero I/O — so every call site (workspace
// render/copy, flat export, DOCX reconstruction) builds an equivalent
// resolver from the same inputs (§2's "one builder per result" consistency
// guarantee, G-FL5-2).
//
// This module is NEW, sitting deliberately OUTSIDE the proven engine
// (flexion-resolver.js/morph/*/case-detector/*, §12: zero deltas there).
import { createFlexionResolver } from './flexion-resolver.js';
import { effectiveOutcomeLegend } from '../substitution.js';

// R-D9 (§4): a `seen` entry "TYPE::rawSurfaceForm" -> token is trusted only
// when the token means the SAME person in both the live legend and the
// legend actually in effect for this outcome (its `legendSnapshot`, if any).
// `refreshLegend` (main.js) rebuilds `seen`+the live legend from zero on
// every source change; an outcome's snapshot is taken once and can silently
// drift from the live legend if a later renumbering happens to collide on
// the same token index. `deriveAttested(seen)` (attested.js) — and, through
// it, `analyzePersonName`'s attested-form precedence (generate.js, ALWAYS
// wins before dictionary/rule generation) — has no notion of "whose" a
// surface form is; it will happily attest a completely different person's
// forms under a colliding token unless entries for that token are dropped
// here first.
//
// No snapshot (outcome.legendSnapshot absent) => effectiveOutcomeLegend
// returns the live legend itself => every token trivially agrees => every
// `seen` entry passes through unchanged (today's behavior, byte for byte).
export function filterSeenForLegend(seen, liveLegend, effectiveLegend) {
  const live = liveLegend ?? {};
  const effective = effectiveLegend ?? {};
  const filtered = {};
  for (const [key, token] of Object.entries(seen ?? {})) {
    if (key.indexOf('::') === -1) continue; // malformed key (no type separator) — skip, never throw
    if (!Object.prototype.hasOwnProperty.call(effective, token)) continue; // token not in this outcome's legend at all
    if (live[token] !== effective[token]) continue; // R-D9: token drifted to a different value live vs. effective
    filtered[key] = token;
  }
  return filtered;
}

/**
 * The single construction point (O-FL5-2) for every live sink's
 * resolveReplacement. `enabled === false` declines outright — the caller
 * (main.js) decides per sink whether the activation flag applies (U1-U3) or
 * not (U4, permanently "on" regardless of the flag, §7).
 *
 * The R-D9 filter (filterSeenForLegend) always runs whenever a resolver IS
 * built — this is the "unconditional, even at U4, outside the flag"
 * guarantee from O-FL5-3: it is a safety correction to an existing path, not
 * a feature gated by FLEXION_LIVE_DEFAULT.
 *
 * @param {{enabled?: boolean, morph?: object|null, seen?: Record<string,string>,
 *   liveLegend?: Record<string,string>, outcome?: object}} params
 * @returns {((ctx: object) => object|undefined) | undefined} a
 *   resolveReplacement implementation for resolveOccurrences
 *   (src/substitution.js), or undefined when declined (identity by omission,
 *   S2 falls back to the base legend value exactly as it does today).
 */
export function buildOutcomeResolver({ enabled = false, morph = null, seen, liveLegend, outcome } = {}) {
  if (!enabled) return undefined;
  const effective = effectiveOutcomeLegend(outcome, liveLegend);
  const filteredSeen = filterSeenForLegend(seen, liveLegend, effective);
  // O-FL5-1: minConfidence is always 'wysoka' here — none of U1-U4 has a
  // per-occurrence human approval step in v1 (that UI is FL-6), so a lower-
  // confidence suggestion must fail closed to the base value, exactly like
  // the DOCX precedent (O-DOCX-2(a)) this generalizes.
  return createFlexionResolver({ morph, seen: filteredSeen, minConfidence: 'wysoka' });
}
