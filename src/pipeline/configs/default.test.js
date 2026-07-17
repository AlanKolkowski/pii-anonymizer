import { describe, it, expect } from 'vitest';
import { get_sentence_boundaries } from 'sentencex';
import {
  createDefaultPipeline,
  createPreSegmentSteps,
  createModelLoadSteps,
  createNerSteps,
  createPostprocessSteps,
} from './default.js';
import { runPipeline } from '../runner.js';
import { allEntityTypes } from './entity-sources.js';

const ALL_ENTITIES = allEntityTypes();

describe('default pipeline (with mock NER)', () => {
  it('runs full pipeline and produces anonymized output', async () => {
    // Mock NER that detects "Jan Kowalski" and "jan@test.com"
    const mockLoadModel = async () => ({
      infer: async (text) => {
        const entities = [];
        const nameIdx = text.indexOf('Jan Kowalski');
        if (nameIdx >= 0) {
          entities.push(
            { word: 'Jan', entity: 'B-PERSON_NAME', score: 0.95, index: 0 },
            { word: 'Kowalski', entity: 'I-PERSON_NAME', score: 0.93, index: 1 },
          );
        }
        return entities;
      },
      dispose: async () => {},
    });

    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    // A1 (EVAL-RECALL-AUDIT §8): the regex PESEL detector now requires a
    // valid check digit, so this fixture uses a checksum-valid PESEL rather
    // than an arbitrary 11-digit placeholder.
    const text = 'Jan Kowalski, email jan@test.com, PESEL 92071314764';
    const result = await runPipeline(text, pipeline);

    // Should have anonymized text
    expect(result.anonymized).not.toContain('Jan Kowalski');
    expect(result.anonymized).toContain('[PERSON_NAME_');
    // Regex should catch email and PESEL
    expect(result.anonymized).not.toContain('jan@test.com');
    expect(result.anonymized).toContain('[EMAIL_ADDRESS_');
    expect(result.anonymized).not.toContain('92071314764');
    expect(result.anonymized).toContain('[PERSON_IDENTIFIER_');
    // Legend should exist
    expect(Object.keys(result.legend).length).toBeGreaterThan(0);
    // Debug should have entries for each step
    expect(result.debug.length).toBeGreaterThan(0);
  });

  it('merges Polish abbreviations in segment phase (adw., ul., r.)', async () => {
    const mockLoadModel = async () => ({
      infer: async () => [],
      dispose: async () => {},
    });

    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const text = 'W dniu 10 września 2023 r. pomiędzy Panem Kowalskim a firmą sp. z o.o. zawarto umowę. adw. Nowak reprezentuje stronę.';
    const result = await runPipeline(text, pipeline);

    const segmentDebug = result.debug.filter(d => d.phase === 'segment');
    expect(segmentDebug.length).toBe(3);
    expect(segmentDebug[1].step).toBe('mergeAbbreviationsStep');
    expect(segmentDebug[2].step).toBe('tightenSegmentsStep');

    const before = segmentDebug[0].changes.segments.count.after;
    const after = segmentDebug[1].changes.segments.count.after;
    expect(after).toBeLessThan(before);
  });

  it('does not leak a name preceded by astral characters in an earlier sentence (issue #16)', async () => {
    const mockLoadModel = async () => ({
      infer: async (text) => (text.indexOf('Kowalski') >= 0
        ? [{ word: 'Kowalski', entity: 'B-PERSON_NAME', score: 0.97, index: 0 }]
        : []),
      dispose: async () => {},
    });

    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const text = '😀😀😀😀😀😀😀😀😀😀😀😀😀😀 Pierwsze zdanie. Pan Kowalski zapłacił.';
    const result = await runPipeline(text, pipeline);

    expect(result.anonymized).not.toContain('Kowalski');
    expect(result.anonymized).toContain('[PERSON_NAME_');
    expect(Object.values(result.legend)).toContain('Kowalski');
  });
});

