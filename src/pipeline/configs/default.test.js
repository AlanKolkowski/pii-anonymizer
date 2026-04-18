import { describe, it, expect } from 'vitest';
import { get_sentence_boundaries } from 'sentencex';
import { createDefaultPipeline } from './default.js';
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
    const text = 'Jan Kowalski, email jan@test.com, PESEL 12345678901';
    const result = await runPipeline(text, pipeline);

    // Should have anonymized text
    expect(result.anonymized).not.toContain('Jan Kowalski');
    expect(result.anonymized).toContain('[PERSON_NAME_');
    // Regex should catch email and PESEL
    expect(result.anonymized).not.toContain('jan@test.com');
    expect(result.anonymized).toContain('[EMAIL_ADDRESS_');
    expect(result.anonymized).not.toContain('12345678901');
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
});
