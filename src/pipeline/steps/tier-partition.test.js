import { describe, it, expect } from 'vitest';
import { createTierPartitionStep } from './tier-partition.js';
import { anonymizeText } from '../../anonymizer.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

describe('createTierPartitionStep — ST-2 partition (SCOPE-TIERS-DESIGN.md §3.2)', () => {
  it('splits entities into the three sinks by their static TYPE_TIERS tier', () => {
    const text = 'Jan Kowalski, adres w Warszawie, reprezentuje Sad Rejonowy w Koninie.';
    const nameStart = text.indexOf('Jan Kowalski');
    const locStart = text.indexOf('Warszawie');
    const orgStart = text.indexOf('Sad Rejonowy w Koninie');
    const mask = { entity_group: 'PERSON_NAME', start: nameStart, end: nameStart + 'Jan Kowalski'.length, score: 0.95, source: 'polish-fp16' };
    const review = { entity_group: 'LOCATION', start: locStart, end: locStart + 'Warszawie'.length, score: 0.9, source: 'multilang-fp32' };
    const pass = { entity_group: 'ORGANIZATION_NAME', start: orgStart, end: orgStart + 'Sad Rejonowy w Koninie'.length, score: 0.9, source: 'multilang-fp32' };
    const step = createTierPartitionStep();
    const result = step(ctx(text, [mask, review, pass]));

    expect(result.entities).toEqual([mask]);
    expect(result.reviewCandidates).toHaveLength(1);
    expect(result.reviewCandidates[0]).toMatchObject({ entity_group: 'LOCATION', start: review.start, end: review.end, tier: 'review' });
    // pass entities are gone from ctx.entities entirely — no third bucket.
  });

  it('a review candidate does not carry the raw text/context value, only offsets + a folded valueKey', () => {
    const text = 'Powod jest wdowcem od dwoch lat.';
    const review = { entity_group: 'PERSON_ATTRIBUTE', start: 11, end: 18, score: 0.9, source: 'multilang-fp32' };
    const step = createTierPartitionStep();
    const result = step(ctx(text, [review]));
    expect(result.reviewCandidates).toHaveLength(1);
    const candidate = result.reviewCandidates[0];
    expect(Object.keys(candidate).sort()).toEqual(['entity_group', 'score', 'source', 'start', 'end', 'tier', 'valueKey'].sort());
    expect(candidate).not.toHaveProperty('text');
    expect(candidate).not.toHaveProperty('value');
    expect(candidate).not.toHaveProperty('context');
  });

  it('drops a review candidate fully covered by a mask span; keeps a partially-covered one at its original full span', () => {
    const text = 'Jan Kowalski, dyrektor generalny, podpisal umowe.';
    const nameStart = text.indexOf('Jan Kowalski');
    const nameEnd = nameStart + 'Jan Kowalski'.length;
    const maskEntity = { entity_group: 'PERSON_NAME', start: nameStart, end: nameEnd, score: 0.95, source: 'x' };
    // Fully inside the mask span — noise once masked, must be dropped.
    const coveredCandidate = { entity_group: 'PERSON_ROLE_OR_TITLE', start: nameStart + 1, end: nameStart + 3, score: 0.8, source: 'x' };
    // Starts just before the mask span ends, extends past it — partial overlap, kept at its FULL span.
    const overlapStart = nameEnd - 2;
    const partialCandidate = { entity_group: 'PERSON_ROLE_OR_TITLE', start: overlapStart, end: overlapStart + 6, score: 0.8, source: 'x' };

    const step = createTierPartitionStep();
    const result = step(ctx(text, [maskEntity, coveredCandidate, partialCandidate]));

    expect(result.entities).toEqual([maskEntity]);
    expect(result.reviewCandidates).toHaveLength(1);
    expect(result.reviewCandidates[0].start).toBe(partialCandidate.start);
    expect(result.reviewCandidates[0].end).toBe(partialCandidate.end);
  });

  it('valueKey folds case (toLocaleLowerCase) — same word, three different cases, aggregate under one key', () => {
    // Deliberately NOT an inflection test: fold is case/whitespace-only
    // (design §3.2 pkt 5 explicitly excludes couldBeSamePerson-style
    // morphological matching from W2 — that stays on the W1/backfill side).
    const text = 'Swiadek byl WDOWIEC. Pozwany, wdowiec, potwierdzil rowniez status. Takze Wdowiec, sam.';
    const positions = [];
    for (const m of text.matchAll(/wdowiec/gi)) positions.push(m.index);
    expect(positions).toHaveLength(3);

    const entities = positions.map((start) => ({
      entity_group: 'PERSON_ATTRIBUTE', start, end: start + 'wdowiec'.length, score: 0.9, source: 'x',
    }));
    const step = createTierPartitionStep();
    const result = step(ctx(text, entities));
    const keys = new Set(result.reviewCandidates.map((c) => c.valueKey));
    expect(keys).toEqual(new Set(['PERSON_ATTRIBUTE::wdowiec']));
  });

  it('valueKey collapses internal whitespace and trims — an OCR-doubled space folds to the same key as a clean one', () => {
    const value1 = 'Radca  Prawny'; // double space
    const value2 = 'Radca Prawny'; // single space
    const text = `${value1} oraz ${value2} obecni.`;
    const start1 = 0;
    const start2 = text.indexOf(value2, start1 + value1.length);
    const entities = [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: start1, end: start1 + value1.length, score: 0.9, source: 'x' },
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: start2, end: start2 + value2.length, score: 0.9, source: 'x' },
    ];
    const step = createTierPartitionStep();
    const result = step(ctx(text, entities));
    const keys = new Set(result.reviewCandidates.map((c) => c.valueKey));
    expect(keys).toEqual(new Set(['PERSON_ROLE_OR_TITLE::radca prawny']));
  });

  it('golden JDG: a person name (mask) nested inside an organization name (pass) — org stays visible, name is masked, zero review candidates from that span', () => {
    const text = 'Kancelaria Radcy Prawnego Jan Kowalski reprezentuje powoda. Jan Kowalski podpisal pelnomocnictwo.';
    const nestedStart = text.indexOf('Jan Kowalski');
    const orgEnd = nestedStart + 'Jan Kowalski'.length;
    const secondStart = text.lastIndexOf('Jan Kowalski');

    const entities = [
      { entity_group: 'ORGANIZATION_NAME', start: 0, end: orgEnd, score: 0.95, source: 'multilang-fp32' },
      { entity_group: 'PERSON_NAME', start: nestedStart, end: orgEnd, score: 0.9, source: 'polish-fp16' },
      { entity_group: 'PERSON_NAME', start: secondStart, end: secondStart + 'Jan Kowalski'.length, score: 0.93, source: 'polish-fp16' },
    ];

    const step = createTierPartitionStep();
    const result = step(ctx(text, entities));

    expect(result.entities).toHaveLength(2);
    expect(result.entities.every((e) => e.entity_group === 'PERSON_NAME')).toBe(true);
    expect(result.reviewCandidates).toEqual([]);

    const { anonymized } = anonymizeText(text, result.entities);
    expect(anonymized).toContain('Kancelaria Radcy Prawnego [PERSON_NAME_');
    expect(anonymized).not.toContain('Jan Kowalski');
  });

  it('golden basket: three occurrences of a review-tier value aggregate under one valueKey; the anonymized text still shows the value (pre-decision, ST-3 does not exist yet)', () => {
    const text = 'Pozwany jako wdowiec zlozyl oswiadczenie. Swiadek potwierdzil, ze wdowiec mieszka sam. Sad ustalil status: wdowiec.';
    const positions = [];
    let idx = -1;
    while ((idx = text.indexOf('wdowiec', idx + 1)) !== -1) positions.push(idx);
    expect(positions).toHaveLength(3);

    const entities = positions.map((start) => ({
      entity_group: 'PERSON_ATTRIBUTE', start, end: start + 'wdowiec'.length, score: 0.9, source: 'multilang-fp32',
    }));

    const step = createTierPartitionStep();
    const result = step(ctx(text, entities));

    expect(result.entities).toHaveLength(0);
    expect(result.reviewCandidates).toHaveLength(3);
    const keys = new Set(result.reviewCandidates.map((c) => c.valueKey));
    expect(keys).toEqual(new Set(['PERSON_ATTRIBUTE::wdowiec']));

    const { anonymized } = anonymizeText(text, result.entities);
    expect(anonymized).toBe(text);
    expect(anonymized).toContain('wdowiec');
  });

  it('tierOverrides can move a type to a different tier without touching TYPE_TIERS', () => {
    const text = 'Sygnatura akt I C 1552/23 dotyczy sprawy.';
    const entity = { entity_group: 'DOCUMENT_REFERENCE', start: 15, end: 26, score: 1.0, source: 'regex' };
    const step = createTierPartitionStep({ tierOverrides: { DOCUMENT_REFERENCE: 'mask' } });
    const result = step(ctx(text, [entity]));
    expect(result.entities).toEqual([entity]);
    expect(result.reviewCandidates).toEqual([]);
  });

  it('GS-5: allMask masks a forceTier:"review" entity instead of routing it to the basket', () => {
    const text = 'Kancelaria Radcy Prawnego Jan Kowalski dziala w tej sprawie.';
    const orgValue = 'Kancelaria Radcy Prawnego Jan Kowalski';
    const entity = { entity_group: 'ORGANIZATION_NAME', start: 0, end: orgValue.length, score: 0.9, source: 'x', forceTier: 'review' };
    const step = createTierPartitionStep({ allMask: true });
    const result = step(ctx(text, [entity]));
    expect(result.entities).toEqual([entity]);
    expect(result.reviewCandidates).toEqual([]);
  });

  it('does not mutate ctx.text or ctx.segments', () => {
    const text = 'Jan Kowalski mieszka w Warszawie.';
    const segments = [{ text, offset: 0 }];
    const entity = { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, source: 'x' };
    const step = createTierPartitionStep();
    const result = step({ text, segments, entities: [entity], anonymized: '', legend: {} });
    expect(result.text).toBe(text);
    expect(result.segments).toBe(segments);
  });
});
