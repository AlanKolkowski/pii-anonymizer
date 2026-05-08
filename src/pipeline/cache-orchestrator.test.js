import { describe, it, expect } from 'vitest';
import { get_sentence_boundaries } from 'sentencex';
import { sha256Hex, classifyWithCache } from './cache-orchestrator.js';

describe('sha256Hex', () => {
  it('produces the standard SHA-256 hex digest of a string', async () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(await sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces different digests for different inputs', async () => {
    const a = await sha256Hex('alpha');
    const b = await sha256Hex('beta');
    expect(a).not.toBe(b);
  });

  it('handles long inputs', async () => {
    const long = 'x'.repeat(100_000);
    const hash = await sha256Hex(long);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

const TEST_SOURCES = {
  'multilang-q8':   { kind: 'hf', id: 'm-q8',   dtype: 'q8' },
  'polish-q8':      { kind: 'hf', id: 'p-q8',   dtype: 'q8' },
  'multilang-fp32': { kind: 'hf', id: 'm-fp32', dtype: 'fp32' },
  'regex':          { kind: 'regex' },
};

const TEST_ENTITY_SOURCES = {
  PERSON_NAME:   ['multilang-q8'],
  HEALTH_DATA:   ['multilang-fp32'],
  EMAIL_ADDRESS: ['multilang-q8', 'regex'],
};

function makeMockLoader(callLog) {
  return async ({ id }) => ({
    infer: async (segText) => {
      callLog.push(id);
      if (id === 'm-q8' && segText.includes('Jan')) {
        const idx = segText.indexOf('Jan');
        return [{ entity_group: 'PERSON_NAME', start: idx, end: idx + 3, score: 0.95, word: 'Jan' }];
      }
      if (id === 'm-fp32' && segText.includes('cukrzyca')) {
        const idx = segText.indexOf('cukrzyca');
        return [{ entity_group: 'HEALTH_DATA', start: idx, end: idx + 8, score: 0.9, word: 'cukrzyca' }];
      }
      return [];
    },
    dispose: async () => {},
  });
}

describe('classifyWithCache', () => {
  it('cold start: runs preprocess+segment+all needed sources, returns cache', async () => {
    const callLog = [];
    const { ctx, cache } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME', 'HEALTH_DATA'],
      cache: null,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: makeMockLoader(callLog),
      getSentenceBoundaries: get_sentence_boundaries,
    });

    expect(callLog).toContain('m-q8');
    expect(callLog).toContain('m-fp32');
    expect(cache.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cache.normalizedText).toBe('Jan ma cukrzyca.');
    expect(cache.bySource.has('multilang-q8')).toBe(true);
    expect(cache.bySource.has('multilang-fp32')).toBe(true);
    const groups = ctx.entities.map(e => e.entity_group);
    expect(groups).toContain('PERSON_NAME');
    expect(groups).toContain('HEALTH_DATA');
  });

  it('cache hit (same text, narrowed selection): runs zero models', async () => {
    const callLog = [];
    const loader = makeMockLoader(callLog);
    const { cache: cache1 } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME', 'HEALTH_DATA'],
      cache: null,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });
    callLog.length = 0;

    const { ctx, cache: cache2 } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME'],
      cache: cache1,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });

    expect(callLog).toEqual([]);
    const groups = ctx.entities.map(e => e.entity_group);
    expect(groups).toContain('PERSON_NAME');
    expect(groups).not.toContain('HEALTH_DATA');
    expect(cache2.textHash).toBe(cache1.textHash);
    expect(cache2.bySource.has('multilang-fp32')).toBe(true);
  });

  it('partial hit: only the missing model runs', async () => {
    const callLog = [];
    const loader = makeMockLoader(callLog);
    const { cache: cache1 } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME'],
      cache: null,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });
    callLog.length = 0;

    const { ctx } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME', 'HEALTH_DATA'],
      cache: cache1,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });

    expect(callLog.every(id => id === 'm-fp32')).toBe(true);
    expect(callLog).not.toContain('m-q8');

    const groups = ctx.entities.map(e => e.entity_group);
    expect(groups).toContain('PERSON_NAME');
    expect(groups).toContain('HEALTH_DATA');
  });

  it('text change: invalidates cache, full re-run', async () => {
    const callLog = [];
    const loader = makeMockLoader(callLog);
    const { cache: cache1 } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME'],
      cache: null,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });
    callLog.length = 0;

    const { cache: cache2 } = await classifyWithCache({
      text: 'Inny tekst Jan.',
      enabledEntities: ['PERSON_NAME'],
      cache: cache1,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });

    expect(callLog).toContain('m-q8');
    expect(cache2.textHash).not.toBe(cache1.textHash);
    expect(cache2.normalizedText).toBe('Inny tekst Jan.');
  });
});
