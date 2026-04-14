import { describe, it, expect } from 'vitest';
import { createDefaultPipeline } from './default.js';
import { runPipeline } from '../runner.js';

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

    const pipeline = createDefaultPipeline(mockLoadModel);
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
});
