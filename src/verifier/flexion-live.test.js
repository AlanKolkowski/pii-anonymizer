// FL-5-LIVE-WIRING-DESIGN.md K1/K2: tests for the one construction point that
// wires the proven flexion engine (createFlexionResolver, untouched by this
// branch) into every live deanonymization sink. Two pure, stateless helpers:
//
// - filterSeenForLegend (K1, §3.1/§4): the R-D9 fix — an outcome's snapshot
//   legend can drift from the live legend after a source renumbering
//   collision; this drops any `seen` entry whose token now disagrees between
//   the two, so the resolver never sees another person's attested form.
// - buildOutcomeResolver (K2, §3.1): the single place every sink (U1-U4)
//   builds a resolveReplacement, or declines to undefined when disabled.
import { createFlexionResolver } from './flexion-resolver.js';
import { loadMorphData } from './morph/load.js';
import { MINI_LEXICON } from './morph/fixtures/mini-lexicon.js';
import { filterSeenForLegend, buildOutcomeResolver } from './flexion-live.js';

// "Jan" needs a dictionary hit to generate its inflected form (only the
// surname is rule-governed) — the mini-fixture (test-only, no external
// dataset content) mirrors the exact recipe already proven in
// flexion-resolver.test.js's FD-4 suite.
const morph = loadMorphData(MINI_LEXICON);

describe('filterSeenForLegend (K1)', () => {
  it('(a) passes every seen entry through unchanged when liveLegend and effectiveLegend agree (no-snapshot case)', () => {
    const seen = {
      'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]',
      'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]',
    };
    const liveLegend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    // No snapshot: the outcome's effective legend IS the live legend (this is
    // exactly what effectiveOutcomeLegend(outcome, liveLegend) returns when
    // outcome.legendSnapshot is absent) — every entry trivially agrees.
    expect(filterSeenForLegend(seen, liveLegend, liveLegend)).toEqual(seen);
  });

  it('(b) R-D9 corner: drops every seen entry for a token whose live value diverges from the effective (snapshot) value', () => {
    const seen = {
      'PERSON_NAME::Anna Nowak': '[PERSON_NAME_1]',
      'PERSON_NAME::Annie Nowak': '[PERSON_NAME_1]',
      'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_2]', // different token, unaffected by the collision
    };
    // After a source renumbering, [PERSON_NAME_1] now points at a DIFFERENT
    // person live than the snapshot an existing outcome was built from.
    const liveLegend = { '[PERSON_NAME_1]': 'Anna Nowak', '[PERSON_NAME_2]': 'Jan Kowalski' };
    const effectiveLegend = { '[PERSON_NAME_1]': 'Jan Kowalski', '[PERSON_NAME_2]': 'Jan Kowalski' };
    expect(filterSeenForLegend(seen, liveLegend, effectiveLegend)).toEqual({
      'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_2]',
    });
  });

  it('(c) skips malformed keys (no "::" separator) and tokens absent from either legend, without throwing', () => {
    const seen = {
      'malformed-key-no-separator': '[PERSON_NAME_1]',
      'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_9]', // token in neither legend
    };
    expect(() => filterSeenForLegend(seen, {}, {})).not.toThrow();
    expect(filterSeenForLegend(seen, {}, {})).toEqual({});
  });

  it('(c) tolerates missing seen/legend arguments entirely', () => {
    expect(filterSeenForLegend(undefined, undefined, undefined)).toEqual({});
    expect(filterSeenForLegend(null, null, null)).toEqual({});
  });
});

