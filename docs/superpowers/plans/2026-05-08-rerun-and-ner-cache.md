# Re-run trigger + per-source NER cache — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Anonimizuj ponownie" button that appears when the displayed result is stale, backed by a content-addressed in-worker cache so re-runs only execute the missing models.

**Architecture:** Pipeline factored into three composable stage helpers (preprocess+segment, ner, postprocess) so the worker can drive them stage by stage. A cache orchestrator runs each stage conditionally based on a SHA-256 cache key and per-source coverage, persisting `{ textHash, normalizedText, segments, bySource, regex }` between calls in worker memory. Main thread tracks `lastRun = { text, enabledEntities }` and toggles the new button when current state drifts from it.

**Tech Stack:** Vanilla JS (ESM), Vitest, Vite dev server, Web Worker, `crypto.subtle.digest` (SHA-256), `@huggingface/transformers`, `sentencex-wasm`.

**Spec:** [docs/superpowers/specs/2026-05-08-rerun-and-ner-cache-design.md](../specs/2026-05-08-rerun-and-ner-cache-design.md)

---

## File map

| File | Role |
|---|---|
| `src/pipeline/runner.js` | Modify: accept pre-seeded ctx |
| `src/pipeline/runner.test.js` | Add: seeded-ctx test cases |
| `src/pipeline/configs/default.js` | Refactor: split into `createPreSegmentSteps`, `createNerSteps`, `createPostprocessSteps`; `createDefaultPipeline` re-uses them |
| `src/pipeline/configs/default.test.js` | Add: tests for each new helper composing correctly |
| `src/pipeline/cache-orchestrator.js` | New: `classifyWithCache(...)` pure orchestrator + `sha256Hex` helper |
| `src/pipeline/cache-orchestrator.test.js` | New: cover cache miss, hit, partial hit (missing source), text change |
| `src/worker.js` | Modify: hold `nerCache`; replace `classify` branch with orchestrator call; clear cache on backend change |
| `index.html` | Modify: add `<button id="rerun-btn">` to `.workspace-actions` |
| `src/main.js` | Modify: add `lastRun`, `updateRerunButton`, button handler, wire into selector/editor/worker callbacks |

---

## Task 1: Extend runner to accept a pre-seeded context

**Files:**
- Modify: `src/pipeline/runner.js:101`
- Test: `src/pipeline/runner.test.js`

- [ ] **Step 1.1: Write the failing test**

Add to `src/pipeline/runner.test.js`, inside the `describe('runPipeline', ...)` block:

```js
  it('accepts a pre-seeded context object instead of a string', async () => {
    const seeded = {
      text: 'pre-normalized',
      segments: [{ offset: 0, text: 'pre-normalized' }],
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 3, score: 0.9 }],
      anonymized: '',
      legend: {},
      debug: [],
    };
    function appendBang(ctx) {
      return { ...ctx, anonymized: ctx.text + '!' };
    }
    const result = await runPipeline(seeded, [{ phase: 'postprocess', steps: [appendBang] }]);
    expect(result.text).toBe('pre-normalized');
    expect(result.segments).toHaveLength(1);
    expect(result.entities).toHaveLength(1);
    expect(result.anonymized).toBe('pre-normalized!');
  });
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/runner.test.js`

Expected: FAIL — when a non-string is passed, `createContext` will be called with the object and produce wrong results (e.g. `text` being `[object Object]` or test failing because seeded fields are dropped).

- [ ] **Step 1.3: Implement seeded-ctx support**

Modify `src/pipeline/runner.js`. Replace the body of `runPipeline`:

```js
export async function runPipeline(input, pipeline) {
  let ctx = typeof input === 'string' ? createContext(input) : input;
  const debug = [];

  for (const { phase, steps } of pipeline) {
    for (const step of steps) {
      const before = snapshotContext(ctx);
      ctx = await step(ctx);
      ctx = { ...ctx, debug: [] };
      const changes = diffContext(before, ctx);
      debug.push({
        step: step.name || 'anonymous',
        phase,
        changes,
      });
    }
  }

  return { ...ctx, debug };
}
```