describe('stage helpers', () => {
  it('createPreSegmentSteps returns preprocess + segment phases', () => {
    const steps = createPreSegmentSteps(get_sentence_boundaries);
    expect(steps.map(s => s.phase)).toEqual(['preprocess', 'segment']);
  });

  it('createModelLoadSteps returns a model-load phase before NER', () => {
    const noLoad = async () => ({ infer: async () => [], dispose: async () => {} });
    const steps = createModelLoadSteps([{ alias: 'multilang-q8', id: 'x', dtype: 'q8' }], noLoad);
    expect(steps).toHaveLength(1);
    expect(steps[0].phase).toBe('model-load');
    expect(steps[0].steps).toHaveLength(1);
    expect(steps[0].steps[0].name).toBe('loadModelsStep');
  });

  it('createNerSteps returns a single ner phase with hf step (and regex/lexicon when active)', () => {
    const noLoad = async () => ({ infer: async () => [], dispose: async () => {} });
    const withBoth = createNerSteps([{ alias: 'multilang-q8', id: 'x', dtype: 'q8' }], true, true, noLoad);
    expect(withBoth).toHaveLength(1);
    expect(withBoth[0].phase).toBe('ner');
    expect(withBoth[0].steps).toHaveLength(8);

    const withNeither = createNerSteps([], false, false, noLoad);
    expect(withNeither[0].steps).toHaveLength(8); // ner/case-folded-ner/despaced-ner/regex/lexicon/special-category-lexicon/case-allowlist/gazetteer steps always exist; regex/lexicon/case-folded/despaced/case-allowlist/gazetteer are no-ops when inactive/non-qualifying
  });

  it('createNerSteps suppresses the case-folded pass when options.caseFoldedActive is false (cache-orchestrator.js per-source loop)', async () => {
    let loadCount = 0;
    const loadModel = async () => {
      loadCount++;
      return {
        infer: async (text) => (text.includes('Zakładu') // only the folded (Title Case) variant matches
          ? [{ entity_group: 'ORGANIZATION_NAME', start: text.indexOf('Zakładu'), end: text.indexOf('Zakładu') + 7, score: 0.9 }]
          : []),
        dispose: async () => {},
      };
    };
    const source = { alias: 'multilang-q8', id: 'x', dtype: 'q8' };
    const text = 'ZAKŁADU UBEZPIECZEŃ SPOŁECZNYCH';
    const ctx = { text, segments: [{ text, offset: 0 }], entities: [], anonymized: '', legend: {} };

    const suppressed = createNerSteps([source], false, false, loadModel, { caseFoldedActive: false });
    const suppressedResult = await runPipeline(ctx, suppressed);
    expect(suppressedResult.entities.some((e) => e.source === 'case-folded')).toBe(false);

    loadCount = 0;
    const active = createNerSteps([source], false, false, loadModel);
    const activeResult = await runPipeline(ctx, active);
    expect(activeResult.entities.some((e) => e.source === 'case-folded')).toBe(true);
  });

  it('createPostprocessSteps returns a single postprocess phase', () => {
    const steps = createPostprocessSteps({ enabledEntities: ALL_ENTITIES });
    expect(steps).toHaveLength(1);
    expect(steps[0].phase).toBe('postprocess');
    expect(steps[0].steps.length).toBeGreaterThan(5);
  });

  it('createDefaultPipeline composes all three helpers in order', () => {
    const noLoad = async () => ({ infer: async () => [], dispose: async () => {} });
    const pipeline = createDefaultPipeline(noLoad, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    expect(pipeline.map(p => p.phase)).toEqual(['preprocess', 'segment', 'model-load', 'ner', 'postprocess']);
  });
});

describe('ST-2 tier activation default (SCOPE-TIERS-DESIGN.md §3.4 pkt 2, §9)', () => {
  // HEALTH_DATA is 'review' tier in TYPE_TIERS (not 'mask') — the sharpest
  // possible check that a caller who has never heard of tiers (no
  // tierOverrides, no allMask) still gets today's single-tier output.
  const mockLoadModel = async () => ({
    infer: async (text) => (text.includes('cukrzyca')
      ? [{ word: 'cukrzyca', entity: 'B-HEALTH_DATA', score: 0.95, index: 0 }]
      : []),
    dispose: async () => {},
  });

  it('a caller that passes no tier options gets exactly today\'s single-tier behavior — review-tier entities stay masked, reviewCandidates stays empty', async () => {
    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline('Pacjent ma cukrzyca.', pipeline);

    expect(result.anonymized).not.toContain('cukrzyca');
    expect(result.anonymized).toContain('[HEALTH_DATA_');
    expect(result.reviewCandidates ?? []).toEqual([]);
  });

  it('allMask: false explicitly activates real tiering — a review-tier entity moves to reviewCandidates and stays visible in the text', async () => {
    const pipeline = createDefaultPipeline(mockLoadModel, get_sentence_boundaries, {
      enabledEntities: ALL_ENTITIES,
      allMask: false,
    });
    const result = await runPipeline('Pacjent ma cukrzyca.', pipeline);

    expect(result.anonymized).toContain('cukrzyca');
    expect(result.anonymized).not.toContain('[HEALTH_DATA_');
    expect(result.reviewCandidates).toHaveLength(1);
    expect(result.reviewCandidates[0]).toMatchObject({ entity_group: 'HEALTH_DATA', tier: 'review' });
  });
});
