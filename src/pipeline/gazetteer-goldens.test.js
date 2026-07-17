import { get_sentence_boundaries } from 'sentencex';
import { createDefaultPipeline } from './configs/default.js';
import { runPipeline } from './runner.js';
import { allEntityTypes } from './configs/entity-sources.js';

// SG-lite (SURNAME-GAZETTEER-DESIGN.md §2.4) end-to-end goldens with a
// silent model — every PERSON_NAME below can only come from the gazetteer,
// so a masked span is proof of the collision list, not of a model.

const ALL_ENTITIES = allEntityTypes();

const silentModel = async () => ({
  infer: async () => [],
  dispose: async () => {},
});

function pipelineWith(extra = {}) {
  return createDefaultPipeline(silentModel, get_sentence_boundaries, {
    enabledEntities: ALL_ENTITIES,
    ...extra,
  });
}

describe('SG-lite goldens — slot matches mask automatically', () => {
  it('S1 name+surname masked end to end (default allMask profile)', async () => {
    const text = 'Odpowiedź na pozew wniosła Anna Wrona w terminie.';
    const result = await runPipeline(text, pipelineWith());
    expect(result.anonymized).toBe('Odpowiedź na pozew wniosła [PERSON_NAME_1] w terminie.');
    expect(result.legend['[PERSON_NAME_1]']).toBe('Anna Wrona');
  });

  it('S4 procedural role slot masks the surname only', async () => {
    const text = 'W sprzeciwie pozwany Kozioł zakwestionował roszczenie.';
    const result = await runPipeline(text, pipelineWith());
    expect(result.anonymized).toBe('W sprzeciwie pozwany [PERSON_NAME_1] zakwestionował roszczenie.');
    expect(result.legend['[PERSON_NAME_1]']).toBe('Kozioł');
  });
});

describe('SG-lite goldens — tiered profile routes slotless matches to review', () => {
  it('a slotless mid-sentence match becomes a review candidate, nothing masked', async () => {
    const text = 'Sąd przesłuchał wtedy Dzięcioła na okoliczność umowy.';
    const result = await runPipeline(text, pipelineWith({ allMask: false }));
    expect(result.anonymized).toBe(text);
    expect(result.reviewCandidates.some(
      (c) => c.entity_group === 'PERSON_NAME' && text.slice(c.start, c.end) === 'Dzięcioła',
    )).toBe(true);
  });

  it('under the default allMask profile the same match is masked (allMask beats forceTier)', async () => {
    const text = 'Sąd przesłuchał wtedy Dzięcioła na okoliczność umowy.';
    const result = await runPipeline(text, pipelineWith());
    expect(result.anonymized).toBe('Sąd przesłuchał wtedy [PERSON_NAME_1] na okoliczność umowy.');
  });
});

describe('SG-lite goldens — negative whole-document traps (§2.4)', () => {
  it('birds, streets and lowercase nouns produce nothing', async () => {
    const text = 'Wrona siedziała na płocie przy ul. 3 Maja 12. Na dachu przysiadła sowa, a lis przebiegł przez podwórze.';
    const result = await runPipeline(text, pipelineWith());
    expect(result.anonymized).toBe(text);
    expect(result.entities).toEqual([]);
  });
});