(Only the first line of the function changes; rest is identical.)

- [ ] **Step 1.4: Run all runner tests to verify**

Run: `npx vitest run src/pipeline/runner.test.js`

Expected: PASS — all existing tests + new seeded-ctx test.

- [ ] **Step 1.5: Commit**

```bash
git add src/pipeline/runner.js src/pipeline/runner.test.js
git commit -m "feat(pipeline/runner): accept pre-seeded context object"
```

---

## Task 2: Split `createDefaultPipeline` into stage helpers

**Files:**
- Modify: `src/pipeline/configs/default.js`
- Test: `src/pipeline/configs/default.test.js`

- [ ] **Step 2.1: Write failing tests for the three helpers**

Add to `src/pipeline/configs/default.test.js`:

```js
import {
  createPreSegmentSteps,
  createNerSteps,
  createPostprocessSteps,
} from './default.js';

describe('stage helpers', () => {
  it('createPreSegmentSteps returns preprocess + segment phases', () => {
    const steps = createPreSegmentSteps(get_sentence_boundaries);
    expect(steps.map(s => s.phase)).toEqual(['preprocess', 'segment']);
  });

  it('createNerSteps returns a single ner phase with hf step (and regex when active)', () => {
    const noLoad = async () => ({ infer: async () => [], dispose: async () => {} });
    const withRegex = createNerSteps([{ alias: 'multilang-q8', id: 'x', dtype: 'q8' }], true, noLoad);
    expect(withRegex).toHaveLength(1);
    expect(withRegex[0].phase).toBe('ner');
    expect(withRegex[0].steps).toHaveLength(2);

    const withoutRegex = createNerSteps([], false, noLoad);
    expect(withoutRegex[0].steps).toHaveLength(2); // ner step always exists; regex step is a no-op when active=false
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
    expect(pipeline.map(p => p.phase)).toEqual(['preprocess', 'segment', 'ner', 'postprocess']);
  });
});
```

- [ ] **Step 2.2: Run tests to verify failure**

Run: `npx vitest run src/pipeline/configs/default.test.js`

Expected: FAIL — `createPreSegmentSteps`, `createNerSteps`, `createPostprocessSteps` are not exported.

- [ ] **Step 2.3: Refactor `default.js` into stage helpers**

Replace the contents of `src/pipeline/configs/default.js`:

