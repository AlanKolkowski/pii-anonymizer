import { describe, it, expect } from 'vitest';
import { checkRoleConsistency } from './n04-role-consistency.js';

describe('checkRoleConsistency (N-4)', () => {
  it('flags the same name appearing as both plaintiff and defendant', () => {
    const text = 'Powód Jan Kowalski wnosi pozew przeciwko spółce. Pozwany Jan Kowalski wnosi o oddalenie.';
    const findings = checkRoleConsistency(text);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.checker === 'N-4')).toBe(true);
  });

  it('does not flag two different people on opposite sides', () => {
    const text = 'Powód Jan Kowalski wnosi pozew. Pozwana Anna Nowak wnosi o oddalenie.';
    expect(checkRoleConsistency(text)).toEqual([]);
  });

  it('does not flag the same name repeated on the same side', () => {
    const text = 'Powód Jan Kowalski wnosi pozew. Powód Jan Kowalski żąda zapłaty.';
    expect(checkRoleConsistency(text)).toEqual([]);
  });

  it('returns no findings for text with no role words', () => {
    expect(checkRoleConsistency('Zwykły tekst bez ról procesowych.')).toEqual([]);
  });
});
