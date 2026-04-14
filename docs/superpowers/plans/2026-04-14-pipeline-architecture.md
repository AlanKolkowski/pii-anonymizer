# Pipeline Architecture & Evaluation Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the PII anonymizer into a staged pipeline with shared context, then add a Node.js evaluation harness so test documents can be batch-processed without the browser.

**Architecture:** Fixed phases (preprocess → segment → NER → postprocess), each containing swappable steps. Every step is a function `(ctx) → ctx` operating on a shared context object. A thin runner iterates phases/steps. The same pipeline config is used in the browser Web Worker and in a Node.js eval CLI.

**Tech Stack:** Vanilla ES modules, Vitest, `@huggingface/transformers`, `onnxruntime-node` (for eval CLI)

**Spec:** `docs/superpowers/specs/2026-04-14-pipeline-architecture-design.md`

---

## File Structure

```
src/
  pipeline/
    runner.js              — runPipeline(text, pipelineConfig) async, iterates phases/steps
    context.js             — createContext(text) factory
    steps/
      preprocess.js        — normalizeWhitespace step (no-op pass-through)
      segment.js           — chunkText step (wraps existing chunkText)
      ner.js               — nerModelStep factory (wraps model load/infer/dispose + aggregateEntities)
      regex.js             — regexEntities step (wraps existing findRegexEntities)
      snap.js              — snapStep (wraps existing snapToWordBoundaries)
      filter.js            — filterStep (wraps existing filterOversizedEntities)
      dedup.js             — dedupStep (wraps existing deduplicateEntities)
      merge.js             — mergeStep (wraps existing mergeAdjacentEntities)
      rescan.js            — rescanStep (wraps existing rescanForKnownPii)
      tokenize.js          — tokenizeStep (wraps existing buildTokenMap + anonymizeText)
    configs/
      default.js           — assembles the standard pipeline from all steps
  anonymizer.js            — shrinks to: couldBeSamePerson, deanonymizeText, plus all raw functions re-exported for backward compat
  worker.js                — simplified: imports default config, calls runPipeline
  main.js                  — unchanged
  eval/
    run.js                 — Node CLI: batch-process test-data/ through the pipeline
```

---

### Task 1: Pipeline Runner & Context

Create the core runner and context factory. These have no dependencies on existing code.

**Files:**
- Create: `src/pipeline/runner.js`
- Create: `src/pipeline/context.js`
- Create: `src/pipeline/runner.test.js`

- [ ] **Step 1: Write failing test for createContext**

In `src/pipeline/runner.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createContext } from './context.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/runner.test.js`
Expected: FAIL — module `./context.js` not found

- [ ] **Step 3: Implement createContext**

In `src/pipeline/context.js`:

```js
export function createContext(text) {
  return {
    text,
    segments: [],
    entities: [],
    anonymized: '',
    legend: {},
    debug: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/runner.test.js`
Expected: PASS

- [ ] **Step 5: Write failing test for runPipeline**

Add to `src/pipeline/runner.test.js`:

```js
import { runPipeline } from './runner.js';

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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/pipeline/runner.test.js`
Expected: FAIL — module `./runner.js` not found

- [ ] **Step 7: Implement runPipeline**

In `src/pipeline/runner.js`:

```js
import { createContext } from './context.js';

export async function runPipeline(text, pipeline) {
  let ctx = createContext(text);
  for (const { steps } of pipeline) {
    for (const step of steps) {
      ctx = await step(ctx);
    }
  }
  return ctx;
}
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `npx vitest run src/pipeline/runner.test.js`
Expected: all 4 tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/runner.js src/pipeline/context.js src/pipeline/runner.test.js
git commit -m "feat: add pipeline runner and context factory"
```

---

### Task 2: Preprocess & Segment Steps

Wrap existing `chunkText` as a pipeline step, add the no-op preprocess step.

**Files:**
- Create: `src/pipeline/steps/preprocess.js`
- Create: `src/pipeline/steps/segment.js`
- Create: `src/pipeline/steps/steps.test.js`

- [ ] **Step 1: Write failing tests for preprocess and segment steps**

