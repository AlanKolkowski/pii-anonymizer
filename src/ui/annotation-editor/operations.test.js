import {
  overlapsAny,
  addEntity,
  removeToken,
  updateTypeForToken,
  updateBoundaries,
  tokensFromEntities,
} from './operations.js';

const ent = (entity_group, start, end) => ({ entity_group, start, end });

describe('overlapsAny', () => {
  it('returns false for non-overlapping spans', () => {
    const entities = [ent('PERSON_NAME', 0, 5), ent('LOCATION', 10, 20)];
    expect(overlapsAny(6, 9, entities)).toBe(false);
  });

  it('returns false for touching boundaries', () => {
    const entities = [ent('PERSON_NAME', 0, 5)];
    expect(overlapsAny(5, 10, entities)).toBe(false);
    expect(overlapsAny(-5, 0, entities)).toBe(false);
  });

  it('returns true for fully nested', () => {
    const entities = [ent('PERSON_NAME', 0, 20)];
    expect(overlapsAny(5, 15, entities)).toBe(true);
  });

  it('returns true for partial cross at start', () => {
    const entities = [ent('PERSON_NAME', 5, 15)];
    expect(overlapsAny(0, 10, entities)).toBe(true);
  });

  it('returns true for partial cross at end', () => {
    const entities = [ent('PERSON_NAME', 5, 15)];
    expect(overlapsAny(10, 20, entities)).toBe(true);
  });

  it('returns true when candidate fully contains existing', () => {
    const entities = [ent('PERSON_NAME', 5, 10)];
    expect(overlapsAny(0, 20, entities)).toBe(true);
  });

  it('respects ignoreIndex (for boundary updates)', () => {
    const entities = [ent('PERSON_NAME', 0, 5), ent('LOCATION', 10, 20)];
    // resizing entity 0 to 0-6: ignore self-overlap; doesn't reach entity 1 → false
    expect(overlapsAny(0, 6, entities, 0)).toBe(false);
    // resizing entity 1 to 8-22: ignore self-overlap; doesn't touch entity 0 → false
    expect(overlapsAny(8, 22, entities, 1)).toBe(false);
    // resizing entity 0 to 0-12: would collide with entity 1 → true
    expect(overlapsAny(0, 12, entities, 0)).toBe(true);
  });
});

describe('addEntity', () => {
  const text = 'Krzysztof Nowak mieszka w Warszawie.';

  it('appends a non-overlapping entity', () => {
    const before = [ent('PERSON_NAME', 0, 15)];
    const result = addEntity(before, ent('LOCATION', 26, 35));
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ entity_group: 'LOCATION', start: 26, end: 35 });
  });

  it('returns unchanged array when overlap detected', () => {
    const before = [ent('PERSON_NAME', 0, 15)];
    const result = addEntity(before, ent('LOCATION', 5, 10));
    expect(result).toBe(before);
  });

  it('does not mutate the input array', () => {
    const before = [ent('PERSON_NAME', 0, 15)];
    const snapshot = [...before];
    addEntity(before, ent('LOCATION', 26, 35));
    expect(before).toEqual(snapshot);
  });
});

