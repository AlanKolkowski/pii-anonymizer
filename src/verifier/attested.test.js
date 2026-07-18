// SS3.2 (FLEKSJA-IMPL-PLAN.md): deriveAttested — the minimal variant is
// "sama inwersja seen, bez kontekstów", which is declared sufficient for
// PERSON_NAME. `seen` (src/anonymizer.js) is a flat { "TYPE::rawValue":
// "[TYPE_N]" } map; every key's rawValue suffix is verbatim text that
// actually appeared in a source document (buildTokenMap/buildTokenMapMulti
// via ingestSource) — deriveAttested only ever inverts it, never touches
// anonymizer.js/tokenization itself (masking stays untouched by construction:
// this reads `seen` after the fact, it never participates in producing it).
import { deriveAttested } from './attested.js';

describe('deriveAttested — pure inversion of seen', () => {
  it('groups every raw surface form seen for a token under that token', () => {
    const seen = {
      'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]',
      'PERSON_NAME::Jana Kowalskiego': '[PERSON_NAME_1]',
      'PERSON_NAME::Anna Nowak': '[PERSON_NAME_2]',
    };
    const out = deriveAttested(seen);
    expect(out['[PERSON_NAME_1]'].sort()).toEqual(['Jan Kowalski', 'Jana Kowalskiego'].sort());
    expect(out['[PERSON_NAME_2]']).toEqual(['Anna Nowak']);
  });

  it('a value containing "::" is still split on the FIRST separator only', () => {
    const seen = { 'ORGANIZATION_NAME::Firma A::B Sp. z o.o.': '[ORGANIZATION_NAME_1]' };
    expect(deriveAttested(seen)['[ORGANIZATION_NAME_1]']).toEqual(['Firma A::B Sp. z o.o.']);
  });

  it('handles an empty, missing, or null seen gracefully', () => {
    expect(deriveAttested({})).toEqual({});
    expect(deriveAttested(undefined)).toEqual({});
    expect(deriveAttested(null)).toEqual({});
  });

  it('is a pure function: never mutates the input', () => {
    const seen = { 'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]' };
    const before = JSON.stringify(seen);
    deriveAttested(seen);
    expect(JSON.stringify(seen)).toBe(before);
  });

  it('skips a malformed key with no type separator rather than throwing', () => {
    const seen = { 'no-separator-here': '[PERSON_NAME_1]', 'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]' };
    expect(() => deriveAttested(seen)).not.toThrow();
    expect(deriveAttested(seen)['[PERSON_NAME_1]']).toEqual(['Jan Kowalski']);
  });
});