In `src/pipeline/steps/steps.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { normalizeWhitespace } from './preprocess.js';
import { segmentStep } from './segment.js';

describe('normalizeWhitespace', () => {
  it('passes text through unchanged (no-op)', () => {
    const ctx = {
      text: '  hello\n\nworld  ',
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = normalizeWhitespace(ctx);
    expect(result.text).toBe('  hello\n\nworld  ');
    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('normalizeWhitespace');
  });
});

describe('segmentStep', () => {
  it('chunks short text into a single segment', () => {
    const ctx = {
      text: 'short text',
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = segmentStep(ctx);
    expect(result.segments).toEqual([{ text: 'short text', offset: 0 }]);
    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('segment');
    expect(result.debug[0].out.segmentCount).toBe(1);
  });

  it('chunks long text into multiple segments', () => {
    // Create text with two paragraphs, each > 600 chars but total > 1200
    const para = 'A'.repeat(700);
    const text = para + '\n\n' + para;
    const ctx = {
      text,
      segments: [],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = segmentStep(ctx);
    expect(result.segments.length).toBeGreaterThan(1);
    // Each segment should have correct offset
    for (const seg of result.segments) {
      expect(text.slice(seg.offset, seg.offset + seg.text.length)).toBe(seg.text);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement preprocess step**

In `src/pipeline/steps/preprocess.js`:

```js
export function normalizeWhitespace(ctx) {
  // No-op for now — placeholder for future preprocessing
  return {
    ...ctx,
    debug: [...ctx.debug, { step: 'normalizeWhitespace', phase: 'preprocess' }],
  };
}
```

- [ ] **Step 4: Implement segment step**

In `src/pipeline/steps/segment.js`:

```js
import { chunkText } from '../../anonymizer.js';

const MAX_CHUNK_CHARS = 1200;

export function segmentStep(ctx) {
  const segments = chunkText(ctx.text, MAX_CHUNK_CHARS);
  return {
    ...ctx,
    segments,
    debug: [...ctx.debug, {
      step: 'segment',
      phase: 'segment',
      out: { segmentCount: segments.length },
    }],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: all 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/steps/preprocess.js src/pipeline/steps/segment.js src/pipeline/steps/steps.test.js
git commit -m "feat: add preprocess (no-op) and segment pipeline steps"
```

---

### Task 3: Post-Processing Steps (snap, filter, dedup, merge)

Wrap the four post-processing functions that operate on entities.

**Files:**
- Create: `src/pipeline/steps/snap.js`
- Create: `src/pipeline/steps/filter.js`
- Create: `src/pipeline/steps/dedup.js`
- Create: `src/pipeline/steps/merge.js`
- Modify: `src/pipeline/steps/steps.test.js` (append tests)

- [ ] **Step 1: Write failing tests for all four steps**

Append to `src/pipeline/steps/steps.test.js`:

```js
import { snapStep } from './snap.js';
import { filterStep } from './filter.js';
import { dedupStep } from './dedup.js';
import { mergeStep } from './merge.js';

describe('snapStep', () => {
  it('snaps entity boundaries to word boundaries', () => {
    // "notariusz" — model detected "not" (start=0, end=3) inside the word
    const text = 'notariusz Jan Kowalski';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 10, end: 13, score: 0.9 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = snapStep(ctx);
    // "Jan" should snap to word boundaries — already at word boundaries in this case
    expect(result.entities[0].start).toBe(10);
    expect(result.entities[0].end).toBe(13);
    expect(result.debug).toHaveLength(1);
    expect(result.debug[0].step).toBe('snap');
  });
});

describe('filterStep', () => {
  it('removes oversized entities', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.9 },
        { entity_group: 'PERSON_NAME', start: 0, end: 100, score: 0.8 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = filterStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].end).toBe(10);
    expect(result.debug[0].step).toBe('filter');
  });
});

describe('dedupStep', () => {
  it('removes overlapping entities keeping higher-priority', () => {
    const ctx = {
      text: '',
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.8 },
        { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.95 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = dedupStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.95);
    expect(result.debug[0].step).toBe('dedup');
  });
});

