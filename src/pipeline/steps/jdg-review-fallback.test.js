import { createJdgReviewFallbackStep } from './jdg-review-fallback.js';

const TIERED = { allMask: false };

function ctxFor(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {}, debug: [] };
}

function orgAt(text, value) {
  const start = text.indexOf(value);
  return { entity_group: 'ORGANIZATION_NAME', start, end: start + value.length, score: 0.9, source: 'model' };
}

describe('createJdgReviewFallbackStep (ST-5 §5.2 pkt 5)', () => {
  it('is a hard no-op under allMask — no forceTier fields appear anywhere', () => {
    const text = 'Kancelaria Radcy Prawnego Jan Kowalski w Toruniu';
    const ctx = ctxFor(text, [orgAt(text, 'Kancelaria Radcy Prawnego Jan Kowalski')]);
    expect(createJdgReviewFallbackStep({ allMask: true })(ctx)).toBe(ctx);
    expect(createJdgReviewFallbackStep()(ctx)).toBe(ctx);
  });

  it('marks a pass-tier org name containing an uncovered capitalized sequence as review', () => {
    const text = 'Pozwana: Kancelaria Radcy Prawnego Jan Kowalski, ul. Piekary 33';
    const org = orgAt(text, 'Kancelaria Radcy Prawnego Jan Kowalski');
    const out = createJdgReviewFallbackStep(TIERED)(ctxFor(text, [org]));
    expect(out.entities[0].forceTier).toBe('review');
    // Original entity object untouched (new object returned).
    expect(org.forceTier).toBeUndefined();
  });

  it('stays silent when the personal part is already masked inside the span', () => {
    const text = 'Pozwana: Kancelaria Radcy Prawnego Jan Kowalski, ul. Piekary 33';
    const org = orgAt(text, 'Kancelaria Radcy Prawnego Jan Kowalski');
    const person = {
      entity_group: 'PERSON_NAME',
      start: text.indexOf('Jan Kowalski'),
      end: text.indexOf('Jan Kowalski') + 'Jan Kowalski'.length,
      score: 0.95,
      source: 'model',
    };
    const out = createJdgReviewFallbackStep(TIERED)(ctxFor(text, [org, person]));
    expect(out.entities.find((e) => e.entity_group === 'ORGANIZATION_NAME').forceTier).toBeUndefined();
  });

  it('a sequence touched by any masked entity counts as handled (v1 boundary)', () => {
    // Only "Marek" is masked and "Nowak" stays visible — v1 accepts this:
    // sequence coverage is overlap-based so ST-2's golden (masked name ⇒
    // zero candidates from the span) holds; tightening to known-first-name
    // sequences comes with the morphology lexicon (poza v1, §5.2 pkt 5).
    const text = 'Firma PHU Marek Nowak sp.j. w Toruniu';
    const org = orgAt(text, 'PHU Marek Nowak');
    const person = {
      entity_group: 'PERSON_NAME',
      start: text.indexOf('Marek'),
      end: text.indexOf('Marek') + 'Marek'.length,
      score: 0.95,
      source: 'model',
    };
    const out = createJdgReviewFallbackStep(TIERED)(ctxFor(text, [org, person]));
    expect(out.entities.find((e) => e.entity_group === 'ORGANIZATION_NAME').forceTier).toBeUndefined();
  });

  it('leaves org names with no capitalized sequence alone', () => {
    const text = 'Powszechna kasa oszczędności prowadzi rachunek.';
    const org = orgAt(text, 'Powszechna kasa oszczędności');
    const out = createJdgReviewFallbackStep(TIERED)(ctxFor(text, [org]));
    expect(out.entities[0].forceTier).toBeUndefined();
    expect(out).toEqual(ctxFor(text, [org]));
  });

  it('does not touch non-ORGANIZATION_NAME entities or ones with an existing forceTier', () => {
    const text = 'Sygn. I C 1552/23; Kancelaria Radcy Prawnego Jan Kowalski';
    const doc = {
      entity_group: 'DOCUMENT_REFERENCE', start: 6, end: 17, score: 1.0,
      source: 'case-allowlist', forceTier: 'mask',
    };
    const org = { ...orgAt(text, 'Kancelaria Radcy Prawnego Jan Kowalski'), forceTier: 'review' };
    const out = createJdgReviewFallbackStep(TIERED)(ctxFor(text, [doc, org]));
    expect(out.entities[0]).toBe(doc);
    expect(out.entities[1]).toBe(org);
  });

  it('respects tierOverrides — an org type overridden to mask is not a fallback target', () => {
    const text = 'Kancelaria Radcy Prawnego Jan Kowalski';
    const org = orgAt(text, 'Kancelaria Radcy Prawnego Jan Kowalski');
    const out = createJdgReviewFallbackStep({ allMask: false, tierOverrides: { ORGANIZATION_NAME: 'mask' } })(
      ctxFor(text, [org]),
    );
    expect(out.entities[0].forceTier).toBeUndefined();
  });
});
