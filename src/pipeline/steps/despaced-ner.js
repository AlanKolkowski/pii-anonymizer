import { createNerStep } from './ner.js';
import { ALLOWED_TYPES, isStructuralMarkerSpan } from './case-folded-ner.js';
import { buildDespacedSegments } from '../despace.js';

export const DESPACED_SOURCE = 'despaced';

/**
 * OS-1 (OCR-SPACING-DESIGN.md §2): second NER pass over glued variants of
 * segments containing OCR-spaced words ("W r ó b l e w s k a"), so the models
 * see text they are competent on ("Wróblewska") and decide the type — the
 * pattern itself never asserts "this is a name" (§2.1: normalize and ask the
 * model, don't guess from shape). Modeled 1:1 on createCaseFoldedNerStep
 * (B2), including the reuse of createNerStep as the inference engine and the
 * once-per-text standalone caching in cache-orchestrator.js.
 *
 * Unlike B2's length-preserving fold, the glued variant is SHORTER than the
 * original, so candidate offsets from the variant are remapped through the
 * per-segment origPos table (variant index → original index). The map is
 * transient — it exists only inside this step (tripwire T1 of the design
 * forbids it ever leaking into ctx, debug or the legend). Any candidate that
 * cannot be remapped cleanly is dropped (fail open, R-OS-1: wrong offsets
 * are a leak and content destruction at once — never emit them).
 *
 * Provenance gate (§2.2 pkt 6, shared contract with B5a): the step is a hard
 * no-op unless the caller set ctx.meta.ocrProvenance — OCR-spaced surnames
 * exist on scans; on clean text this pattern must cost nothing, neither FPs
 * nor latency. The worker sets the flag from the source's import metadata,
 * eval from the document class/filename.
 *
 * Residual W2 emission (§2.2 pkt 5 — unconfirmed title-case runs as review
 * candidates) is deliberately NOT implemented here: it needs the ST-2/ST-3
 * review bucket as its sink and enters with OS-2 (§6 sequencing).
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources - same
 *   HF source list as the main pass.
 * @param {Function} loadModel
 * @param {object} [options]
 * @param {boolean} [options.active] - default true. Same contract as
 *   createCaseFoldedNerStep's flag: cache-orchestrator's per-source NER loop
 *   passes false and runs this step standalone with the full source set,
 *   cached under its own bucket (cache.despaced).
 */
export function createDespacedNerStep(sources, loadModel, options = {}) {
  const active = options.active ?? true;
  const innerStep = createNerStep(sources, loadModel, {});

  return async function despacedNerStep(ctx) {
    if (!active) return ctx;
    if (!ctx.meta?.ocrProvenance) return ctx;

    const despaced = buildDespacedSegments(ctx.segments);
    if (despaced.length === 0) return ctx;

    const { entities: rawEntities } = await innerStep({
      ...ctx,
      segments: despaced.map((d) => ({ text: d.text, offset: d.offset })),
      entities: [],
      modelHandles: undefined,
    });

    const candidates = [];
    for (const entity of rawEntities) {
      if (!ALLOWED_TYPES.has(entity.entity_group)) continue;

      // Variant offsets are (segment.offset + variant-local); the owning
      // segment is the one whose variant range contains the span. Variant
      // ranges of different segments cannot overlap (a variant is never
      // longer than its original), so the match is unambiguous.
      const segment = despaced.find(
        (d) => entity.start >= d.offset && entity.end <= d.offset + d.text.length,
      );
      if (!segment) continue;

      const variantStart = entity.start - segment.offset;
      const variantEnd = entity.end - segment.offset;
      if (variantStart >= variantEnd) continue;
      const spanText = segment.text.slice(variantStart, variantEnd);
      if (isStructuralMarkerSpan(spanText)) continue;

      const start = segment.offset + segment.origPos[variantStart];
      const end = segment.offset + segment.origPos[variantEnd - 1] + 1;

      // Keep only candidates that actually cover a detected spaced word —
      // a candidate lying entirely in the identity-copied remainder saw the
      // same characters the main pass saw and would only re-litigate spans
      // the main pass already owns (the exact arbitration hazard B2's
      // gap-filling guard documents).
      const coversWord = segment.words.some(
        (w) => segment.offset + w.start < end && start < segment.offset + w.end,
      );
      if (!coversWord) continue;

      // Strip the raw model's `word` (and any other surface-text field): it
      // holds the GLUED variant text, while start/end now point at the
      // spaced original — a mismatched word would mislead debug output and
      // eval artifacts. Everything downstream reads text.slice(start, end).
      const { word: _variantWord, ...mappedFields } = entity;
      candidates.push({ ...mappedFields, start, end, source: DESPACED_SOURCE });
    }

    return { ...ctx, entities: [...ctx.entities, ...candidates] };
  };
}
