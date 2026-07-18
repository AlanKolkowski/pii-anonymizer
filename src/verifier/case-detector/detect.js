// W3 (W1-W3-MORPHOLOGY-DESIGN.md SS3, FLEKSJA-IMPL-PLAN.md SS3.4): detectCase
// — the cascade of local signals that decides which grammatical case a
// PERSON_NAME token occupies at one occurrence in the OUTPUT text. Pure
// function: text windows + an optional loaded morph object in, a case set
// (or an honest refusal) out. Intersection algebra across signals; a
// contradiction anywhere is a fail-closed 'nieustalony', never a guess.
//
// v1/laptop-safe scope: this cascade works over the resolver's existing
// ±40-char contextBefore/contextAfter windows (S2, src/substitution.js),
// not the full sentence-level 200/80 window the complete W3 design
// specifies — narrower but strictly local, matching this turn's "core"
// scope (mini-fixture, no full sentence tokenizer). Widening the window is
// a mechanical follow-up, not a design change.
import { PREPOSITION_CASES } from './prepositions.js';
import { VERB_GOVERNMENT } from './verbs.js';

const VERB_LOOKBACK = 3;

function words(text) {
  return (text.match(/\p{L}+/gu) ?? []).map((w) => w.toLocaleLowerCase('pl'));
}

function narrow(candidate, cases) {
  if (candidate === null) return new Set(cases);
  return new Set([...candidate].filter((c) => cases.includes(c)));
}

function findRoleSignal(allWords, morph) {
  if (!morph?.formaDoLematu) return null;
  for (const w of allWords) {
    const hit = morph.formaDoLematu.get(w)?.find((e) => e.sekcja === 'role');
    if (hit) return { word: w, lemma: hit.lemat, cases: hit.przypadki };
  }
  return null;
}

/**
 * detectCase (W3): combines S-P/S-R/S-A/S-T into a case set + confidence, or
 * an honest refusal. Never picks a case among genuinely conflicting signals.
 *
 * @param {{contextBefore?:string, contextAfter?:string, annotation?:string}} occurrence
 * @param {{morph?: object}} deps - the loaded morph object powers S-A (role
 *   apposition) via its formaDoLematu reverse index; omitted, S-A is simply
 *   silent (never a fallback guess).
 * @returns {{status:'ok', cases:string[], confidence:'wysoka'|'niska', signals:object[]}
 *          | {status:'nieustalony', rationale:string, signals:object[]}}
 */
export function detectCase({ contextBefore = '', contextAfter = '', annotation } = {}, deps = {}) {
  const signals = [];
  let candidate = null;

  const beforeWords = words(contextBefore);
  const afterWords = words(contextAfter);

  // S-P: preposition immediately before the token.
  const lastBefore = beforeWords[beforeWords.length - 1];
  if (lastBefore && PREPOSITION_CASES[lastBefore]) {
    candidate = narrow(candidate, PREPOSITION_CASES[lastBefore]);
    signals.push({ signal: 'S-P', word: lastBefore, cases: PREPOSITION_CASES[lastBefore] });
  }

  // S-R: a known governing verb form within the last few words.
  for (const w of beforeWords.slice(-VERB_LOOKBACK)) {
    if (VERB_GOVERNMENT[w]) {
      candidate = narrow(candidate, [VERB_GOVERNMENT[w]]);
      signals.push({ signal: 'S-R', word: w, cases: [VERB_GOVERNMENT[w]] });
    }
  }

  // S-A: a role lemma's inflected form on either side (apposition can
  // precede — "powodowi Janowi Kowalskiemu" — or follow — "Jan Kowalski,
  // powód, ..." — the name).
  const roleHit = findRoleSignal([...beforeWords, ...afterWords], deps.morph);
  if (roleHit) {
    candidate = narrow(candidate, roleHit.cases);
    signals.push({ signal: 'S-A', word: roleHit.word, lemma: roleHit.lemma, cases: roleHit.cases });
  }

  if (candidate !== null && candidate.size === 0) {
    return { status: 'nieustalony', rationale: 'sygnały sprzeczne', signals };
  }

  // S-T: the token's own case annotation — untrusted input (decyzja 17).
  // Agreeing with the cascade raises confidence; contradicting it fails
  // closed rather than letting untrusted data override observed context;
  // alone (no other signal at all) it is accepted but capped at 'niska'.
  if (annotation) {
    if (candidate === null) {
      candidate = new Set([annotation]);
      signals.push({ signal: 'S-T', cases: [annotation] });
    } else if (candidate.has(annotation)) {
      candidate = new Set([annotation]);
      signals.push({ signal: 'S-T (zgodna)', cases: [annotation] });
    } else {
      return { status: 'nieustalony', rationale: 'adnotacja sprzeczna z kontekstem', signals };
    }
  }

  if (candidate === null || candidate.size === 0) {
    return { status: 'nieustalony', rationale: 'brak sygnału', signals };
  }

  // 'wysoka' requires the set to have actually narrowed to one case AND at
  // least one signal beyond the (untrusted) annotation to have contributed
  // to it — an annotation with nothing corroborating it stays 'niska' even
  // when it is the only source of a single-case result.
  const corroborated = signals.some((s) => !s.signal.startsWith('S-T'));
  const confidence = candidate.size === 1 && corroborated ? 'wysoka' : 'niska';

  return { status: 'ok', cases: [...candidate], confidence, signals };
}
