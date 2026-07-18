import { describe, it, expect } from 'vitest';
import { findUnsafeMergeRules, TIER_PROTECTION_RANK } from './merge-tier-safety.js';
import { ENTITY_RULES } from './entity-rules.js';
import { tierFor } from './type-tiers.js';

// H-3-CLOSURE-DESIGN.md, finding 6.5 (zamknięcie strukturalne H-3): mergeStep
// is tier-blind. canMergePair (merge.js:11-23) always makes the RULE OWNER
// the host of the merged span and re-tags the absorbed type onto the owner's
// tier. The only thing keeping today's behavior safe is the CONTENT of
// ENTITY_RULES, so this guard makes the implicit invariant explicit and lets
// CI fail on any future rule edit that would open a leak, BEFORE it ships.
//
// Protection order (most protective first): mask > review > pass. A merge is
// safe only when the owner is at least as protective as the type it absorbs.
describe('findUnsafeMergeRules — tier-safety guard on merge rules (finding 6.5)', () => {
  it('protection rank orders mask > review > pass', () => {
    expect(TIER_PROTECTION_RANK.mask).toBeGreaterThan(TIER_PROTECTION_RANK.review);
    expect(TIER_PROTECTION_RANK.review).toBeGreaterThan(TIER_PROTECTION_RANK.pass);
  });

  // The standing CI sentinel: the REAL rule table must stay tier-safe. The
  // only real cross-type rule today is POSTAL_ADDRESS [mask] mergeWithFollowing
  // [LOCATION [review]] — owner more protective than absorbed, so safe.
  it('REAL ENTITY_RULES is tier-safe (must stay empty — this is the CI guard)', () => {
    expect(findUnsafeMergeRules(ENTITY_RULES, tierFor)).toEqual([]);
  });

  // Teeth: the exact finding-6.5 leak. A pass-tier owner absorbing a mask-tier
  // type re-tags the personal identifier as pass, so it stops being masked.
  it('flags a pass owner absorbing a mask type (DOCUMENT_REFERENCE ⊃ PERSON_IDENTIFIER)', () => {
    const dangerous = { DOCUMENT_REFERENCE: { mergeWithFollowing: ['PERSON_IDENTIFIER'] } };
    const violations = findUnsafeMergeRules(dangerous, tierFor);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      owner: 'DOCUMENT_REFERENCE',
      absorbed: 'PERSON_IDENTIFIER',
      via: 'mergeWithFollowing',
      ownerTier: 'pass',
      absorbedTier: 'mask',
    });
  });

  // Explicit safe-direction control (finding 6.5's ask): a mask owner
  // absorbing a review type must NOT be flagged — over-masking is reversible.
  it('does NOT flag the safe direction (mask owner ⊃ review type: POSTAL_ADDRESS ⊃ LOCATION)', () => {
    const safe = { POSTAL_ADDRESS: { mergeWithFollowing: ['LOCATION'] } };
    expect(findUnsafeMergeRules(safe, tierFor)).toEqual([]);
  });

  describe('rank comparison across every tier ordering (abstract, injected tierFor)', () => {
    const tiers = { M: 'mask', M2: 'mask', R: 'review', P: 'pass' };
    const fakeTierFor = (t) => tiers[t] ?? 'mask';

    it.each([
      ['mask absorbs review (safe)', { M: { mergeWithFollowing: ['R'] } }, 0],
      ['mask absorbs pass (safe)', { M: { mergeWithFollowing: ['P'] } }, 0],
      ['mask absorbs mask, equal tier (safe)', { M: { mergeWithFollowing: ['M2'] } }, 0],
      ['review absorbs pass (safe)', { R: { mergeWithFollowing: ['P'] } }, 0],
      ['review absorbs mask (LEAK)', { R: { mergeWithFollowing: ['M'] } }, 1],
      ['pass absorbs review (silent skip)', { P: { mergeWithFollowing: ['R'] } }, 1],
      ['pass absorbs mask (LEAK)', { P: { mergeWithFollowing: ['M'] } }, 1],
    ])('%s', (_label, rules, expected) => {
      expect(findUnsafeMergeRules(rules, fakeTierFor)).toHaveLength(expected);
    });

    it('checks mergeWithAdjacent rules too, not only mergeWithFollowing', () => {
      const rules = { P: { mergeWithAdjacent: ['M'] } };
      const violations = findUnsafeMergeRules(rules, fakeTierFor);
      expect(violations).toHaveLength(1);
      expect(violations[0].via).toBe('mergeWithAdjacent');
    });

    it('evaluates each ownership direction independently for a symmetric adjacency pair', () => {
      // M owns [P] (mask ⊃ pass, safe) and P owns [M] (pass ⊃ mask, leak) —
      // only the P-owned direction is a violation, proving the guard keys on
      // the rule OWNER (= merge host), not on textual adjacency.
      const rules = { M: { mergeWithAdjacent: ['P'] }, P: { mergeWithAdjacent: ['M'] } };
      const violations = findUnsafeMergeRules(rules, fakeTierFor);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ owner: 'P', absorbed: 'M', via: 'mergeWithAdjacent' });
    });

    it('reports one violation per listed absorbed type', () => {
      const rules = { P: { mergeWithFollowing: ['M', 'R'] } };
      expect(findUnsafeMergeRules(rules, fakeTierFor)).toHaveLength(2);
    });

    it('ignores rules with no merge arrays and an empty table', () => {
      expect(findUnsafeMergeRules({}, fakeTierFor)).toEqual([]);
      expect(findUnsafeMergeRules({ M: { threshold: 0.5 } }, fakeTierFor)).toEqual([]);
      expect(findUnsafeMergeRules({ M: { mergeWithFollowing: [], mergeWithAdjacent: [] } }, fakeTierFor)).toEqual([]);
    });
  });
});
