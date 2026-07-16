import { createNerStep } from './ner.js';
import { buildFoldedSegments } from '../case-fold.js';
import documentHeaderLemmas from '../data/document-header-lemmas.json' with { type: 'json' };

// RECALL-90-DESIGN.md §2.2 pkt 4: closed list of types the case-folded
// source may originate candidates for — only types where a fully-uppercase
// span plausibly still carries a recognizable proper-noun/role shape once
// restored to Title Case. Exported because OS-1's despaced pass uses the
// SAME closed list by contract (OCR-SPACING-DESIGN.md §2.2 pkt 4:
// "identycznej z B2") — one source of truth, not a copied literal.
export const ALLOWED_TYPES = new Set([
  'PERSON_NAME',
  'ORGANIZATION_NAME',
  'POSTAL_ADDRESS',
  'LOCATION',
  'PERSON_ROLE_OR_TITLE',
]);

export const CASE_FOLDED_SOURCE = 'case-folded';

const HEADER_LEMMAS = new Set(documentHeaderLemmas.lemmas);
const FIRST_WORD_RE = /^\p{L}+/u;

// Section-numbering markers ("I.", "II.", ..., "XX.") that open a numbered
// heading in Polish legal documents ("I. Strony umowy", "IV. Żądanie").
// Closed list, not a general roman-numeral parser — legal-document section
// counts don't plausibly exceed ~20, and a closed list means this can never
// accidentally swallow an unrelated all-caps token that happens to consist
// only of I/V/X letters.
const SECTION_MARKERS = new Set([
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
]);
const LEADING_TOKEN_WITH_DOT_RE = /^(\p{L}+)\./u;

// Bare identifier-LABEL acronyms — the word this system itself uses to
// label a DIFFERENT entity type's value (PERSON_IDENTIFIER: "PESEL";
// ORGANIZATION_IDENTIFIER: "NIP"/"REGON"/"KRS"; BANK_ACCOUNT_IDENTIFIER:
// "IBAN"/"NRB"/"SWIFT"/"BIC") is never itself that entity. Measured:
// adw_09_pesel_formaty repeats "PESEL:" as a field label ahead of four
// separate PESEL values; the folded pass scored the bare label itself
// ORGANIZATION_NAME (0.91), and PERSON_IDENTIFIER's caseInsensitiveBackfill
// then propagated that one mistake to the other three literal "PESEL"
// occurrences via the 'rescan' source (src/pipeline/steps/backfill.js) —
// traced with a diff against a fresh baseline run of the same document,
// not assumed: TP and FN were bit-for-bit identical to baseline, all four
// extra FPs were this one cascade. Closed list, not a general acronym
// blocklist — deliberately limited to labels THIS SYSTEM already has a
// dedicated entity type for (a principled boundary, not "acronyms observed
// to cause problems"); a same-shaped mistake on an acronym with no such
// home (e.g. "MRI" scored PERSON_NAME once on the synthetic corpus) is
// left as documented residual noise in RECALL-B2-NOTES.md rather than
// grown into an ad hoc list chasing individual observations.
const IDENTIFIER_LABEL_ACRONYMS = new Set(['PESEL', 'NIP', 'REGON', 'KRS', 'IBAN', 'NRB', 'SWIFT', 'BIC']);

function isBareIdentifierLabel(spanText) {
  return IDENTIFIER_LABEL_ACRONYMS.has(spanText.trim().toUpperCase());
}

// Structural-marker FP guard (RECALL-90-DESIGN.md §2.2 pkt 5, extended
// after measurement — RECALL-B2-NOTES.md): a candidate from the case-folded
// source whose span is document scaffolding, not PII, is rejected however
// confidently the folded pass scored it. Three related but distinct
// failure modes, checked in isStructuralMarkerSpan:
//   - Lemma case (span *opens* with a document-type lemma): "UMOWA KREDYTU
//     GOTÓWKOWEGO" scored ORGANIZATION_NAME (RECALL-90-DESIGN.md §5.2, the
//     original motivating example) and "PEŁNOMOCNICTWO PROCESOWE" scored
//     PERSON_ROLE_OR_TITLE (measured on pismo_03 — "pełnomocnictwo" the
//     document vs "pełnomocnik" the role is a one-letter-away confusion for
//     a model reading Title Case text).
//   - Section-marker case (span *opens* with a numbered-section marker):
//     "IV. ŻĄDANIE" / "I. PRZYCZYNA" scored PERSON_NAME — structurally
//     identical to the "J. Kowalski" initial-plus-surname pattern once
//     folded ("Iv. Żądanie"), which is exactly the shape PERSON_NAME
//     candidates are expected to have.
//   - Identifier-label case (span *is, in full,* a bare label acronym): see
//     isBareIdentifierLabel above.
// Applied across all ALLOWED_TYPES (not just the type each was first
// observed on) because the mechanism — folded document scaffolding
// resembling SOME entity shape — isn't specific to one type; only the
// *lemma list itself* stays domain-specific (chosen so none of its entries
// are plausible surnames/place names/org names, so widening its type scope
// costs nothing measured on either corpus).
//
// The lemma and section-marker checks are scoped to the candidate's *first
// word only* (not "does this span contain a marker anywhere") so a real
// entity immediately adjacent to a generic lead-in on the same all-caps
// line survives, as long as the model's own span boundary doesn't start on
// the marker — see pismo_03's "ODWOŁANIE OD DECYZJI ZAKŁADU UBEZPIECZEŃ
// SPOŁECZNYCH", where this guard must NOT reject "Zakładu Ubezpieczeń
// Społecznych". "ODWOŁANIE" is deliberately absent from document-header-
// lemmas.json for exactly this reason: that header has no punctuation
// between the lead-in and the real org name, so if the model ever merged
// the two into one span, adding "ODWOŁANIE" to the list would make this
// guard reject the whole thing — trading a true positive away to suppress
// a false one that, unlike the UMOWA KREDYTU case, has no evidence of
// actually occurring. The identifier-label check is whole-span instead
// (see isBareIdentifierLabel) since the failure mode there is the model
// tagging the bare label on its own, not a label-prefixed longer phrase.
//
// Known residual risk, accepted and documented rather than silently
// present: a genuine single-initial Polish name ("I. Iwańska") inside a
// qualifying all-caps segment would also be rejected by the section-marker
// half of this guard. Checked against both corpora at measurement time —
// zero such GT entities exist in either — so this costs nothing *measured*;
// flagged here for whoever extends the corpus with that shape later.
// Exported for OS-1's despaced pass: a spaced-out all-caps header glued and
// folded to Title Case ("U M O W A  K R E D Y T U" → "Umowa Kredytu") is the
// same folded-scaffolding shape this guard was measured against — same
// mechanism, same guard, not a new list.
export function isStructuralMarkerSpan(spanText) {
  if (isBareIdentifierLabel(spanText)) return true;
  const word = spanText.match(FIRST_WORD_RE);
  if (word && HEADER_LEMMAS.has(word[0].toUpperCase())) return true;
  const dotted = spanText.match(LEADING_TOKEN_WITH_DOT_RE);
  return dotted ? SECTION_MARKERS.has(dotted[1].toUpperCase()) : false;
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
      .filter((e) => !isStructuralMarkerSpan(ctx.text.slice(e.start, e.end)))
      .filter((e) => fillsGap(e, ctx.entities))
      .map((e) => ({ ...e, source: CASE_FOLDED_SOURCE }));

    return { ...ctx, entities: [...ctx.entities, ...candidates] };
  };
}
