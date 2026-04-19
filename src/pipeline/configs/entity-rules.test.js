import { describe, it, expect } from 'vitest';
import { rulesFor, ENTITY_RULES, DEFAULT_RULE } from './entity-rules.js';

describe('rulesFor', () => {
  it('returns DEFAULT_RULE for unknown types', () => {
    const rules = rulesFor('NOT_A_REAL_TYPE');
    expect(rules).toEqual(DEFAULT_RULE);
  });

  it('merges entity overrides onto DEFAULT_RULE', () => {
    const rules = rulesFor('PERSON_ROLE_OR_TITLE');
    expect(rules.threshold).toBe(0.9);
    expect(rules.blocklist).toEqual(['Pan', 'Pani', 'Nadawca']);
    expect(rules.blocklistPatterns.length).toBeGreaterThan(0);
    expect(rules.snap).toBe(true);
    expect(rules.trimTrailingPunctuation).toBe(true);
  });

  it('defaults blocklistPatterns to empty array for types without overrides', () => {
    expect(rulesFor('EMAIL_ADDRESS').blocklistPatterns).toEqual([]);
  });

  it('preserves DEFAULT_RULE.maxLength = null for unconfigured types', () => {
    expect(rulesFor('EMAIL_ADDRESS').maxLength).toBeNull();
  });

  it('returns a fresh object (callers may not mutate defaults)', () => {
    const a = rulesFor('PERSON_NAME');
    a.maxLength = 999;
    const b = rulesFor('PERSON_NAME');
    expect(b.maxLength).toBe(50);
  });
});