```js
import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../steps/merge-abbreviations.js';
import { tightenSegmentsStep } from '../steps/tighten-segments.js';
import { createNerStep } from '../steps/ner.js';
import { createRegexStep } from '../steps/regex.js';
import { createSourceFilterStep } from '../steps/source-filter.js';
import { thresholdStep } from '../steps/threshold.js';
import { snapStep } from '../steps/snap.js';
import { trimTrailingPunctuationStep } from '../steps/trim-trailing-punctuation.js';
import { blocklistStep } from '../steps/blocklist.js';
import { maxLengthStep } from '../steps/max-length.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { backfillOccurrencesStep } from '../steps/backfill.js';
import { tokenizeStep } from '../steps/tokenize.js';
import { ENTITY_SOURCES, SOURCES, requiredSources } from './entity-sources.js';

function resolveActiveSources({ enabledEntities, entitySources, sources }) {
  const needed = requiredSources(enabledEntities);
  const hf = [];
  let regexActive = false;
  for (const alias of needed) {
    const def = sources[alias];
    if (!def) continue;
    if (def.kind === 'hf') hf.push({ alias, id: def.id, dtype: def.dtype });
    else if (def.kind === 'regex') regexActive = true;
  }
  return { hf, regexActive };
}

export function createPreSegmentSteps(getSentenceBoundaries) {
  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [
      createSentencexSegmentStep(getSentenceBoundaries),
      mergeAbbreviationsStep,
      tightenSegmentsStep,
    ] },
  ];
}

export function createNerSteps(hfSubset, regexActive, loadModel) {
  return [
    { phase: 'ner', steps: [createNerStep(hfSubset, loadModel), createRegexStep(regexActive)] },
  ];
}

export function createPostprocessSteps(options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const enabledEntities = options.enabledEntities;
  return [
    { phase: 'postprocess', steps: [
      createSourceFilterStep({ enabledEntities, entitySources }),
      thresholdStep,
      snapStep,
      trimTrailingPunctuationStep,
      blocklistStep,
      maxLengthStep,
      dedupStep,
      backfillOccurrencesStep,
      mergeStep,
      tokenizeStep,
    ] },
  ];
}

/**
 * Creates the default PII anonymization pipeline.
 *
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), dispose() }
 * @param {Function} getSentenceBoundaries - (lang, text) => [{start_index, end_index, text}, ...]
 * @param {object} options - { enabledEntities, entitySources?, sources?, sortSources? }
 */
export function createDefaultPipeline(loadModel, getSentenceBoundaries, options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const sources = options.sources ?? SOURCES;
  const enabledEntities = options.enabledEntities;
  const { hf, regexActive } = resolveActiveSources({ enabledEntities, entitySources, sources });
  const orderedHf = options.sortSources ? options.sortSources(hf) : hf;

  return [
    ...createPreSegmentSteps(getSentenceBoundaries),
    ...createNerSteps(orderedHf, regexActive, loadModel),
    ...createPostprocessSteps({ enabledEntities, entitySources }),
  ];
}
```

- [ ] **Step 2.4: Run tests to verify pass**

Run: `npx vitest run src/pipeline/`

Expected: PASS — both new helper tests and existing default-pipeline tests succeed.

- [ ] **Step 2.5: Run the full test suite (no regressions)**

Run: `npm test`

Expected: PASS — all tests.

- [ ] **Step 2.6: Commit**

```bash
git add src/pipeline/configs/default.js src/pipeline/configs/default.test.js
git commit -m "refactor(pipeline/default): split into composable stage helpers"
```

---

## Task 3: Cache orchestrator — SHA-256 helper

**Files:**
- Create: `src/pipeline/cache-orchestrator.js`
- Test: `src/pipeline/cache-orchestrator.test.js`

- [ ] **Step 3.1: Write failing test for `sha256Hex`**

Create `src/pipeline/cache-orchestrator.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './cache-orchestrator.js';

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
```

- [ ] **Step 3.2: Run test to verify failure**

Run: `npx vitest run src/pipeline/cache-orchestrator.test.js`

Expected: FAIL — file does not exist.

- [ ] **Step 3.3: Implement `sha256Hex`**

Create `src/pipeline/cache-orchestrator.js`:

```js
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 3.4: Run test to verify pass**

Run: `npx vitest run src/pipeline/cache-orchestrator.test.js`

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/pipeline/cache-orchestrator.js src/pipeline/cache-orchestrator.test.js
git commit -m "feat(pipeline): add sha256Hex helper for cache keying"
```

---

## Task 4: Cache orchestrator — `classifyWithCache`

**Files:**
- Modify: `src/pipeline/cache-orchestrator.js`
- Test: `src/pipeline/cache-orchestrator.test.js`

- [ ] **Step 4.1: Write failing test for cache miss + cache hit + partial hit**

Append to `src/pipeline/cache-orchestrator.test.js`:

