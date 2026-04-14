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

  it('preserves debug entries across steps', async () => {
    const step1 = (ctx) => ({
      ...ctx,
      debug: [...ctx.debug, { step: 'step1', phase: 'a' }],
    });
    const step2 = (ctx) => ({
      ...ctx,
      debug: [...ctx.debug, { step: 'step2', phase: 'b' }],
    });

    const config = [
      { phase: 'a', steps: [step1] },
      { phase: 'b', steps: [step2] },
    ];
    const result = await runPipeline('text', config);
    expect(result.debug).toHaveLength(2);
    expect(result.debug[0].step).toBe('step1');
    expect(result.debug[1].step).toBe('step2');
  });
});
