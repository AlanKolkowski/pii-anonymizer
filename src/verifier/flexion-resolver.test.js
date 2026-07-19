// THE integration proof for this turn (FLEKSJA-IMPL-PLAN.md core scope):
// createFlexionResolver wires detectCase + analyzePersonName + generateForm
// + deriveAttested into a resolveReplacement implementation that plugs
// directly into the EXISTING, UNCHANGED S2 API (resolveOccurrences /
// renderResolvedText, src/substitution.js) and the EXISTING, UNCHANGED
// masking path (buildTokenMap / applyTokens / anonymizeText,
// src/anonymizer.js) — nothing in this file, or anywhere this turn, edits
// either of those two functions' bodies.
//
// v1/core scope note: this resolver applies the engine's own case-detection
// result directly, unfiltered by confidence tier — the human-approval gate
// (plan/decisions/UI, FL-5/FL-6) that would show a proposal for review
// before ever emitting it is explicitly out of this turn's scope. Nothing
// in the current UI (deanon-workspace, outcomes-list, export/deanon.js)
// passes resolveReplacement at all, so V2 ("no text changes without an
// explicit human gesture") holds trivially: this module is inert until a
// future, separately-gated change wires it into an actual UI call site.
import { loadMorphData } from './morph/load.js';
import { MINI_LEXICON } from './morph/fixtures/mini-lexicon.js';
import { resolveOccurrences, renderResolvedText } from '../substitution.js';
import { anonymizeText, buildTokenMap } from '../anonymizer.js';
import { createFlexionResolver } from './flexion-resolver.js';

const morph = loadMorphData(MINI_LEXICON);

function deanon(text, legend, seen) {
  const resolveReplacement = createFlexionResolver({ morph, seen });
  return renderResolvedText(resolveOccurrences(text, { legend, resolveReplacement }), text);
}

describe('createFlexionResolver — the core deanonymization proof', () => {
  it('an annotated genitive token deanonymizes to the genitive surname form, not the nominative legend value', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const out = deanon('Zobowiązuje [PERSON_NAME_1|D] do zapłaty.', legend, {});
    expect(out).toBe('Zobowiązuje Jana Kowalskiego do zapłaty.');
  });

  it('a dative token in context (S-A role apposition, no annotation needed) generates the dative form', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const out = deanon('Sąd doręczył zawiadomienie powodowi [PERSON_NAME_1].', legend, {});
    expect(out).toBe('Sąd doręczył zawiadomienie powodowi Janowi Kowalskiemu.');
  });

  it('an unannotated token with no case signal at all falls back to the legend value unchanged (never guesses)', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const out = deanon('Lorem ipsum [PERSON_NAME_1] dolor sit.', legend, {});
    expect(out).toBe('Lorem ipsum Jan Kowalski dolor sit.');
  });
});

describe('createFlexionResolver — "one group" contract (SS4): tokenId is the identity key', () => {
  it('annotated and unannotated occurrences of the SAME token share one legend entry, generate independently', () => {
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    // Second sentence deliberately avoids any word in prepositions.js/
    // verbs.js/the mini-fixture's role forms near the annotated occurrence
    // — isolates the proof to the S-T annotation alone, no S-P/S-R/S-A
    // corroboration or (im)possible contradiction from context.
    const text = '[PERSON_NAME_1] złożył pozew przeciwko pozwanemu. Wspomniano wcześniej [PERSON_NAME_1|D] w piśmie.';
    const occ = resolveOccurrences(text, {
      legend,
      resolveReplacement: createFlexionResolver({ morph, seen: {} }),
    });
    expect(occ).toHaveLength(2);
    expect(occ[0].tokenId).toBe('PERSON_NAME_1');
    expect(occ[1].tokenId).toBe('PERSON_NAME_1');
    expect(occ[0].baseValue).toBe('Jan Kowalski');
    expect(occ[1].baseValue).toBe('Jan Kowalski'); // same legend entry, no per-occurrence copies
    expect(occ[0].finalText).toBe('Jan Kowalski'); // no signal at all here -> unchanged
    expect(occ[1].finalText).toBe('Jana Kowalskiego'); // annotated D -> generated
  });

  it('deriveAttested(seen) feeds attested forms through automatically (G12: nominative attestation wins for an M target)', () => {
    // Legend holds the first-seen (genitive) form; a nominative mention
    // elsewhere in the same source is retained in `seen` (S1/S2 already do
    // this — zero tokenization changes) and used here via deriveAttested.
    const source = 'Jana Kowalskiego i Jan Kowalski';
    const firstEnd = source.indexOf('Jana Kowalskiego') + 'Jana Kowalskiego'.length;
    const secondStart = source.indexOf('Jan Kowalski', firstEnd);
    const { seen, legend } = buildTokenMap(
      [
        { entity_group: 'PERSON_NAME', start: 0, end: firstEnd },
        { entity_group: 'PERSON_NAME', start: secondStart, end: secondStart + 'Jan Kowalski'.length },
      ],
      source,
    );
    expect(legend['[PERSON_NAME_1]']).toBe('Jana Kowalskiego'); // first-seen wins (unchanged behavior)

    // "że" (immediately before the token) and "złożył"/"pozew" (immediately
    // after) are absent from every signal table and the mini-fixture's role
    // forms — the only signal present is the |M annotation itself.
    const out = deanon('Z akt wynika, że [PERSON_NAME_1|M] złożył pozew.', legend, seen);
    expect(out).toBe('Z akt wynika, że Jan Kowalski złożył pozew.');
  });
});

