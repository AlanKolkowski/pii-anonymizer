import { findGazetteerEntities } from '../surname-gazetteer.js';

/**
 * SG-lite (SURNAME-GAZETTEER-DESIGN.md §2.2 pkt 5): ner-phase step, after
 * the models and next to lexiconStep — it reads ctx.entities for the S3
 * role-adjacency slot signal, so it must run after every step that can emit
 * PERSON_ROLE_OR_TITLE. Self-disabled via `active`, same contract as
 * createLexiconStep.
 */
export function createGazetteerStep(active) {
  return function gazetteerStep(ctx) {
    if (!active) return ctx;
    const found = findGazetteerEntities(ctx.text, ctx.segments, ctx.entities);
    if (found.length === 0) return ctx;
    return { ...ctx, entities: [...ctx.entities, ...found] };
  };
}
