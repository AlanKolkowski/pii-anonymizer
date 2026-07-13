import { createNerStep } from './ner.js';
import { buildFoldedSegments } from '../case-fold.js';
import documentHeaderLemmas from '../data/document-header-lemmas.json' with { type: 'json' };

// RECALL-90-DESIGN.md §2.2 pkt 4: closed list of types the case-folded
// source may originate candidates for — only types where a fully-uppercase
// span plausibly still carries a recognizable proper-noun/role shape once
// restored to Title Case.
const ALLOWED_TYPES = new Set([
  'PERSON_NAME',
  'ORGANIZATION_NAME',
  'POSTAL_ADDRESS',
  'LOCATION',
  'PERSON_ROLE_OR_TITLE',
]);

export const CASE_FOLDED_SOURCE = 'case-folded';

const HEADER_LEMMAS = new Set(documentHeaderLemmas.lemmas);
const FIRST_WORD_RE = /^\p{L}+/u;

// FP guard (RECALL-90-DESIGN.md §2.2 pkt 5): an ORGANIZATION_NAME candidate
// from the case-folded source whose span *opens* with a document-type lemma
// ("UMOWA ...", "POZEW ...") is the document's own title declaration, not an
// organization — reject the whole candidate, however confidently the folded
// pass scored it. This is exactly how the pre-existing "UMOWA KREDYTU
// GOTÓWKOWEGO" ORGANIZATION_NAME false positive (RECALL-90-DESIGN.md §5.2)
// would otherwise reappear, scored on Title Case text this time, at
// case-folded's own threshold too.
//
// Scoped to the candidate's *first word only* (not "does this span contain
// a lemma anywhere") so a real organization name immediately adjacent to a
// generic lead-in on the same all-caps line survives, as long as the
// model's own span boundary doesn't start on the lemma — see pismo_03's
// "ODWOŁANIE OD DECYZJI ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH", where the lemma
// list must NOT reject "Zakładu Ubezpieczeń Społecznych". "ODWOŁANIE" is
// deliberately absent from document-header-lemmas.json for exactly this
// reason: that header has no punctuation between the lead-in and the real
// org name, so if the model ever merged the two into one span, adding
// "ODWOŁANIE" to the list would make this guard reject the whole thing —
// trading the true positive away to suppress a false one that, unlike the
// UMOWA KREDYTU case, has no evidence of actually occurring.
function isDocumentHeaderSpan(spanText) {
  const m = spanText.match(FIRST_WORD_RE);
  return m ? HEADER_LEMMAS.has(m[0].toUpperCase()) : false;
}

function overlapsAny(candidate, existingEntities) {
  return existingEntities.some((e) => e.start < candidate.end && candidate.start < e.end);
}

// Gap-filling guard, added after measurement (RECALL-B2-NOTES.md): a
// case-folded candidate is dropped if the main pass already produced ANY
// entity overlapping its span, of ANY type, regardless of score. Without
// this, case-folded's redundant re-detection of a span the main pass
// *already* covers can still win deduplicateEntities' type-agnostic,
// order-sensitive arbitration (src/anonymizer.js — same-start candidates
// sorted by score, "close scores -> prefer wider span") and evict a
// correct candidate in favor of a worse one case-folded itself produced
// (measured case: a folded segment's model output disagreed with itself,
// LOCATION vs POSTAL_ADDRESS, on the exact same address span; LOCATION's
// higher score let it win the sort-order tie-break against the main pass's
// already-correct POSTAL_ADDRESS, and the arriving POSTAL_ADDRESS
// candidate from case-folded itself then lost the *equal*-width tie
// against that wrong LOCATION winner — "close scores -> wider span" only
// overrides on strictly-greater width). This is not a special case to
// patch around: it is the faithful reading of the module's own diagnosis
// (RECALL-90-DESIGN.md §2.2 — both models "lose the signal" on qualifying
// segments) — case-folded exists to fill gaps the main pass has *no*
// opinion on, not to relitigate spans it already covered, however
// imperfectly. Any genuine boundary truncation the main pass leaves behind
// (e.g. a POSTAL_ADDRESS missing its trailing city) is left to the
// existing backfill/rescan mechanism, which does not carry this risk since
// it only ever repeats an *already-accepted* value.
function fillsGap(candidate, mainPassEntities) {
  return !overlapsAny(candidate, mainPassEntities);
}

/**
 * B2 (RECALL-90-DESIGN.md §2.2): second NER pass over uppercase segments
 * folded to Title Case, so both models see naturally-capitalised text where
 * they otherwise lose (or misfire on) the proper-noun signal. Placed after
 * createNerStep in the `ner` phase (configs/default.js).
 *
 * Reuses createNerStep itself as the inference engine — same chunking,
 * aggregation, and dispose lifecycle already proven for the main pass —
 * rather than duplicating it. The only differences are the input segments
 * (folded variants of the qualifying ones, same {text, offset} shape) and
 * the source tag rewritten on the way out.
 *
 * Model handles: by the time this step runs, createNerStep's own pass has
 * already disposed the sources it used (ner.js always tears down after one
 * run through ctx.segments, regardless of whether the handle was preloaded)
 * — so this step never reads ctx.modelHandles and always drives createNerStep
 * down its self-contained load-use-dispose path. In the browser this is
 * close to free (worker.js's loadModelForPipeline keeps sessions warm
 * across calls within a worker session; the dispose it hands back is a
 * no-op there); in Node/eval it is a genuine second load+dispose cycle per
 * source — the accepted cost of this module, paid once per document that
 * has at least one qualifying segment, not per segment.
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources - same
 *   HF source list passed to the main pass's createNerStep.
 * @param {Function} loadModel
 * @param {object} [options]
 * @param {boolean} [options.active] - default true. Callers that fan NER
 *   out per-source for incremental caching (cache-orchestrator.js's
 *   per-source loop) must pass `false` here: this step needs the full
 *   source set at once (folding is meaningless run against only one of the
 *   two models), so it cannot be driven one source at a time the way the
 *   main pass can. cache-orchestrator.js instead runs it once, standalone,
 *   with every currently-required source, and caches the result under its
 *   own `cache.caseFolded` bucket — mirroring `cache.regex`/`cache.lexicon`.
 */
export function createCaseFoldedNerStep(sources, loadModel, options = {}) {
  const active = options.active ?? true;
  const innerStep = createNerStep(sources, loadModel, {});

  return async function caseFoldedNerStep(ctx) {
    if (!active) return ctx;

    const foldedSegments = buildFoldedSegments(ctx.segments);
    if (foldedSegments.length === 0) return ctx;

    const { entities: rawEntities } = await innerStep({
      ...ctx,
      segments: foldedSegments,
      entities: [],
      modelHandles: undefined,
    });

    const candidates = rawEntities
      .filter((e) => ALLOWED_TYPES.has(e.entity_group))
      .filter((e) => e.entity_group !== 'ORGANIZATION_NAME' || !isDocumentHeaderSpan(ctx.text.slice(e.start, e.end)))
      .filter((e) => fillsGap(e, ctx.entities))
      .map((e) => ({ ...e, source: CASE_FOLDED_SOURCE }));

    return { ...ctx, entities: [...ctx.entities, ...candidates] };
  };
}