describe('createFlexionResolver — v1 scope: PERSON_NAME only (decyzja 13/O-FL-5)', () => {
  it('declines for a non-PERSON_NAME type, leaving the base value untouched', () => {
    const legend = { '[ORGANIZATION_NAME_1]': 'ACME Sp. z o.o.' };
    const out = deanon('Dla [ORGANIZATION_NAME_1|D] przyznano odszkodowanie.', legend, {});
    expect(out).toBe('Dla ACME Sp. z o.o. przyznano odszkodowanie.');
  });
});

// DOCX-IMPL-PLAN.md FD-4/§4.3: the four worked examples binding for
// O-DOCX-2(a) — confidence policy for a sink with no per-occurrence human
// approval (v1 .docx reconstruction). Calls createFlexionResolver directly
// (not through resolveOccurrences/deanon) so `note` is observable — S2 only
// ever reads `.text`, but the DOCX report (FD-2) reads `.note` for the
// "odmieniono" rows.
describe('createFlexionResolver — FD-4 confidence policy (minConfidence)', () => {
  const ctxFor = (overrides) => ({
    token: '[PERSON_NAME_1]', tokenId: 'PERSON_NAME_1', type: 'PERSON_NAME',
    baseValue: 'Jan Kowalski', occurrence: 0, part: 'word/document.xml', ...overrides,
  });

  it('S-P + agreeing annotation corroborate to wysoka — inflects even with the threshold on, with a note', () => {
    const resolver = createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' });
    const result = resolver(ctxFor({
      case: 'D', contextBefore: 'Zasądza od ', contextAfter: ' kwotę zaległości.',
    }));
    expect(result).toEqual({
      text: 'Jana Kowalskiego',
      note: { przypadek: 'D', zrodlo: 'reguła', pewnosc: 'wysoka' },
    });
  });

  it('an annotation alone (no corroborating signal) is niska — the threshold declines it, base value stands', () => {
    const ctx = ctxFor({ case: 'D', contextBefore: 'Z akt wynika, że ', contextAfter: ' nie stawił się na rozprawę.' });

    // O-DOCX-2(a): a wrong LLM annotation in a position with no context
    // signal must NOT silently inflect a name sitting in subject position.
    expect(createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' })(ctx)).toBeUndefined();

    // Additive option (G-D7): omitted entirely, behavior is unfiltered by
    // confidence — the SAME input now inflects (a future human-approval
    // consumer would show this as a 'niska'-confidence suggestion instead).
    const unfiltered = createFlexionResolver({ morph, seen: {} })(ctx);
    expect(unfiltered).toEqual({
      text: 'Jana Kowalskiego',
      note: { przypadek: 'D', zrodlo: 'reguła', pewnosc: 'niska' },
    });
  });

  it('an unambiguous preposition alone reaches wysoka with NO annotation at all', () => {
    const resolver = createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' });
    const result = resolver(ctxFor({
      token: '[PERSON_NAME_2]', tokenId: 'PERSON_NAME_2', baseValue: 'Jan Kowalski',
      contextBefore: 'Wnosimy o zasądzenie przeciwko ', contextAfter: ' kosztów procesu.',
    }));
    expect(result).toEqual({
      text: 'Janowi Kowalskiemu',
      note: { przypadek: 'C', zrodlo: 'reguła', pewnosc: 'wysoka' },
    });
  });

  it('an annotation contradicting the context is nieustalony — base value, regardless of the threshold', () => {
    const ctx = ctxFor({ case: 'M', contextBefore: 'Wnosimy o zasądzenie przeciwko ', contextAfter: ' kosztów.' });
    expect(createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' })(ctx)).toBeUndefined();
    expect(createFlexionResolver({ morph, seen: {} })(ctx)).toBeUndefined();
  });
});

describe('createFlexionResolver — masking stays byte-for-byte untouched', () => {
  it('anonymizeText/buildTokenMap are unaffected by this module even existing (no import cycle, no shared mutable state)', () => {
    const text = 'Powód Jan Kowalski wnosi o zapłatę od pozwanego.';
    const entities = [{ entity_group: 'PERSON_NAME', start: 6, end: 18 }];
    const { anonymized, legend } = anonymizeText(text, entities);
    expect(anonymized).toBe('Powód [PERSON_NAME_1] wnosi o zapłatę od pozwanego.');
    expect(legend).toEqual({ '[PERSON_NAME_1]': 'Jan Kowalski' });
  });
});
