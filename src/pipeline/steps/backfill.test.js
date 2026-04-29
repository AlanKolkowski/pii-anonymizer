import { describe, it, expect, vi } from 'vitest';
import { backfillOccurrencesStep } from './backfill.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { backfill: true, fuzzyBackfill: true },
      PERSON_ROLE_OR_TITLE: { backfill: true, fuzzyBackfill: true },
      ORGANIZATION_NAME: { backfill: false, fuzzyBackfill: false },
      ORG_CASE_INSENSITIVE: { backfill: true, fuzzyBackfill: false, caseInsensitiveBackfill: true },
      DOCUMENT_REFERENCE: { backfill: true, fuzzyBackfill: false },
    };
    return map[type] || { backfill: true, fuzzyBackfill: false };
  },
}));

describe('backfillOccurrencesStep', () => {
  it('backfills additional occurrences of a type that opts in', () => {
    const text = 'Kowalski spotkał Kowalski w parku.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 8, score: 0.9, source: 'polish-q8' },
    ]));
    const names = result.entities.filter((e) => e.entity_group === 'PERSON_NAME');
    expect(names.length).toBe(2);
    expect(names[1].start).toBe(17);
    expect(names[1].end).toBe(25);
  });

  it('does not backfill occurrences for types where backfill=false', () => {
    const text = 'Acme Corp paid Acme Corp again.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'ORGANIZATION_NAME', start: 0, end: 9, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
  });

  it('fuzzy-backfills a declined form of a PERSON_ROLE_OR_TITLE', () => {
    const text = 'Pełni rolę Prezesa Zarządu. Jan, Prezes Zarządu, podpisał.';
    const detected = { entity_group: 'PERSON_ROLE_OR_TITLE', start: 33, end: 47, score: 0.9, source: 'multilang-fp32' };
    const result = backfillOccurrencesStep(ctx(text, [detected]));
    const roles = result.entities.filter((e) => e.entity_group === 'PERSON_ROLE_OR_TITLE');
    expect(roles).toHaveLength(2);
    const backfilled = roles.find((e) => e.source === 'rescan');
    expect(text.slice(backfilled.start, backfilled.end)).toBe('Prezesa Zarządu');
  });

  it('does not fuzzy-backfill when fuzzyBackfill=false even if backfill=true', () => {
    const text = 'Faktura FV/2024/001 oraz Faktury FV/2024/002.';
    const detected = { entity_group: 'DOCUMENT_REFERENCE', start: 8, end: 19, score: 0.9, source: 'regex' };
    const result = backfillOccurrencesStep(ctx(text, [detected]));
    const refs = result.entities.filter((e) => e.entity_group === 'DOCUMENT_REFERENCE');
    expect(refs).toHaveLength(1);
  });

  it('case-insensitive backfill: finds different-case occurrences when rule opts in', () => {
    const text = 'Acme Corp paid acme corp again. Then ACME CORP was billed.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'ORG_CASE_INSENSITIVE', start: 0, end: 9, score: 0.9, source: 'manual' },
    ]));
    const orgs = result.entities.filter((e) => e.entity_group === 'ORG_CASE_INSENSITIVE');
    expect(orgs).toHaveLength(3);
    const sliced = orgs.map((e) => text.slice(e.start, e.end)).sort();
    expect(sliced).toEqual(['ACME CORP', 'Acme Corp', 'acme corp']);
  });

  it('case-insensitive backfill: dedupes by lowercase so we do not re-scan equivalents', () => {
    const text = 'Acme Corp and acme corp.';
    // Two existing entities with different cases — should not double-add.
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'ORG_CASE_INSENSITIVE', start: 0, end: 9, score: 0.9, source: 'manual' },
      { entity_group: 'ORG_CASE_INSENSITIVE', start: 14, end: 23, score: 0.9, source: 'manual' },
    ]));
    const orgs = result.entities.filter((e) => e.entity_group === 'ORG_CASE_INSENSITIVE');
    expect(orgs).toHaveLength(2);
  });

  it('fuzzy-backfill does not match different role stems', () => {
    const text = 'Jan, Prezes Zarządu, oraz Anna, Prezes Banku, byli obecni.';
    const detected = { entity_group: 'PERSON_ROLE_OR_TITLE', start: 5, end: 19, score: 0.9, source: 'multilang-fp32' };
    const result = backfillOccurrencesStep(ctx(text, [detected]));
    const roles = result.entities.filter((e) => e.entity_group === 'PERSON_ROLE_OR_TITLE');
    expect(roles).toHaveLength(1);
  });
});