```js
import { classifyWithCache } from './cache-orchestrator.js';
import { get_sentence_boundaries } from 'sentencex';

const TEST_SOURCES = {
  'multilang-q8': { kind: 'hf', id: 'm-q8', dtype: 'q8' },
  'polish-q8':    { kind: 'hf', id: 'p-q8', dtype: 'q8' },
  'multilang-fp32': { kind: 'hf', id: 'm-fp32', dtype: 'fp32' },
  'regex':        { kind: 'regex' },
};

const TEST_ENTITY_SOURCES = {
  PERSON_NAME:  ['multilang-q8'],
  HEALTH_DATA:  ['multilang-fp32'],
  EMAIL_ADDRESS:['multilang-q8', 'regex'],
};

function makeMockLoader(callLog) {
  // Returns infer() that returns one fake aggregated entity per call,
  // tagged with the source id so we can assert which model produced what.
  return async ({ id }) => ({
    infer: async (segText) => {
      callLog.push(id);
      if (id === 'm-q8' && segText.includes('Jan')) {
        return [{ entity_group: 'PERSON_NAME', start: 0, end: 3, score: 0.95, word: 'Jan' }];
      }
      if (id === 'm-fp32' && segText.includes('cukrzyca')) {
        return [{ entity_group: 'HEALTH_DATA', start: segText.indexOf('cukrzyca'), end: segText.indexOf('cukrzyca') + 8, score: 0.9, word: 'cukrzyca' }];
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

    // Both HF models ran
    expect(callLog).toContain('m-q8');
    expect(callLog).toContain('m-fp32');
    // Cache populated
    expect(cache.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cache.normalizedText).toBe('Jan ma cukrzyca.');
    expect(cache.bySource.has('multilang-q8')).toBe(true);
    expect(cache.bySource.has('multilang-fp32')).toBe(true);
    // Final ctx has both entity types
    const groups = ctx.entities.map(e => e.entity_group);
    expect(groups).toContain('PERSON_NAME');
    expect(groups).toContain('HEALTH_DATA');
  });

  it('cache hit (same text, narrowed selection): runs zero models', async () => {
    const callLog = [];
    const loader = makeMockLoader(callLog);
    // Cold run
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

    // Narrow to PERSON_NAME only
    const { ctx, cache: cache2 } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME'],
      cache: cache1,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });

    // No models invoked on the second call
    expect(callLog).toEqual([]);
    // Result reflects narrowed selection
    const groups = ctx.entities.map(e => e.entity_group);
    expect(groups).toContain('PERSON_NAME');
    expect(groups).not.toContain('HEALTH_DATA');
    // Cache preserved
    expect(cache2.textHash).toBe(cache1.textHash);
    expect(cache2.bySource.has('multilang-fp32')).toBe(true);
  });

  it('partial hit: only the missing model runs', async () => {
    const callLog = [];
    const loader = makeMockLoader(callLog);
    // Cold run with only PERSON_NAME (only m-q8 needed)
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

    // Expand to include HEALTH_DATA — only m-fp32 should run
    const { ctx } = await classifyWithCache({
      text: 'Jan ma cukrzyca.',
      enabledEntities: ['PERSON_NAME', 'HEALTH_DATA'],
      cache: cache1,
      sources: TEST_SOURCES,
      entitySources: TEST_ENTITY_SOURCES,
      loadModel: loader,
      getSentenceBoundaries: get_sentence_boundaries,
    });

    // Only m-fp32 invoked, m-q8 not re-run
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

    expect(callLog).toContain('m-q8'); // re-ran
    expect(cache2.textHash).not.toBe(cache1.textHash);
    expect(cache2.normalizedText).toBe('Inny tekst Jan.');
  });
});
```

- [ ] **Step 4.2: Run test to verify failure**

Run: `npx vitest run src/pipeline/cache-orchestrator.test.js`

Expected: FAIL — `classifyWithCache` does not exist.

- [ ] **Step 4.3: Implement `classifyWithCache`**

Append to `src/pipeline/cache-orchestrator.js`:

