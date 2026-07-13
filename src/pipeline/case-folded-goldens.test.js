import { describe, it, expect } from 'vitest';
import { get_sentence_boundaries } from 'sentencex';
import { createDefaultPipeline } from './configs/default.js';
import { runPipeline } from './runner.js';
import { allEntityTypes } from './configs/entity-sources.js';

// B2 (RECALL-90-DESIGN.md §2.2) acceptance-criteria goldens, run end-to-end
// through createDefaultPipeline (full postprocess: source-filter, threshold,
// snap, blocklist, dedup, backfill, tokenize) with a mocked model instead of
// the real HF weights — this proves the *wiring* deterministically and fast
// (part of `npm test`); the measured recall/precision numbers on the real
// corpora come from `npm run eval` (RECALL-B2-NOTES.md).
//
// Each mock only recognizes the Title Case (folded) form of its target span
// — never the untouched all-caps original — so a passing test is proof the
// candidate really did come from a second, case-folded pass, not the main
// one. Text fragments below are copied verbatim from the named corpus files.

const ALL_ENTITIES = allEntityTypes();

function textOnlyMock(matchers) {
  return async () => ({
    infer: async (text) => {
      for (const { needle, group, score } of matchers) {
        const idx = text.indexOf(needle);
        if (idx >= 0) {
          return [{ entity_group: group, start: idx, end: idx + needle.length, score }];
        }
      }
      return [];
    },
    dispose: async () => {},
  });
}

describe('B2 goldens — ZUS masked despite full-caps header (test-data/synthetic/pismo_03)', () => {
  it('masks all three occurrences of the all-caps org name header line', async () => {
    const mockLoadModel = textOnlyMock([
      { needle: 'Zakładu Ubezpieczeń Społecznych', group: 'ORGANIZATION_NAME', score: 0.9 },
    ]);
    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });

    const header = 'ODWOŁANIE OD DECYZJI ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH';
    const text = [header, '', 'Treść pisma.', '', header, '', 'Dalsza treść.', '', header].join('\n');

    const result = await runPipeline(text, pipeline);

    expect(result.anonymized).not.toContain('ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH');
    const maskCount = (result.anonymized.match(/\[ORGANIZATION_NAME_\d+\]/g) || []).length;
    expect(maskCount).toBe(3);
  });
});

describe('B2 goldens — document-header FP guard (test-data/adversarial/adw_18_naglowek_pisma)', () => {
  it('does not mask a bare document-type header ("POZEW O ZAPŁATĘ") even if the folded pass mistags it', async () => {
    // Simulates the realistic failure mode this guard exists for: a model,
    // even given naturally-capitalised text, tags the document's own title
    // declaration as an organization.
    const mockLoadModel = textOnlyMock([
      { needle: 'Pozew O Zapłatę', group: 'ORGANIZATION_NAME', score: 0.95 },
    ]);
    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });

    const text = 'Toruń, dnia 3 marca 2025 r.\n\nPowód:\nKonrad Żurawski\n\nPOZEW O ZAPŁATĘ';
    const result = await runPipeline(text, pipeline);

    expect(result.anonymized).toContain('POZEW O ZAPŁATĘ');
    expect(result.anonymized).not.toMatch(/\[ORGANIZATION_NAME_\d+\]/);
  });
});

describe('B2 goldens — UMOWA KREDYTU GOTÓWKOWEGO false positive does not return in Title Case (test-data/adversarial/adw_29_umowa_kredytu)', () => {
  it('does not mask the document title in any capitalization once folded', async () => {
    // RECALL-90-DESIGN.md §5.2 / EVAL-RECALL-AUDIT.md line 257: this exact
    // phrase is a pre-existing ORGANIZATION_NAME false positive (score 1.00)
    // from the *main* pass on the raw all-caps text — unrelated to B2, and
    // out of this module's scope to fix. What this golden proves is narrower
    // and squarely B2's responsibility: the *case-folded* pass must not
    // reproduce the same false positive a second time, scored on Title Case.
    const mockLoadModel = textOnlyMock([
      { needle: 'Umowa Kredytu Gotówkowego', group: 'ORGANIZATION_NAME', score: 1.0 },
    ]);
    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });

    const text = 'UMOWA KREDYTU GOTÓWKOWEGO NR KG/2025/02/00871\n\nzawarta w Toruniu dnia 20 lutego 2025 r.';
    const result = await runPipeline(text, pipeline);

    const foldedSourceHit = result.entities.some(
      (e) => e.source === 'case-folded' && e.entity_group === 'ORGANIZATION_NAME',
    );
    expect(foldedSourceHit).toBe(false);
  });
});

describe('B2 goldens — letter-spaced OCR stays out of scope (test-data/adversarial/adw_24_ocr_rozstrzelone)', () => {
  it('never invokes the case-folded pass on letter-spaced text (each "word" is a single letter, C1)', async () => {
    let inferCallCount = 0;
    const mockLoadModel = async () => ({
      infer: async () => { inferCallCount += 1; return []; },
      dispose: async () => {},
    });
    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });

    const text = 'Nagłówek skanu decyzji: Z A K Ł A D   U B E Z P I E C Z E Ń   S P O Ł E C Z N Y C H';
    await runPipeline(text, pipeline);

    // Both models still run once each on the (single, unfolded) segment for
    // the main pass — this only proves the *second* pass contributes zero
    // extra inference calls, not that inference never happens at all.
    const hfSourceCount = 2; // multilang-fp32 + polish-fp16
    expect(inferCallCount).toBe(hfSourceCount);
  });
});