describe('removeToken', () => {
  const text = 'Pan Krzysztof Nowak. Widzę Krzysztofa Nowaka. Inny Adam.';

  it('removes all entities sharing the canonical key (incl. Polish declension)', () => {
    const a = { entity_group: 'PERSON_NAME', start: 4, end: 19 };  // Krzysztof Nowak
    const b = { entity_group: 'PERSON_NAME', start: 27, end: 44 }; // Krzysztofa Nowaka
    const c = { entity_group: 'PERSON_NAME', start: 51, end: 55 }; // Adam
    const before = [a, b, c];
    const result = removeToken(before, a, text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(c);
  });

  it('does not affect different types', () => {
    const a = { entity_group: 'PERSON_NAME', start: 4, end: 19 };
    const b = { entity_group: 'LOCATION', start: 4, end: 19 };
    const text2 = 'Krzysztof Nowak';
    const result = removeToken([a, b], a, text2);
    expect(result).toEqual([b]);
  });

  it('returns a new array (no mutation)', () => {
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 5 };
    const before = [a];
    const result = removeToken(before, a, 'hello');
    expect(result).not.toBe(before);
  });

  // ST-3 gate follow-up #2 (SCOPE-TIERS-DESIGN.md; W1 leak fixed in
  // review-engine.js's applyMaskDecision/removeAppliedEntities): is
  // removeToken's "delete by canonical value" a twin of that bug? No — and
  // this is the test that PINS the distinction, not just argues it.
  //
  // The review-engine bug was about ATTRIBUTION across a two-phase
  // operation: postEdit silently added an entity of value B as a side
  // effect of deciding value A, and undoing A must remove only what A
  // itself added, never a pre-existing, decision-independent B. removeToken
  // has no such two-phase add-then-undo structure at all — it is a single,
  // synchronous "remove every CURRENT entity sharing the anchor's canonical
  // value" filter, and that full removal (including Polish-declined
  // sibling occurrences) is its DECLARED, user-disclosed contract: the
  // confirm dialog it's invoked from (index.js openConfirmDelete) tells the
  // radca up front exactly how many occurrences will disappear ("Z
  // dokumentu zostanie usuniętych N wystąpień") before they confirm. There
  // is no hidden/silent blast radius for this test to catch — so it simply
  // pins the two halves of that contract explicitly, so neither erodes
  // silently in a future refactor: (1) every occurrence of the SAME value
  // is removed together, (2) an entity of a DIFFERENT value is never
  // touched, no matter how it got there (NER, backfill, or a manual
  // annotation added for a completely unrelated reason).
  it('pins the contract: removes every occurrence of the SAME value, never touches entities of a DIFFERENT value', () => {
    const a = { entity_group: 'PERSON_NAME', start: 4, end: 19 };  // Krzysztof Nowak
    const b = { entity_group: 'PERSON_NAME', start: 27, end: 44 }; // Krzysztofa Nowaka (declined) — same person
    // "Adam", added for a totally unrelated reason (e.g. a manual
    // annotation days later) — must survive deleting the Nowak token.
    const unrelated = { entity_group: 'PERSON_NAME', start: 51, end: 55 };
    const result = removeToken([a, b, unrelated], a, text);
    expect(result).toEqual([unrelated]);
  });
});

describe('updateTypeForToken', () => {
  it('changes type on all entities sharing canonical key', () => {
    const text = 'Krzysztof Nowak i Krzysztofa Nowaka.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 15 };
    const b = { entity_group: 'PERSON_NAME', start: 18, end: 35 };
    const result = updateTypeForToken([a, b], a, 'PERSON_ALIAS', text);
    expect(result.every((e) => e.entity_group === 'PERSON_ALIAS')).toBe(true);
  });

  it('leaves entities with different canonical keys unchanged', () => {
    const text = 'Krzysztof Nowak i Adam Mickiewicz.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 15 };
    const b = { entity_group: 'PERSON_NAME', start: 18, end: 33 };
    const result = updateTypeForToken([a, b], a, 'PERSON_ALIAS', text);
    expect(result[0].entity_group).toBe('PERSON_ALIAS');
    expect(result[1].entity_group).toBe('PERSON_NAME');
  });
});

describe('updateBoundaries', () => {
  it('updates a single entity span', () => {
    const before = [ent('PERSON_NAME', 0, 10), ent('LOCATION', 20, 30)];
    const result = updateBoundaries(before, 0, 0, 12);
    expect(result[0]).toMatchObject({ start: 0, end: 12 });
    expect(result[1]).toBe(before[1]);
  });

  it('returns null when new span overlaps another entity', () => {
    const before = [ent('PERSON_NAME', 0, 10), ent('LOCATION', 20, 30)];
    const result = updateBoundaries(before, 0, 0, 25);
    expect(result).toBeNull();
  });

  it('allows resizing into self (own span)', () => {
    const before = [ent('PERSON_NAME', 0, 10)];
    const result = updateBoundaries(before, 0, 2, 8);
    expect(result[0]).toMatchObject({ start: 2, end: 8 });
  });

  it('returns null on inverted span', () => {
    const before = [ent('PERSON_NAME', 0, 10)];
    const result = updateBoundaries(before, 0, 5, 5);
    expect(result).toBeNull();
    const result2 = updateBoundaries(before, 0, 8, 4);
    expect(result2).toBeNull();
  });
});