```js
import { runPipeline } from './runner.js';
import {
  createPreSegmentSteps,
  createNerSteps,
  createPostprocessSteps,
} from './configs/default.js';
import { requiredSources } from './configs/entity-sources.js';

function makeSeededCtx({ text, segments, entities }) {
  return { text, segments, entities, anonymized: '', legend: {}, debug: [] };
}

/**
 * Cache-aware classify orchestration.
 *
 * On cache hit (text matches previous), reuses normalized text + segments
 * and skips already-run NER sources. On miss, runs the full pipeline and
 * populates the cache.
 *
 * @param {object} params
 * @param {string} params.text - Input text
 * @param {string[]} params.enabledEntities - Selected entity types
 * @param {object|null} params.cache - Previous cache, or null
 * @param {object} params.sources - SOURCES map (alias → def)
 * @param {object} params.entitySources - ENTITY_SOURCES map
 * @param {Function} params.loadModel - async ({id, dtype}) => { infer, dispose }
 * @param {Function} params.getSentenceBoundaries - (lang, text) => boundaries[]
 * @param {Function} [params.sortSources] - optional ordering of HF sources
 * @returns {Promise<{ ctx: object, cache: object }>}
 */
export async function classifyWithCache({
  text,
  enabledEntities,
  cache,
  sources,
  entitySources,
  loadModel,
  getSentenceBoundaries,
  sortSources,
}) {
  const hash = await sha256Hex(text);
  const hit = cache?.textHash === hash;

  // --- Stage 1: preprocess + segment ---
  let normalizedText, segments;
  if (hit) {
    normalizedText = cache.normalizedText;
    segments = cache.segments;
  } else {
    const preCtx = await runPipeline(text, createPreSegmentSteps(getSentenceBoundaries));
    normalizedText = preCtx.text;
    segments = preCtx.segments;
  }

  // --- Stage 2: NER, running only what's missing ---
  const bySource = hit ? new Map(cache.bySource) : new Map();
  let regex = hit ? cache.regex : null;

  const needed = requiredSources(enabledEntities);
  const requiredHf = needed
    .filter((alias) => sources[alias]?.kind === 'hf')
    .map((alias) => ({ alias, id: sources[alias].id, dtype: sources[alias].dtype }));
  const missingHf = requiredHf.filter((s) => !bySource.has(s.alias));
  const regexNeeded = needed.includes('regex');

  if (missingHf.length > 0) {
    const ordered = sortSources ? sortSources(missingHf) : missingHf;
    for (const source of ordered) {
      const ctx = await runPipeline(
        makeSeededCtx({ text: normalizedText, segments, entities: [] }),
        createNerSteps([source], false, loadModel),
      );
      bySource.set(source.alias, ctx.entities);
    }
  }

  if (regexNeeded && regex === null) {
    const ctx = await runPipeline(
      makeSeededCtx({ text: normalizedText, segments, entities: [] }),
      createNerSteps([], true, loadModel),
    );
    regex = ctx.entities;
  }

  // --- Stage 3: postprocess on the merged entity union ---
  const merged = [...[...bySource.values()].flat(), ...(regex ?? [])];
  const finalCtx = await runPipeline(
    makeSeededCtx({ text: normalizedText, segments, entities: merged }),
    createPostprocessSteps({ enabledEntities, entitySources }),
  );

  return {
    ctx: finalCtx,
    cache: { textHash: hash, normalizedText, segments, bySource, regex },
  };
}
```

- [ ] **Step 4.4: Run tests to verify pass**

Run: `npx vitest run src/pipeline/cache-orchestrator.test.js`

Expected: PASS — all four scenarios.

