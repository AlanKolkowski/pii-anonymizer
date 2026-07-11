// Substitution engine (SHARED-FOUNDATION-DESIGN.md S2 §4): the shared
// per-occurrence resolution plan that DOCX token-engine (MD4) and the
// verifier's substitution plan (W4) both build on, instead of each defining
// its own resolveReplacement seam. S2 owns only the DEANONYMIZATION direction
// (token -> value); tokenization (buildTokenMap/applyTokens) stays in
// anonymizer.js untouched.
import { findTokens } from './tokens.js';

// Window used for resolveReplacement's contextBefore/contextAfter (matches the
// residue-report context size DOCX-REBUILD-DESIGN.md §6.2 already uses, for
// consistency — v1's resolver is the identity function and never reads it).
const CONTEXT_CHARS = 40;

// A case-annotated token ([TYP_N|D]) occupies more raw characters in the
// source text than its canonical `[${tokenId}]` form. tokenId/case (both from
// findTokens) are enough to recover the exact raw span without tokens.js
// having to expose match lengths itself.
function rawTokenLength(entry) {
  return entry.case
    ? entry.tokenId.length + entry.case.length + 3 // "[" + "|" + "]"
    : entry.tokenId.length + 2; // "[" + "]"
}

function decisionFor(decisions, occurrenceIndex) {
  if (decisions == null) return undefined;
  if (typeof decisions.get === 'function') return decisions.get(occurrenceIndex);
  return decisions[occurrenceIndex];
}

export function resolveOccurrences(text, { legend = {}, decisions, resolveReplacement } = {}) {
  const matches = findTokens(text);
  const occurrences = [];

  for (let occurrenceIndex = 0; occurrenceIndex < matches.length; occurrenceIndex++) {
    const match = matches[occurrenceIndex];
    const { token, tokenId, type, index } = match;
    const hasBaseValue = Object.prototype.hasOwnProperty.call(legend, token);
    const baseValue = legend[token];

    const decision = decisionFor(decisions, occurrenceIndex);
    let finalText;
    let source;

    if (decision !== undefined && decision !== null) {
      finalText = decision;
      source = 'decyzja';
    } else {
      let resolverText;
      if (hasBaseValue && typeof resolveReplacement === 'function') {
        const rawLength = rawTokenLength(match);
        const resolved = resolveReplacement({
          token,
          tokenId,
          type,
          baseValue,
          contextBefore: text.slice(Math.max(0, index - CONTEXT_CHARS), index),
          contextAfter: text.slice(index + rawLength, index + rawLength + CONTEXT_CHARS),
          occurrence: occurrenceIndex,
        });
        resolverText = resolved?.text;
      }

      if (resolverText !== undefined && resolverText !== null) {
        finalText = resolverText;
        source = 'resolver';
      } else if (hasBaseValue) {
        finalText = baseValue;
        source = 'baza';
      } else {
        finalText = token;
        source = 'nierozwiązany';
      }
    }

    occurrences.push({ occurrenceIndex, index, token, tokenId, type, baseValue, finalText, source });
  }

  return occurrences;
}

// Builds the output in one pass over `originalText` — occurrences' finalText
// values are concatenated verbatim and never re-scanned for further token
// matches, so a legend value that happens to contain another token's literal
// can never cascade (S2 §4.4 point 2 / O-SF-4: a deliberate behavior change
// from the old sequential-replaceAll deanonymizeText, unreachable in practice
// because collectReservedTokens excludes any literal already present in a
// source document from ever being freshly generated as a token elsewhere).
export function renderResolvedText(occurrences, originalText) {
  const rawLengthByIndex = new Map();
  for (const match of findTokens(originalText)) {
    rawLengthByIndex.set(match.index, rawTokenLength(match));
  }

  let result = '';
  let cursor = 0;
  for (const occ of occurrences) {
    const rawLength = rawLengthByIndex.get(occ.index) ?? occ.token.length;
    result += originalText.slice(cursor, occ.index);
    result += occ.finalText;
    cursor = occ.index + rawLength;
  }
  result += originalText.slice(cursor);
  return result;
}

// Single export replacing the three identical copies (deanon-workspace,
// export/deanon.js, outcomes-coordinator.js): legendSnapshot always wins over
// the live legend when present (an outcome's snapshot is taken once, at
// creation/update time, so it must not drift as the live legend keeps
// changing underneath it).
export function effectiveOutcomeLegend(outcome, liveLegend) {
  return outcome?.legendSnapshot ?? liveLegend ?? {};
}
