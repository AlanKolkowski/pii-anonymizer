// FLEKSJA-IMPL-PLAN.md core scope: wires the morphology engine (analyze.js/
// generate.js) + case-detector cascade (detect.js) + attested forms
// (attested.js) into a resolveReplacement implementation — the seam
// resolveOccurrences (src/substitution.js) already defines and every
// current UI call site simply never fills in (identity by omission).
//
// Scope (decyzja 13/O-FL-5, FLEKSJA-IMPL-PLAN.md SS3.3/SS12): PERSON_NAME
// only. Every other type declines immediately — v1 does not attempt
// generation for LOCATION/ORGANIZATION_NAME/PERSON_ALIAS (those get an
// attested-forms-only treatment in a later phase, out of this turn).
//
// Never guesses: any step that can't reach a confident, single answer
// returns `undefined` (decline) rather than fabricating a form — the
// resolveOccurrences contract already falls back to the plain legend value
// (baseValue) whenever the resolver declines, so an unresolvable occurrence
// is simply left exactly as it is today.
//
// Wired into the live app by FL-5 (FL-5-LIVE-WIRING-DESIGN.md): every
// production construction goes through buildOutcomeResolver (flexion-live.js),
// which the deanon sinks (screen/clipboard/flat export U1-U3, DOCX rebuild U4)
// consume via resolveOccurrences. U1-U3 sit behind the pii.deanon-flexion flag
// (default OFF — mechanism sleeps like allMask until Alan activates); U4 and
// the R-D9 seen/legend filter run unconditionally. The 'niska'-confidence
// review UI (surfacing sub-threshold suggestions for a click) is still FL-6.
import { detectCase } from './case-detector/detect.js';
import { analyzePersonName } from './morph/analyze.js';
import { generateForm } from './morph/generate.js';
import { deriveAttested } from './attested.js';

// DOCX-IMPL-PLAN.md FD-4: detectCase's confidence is 'niska' | 'wysoka' —
// a total order lets the threshold be a single comparison instead of a
// hardcoded string check, and keeps the option additive (no threshold ==
// no comparison == today's behavior, byte for byte).
const CONFIDENCE_RANK = { niska: 0, wysoka: 1 };

/**
 * @param {{morph?: object|null, seen?: Record<string,string>,
 *   minConfidence?: 'niska'|'wysoka'}} deps - `minConfidence` is additive
 *   (DOCX-IMPL-PLAN.md FD-4): omitted, this resolver behaves exactly as
 *   before (accepts detectCase's result unfiltered by confidence) — correct
 *   for a future human-in-the-loop consumer where a 'niska' suggestion still
 *   waits on a click. A sink with no per-occurrence approval (v1 .docx
 *   reconstruction, O-DOCX-2) has no click to wait for, so it sets
 *   `minConfidence: 'wysoka'` to fail closed to the base value instead.
 * @returns {(ctx: object) => ({text: string, note?: object}|undefined)} a
 *   resolveReplacement implementation for resolveOccurrences
 *   (src/substitution.js) and rebuildPart (src/docx-rebuild/token-engine.js)
 */
export function createFlexionResolver({ morph = null, seen = {}, minConfidence } = {}) {
  const attested = deriveAttested(seen);
  const minRank = minConfidence === undefined ? undefined : CONFIDENCE_RANK[minConfidence];

  return function resolveReplacement(ctx) {
    if (ctx.type !== 'PERSON_NAME') return undefined;

    const analysis = analyzePersonName(ctx.baseValue, attested[ctx.token] ?? [], morph);
    if (analysis.status !== 'ok') return undefined;

    const detected = detectCase(
      { contextBefore: ctx.contextBefore, contextAfter: ctx.contextAfter, annotation: ctx.case },
      { morph },
    );
    if (detected.status !== 'ok') return undefined;
    if (minRank !== undefined && CONFIDENCE_RANK[detected.confidence] < minRank) return undefined;

    const generated = generateForm(analysis, new Set(detected.cases));
    if (generated.status !== 'ok') return undefined;

    // `note` is additive (FD-2/FD-4): S2 reads only `.text` (resolveOccurrences
    // does `resolved?.text`), so this carries zero risk to that contract;
    // the DOCX engine's report ("odmieniono" rows) reads it for przypadek/
    // źródło/pewność without the engine ever inventing that metadata itself.
    return {
      text: generated.tekst,
      note: { przypadek: generated.przypadek, zrodlo: generated.zrodlo, pewnosc: detected.confidence },
    };
  };
}