- [ ] **Step 4.5: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/pipeline/cache-orchestrator.js src/pipeline/cache-orchestrator.test.js
git commit -m "feat(pipeline): add classifyWithCache orchestrator with per-source caching"
```

---

## Task 5: Wire orchestrator into worker, manage cache lifecycle

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 5.1: Add cache state and replace classify branch**

In `src/worker.js`:

1. After the existing `loadedModels` declaration (around line 24), add:

```js
let nerCache = null;
```

2. Add a new import at the top (alongside the existing pipeline imports):

```js
import { classifyWithCache } from './pipeline/cache-orchestrator.js';
```

3. Modify the existing `configure` branch to clear the cache when the backend override changes. Find the block:

```js
if ((newOverride !== backendOverride || newWebnnAvailable !== webnnAvailable) && loadedModels.size > 0) {
  for (const alias of [...loadedModels.keys()]) await disposeModel(alias);
}
```

Replace with:

```js
if (newOverride !== backendOverride || newWebnnAvailable !== webnnAvailable) {
  if (loadedModels.size > 0) {
    for (const alias of [...loadedModels.keys()]) await disposeModel(alias);
  }
  // Backend semantics may differ; drop entity cache too.
  nerCache = null;
}
```

4. Replace the entire `if (type === 'classify')` branch with:

```js
if (type === 'classify') {
  if (!currentConfig) {
    self.postMessage({ type: 'error', message: 'Worker not configured' });
    return;
  }
  if (currentConfig.enabledEntities.length === 0) {
    self.postMessage({ type: 'error', message: 'No entities enabled' });
    return;
  }
  self.postMessage({ type: 'timing', mark: 'classify:start', t: performance.now() });
  try {
    const sortSources = (hf) => [...hf].sort((a, b) => {
      const aLoaded = loadedModels.has(a.alias) ? 0 : 1;
      const bLoaded = loadedModels.has(b.alias) ? 0 : 1;
      if (aLoaded !== bLoaded) return aLoaded - bLoaded;
      return (SOURCES[a.alias]?.sizeMB ?? 0) - (SOURCES[b.alias]?.sizeMB ?? 0);
    });

    const { ctx, cache: newCache } = await classifyWithCache({
      text: e.data.text,
      enabledEntities: currentConfig.enabledEntities,
      cache: nerCache,
      sources: SOURCES,
      entitySources: ENTITY_SOURCES,
      loadModel: loadModelForPipeline,
      getSentenceBoundaries: get_sentence_boundaries,
      sortSources,
    });
    nerCache = newCache;

    self.postMessage({
      type: 'result',
      data: ctx.entities,
      anonymized: ctx.anonymized,
      legend: ctx.legend,
      debug: ctx.debug,
    });
  } catch (err) {
    console.error('[worker] classify failed:', err);
    self.postMessage({ type: 'error', message: err.message });
  }
  return;
}
```

5. Remove the now-unused `createDefaultPipeline` and `runPipeline` imports if Vite or the linter flags them. (`createDefaultPipeline` and `runPipeline` are no longer referenced in worker.js after this change.) Quick check: `grep -n "createDefaultPipeline\|runPipeline\b" src/worker.js`. If no uses remain, drop:

```js
import { runPipeline } from './pipeline/runner.js';
import { createDefaultPipeline } from './pipeline/configs/default.js';
```

- [ ] **Step 5.2: Verify worker still builds**

Run: `npm run build`

Expected: build succeeds without errors.

- [ ] **Step 5.3: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5.4: Commit**

```bash
git add src/worker.js
git commit -m "feat(worker): wire cache orchestrator into classify; clear cache on backend change"
```

---

## Task 6: UI — re-run button + drift tracking

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`

- [ ] **Step 6.1: Add the button to `index.html`**

In `index.html`, find the `<div class="workspace-actions">` block. Replace it with:

```html
<div class="workspace-actions">
  <button id="anonymize-btn" class="btn btn-primary" disabled>Anonimizuj</button>
  <button id="rerun-btn" class="btn btn-primary" hidden>Anonimizuj ponownie</button>
  <button id="edit-text-btn" class="btn btn-secondary" hidden>Edytuj tekst</button>
  <button id="copy-anonymized" class="btn btn-secondary" hidden>Kopiuj zanonimizowany</button>
</div>
```

- [ ] **Step 6.2: Add `lastRun` state and the `updateRerunButton` function in `src/main.js`**

