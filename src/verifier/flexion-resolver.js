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
// NOT wired into any UI call site by this turn (deanon-workspace,
// outcomes-list, export/deanon.js all still call resolveOccurrences with no
// resolveReplacement) — this module is inert in the running app until a
// separately-gated change (FL-5/FL-6, human-approval plan+UI) invokes it.
import { detectCase } from './case-detector/detect.js';
import { analyzePersonName } from './morph/analyze.js';
import { generateForm } from './morph/generate.js';
import { deriveAttested } from './attested.js';

/**
 * @param {{morph?: object|null, seen?: Record<string,string>}} deps
 * @returns {(ctx: object) => ({text: string}|undefined)} a resolveReplacement
 *   implementation for resolveOccurrences (src/substitution.js)
 */
export function createFlexionResolver({ morph = null, seen = {} } = {}) {
  const attested = deriveAttested(seen);

  return function resolveReplacement(ctx) {
    if (ctx.type !== 'PERSON_NAME') return undefined;

    const analysis = analyzePersonName(ctx.baseValue, attested[ctx.token] ?? [], morph);
    if (analysis.status !== 'ok') return undefined;

    const detected = detectCase(
      { contextBefore: ctx.contextBefore, contextAfter: ctx.contextAfter, annotation: ctx.case },
      { morph },
    );
    if (detected.status !== 'ok') return undefined;

    const generated = generateForm(analysis, new Set(detected.cases));
    if (generated.status !== 'ok') return undefined;

    return { text: generated.tekst };
  };
}
