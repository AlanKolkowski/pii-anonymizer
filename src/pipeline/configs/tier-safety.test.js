import { describe, it, expect } from 'vitest';
import {
  findUnsafeMergeRules,
  findMaskTypesDroppableByMaxLength,
  findMaskTypesWithDropBlocklist,
  TIER_PROTECTION_RANK,
} from './tier-safety.js';
import { ENTITY_RULES } from './entity-rules.js';
import { tierFor } from './type-tiers.js';
import { weightFor } from './type-weights.js';
import { OVERSIZE_WEIGHT_THRESHOLD } from '../steps/max-length.js';

// H-3-CLOSURE-DESIGN.md, finding 6.5 and the follow-up structural audit: the
// activated three-tier model (allMask:false) differs from today's allMask:true
// world only in tierPartitionStep (it drops the pass tier). So any
// PRE-PARTITION step that drops or re-types an entity on a proxy OTHER than its
// tier can silently discard a mask entity once tiers are live. Three such
// channels exist (merge re-type, maxLength drop, blocklist drop); each gets a
// pure lint run here against the real config as a standing CI sentinel. None
// touch runtime.

describe('findUnsafeMergeRules — tier-safety guard on merge rules (finding 6.5)', () => {
  // Protection order: mask (2) > review (1) > pass (0). mergeStep re-tags the
  // absorbed span onto the rule OWNER's tier (canMergePair, merge.js:11-23 —
  // host is always the rule owner). Safe only when the owner is at least as
  // protective as the type it absorbs.
  it('protection rank orders mask > review > pass', () => {
    expect(TIER_PROTECTION_RANK.mask).toBeGreaterThan(TIER_PROTECTION_RANK.review);
    expect(TIER_PROTECTION_RANK.review).toBeGreaterThan(TIER_PROTECTION_RANK.pass);
  });

  it('REAL ENTITY_RULES is tier-safe (must stay empty — this is the CI guard)', () => {
    expect(findUnsafeMergeRules(ENTITY_RULES, tierFor)).toEqual([]);
  });

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

describe('findMaskTypesDroppableByMaxLength — Guard A: maxLength drop channel (finding 6.5 audit)', () => {
  // maxLengthStep (max-length.js): an over-long entity of weight >=
  // OVERSIZE_WEIGHT_THRESHOLD over-masks (kept, oversized:true); weight below
  // the threshold is DROPPED outright. A mask type that both has a maxLength
  // and sits below the threshold would leak its over-long instances after
  // activation. The threshold is imported from max-length.js (not hard-coded)
  // so this standing check tracks the real runtime value.
  it('REAL ENTITY_RULES has no mask type droppable by maxLength (CI guard — must stay empty)', () => {
    expect(findMaskTypesDroppableByMaxLength(ENTITY_RULES, tierFor, weightFor, OVERSIZE_WEIGHT_THRESHOLD)).toEqual([]);
  });

  it('flags a below-threshold mask type that gains a maxLength (ORGANIZATION_IDENTIFIER, weight 2, if it grew a maxLength)', () => {
    // The one mask type with weight < 3 today (ORGANIZATION_IDENTIFIER,
    // weight 2) is safe ONLY because IDENTIFIER_RULE leaves its maxLength
    // null. Give it a maxLength and the drop channel opens — the guard must
    // catch that edit. Uses the real tierFor/weightFor/threshold.
    const dangerous = { ORGANIZATION_IDENTIFIER: { maxLength: 40 } };
    const offenders = findMaskTypesDroppableByMaxLength(dangerous, tierFor, weightFor, OVERSIZE_WEIGHT_THRESHOLD);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({ type: 'ORGANIZATION_IDENTIFIER', maxLength: 40, weight: 2 });
  });

  it('positive control: ORGANIZATION_IDENTIFIER with null maxLength is NOT flagged (null maxLength is the safety factor)', () => {
    const safe = { ORGANIZATION_IDENTIFIER: { maxLength: null } };
    expect(findMaskTypesDroppableByMaxLength(safe, tierFor, weightFor, OVERSIZE_WEIGHT_THRESHOLD)).toEqual([]);
  });

  describe('abstract matrix (injected resolvers)', () => {
    const tierOf = (t) => ({ M2: 'mask', M4: 'mask', R2: 'review', P1: 'pass' })[t] ?? 'mask';
    const weightOf = (t) => ({ M2: 2, M4: 4, R2: 2, P1: 1 })[t] ?? 3;
    const THRESHOLD = 3;

    it.each([
      ['mask, weight 2, maxLength 40 (LEAK)', { M2: { maxLength: 40 } }, 1],
      ['mask, weight 4, maxLength 40 (safe — over-masks, not dropped)', { M4: { maxLength: 40 } }, 0],
      ['mask, weight 2, maxLength null (safe — not droppable)', { M2: { maxLength: null } }, 0],
      ['mask, weight 2, no maxLength key (safe)', { M2: { threshold: 0.5 } }, 0],
      ['review, weight 2, maxLength 40 (safe — not a mask type)', { R2: { maxLength: 40 } }, 0],
      ['pass, weight 1, maxLength 40 (safe — not a mask type)', { P1: { maxLength: 40 } }, 0],
    ])('%s', (_label, rules, expected) => {
      expect(findMaskTypesDroppableByMaxLength(rules, tierOf, weightOf, THRESHOLD)).toHaveLength(expected);
    });

    it('a maxLength of 0 still counts as droppable (not treated as absent)', () => {
      const offenders = findMaskTypesDroppableByMaxLength({ M2: { maxLength: 0 } }, tierOf, weightOf, THRESHOLD);
      expect(offenders).toHaveLength(1);
    });
  });
});

describe('findMaskTypesWithDropBlocklist — Guard B: blocklist drop channel (finding 6.5 audit)', () => {
  // blocklistStep (blocklist.js) DROPS an entity when its value equals a
  // blocklist entry, matches a blocklistPattern, or (rejectTruncatedWord) ends
  // inside a longer word. Edge trimming is a reshape, not a drop, and is out
  // of scope. A mask type carrying any of these drop triggers could discard a
  // real datum — false positives on a mask type belong at DETECTION (regex
  // precision), never a post-hoc value blocklist. Today only
  // PERSON_ROLE_OR_TITLE (review tier) declares any of them.
  it('REAL ENTITY_RULES has no mask type with a drop-blocklist (CI guard — must stay empty)', () => {
    expect(findMaskTypesWithDropBlocklist(ENTITY_RULES, tierFor)).toEqual([]);
  });

  it('positive control: PERSON_ROLE_OR_TITLE carries blocklist + patterns + rejectTruncatedWord but is REVIEW tier, so not flagged', () => {
    const roleRule = { PERSON_ROLE_OR_TITLE: ENTITY_RULES.PERSON_ROLE_OR_TITLE };
    // Sanity: the real rule really does carry all three drop triggers.
    expect(ENTITY_RULES.PERSON_ROLE_OR_TITLE.blocklist.length).toBeGreaterThan(0);
    expect(ENTITY_RULES.PERSON_ROLE_OR_TITLE.blocklistPatterns.length).toBeGreaterThan(0);
    expect(ENTITY_RULES.PERSON_ROLE_OR_TITLE.rejectTruncatedWord).toBe(true);
    // ...yet it is review tier, so the guard leaves it alone.
    expect(findMaskTypesWithDropBlocklist(roleRule, tierFor)).toEqual([]);
  });

  it('flags a mask type that gains a value blocklist (PERSON_NAME with blocklist)', () => {
    const dangerous = { PERSON_NAME: { blocklist: ['Foo'] } };
    const offenders = findMaskTypesWithDropBlocklist(dangerous, tierFor);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({ type: 'PERSON_NAME', reasons: ['blocklist'] });
  });

  it('flags a mask type that gains rejectTruncatedWord:true', () => {
    const dangerous = { PERSON_NAME: { rejectTruncatedWord: true } };
    const offenders = findMaskTypesWithDropBlocklist(dangerous, tierFor);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({ type: 'PERSON_NAME', reasons: ['rejectTruncatedWord'] });
  });

  it('flags a mask type that gains blocklistPatterns and reports every triggered reason', () => {
    const dangerous = { PERSON_NAME: { blocklist: ['Foo'], blocklistPatterns: [/x/], rejectTruncatedWord: true } };
    const offenders = findMaskTypesWithDropBlocklist(dangerous, tierFor);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].reasons).toEqual(['blocklist', 'blocklistPatterns', 'rejectTruncatedWord']);
  });

  describe('abstract (injected tierFor)', () => {
    const tierOf = (t) => ({ M: 'mask', R: 'review', P: 'pass' })[t] ?? 'mask';

    it('does not flag an empty blocklist or empty patterns on a mask type', () => {
      expect(findMaskTypesWithDropBlocklist({ M: { blocklist: [], blocklistPatterns: [] } }, tierOf)).toEqual([]);
      expect(findMaskTypesWithDropBlocklist({ M: { rejectTruncatedWord: false } }, tierOf)).toEqual([]);
    });

    it('does not flag a review or pass type that declares a blocklist', () => {
      expect(findMaskTypesWithDropBlocklist({ R: { blocklist: ['Foo'] } }, tierOf)).toEqual([]);
      expect(findMaskTypesWithDropBlocklist({ P: { rejectTruncatedWord: true } }, tierOf)).toEqual([]);
    });
  });
});
