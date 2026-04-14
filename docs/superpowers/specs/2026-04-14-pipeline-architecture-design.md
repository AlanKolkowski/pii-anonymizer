# Pipeline Architecture & Evaluation Harness

## Problem

The PII anonymization pipeline is currently hardcoded across two files:
- `worker.js` (lines 102-114): NER inference + post-processing chain as sequential function calls
- `main.js` (lines 72-123): rescan + token mapping after worker returns

Adding a new step (e.g., ONNX segmentation model) means editing the worker's classify handler and understanding the implicit ordering. Testing different configurations requires code changes.

Evaluation is manual: run each of 6 test docs in the browser, copy debug output, paste into files, ask for review. No way to batch-run or automate.

## Design

### Architecture: Shared Context Pipeline

A pipeline context object flows through all steps. Each step reads what it needs, writes its output back, and appends to the debug log.

#### Context Object

```js
{
  text: string,         // original input, then preprocessed
  segments: Segment[],  // after segmentation phase
  entities: Entity[],   // after NER phase
  anonymized: string,   // after postprocessing
  legend: Map,          // token ↔ original value
  debug: StepLog[],     // what each step did
}
```

#### Pipeline Definition

A pipeline is an array of phases. Each phase has a label and an ordered list of steps:

```js
const pipeline = [
  { phase: 'preprocess', steps: [normalizeWhitespace] },
  { phase: 'segment',    steps: [chunkText] },
  { phase: 'ner',        steps: [multiLangModel, regexEntities] },
  { phase: 'postprocess', steps: [snap, filter, dedup, merge, rescan, tokenize] },
]
```

Phase labels are for humans and debug output. The runner doesn't enforce contracts between phases — if a step writes bad data, the next step breaks and the debug log shows which step caused it.

#### Pipeline Runner

```js
async function runPipeline(text, pipeline) {
  let ctx = { text, debug: [] };
  for (const { phase, steps } of pipeline) {
    for (const step of steps) {
      ctx = await step(ctx);
    }
  }
  return ctx;
}
```

The runner is async to support NER model inference. Sync steps are called with await harmlessly.

### Step Contract

Every step is a function `(ctx) → ctx` (or async). Steps:
- Read the fields they need from ctx
- Return a new ctx with their output written (spread + override, no mutation)
- Append a debug entry describing what changed

Example:

```js
export function snapToWordBoundaries(ctx) {
  const snapped = snap(ctx.entities, ctx.text);
  return {
    ...ctx,
    entities: snapped,
    debug: [...ctx.debug, {
      step: 'snapToWordBoundaries',
      phase: 'postprocess',
      in: { entityCount: ctx.entities.length },
      out: { entityCount: snapped.length },
    }],
  };
}
```

Debug entries are simple: step name, phase, and a summary of input/output counts or key changes. Not a full diff — just enough to trace what happened.

The NER step is the exception — it's async and has side effects (model load/infer/dispose). That's acceptable; it's explicitly the "heavy" step.

### File Structure

```
src/
  pipeline/
    runner.js          — runPipeline(text, config) → ctx
    context.js         — createContext(text) helper, type documentation
    steps/
      preprocess.js    — normalizeWhitespace (no-op initially)
      segment.js       — chunkText (moved from anonymizer.js)
      ner.js           — multiLangModel step (wraps model load/infer/dispose)
      regex.js         — findRegexEntities (moved from anonymizer.js)
      snap.js          — snapToWordBoundaries
      filter.js        — filterOversizedEntities
      dedup.js         — deduplicateEntities
      merge.js         — mergeAdjacentEntities
      rescan.js        — rescanForKnownPii
      tokenize.js      — buildTokenMap + anonymizeText
    configs/
      default.js       — the standard pipeline (replicates current behavior)
  anonymizer.js        — shrinks to shared utilities (deanonymizeText, couldBeSamePerson)
  worker.js            — simplified: imports default config, calls runPipeline
  main.js              — unchanged (talks to worker)
  eval/
    run.js             — Node CLI: reads test-data/, runs pipeline, writes results
```

### Migration Strategy

Each step file wraps an existing function from `anonymizer.js` in the `(ctx) → ctx` contract. The original function signatures stay the same internally — the step wrapper adapts them.

`anonymizer.js` shrinks to shared utilities used by multiple steps:
- `couldBeSamePerson()` — used by both `tokenize` and `rescan`
- `deanonymizeText()` — used by `main.js` directly, not part of the pipeline

`worker.js` becomes thin: import default config, call `runPipeline`, post result back.

`main.js` is unchanged — it still sends/receives messages to the worker.

All existing tests in `anonymizer.test.js` continue to work by re-exporting the original functions from their new locations, or by updating imports.

### Evaluation Harness

#### CLI Usage

```bash
node src/eval/run.js                          # run all test docs
node src/eval/run.js test-data/pismo-1.txt    # run one doc
node src/eval/run.js --config experimental.js # use alternate pipeline config
```

#### Output

Per document, writes to `test-data/results/<doc-name>/`:
- `anonymized.txt` — the final anonymized text (skim for leaked PII)
- `entities.json` — detected entities: type, value, position, confidence score
- `debug.json` — step-by-step log showing what each step added/changed/removed

#### How It Works

1. Reads `.txt` files from `test-data/`
2. Imports `configs/default.js` (same pipeline the browser uses)
3. Runs each doc through `runPipeline()`
4. Writes results to `test-data/results/`

The script uses `@huggingface/transformers` with `onnxruntime-node` for NER inference in Node.js. If this proves problematic, the NER step can be skipped with a flag (`--skip-ner`) for testing the rest of the pipeline.

### What Doesn't Change

- `main.js` UI logic — still talks to the worker the same way
- `index.html` — no UI changes
- Browser UX is identical to current
- `deanonymizeText` stays as a standalone utility
- All 62 existing test cases work — functions are re-exported from new locations

### Future Extensibility

Adding a new pipeline step (e.g., ONNX segmentation model):
1. Create `src/pipeline/steps/segmentation-model.js` exporting `(ctx) → ctx`
2. Add it to the appropriate phase in `configs/default.js`
3. Done

Creating an experimental pipeline config:
1. Copy `configs/default.js` to `configs/experimental.js`
2. Swap/add/remove steps
3. Run `node src/eval/run.js --config experimental.js`
4. Compare results