describe('tokensFromEntities', () => {
  it('assigns same token to entities sharing canonical key (declension)', () => {
    const text = 'Krzysztof Nowak i Krzysztofa Nowaka.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 15 };
    const b = { entity_group: 'PERSON_NAME', start: 18, end: 35 };
    const tokens = tokensFromEntities([a, b], text);
    expect(tokens.get(0)).toBe(tokens.get(1));
    expect(tokens.get(0)).toMatch(/^\[PERSON_NAME_\d+\]$/);
  });

  it('assigns different tokens to different canonical keys', () => {
    const text = 'Krzysztof Nowak i Adam Mickiewicz.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 15 };
    const b = { entity_group: 'PERSON_NAME', start: 18, end: 33 };
    const tokens = tokensFromEntities([a, b], text);
    expect(tokens.get(0)).not.toBe(tokens.get(1));
  });

  it('renumbers tokens after entity removal (1, 2 not 1, 3)', () => {
    const text = 'Adam i Bartek.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const b = { entity_group: 'PERSON_NAME', start: 7, end: 13 };
    const tokens = tokensFromEntities([a, b], text);
    const labels = [tokens.get(0), tokens.get(1)].sort();
    expect(labels).toEqual(['[PERSON_NAME_1]', '[PERSON_NAME_2]']);
  });

  it('overlays globalSeen token when the key is present', () => {
    const text = 'Anna.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const globalSeen = { 'PERSON_NAME::Anna': '[PERSON_NAME_2]' };
    const tokens = tokensFromEntities([a], text, globalSeen);
    expect(tokens.get(0)).toBe('[PERSON_NAME_2]');
  });

  it('falls back to the per-doc token when the key is missing from globalSeen', () => {
    const text = 'Anna.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const globalSeen = { 'PERSON_NAME::SomeoneElse': '[PERSON_NAME_9]' };
    const tokens = tokensFromEntities([a], text, globalSeen);
    expect(tokens.get(0)).toBe('[PERSON_NAME_1]');
  });

  it('defaults to per-doc numbering when globalSeen is null', () => {
    const text = 'Anna i Adam.';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const b = { entity_group: 'PERSON_NAME', start: 7, end: 11 };
    const tokens = tokensFromEntities([a, b], text, null);
    const labels = [tokens.get(0), tokens.get(1)].sort();
    expect(labels).toEqual(['[PERSON_NAME_1]', '[PERSON_NAME_2]']);
  });

  it('groups same-key entities under the global token', () => {
    const text = 'Anna and Anna again';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const b = { entity_group: 'PERSON_NAME', start: 9, end: 13 };
    const globalSeen = { 'PERSON_NAME::Anna': '[PERSON_NAME_7]' };
    const tokens = tokensFromEntities([a, b], text, globalSeen);
    expect(tokens.get(0)).toBe('[PERSON_NAME_7]');
    expect(tokens.get(1)).toBe('[PERSON_NAME_7]');
  });

  // Found while auditing removeToken for a twin of the ST-3 W1-leak bug
  // (review-engine.js): not the same bug (removeToken has no add-then-undo
  // structure to misattribute — see operations.test.js's removeToken
  // "pins the contract" test), but a REAL, separate defect in the shared
  // grouping logic both removeToken and the annotation editor's delete
  // confirmation dialog (index.js openConfirmDelete) depend on.
  //
  // globalSeen is looked up per RAW text form, independently for each
  // entity — but buildTokenMap's LOCAL folding (ingestSource in
  // anonymizer.js) already unifies Polish-declined forms of one name under
  // ONE canonical key. A globalSeen that has seen only SOME raw forms of a
  // canonical group (e.g. a cross-document legend that knows "Kowalski"
  // from another, already-processed source, but not yet this document's own
  // "Kowalskiego") used to split one canonical person into two different
  // token identities: the override applied to whichever entity's raw text
  // happened to match, and the other fell back to the local token — even
  // though buildTokenMap's own declension folding says they are the same
  // group. That silently broke every caller that groups entities by "same
  // token": removeToken (an occurrence could survive a delete that visually
  // and canonically should have caught it), the hover-highlight
  // (data-token, index.js render), and the delete confirmation's own
  // disclosed count (see render.test.js for the end-to-end reproduction).
  it('a globalSeen hit on only ONE declined form does not split the canonical group', () => {
    const text = 'Krzysztof Nowak przyszedł. Widzę Krzysztofa Nowaka codziennie.';
    const aStart = text.indexOf('Krzysztof Nowak');
    const bStart = text.indexOf('Krzysztofa Nowaka');
    const a = { entity_group: 'PERSON_NAME', start: aStart, end: aStart + 'Krzysztof Nowak'.length }; // nominative
    const b = { entity_group: 'PERSON_NAME', start: bStart, end: bStart + 'Krzysztofa Nowaka'.length }; // genitive
    // Only the nominative raw form is cached globally — as if another,
    // already-processed source document mentioned this person but never in
    // this exact declined form.
    const globalSeen = { 'PERSON_NAME::Krzysztof Nowak': '[PERSON_NAME_9]' };
    const tokens = tokensFromEntities([a, b], text, globalSeen);
    expect(tokens.get(0)).toBe(tokens.get(1));
  });

  it('threads globalSeen through removeToken', () => {
    const text = 'Anna and Anna again';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const b = { entity_group: 'PERSON_NAME', start: 9, end: 13 };
    const globalSeen = { 'PERSON_NAME::Anna': '[PERSON_NAME_7]' };
    const result = removeToken([a, b], a, text, globalSeen);
    expect(result).toHaveLength(0);
  });

  // Concrete consequence of the grouping bug above, at the removeToken level:
  // without the fix, the declined-form sibling would silently survive a
  // delete that removeToken's own documented contract ("removes all entities
  // sharing the canonical key (incl. Polish declension)", see the
  // removeToken describe block) says it should catch — a name occurrence
  // left exposed by an anonymizer is the worst direction for this bug to
  // fail in.
  it('a partial globalSeen hit does not let a declined-form sibling survive removeToken', () => {
    const text = 'Krzysztof Nowak przyszedł. Widzę Krzysztofa Nowaka codziennie.';
    const aStart = text.indexOf('Krzysztof Nowak');
    const bStart = text.indexOf('Krzysztofa Nowaka');
    const a = { entity_group: 'PERSON_NAME', start: aStart, end: aStart + 'Krzysztof Nowak'.length };
    const b = { entity_group: 'PERSON_NAME', start: bStart, end: bStart + 'Krzysztofa Nowaka'.length };
    const globalSeen = { 'PERSON_NAME::Krzysztof Nowak': '[PERSON_NAME_9]' };
    const result = removeToken([a, b], a, text, globalSeen);
    expect(result).toEqual([]);
  });

  it('threads globalSeen through updateTypeForToken', () => {
    const text = 'Anna and Anna again';
    const a = { entity_group: 'PERSON_NAME', start: 0, end: 4 };
    const b = { entity_group: 'PERSON_NAME', start: 9, end: 13 };
    const globalSeen = { 'PERSON_NAME::Anna': '[PERSON_NAME_7]' };
    const result = updateTypeForToken([a, b], a, 'PERSON_ALIAS', text, globalSeen);
    expect(result.every((e) => e.entity_group === 'PERSON_ALIAS')).toBe(true);
  });
});