describe('mergeStep', () => {
  it('merges adjacent address entities', () => {
    const text = 'ul. Kwiatowa 5, Warszawa';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'POSTAL_ADDRESS', start: 0, end: 14, score: 0.9 },
        { entity_group: 'LOCATION', start: 16, end: 24, score: 0.85 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = mergeStep(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(24);
    expect(result.debug[0].step).toBe('merge');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement snap step**

In `src/pipeline/steps/snap.js`:

```js
import { snapToWordBoundaries } from '../../anonymizer.js';

export function snapStep(ctx) {
  const snapped = snapToWordBoundaries(ctx.entities, ctx.text);
  return {
    ...ctx,
    entities: snapped,
    debug: [...ctx.debug, {
      step: 'snap',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: snapped.length },
    }],
  };
}
```

- [ ] **Step 4: Implement filter step**

In `src/pipeline/steps/filter.js`:

```js
import { filterOversizedEntities } from '../../anonymizer.js';

export function filterStep(ctx) {
  const filtered = filterOversizedEntities(ctx.entities);
  return {
    ...ctx,
    entities: filtered,
    debug: [...ctx.debug, {
      step: 'filter',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: filtered.length },
    }],
  };
}
```

- [ ] **Step 5: Implement dedup step**

In `src/pipeline/steps/dedup.js`:

```js
import { deduplicateEntities } from '../../anonymizer.js';

export function dedupStep(ctx) {
  const deduped = deduplicateEntities(ctx.entities);
  return {
    ...ctx,
    entities: deduped,
    debug: [...ctx.debug, {
      step: 'dedup',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: deduped.length },
    }],
  };
}
```

- [ ] **Step 6: Implement merge step**

In `src/pipeline/steps/merge.js`:

```js
import { mergeAdjacentEntities } from '../../anonymizer.js';

export function mergeStep(ctx) {
  const merged = mergeAdjacentEntities(ctx.entities, ctx.text);
  return {
    ...ctx,
    entities: merged,
    debug: [...ctx.debug, {
      step: 'merge',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: merged.length },
    }],
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: all 7 tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/steps/snap.js src/pipeline/steps/filter.js src/pipeline/steps/dedup.js src/pipeline/steps/merge.js src/pipeline/steps/steps.test.js
git commit -m "feat: add snap, filter, dedup, merge pipeline steps"
```

---

### Task 4: Regex, Rescan, and Tokenize Steps

The remaining post-processing steps: regex entity detection, rescan for missed PII, and tokenization/anonymization.

**Files:**
- Create: `src/pipeline/steps/regex.js`
- Create: `src/pipeline/steps/rescan.js`
- Create: `src/pipeline/steps/tokenize.js`
- Modify: `src/pipeline/steps/steps.test.js` (append tests)

- [ ] **Step 1: Write failing tests**

Append to `src/pipeline/steps/steps.test.js`:

```js
import { regexStep } from './regex.js';
import { rescanStep } from './rescan.js';
import { tokenizeStep } from './tokenize.js';

describe('regexStep', () => {
  it('adds regex-detected entities to existing entities', () => {
    const text = 'Contact jan@test.com for details';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.9 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = regexStep(ctx);
    // Should have original entity + the email
    expect(result.entities.length).toBe(2);
    const email = result.entities.find(e => e.entity_group === 'EMAIL_ADDRESS');
    expect(email).toBeDefined();
    expect(email.score).toBe(1.0);
    expect(result.debug[0].step).toBe('regex');
  });
});

describe('tokenizeStep', () => {
  it('produces anonymized text and legend from entities', () => {
    const text = 'Jan Kowalski lives in Warszawa';
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.9 },
        { entity_group: 'LOCATION', start: 22, end: 30, score: 0.85 },
      ],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = tokenizeStep(ctx);
    expect(result.anonymized).toContain('[PERSON_NAME_1]');
    expect(result.anonymized).toContain('[LOCATION_1]');
    expect(result.anonymized).not.toContain('Jan Kowalski');
    expect(result.legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
    expect(result.debug[0].step).toBe('tokenize');
  });
});

describe('rescanStep', () => {
  it('catches remaining PII in anonymized text', () => {
    // Simulate: tokenize found "Jan Kowalski" but missed "Jana Kowalskiego" (declined form)
    const ctx = {
      text: 'original text',
      segments: [],
      entities: [],
      anonymized: 'Pismo od Jana Kowalskiego do sądu',
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      debug: [],
    };
    const result = rescanStep(ctx);
    expect(result.anonymized).toContain('[PERSON_NAME_1]');
    expect(result.anonymized).not.toContain('Jana Kowalskiego');
    expect(result.debug[0].step).toBe('rescan');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement regex step**

In `src/pipeline/steps/regex.js`:

```js
import { findRegexEntities } from '../../anonymizer.js';

export function regexStep(ctx) {
  const regexEntities = findRegexEntities(ctx.text);
  const combined = [...ctx.entities, ...regexEntities];
  return {
    ...ctx,
    entities: combined,
    debug: [...ctx.debug, {
      step: 'regex',
      phase: 'ner',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: combined.length, regexFound: regexEntities.length },
    }],
  };
}
```

- [ ] **Step 4: Implement tokenize step**

In `src/pipeline/steps/tokenize.js`:

```js
import { anonymizeText } from '../../anonymizer.js';

export function tokenizeStep(ctx) {
  const { anonymized, legend } = anonymizeText(ctx.text, ctx.entities);
  return {
    ...ctx,
    anonymized,
    legend,
    debug: [...ctx.debug, {
      step: 'tokenize',
      phase: 'postprocess',
      out: { tokenCount: Object.keys(legend).length },
    }],
  };
}
```

- [ ] **Step 5: Implement rescan step**

In `src/pipeline/steps/rescan.js`:

```js
import { rescanForKnownPii } from '../../anonymizer.js';

export function rescanStep(ctx) {
  const rescanned = rescanForKnownPii(ctx.anonymized, ctx.legend);
  return {
    ...ctx,
    anonymized: rescanned,
    debug: [...ctx.debug, {
      step: 'rescan',
      phase: 'postprocess',
      out: { changed: rescanned !== ctx.anonymized },
    }],
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: all 10 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/steps/regex.js src/pipeline/steps/rescan.js src/pipeline/steps/tokenize.js src/pipeline/steps/steps.test.js
git commit -m "feat: add regex, rescan, and tokenize pipeline steps"
```

---

### Task 5: NER Model Step

The async step that loads ONNX models, runs inference on segments, and aggregates entities. This is the only step with side effects.

**Files:**
- Create: `src/pipeline/steps/ner.js`
- Modify: `src/pipeline/steps/steps.test.js` (append tests)

- [ ] **Step 1: Write failing test with mock model**

Append to `src/pipeline/steps/steps.test.js`:

```js
import { createNerStep } from './ner.js';

describe('createNerStep', () => {
  it('runs model inference on segments and produces entities', async () => {
    // Mock model that returns fake B-PERSON_NAME tokens
    const mockLoadModel = async () => ({
      infer: async (text) => [
        { word: 'Jan', entity: 'B-PERSON_NAME', score: 0.95, index: 0 },
        { word: 'Kowalski', entity: 'I-PERSON_NAME', score: 0.93, index: 1 },
      ],
      dispose: async () => {},
    });

    const step = createNerStep([{ id: 'mock-model', dtype: 'q8' }], mockLoadModel);
    const ctx = {
      text: 'Jan Kowalski jest notariuszem',
      segments: [{ text: 'Jan Kowalski jest notariuszem', offset: 0 }],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = await step(ctx);
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
    expect(result.debug[0].step).toBe('ner');
  });

  it('offsets entities by segment offset', async () => {
    const mockLoadModel = async () => ({
      infer: async (text) => [
        { word: 'Anna', entity: 'B-PERSON_NAME', score: 0.9, index: 0 },
      ],
      dispose: async () => {},
    });

    const step = createNerStep([{ id: 'mock-model', dtype: 'q8' }], mockLoadModel);
    const ctx = {
      text: 'Prefix text. Anna Nowak lives here',
      segments: [{ text: 'Anna Nowak lives here', offset: 13 }],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = await step(ctx);
    // Entity start should be offset by 13
    expect(result.entities[0].start).toBeGreaterThanOrEqual(13);
    expect(result.debug[0].step).toBe('ner');
  });

  it('merges entities from multiple models', async () => {
    let callCount = 0;
    const mockLoadModel = async () => ({
      infer: async (text) => {
        callCount++;
        if (callCount === 1) {
          return [{ word: 'Jan', entity: 'B-PERSON_NAME', score: 0.9, index: 0 }];
        }
        return [{ word: 'Warszawa', entity: 'B-LOCATION', score: 0.85, index: 0 }];
      },
      dispose: async () => {},
    });

    const step = createNerStep(
      [{ id: 'model-a', dtype: 'q8' }, { id: 'model-b', dtype: 'q8' }],
      mockLoadModel,
    );
    const ctx = {
      text: 'Jan z Warszawa',
      segments: [{ text: 'Jan z Warszawa', offset: 0 }],
      entities: [],
      anonymized: '',
      legend: {},
      debug: [],
    };
    const result = await step(ctx);
    expect(result.entities.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: FAIL — module `./ner.js` not found

- [ ] **Step 3: Implement NER step**

In `src/pipeline/steps/ner.js`:

```js
import { aggregateEntities } from '../../anonymizer.js';

/**
 * Factory that creates a NER pipeline step.
 *
 * @param {Array<{id: string, dtype: string}>} models - Model configs to run
 * @param {Function} loadModel - async (modelConfig) => { infer(text), dispose() }
 *   Default uses @huggingface/transformers pipeline().
 *   Tests can inject a mock.
 */
export function createNerStep(models, loadModel) {
  return async function nerStep(ctx) {
    const allEntities = [];

    for (const model of models) {
      const ner = await loadModel(model);

      for (const segment of ctx.segments) {
        const raw = await ner.infer(segment.text);
        const chunkEntities = raw[0]?.entity_group
          ? raw
          : aggregateEntities(raw, segment.text);

        for (const entity of chunkEntities) {
          allEntities.push({
            ...entity,
            start: entity.start + segment.offset,
            end: entity.end + segment.offset,
          });
        }
      }

      await ner.dispose();
    }

    return {
      ...ctx,
      entities: [...ctx.entities, ...allEntities],
      debug: [...ctx.debug, {
        step: 'ner',
        phase: 'ner',
        out: {
          entityCount: allEntities.length,
          modelsUsed: models.map(m => m.id),
        },
      }],
    };
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/steps/steps.test.js`
Expected: all 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/ner.js src/pipeline/steps/steps.test.js
git commit -m "feat: add NER model pipeline step with dependency injection"
```

---

### Task 6: Default Pipeline Config

Assemble all steps into the standard pipeline that replicates current behavior.

**Files:**
- Create: `src/pipeline/configs/default.js`
- Create: `src/pipeline/configs/default.test.js`

- [ ] **Step 1: Write failing integration test**

In `src/pipeline/configs/default.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/configs/default.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement default config**

In `src/pipeline/configs/default.js`:

```js
import { normalizeWhitespace } from '../steps/preprocess.js';
import { segmentStep } from '../steps/segment.js';
import { createNerStep } from '../steps/ner.js';
import { regexStep } from '../steps/regex.js';
import { snapStep } from '../steps/snap.js';
import { filterStep } from '../steps/filter.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { rescanStep } from '../steps/rescan.js';
import { tokenizeStep } from '../steps/tokenize.js';

const MODELS = [
  { id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' },
  { id: 'bardsai/eu-pii-anonimization', dtype: 'q8' },
];

export const MODELS = [
  { id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' },
  { id: 'bardsai/eu-pii-anonimization', dtype: 'q8' },
];

/**
 * Creates the default PII anonymization pipeline.
 *
 * @param {Function} loadModel - async (modelConfig) => { infer(text), dispose() }
 */
export function createDefaultPipeline(loadModel) {
  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [segmentStep] },
    { phase: 'ner', steps: [createNerStep(MODELS, loadModel), regexStep] },
    { phase: 'postprocess', steps: [snapStep, filterStep, dedupStep, mergeStep, tokenizeStep, rescanStep] },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/configs/default.test.js`
Expected: PASS

- [ ] **Step 5: Run ALL existing tests to verify nothing is broken**

Run: `npx vitest run`
Expected: all existing tests in `anonymizer.test.js` still PASS (they import directly from `anonymizer.js` which is unchanged)

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/configs/default.js src/pipeline/configs/default.test.js
git commit -m "feat: add default pipeline config assembling all steps"
```

---

### Task 7: Rewire Worker to Use Pipeline

Replace the hardcoded classify handler in `worker.js` with the pipeline runner.

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 1: Rewrite worker.js to use the pipeline**

Replace the entire contents of `src/worker.js` with:

```js
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { runPipeline } from './pipeline/runner.js';
import { createDefaultPipeline, MODELS } from './pipeline/configs/default.js';

let pipelineConfig = null;
let availableModels = [];

async function loadModelBrowser(model) {
  const ner = await hfPipeline('token-classification', model.id, { dtype: model.dtype });
  return {
    infer: async (text) => await ner(text),
    dispose: async () => await ner.dispose(),
  };
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      availableModels = [];
      console.log('[worker] Preloading models...');

      const makeOpts = (dtype) => ({
        dtype,
        progress_callback: (data) => {
          if (data.status === 'progress') {
            self.postMessage({
              type: 'progress',
              file: data.file,
              progress: data.progress,
            });
          }
        },
      });

      // Preload models one at a time — load, verify, dispose.
      for (const model of MODELS) {
        try {
          const ner = await hfPipeline('token-classification', model.id, makeOpts(model.dtype));
          await ner.dispose();
          availableModels.push(model);
          console.log(`[worker] ${model.id} (${model.dtype}) preloaded and cached`);
        } catch (err) {
          console.warn(`[worker] ${model.id} (${model.dtype}) failed to preload:`, err);
        }
      }

      if (availableModels.length === 0) {
        self.postMessage({ type: 'error', message: 'No models could be loaded' });
        return;
      }

      // Build pipeline config with only the models that loaded successfully
      pipelineConfig = createDefaultPipeline(loadModelBrowser);

      console.log(`[worker] ${availableModels.length} model(s) ready`);
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      console.error('[worker] Preload failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'classify') {
    if (!pipelineConfig) {
      self.postMessage({ type: 'error', message: 'Models not loaded' });
      return;
    }
    try {
      const ctx = await runPipeline(e.data.text, pipelineConfig);

      // Post entities for backward compat with main.js
      self.postMessage({ type: 'result', data: ctx.entities, debug: ctx.debug });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
```

- [ ] **Step 2: Update main.js to use pipeline results**

In `src/main.js`, the `handleAnonymizationResult` function currently receives raw entities and calls `anonymizeText` + `rescanForKnownPii`. With the pipeline, those steps run inside the pipeline. But since the worker currently only posts `ctx.entities` (for backward compat), `main.js` doesn't need to change yet.

However, there's an opportunity: have the worker post the full pipeline result so `main.js` doesn't need to re-run anonymization. Update the worker's classify result to post the full context:

In the worker's classify handler, change the postMessage to:

```js
self.postMessage({
  type: 'result',
  data: ctx.entities,
  anonymized: ctx.anonymized,
  legend: ctx.legend,
  debug: ctx.debug,
});
```

Then update `src/main.js` — change the `handleAnonymizationResult` function and the `case 'result'` handler:

In the `case 'result':` block (around line 51), change from:
```js
    case 'result':
      handleAnonymizationResult(msg.data);
      break;
```
to:
```js
    case 'result':
      handleAnonymizationResult(msg);
      break;
```

Then replace the `handleAnonymizationResult` function (lines 72-123) with:

```js
function handleAnonymizationResult(msg) {
  const { anonymized, legend, debug } = msg;
  currentLegend = legend;

  anonymizedOutput.textContent = anonymized;

  legendTableBody.innerHTML = '';
  for (const [token, value] of Object.entries(legend)) {
    const row = document.createElement('tr');
    const tokenCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = token;
    tokenCell.appendChild(code);
    const valueCell = document.createElement('td');
    valueCell.textContent = value;
    row.appendChild(tokenCell);
    row.appendChild(valueCell);
    legendTableBody.appendChild(row);
  }

  resultSection.hidden = false;
  deanonymizeSection.hidden = false;
  deanonymizeResultSection.hidden = true;
  anonymizeBtn.disabled = false;
  anonymizeBtn.textContent = 'Anonymize';

  // Debug: show "Copy Debug" button if ?debug=1
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    let debugBtn = document.getElementById('copy-debug');
    if (!debugBtn) {
      debugBtn = document.createElement('button');
      debugBtn.id = 'copy-debug';
      debugBtn.className = 'btn btn-secondary';
      debugBtn.textContent = 'Copy Debug (text + legend)';
      debugBtn.style.marginLeft = '0.5rem';
      copyAnonymizedBtn.parentElement.appendChild(debugBtn);
    }
    debugBtn.onclick = () => {
      const legendText = Object.entries(legend)
        .map(([tok, val]) => `${tok}\t${val}`)
        .join('\n');
      const debugSteps = debug
        .map((d) => `[${d.phase}] ${d.step}: ${JSON.stringify(d.out || d.in || {})}`)
        .join('\n');
      const debugOutput = `=== ANONYMIZED TEXT ===\n${anonymized}\n\n=== LEGEND ===\n${legendText}\n\n=== PIPELINE DEBUG ===\n${debugSteps}`;
      navigator.clipboard.writeText(debugOutput);
      debugBtn.textContent = 'Copied!';
      setTimeout(() => {
        debugBtn.textContent = 'Copy Debug (text + legend)';
      }, 2000);
    };
  }
}
```

- [ ] **Step 3: Remove old imports from main.js**

At the top of `src/main.js`, change:
```js
import { anonymizeText, deanonymizeText, rescanForKnownPii } from './anonymizer.js';
```
to:
```js
import { deanonymizeText } from './anonymizer.js';
```

(`anonymizeText` and `rescanForKnownPii` are no longer called from main.js — they run inside the pipeline.)

- [ ] **Step 4: Start dev server and verify in browser**

Run: `npm run dev`

Open the app in a browser. Load the model, paste some test text, click Anonymize. Verify:
- Model downloads with progress indicator
- Anonymized output appears with correct token replacements
- Legend table populates correctly
- De-anonymize still works
- Debug button (with `?debug=1`) shows pipeline debug info

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/worker.js src/main.js
git commit -m "refactor: rewire worker and main.js to use pipeline runner"
```

---

### Task 8: Slim Down anonymizer.js

Remove functions that are now imported by pipeline steps directly. Keep only shared utilities and re-exports for test backward compatibility.

**Files:**
- Modify: `src/anonymizer.js`
- Modify: `src/anonymizer.test.js` (update imports if needed)

- [ ] **Step 1: Check which functions are still imported directly from anonymizer.js**

The only direct imports from `anonymizer.js` remaining should be:
- `main.js` imports `deanonymizeText`
- `anonymizer.test.js` imports all functions for testing
- Pipeline step files import individual functions

The functions themselves stay in `anonymizer.js` — the step files are wrappers. No functions need to be removed. `anonymizer.js` already serves as the "shared utilities" module.

Verify this is the case — if all tests pass after Task 7, `anonymizer.js` is already in the right state.

- [ ] **Step 2: Run all tests to confirm**

Run: `npx vitest run`
Expected: all tests PASS — no changes needed to `anonymizer.js` or `anonymizer.test.js`

- [ ] **Step 3: Commit (only if changes were needed)**

If any imports needed updating:
```bash
git add src/anonymizer.js src/anonymizer.test.js
git commit -m "refactor: clean up anonymizer.js imports after pipeline migration"
```

---

### Task 9: Evaluation Harness

Node.js CLI that batch-processes test documents through the pipeline and writes results.

**Files:**
- Create: `src/eval/run.js`
- Modify: `package.json` (add eval script and onnxruntime-node dependency)

- [ ] **Step 1: Add onnxruntime-node dependency**

Run: `npm install onnxruntime-node`

This provides the ONNX runtime backend for `@huggingface/transformers` when running in Node.js.

- [ ] **Step 2: Add eval script to package.json**

Add to the `"scripts"` section in `package.json`:

```json
"eval": "node src/eval/run.js"
```

- [ ] **Step 3: Implement the eval CLI**

In `src/eval/run.js`:

```js
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { runPipeline } from '../pipeline/runner.js';
import { createDefaultPipeline } from '../pipeline/configs/default.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

async function loadModelNode(model) {
  const ner = await hfPipeline('token-classification', model.id, { dtype: model.dtype });
  return {
    infer: async (text) => await ner(text),
    dispose: async () => await ner.dispose(),
  };
}

async function processDocument(filePath, pipelineConfig) {
  const text = await readFile(filePath, 'utf-8');
  const name = basename(filePath, extname(filePath));

  console.log(`\nProcessing: ${name} (${text.length} chars)`);
  const startTime = performance.now();

  const ctx = await runPipeline(text, pipelineConfig);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`  Done in ${elapsed}s — ${ctx.entities.length} entities, ${Object.keys(ctx.legend).length} tokens`);

  // Write results
  const outDir = join(RESULTS_DIR, name);
  await mkdir(outDir, { recursive: true });

  await writeFile(join(outDir, 'anonymized.txt'), ctx.anonymized, 'utf-8');
  await writeFile(join(outDir, 'entities.json'), JSON.stringify(ctx.entities, null, 2), 'utf-8');
  await writeFile(join(outDir, 'debug.json'), JSON.stringify(ctx.debug, null, 2), 'utf-8');
  await writeFile(
    join(outDir, 'legend.json'),
    JSON.stringify(ctx.legend, null, 2),
    'utf-8',
  );

  console.log(`  Results: ${outDir}/`);
  return { name, entityCount: ctx.entities.length, elapsed };
}

async function main() {
  const args = process.argv.slice(2);

  // Determine which files to process
  let files;
  if (args.length > 0 && !args[0].startsWith('--')) {
    // Specific file(s) passed as arguments
    files = args.filter(a => !a.startsWith('--'));
  } else {
    // All .txt files in test-data/
    const entries = await readdir(TEST_DATA_DIR);
    files = entries
      .filter(f => f.endsWith('.txt'))
      .map(f => join(TEST_DATA_DIR, f));
  }

  if (files.length === 0) {
    console.log('No .txt files found in test-data/');
    process.exit(1);
  }

  console.log(`Eval: ${files.length} document(s)`);
  console.log('Loading models...');

  const pipelineConfig = createDefaultPipeline(loadModelNode);
  await mkdir(RESULTS_DIR, { recursive: true });

  const results = [];
  for (const file of files) {
    results.push(await processDocument(file, pipelineConfig));
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.entityCount} entities (${r.elapsed}s)`);
  }
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Test the eval harness on one document**

Run: `node src/eval/run.js test-data/pismo_01_wezwanie_do_zaplaty.txt`

Expected output:
- Console shows processing progress
- Creates `test-data/results/pismo_01_wezwanie_do_zaplaty/` with:
  - `anonymized.txt`
  - `entities.json`
  - `legend.json`
  - `debug.json`

If `onnxruntime-node` has issues, verify the output files are created (even if empty for NER) and the rest of the pipeline ran.

- [ ] **Step 5: Test eval on all documents**

Run: `npm run eval`

Expected: all 6 documents processed, results written to `test-data/results/`.

- [ ] **Step 6: Add test-data/results/ to .gitignore**

Append to `.gitignore` (create it if it doesn't exist):

```
test-data/results/
```

- [ ] **Step 7: Commit**

```bash
git add src/eval/run.js package.json package-lock.json .gitignore
git commit -m "feat: add Node.js evaluation harness for batch-processing test documents"
```

---

### Task 10: Final Verification

End-to-end check that everything works together.

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS (original 62 + new pipeline tests)

- [ ] **Step 2: Verify browser still works**

Run: `npm run dev`

In browser:
1. Load model
2. Paste a test document
3. Click Anonymize
4. Verify output matches expected behavior
5. Test de-anonymize
6. Test debug mode (`?debug=1`)

- [ ] **Step 3: Run eval on all test documents**

Run: `npm run eval`

Verify each document in `test-data/results/` has:
- `anonymized.txt` — readable, no leaked PII
- `entities.json` — reasonable entities with types and scores
- `legend.json` — token-to-value mapping
- `debug.json` — step-by-step pipeline execution log

- [ ] **Step 4: Commit any final fixes**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: final adjustments after end-to-end pipeline verification"
```