describe('buildOutcomeResolver (K2)', () => {
  it('(a) enabled: false always returns undefined, regardless of morph/seen/outcome', () => {
    const resolver = buildOutcomeResolver({
      enabled: false,
      morph: null,
      seen: { 'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]' },
      liveLegend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      outcome: {},
    });
    expect(resolver).toBeUndefined();
  });

  it('(a) enabled omitted (falsy default) also returns undefined', () => {
    expect(buildOutcomeResolver({})).toBeUndefined();
    expect(buildOutcomeResolver()).toBeUndefined();
  });

  // (b) enabled: true -> a function that behaves exactly like
  // createFlexionResolver({ minConfidence: 'wysoka' }) on the FD-4 worked
  // examples (DOCX-IMPL-PLAN.md §4.3, already proven in
  // flexion-resolver.test.js) — buildOutcomeResolver always fixes
  // minConfidence to 'wysoka' (O-FL5-1), it is not a caller-supplied option.
  describe('(b) enabled: true builds a resolver matching createFlexionResolver({minConfidence: "wysoka"})', () => {
    const liveLegend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const ctxFor = (overrides) => ({
      token: '[PERSON_NAME_1]', tokenId: 'PERSON_NAME_1', type: 'PERSON_NAME',
      baseValue: 'Jan Kowalski', occurrence: 0, part: 'word/document.xml', ...overrides,
    });

    it('S-P + agreeing annotation corroborate to wysoka — inflects, with a note', () => {
      const resolver = buildOutcomeResolver({ enabled: true, morph, seen: {}, liveLegend, outcome: {} });
      const result = resolver(ctxFor({ case: 'D', contextBefore: 'Zasądza od ', contextAfter: ' kwotę zaległości.' }));
      expect(result).toEqual({
        text: 'Jana Kowalskiego',
        note: { przypadek: 'D', zrodlo: 'reguła', pewnosc: 'wysoka' },
      });
      // Cross-check against the direct engine call with the same threshold —
      // buildOutcomeResolver must not diverge from it for this input.
      const direct = createFlexionResolver({ morph, seen: {}, minConfidence: 'wysoka' });
      expect(result).toEqual(direct(ctxFor({ case: 'D', contextBefore: 'Zasądza od ', contextAfter: ' kwotę zaległości.' })));
    });

    it('an annotation alone (no corroborating signal) is niska — the wysoka threshold declines it', () => {
      const resolver = buildOutcomeResolver({ enabled: true, morph, seen: {}, liveLegend, outcome: {} });
      const ctx = ctxFor({ case: 'D', contextBefore: 'Z akt wynika, że ', contextAfter: ' nie stawił się na rozprawę.' });
      expect(resolver(ctx)).toBeUndefined();
    });
  });

  // (c) `seen` is filtered through filterSeenForLegend before it ever reaches
  // the engine — proven through PUBLIC behavior (never through a spy on a
  // private call), exactly the R-D9 scenario §4 describes: after a token
  // collision, the resolver must never surface another person's attested form.
  it('(c) filters `seen` through the R-D9 rule — never emits another person\'s attested form after a token collision', () => {
    const liveLegend = { '[PERSON_NAME_1]': 'Anna Nowak' }; // post-renumbering: token now means someone else
    const seen = {
      'PERSON_NAME::Anna Nowak': '[PERSON_NAME_1]',
      'PERSON_NAME::Annie Nowak': '[PERSON_NAME_1]', // Anna's attested dative — must never leak into Jan's occurrence
    };
    const outcome = { legendSnapshot: { '[PERSON_NAME_1]': 'Jan Kowalski' } }; // this outcome was built when T1 meant Jan
    const resolver = buildOutcomeResolver({ enabled: true, morph, seen, liveLegend, outcome });

    const result = resolver({
      token: '[PERSON_NAME_1]', tokenId: 'PERSON_NAME_1', type: 'PERSON_NAME',
      baseValue: 'Jan Kowalski', case: 'D', contextBefore: 'Zasądza od ', contextAfter: ' kwotę.',
      occurrence: 0,
    });

    // Never Anna's attested form. Either a decline (base value stands) or
    // Jan's OWN rule/dictionary-generated genitive — never "Annie Nowak".
    expect(result?.text).not.toBe('Annie Nowak');
    expect(result?.text).not.toContain('Nowak');
    expect(result.text).toBe('Jana Kowalskiego'); // Jan's own generated form, not Anna's attested one
    expect(result.note.zrodlo).not.toBe('poświadczona'); // not from the (filtered-out) attested form
  });

  it('(c) without a snapshot (no collision possible), attested forms from `seen` still reach the engine normally', () => {
    const liveLegend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    const seen = { 'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]' };
    const resolver = buildOutcomeResolver({ enabled: true, morph, seen, liveLegend, outcome: {} });
    const result = resolver({
      token: '[PERSON_NAME_1]', tokenId: 'PERSON_NAME_1', type: 'PERSON_NAME',
      baseValue: 'Jan Kowalski', case: 'D', contextBefore: 'Zasądza od ', contextAfter: ' kwotę.',
      occurrence: 0,
    });
    expect(result.text).toBe('Jana Kowalskiego');
    expect(result.note.zrodlo).toBe('poświadczona');
  });
});
