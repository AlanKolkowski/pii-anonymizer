import { describe, it, expect } from 'vitest';
import { createContext } from './context.js';
import { runPipeline } from './runner.js';

describe('createContext', () => {
  it('creates a context with text and empty debug array', () => {
    const ctx = createContext('hello world');
    expect(ctx).toEqual({
      text: 'hello world',
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    });
  });
});

describe('runPipeline', () => {
  it('runs steps in phase order, threading context', async () => {
    const step1 = (ctx) => ({ ...ctx, text: ctx.text.toUpperCase() });
    const step2 = (ctx) => ({ ...ctx, text: ctx.text + '!' });

    const config = [
      { phase: 'preprocess', steps: [step1] },
      { phase: 'postprocess', steps: [step2] },
    ];

    const result = await runPipeline('hello', config);
    expect(result.text).toBe('HELLO!');
  });

  it('handles async steps', async () => {
    const asyncStep = async (ctx) => {
      return { ...ctx, text: ctx.text + ' async' };
    };

    const config = [{ phase: 'test', steps: [asyncStep] }];
    const result = await runPipeline('hi', config);
    expect(result.text).toBe('hi async');
  });

  it('auto-generates debug entries with context diffs', async () => {
    function addEntity(ctx) {
      return {
        ...ctx,
        entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 3, score: 0.9 }],
      };
    }

    function setAnonymized(ctx) {
      return {
        ...ctx,
        anonymized: '[PERSON_NAME_1] world',
        legend: { '[PERSON_NAME_1]': 'Jan' },
      };
    }

    const config = [
      { phase: 'ner', steps: [addEntity] },
      { phase: 'postprocess', steps: [setAnonymized] },
    ];

    const result = await runPipeline('Jan world', config);
    expect(result.debug).toHaveLength(2);

    // First step: added an entity
    expect(result.debug[0].step).toBe('addEntity');
    expect(result.debug[0].phase).toBe('ner');
    expect(result.debug[0].changes.entities.added).toHaveLength(1);
    expect(result.debug[0].changes.entities.added[0].text).toBe('Jan');
    expect(result.debug[0].changes.entities.count).toEqual({ before: 0, after: 1 });

    // Second step: set anonymized + legend
    expect(result.debug[1].step).toBe('setAnonymized');
    expect(result.debug[1].phase).toBe('postprocess');
    expect(result.debug[1].changes.anonymized.changed).toBe(true);
    expect(result.debug[1].changes.legend.added['[PERSON_NAME_1]']).toBe('Jan');
  });

  it('records no changes for no-op steps', async () => {
    const noop = function noopStep(ctx) { return ctx; };
    const config = [{ phase: 'preprocess', steps: [noop] }];
    const result = await runPipeline('hello', config);

    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('noopStep');
    expect(result.debug[0].changes).toEqual({});
  });

  it('detects entity removals', async () => {
    function addEntities(ctx) {
      return {
        ...ctx,
        entities: [
          { entity_group: 'PERSON_NAME', start: 0, end: 3, score: 0.9 },
          { entity_group: 'PERSON_NAME', start: 0, end: 100, score: 0.5 },
        ],
      };
    }
    function filterBig(ctx) {
      return {
        ...ctx,
        entities: ctx.entities.filter(e => (e.end - e.start) < 50),
      };
    }

    const config = [
      { phase: 'ner', steps: [addEntities] },
      { phase: 'postprocess', steps: [filterBig] },
    ];
    const result = await runPipeline('Jan world', config);

    const filterDebug = result.debug[1];
    expect(filterDebug.step).toBe('filterBig');
    expect(filterDebug.changes.entities.removed).toHaveLength(1);
    expect(filterDebug.changes.entities.removed[0].start).toBe(0);
    expect(filterDebug.changes.entities.removed[0].end).toBe(100);
    expect(filterDebug.changes.entities.count).toEqual({ before: 2, after: 1 });
  });
});