In `src/main.js`, add a DOM reference near the other DOM lookups (around line 30):

```js
const rerunBtn = document.getElementById('rerun-btn');
```

Add module-level state near `currentLegend` / `currentAnonymized` (around line 20):

```js
let lastRun = null;  // { text, enabledEntities (sorted) }
```

Add the helpers near `updateAnonymizeButton` (around line 183):

```js
function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function updateRerunButton() {
  if (!lastRun) {
    rerunBtn.hidden = true;
    return;
  }
  const isAnnot = editor.getMode() === 'annotation';
  const currentText = editor.getText();
  const currentSelection = selector.getSelected();
  const stale =
    currentText !== lastRun.text ||
    !setsEqual(currentSelection, lastRun.enabledEntities);
  const hasSelection = currentSelection.length > 0;
  const hasText = currentText.trim() !== '';
  rerunBtn.hidden = !(isAnnot && stale && hasSelection && hasText);
  rerunBtn.disabled = classifyInFlight;
}
```

- [ ] **Step 6.3: Wire the button click**

Add near the `anonymizeBtn.addEventListener('click', ...)` handler (around line 229):

```js
rerunBtn.addEventListener('click', () => {
  const text = editor.getText().trim();
  if (!text) return;
  classifyInFlight = true;
  modelStatus.textContent = 'Analizowanie...';
  rerunBtn.disabled = true;
  worker.postMessage({ type: 'classify', text });
});
```

- [ ] **Step 6.4: Wire `updateRerunButton` into the existing callbacks**

Modify the `selector` `onChange` handler (currently lines 119-124) to also call `updateRerunButton`:

```js
const selector = createEntitySelector(selectorRoot, {
  categories: ENTITY_CATEGORIES,
  labels: ENTITY_LABELS,
  initial: initialSelection,
  onChange(selected) {
    localStorage.setItem(LS_KEY, JSON.stringify(selected));
    updateAnonymizeButton();
    updateRerunButton();
    updateWebnnHint(selected);
    scheduleConfigure(selected);
  },
});
```

Modify the editor's `onModeChange` handler (currently lines 142-152) to call `updateRerunButton`:

```js
onModeChange(mode) {
  if (mode === 'annotation') {
    editTextBtn.hidden = false;
    copyAnonymizedBtn.hidden = false;
    anonymizeBtn.hidden = true;
  } else {
    editTextBtn.hidden = true;
    copyAnonymizedBtn.hidden = true;
    anonymizeBtn.hidden = false;
  }
  updateRerunButton();
},
```

In the worker `result` handler (case 'result' branch around line 208), after `handleAnonymizationResult(msg)` and `updateAnonymizeButton()`, set `lastRun` and update the button:

```js
case 'result':
  classifyInFlight = false;
  console.log(`[bench-timing] result t=${performance.now().toFixed(2)}`);
  handleAnonymizationResult(msg);
  lastRun = {
    text: editor.getText(),
    enabledEntities: [...selector.getSelected()].sort(),
  };
  updateAnonymizeButton();
  updateRerunButton();
  if (msg.data.length === 0) {
    modelStatus.textContent = 'Nie znaleziono żadnych danych osobowych w tekście.';
  }
  break;
```

In the worker `error` handler (case 'error' branch), call `updateRerunButton`:

```js
case 'error':
  classifyInFlight = false;
  modelStatus.textContent = `Błąd: ${msg.message}`;
  anonymizeBtn.textContent = 'Anonimizuj';
  updateAnonymizeButton();
  updateRerunButton();
  break;
```

Finally, at the bottom of the file (after `updateAnonymizeButton();` around line 407), call once on load to set initial state:

```js
updateRerunButton();
```

- [ ] **Step 6.5: Verify UI manually with the dev server**

Start the dev server (background) and exercise the flow:

1. Open the preview and paste a short Polish doc with multiple PII types (e.g. "Jan Kowalski, jan@test.com, PESEL 12345678901").
2. Click "Anonimizuj" → wait for result. Confirm: `[Edytuj tekst] [Kopiuj zanonimizowany]` are shown, "Anonimizuj ponownie" is hidden.
3. Untick a category in the selector. Confirm: "Anonimizuj ponownie" appears.
4. Click "Anonimizuj ponownie" → result updates instantly (no model loading). Confirm console shows no `[worker] loaded` lines for this run, and "Anonimizuj ponownie" hides again.
5. Tick the category back. Confirm: "Anonimizuj ponownie" appears again.
6. Click "Edytuj tekst" → edit the text → click "Anonimizuj". Confirm a fresh run executes (cache miss; new hash).
7. After result, change the entity selection. Confirm "Anonimizuj ponownie" appears and clicking it is fast.

Use `preview_console_logs` (filter: `worker|cache|bench-timing`) to verify per-step behavior. Take a screenshot for proof.

- [ ] **Step 6.6: Commit**

```bash
git add index.html src/main.js
git commit -m "feat(ui): add Anonimizuj-ponownie button with drift detection"
```

---

## Task 7: Eval regression check

**Files:**
- (no source changes — verification only)

- [ ] **Step 7.1: Run a tagged eval before merging**

Run: `npm run eval -- --label=ner-cache`

Expected: eval completes successfully across the synthetic test docs.

- [ ] **Step 7.2: Score it and compare to a recent prior run**

Run:

```bash
npm run eval:score
npm run eval:list
npm run eval:compare ner-cache <previous-run-id>
```

Where `<previous-run-id>` is the most recent prior labeled run (use the output of `eval:list` to pick one). The cache changes are pure refactoring of pipeline composition — F1 should be identical (within rounding).

Expected: precision/recall/F1 unchanged vs. the prior baseline. If anything drifts, halt and investigate before continuing.

- [ ] **Step 7.3: No commit — verification step**

Eval results live in `test-data/results/` and are not source-tracked. If everything looks good, the implementation is complete.

---

## Self-review checklist (run after writing the plan, before execution)

Already executed inline; results below.

**Spec coverage:**
- ✅ "Re-run button visible only when stale" → Task 6 (`updateRerunButton` covers all five conditions in the disabled/hidden table)
- ✅ "SHA-256 content-addressed cache" → Task 3 (`sha256Hex`) + Task 4 (`textHash` field)
- ✅ "Per-source NER cache" → Task 4 (`bySource: Map<alias, Entity[]>`)
- ✅ "Cache normalized text + segments" → Task 4 (cache shape includes `normalizedText`, `segments`)
- ✅ "Skip preprocess+segment on hit" → Task 4 (`hit` branch in Stage 1)
- ✅ "Run only missing models" → Task 4 (`missingHf` filter)
- ✅ "Atomic cache update on success" → Task 4 (`return { ctx, cache }` only at the end)
- ✅ "Backend override change clears cache" → Task 5 (Step 5.1 step 3)
- ✅ "Pipeline factoring into three helpers" → Task 2
- ✅ "Pre-seeded ctx in runner" → Task 1
- ✅ "Worker uses orchestrator, not createDefaultPipeline" → Task 5 (Step 5.1 step 5)
- ✅ "Eval regression check" → Task 7

**Placeholder scan:** No TBD/TODO; every code step contains the actual code.

**Type/name consistency:**
- `sha256Hex` defined Task 3, used Task 4 ✅
- `classifyWithCache` exports `{ ctx, cache }`; worker destructures the same ✅
- Cache shape `{ textHash, normalizedText, segments, bySource, regex }` consistent across Task 4 + Task 5 ✅
- `setsEqual` defined and used in Task 6 ✅
- `lastRun` shape `{ text, enabledEntities }` consistent in Task 6 ✅
- `createPreSegmentSteps`/`createNerSteps`/`createPostprocessSteps` signatures consistent across Task 2 and Task 4 ✅
