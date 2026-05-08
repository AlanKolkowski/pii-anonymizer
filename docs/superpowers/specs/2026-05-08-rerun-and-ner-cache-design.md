# Re-run trigger + per-source NER cache — design

**Status:** approved (brainstorming)
**Date:** 2026-05-08

## Goal

Two coupled QoL changes:

1. After anonymization, give the user a way to re-run the pipeline without leaving annotation mode when their input has drifted (text edited, or entity selection changed).
2. Avoid redoing expensive work between runs of the same document. Cache preprocess output, segments, and per-model NER outputs keyed by content hash. Re-run only what is missing.

The two are coupled because the cache is what makes the re-run fast in the common case (toggling categories within already-loaded models).

## Non-goals (v1)

- Persistent cache across page loads. In-memory only; HF model weights remain cached in IndexedDB by Transformers.js.
- Visual distinction between "instant" (cache hit) vs "slow" (cache miss) re-runs. The same button, same loading state.
- Caching across different `backendOverride` values (WebNN vs WASM). Cache wipes on backend switch (conservative; numerics in principle match but we don't verify).
- Worker-level test harness. Cache logic is covered indirectly via existing pipeline tests + manual eval.

## UX

### Where the button lives

In annotation mode, the workspace toolbar gains a third button:

```
[Anonimizuj ponownie] [Edytuj tekst] [Kopiuj zanonimizowany]
```

The button is **shown only when the displayed result is stale** — i.e., the current state differs from the state that produced the result.

**Stale ⇔ either:**
- `editor.getText() !== lastRun.text`, or
- `selector.getSelected()` (as a set) `!==` `lastRun.enabledEntities` (as a set)

Selection comparison is order-insensitive; we compare canonical sorted arrays or sets.

### Text-mode behavior unchanged

In text mode the existing "Anonimizuj" button stays as is — it already covers commit-edits + run, and there's no separate "stale" indicator needed because the user is mid-edit.

### Disabled / hidden states

| Condition | Re-run button |
|---|---|
| Not in annotation mode | hidden |
| No prior successful run | hidden |
| State not stale | hidden |
| State stale, classify in flight | shown but disabled |
| Selection has 0 entities | hidden (matches current Anonimizuj gate) |
| Editor text empty | hidden |

After a successful classify, `lastRun` updates and the button hides.

### Edge cases

- **Annotation edits (manual entity tweaks)**: do not affect the rerun button. They are local annotations, not pipeline inputs.
- **File upload while in `'loaded'` annotation state**: replaces text and entities (existing flow). After replacement, annotation mode is exited; rerun button is irrelevant until the next successful classify.

## Architecture

### Main thread (`src/main.js`)

New module-level state:

```js
let lastRun = null;  // null until first successful classify
// shape: { text: string, enabledEntities: string[] (sorted) }
```

New function:

```js
function updateRerunButton() {
  const stale = lastRun && (
    editor.getText() !== lastRun.text ||
    !setsEqual(selector.getSelected(), lastRun.enabledEntities)
  );
  rerunBtn.hidden = !(editor.getMode() === 'annotation' && stale && !classifyInFlight);
  rerunBtn.disabled = classifyInFlight;
}
```

Called from:
- `selector.onChange`
- `editor.onModeChange`
- worker `result` handler (after `lastRun` is updated)
- worker `error` handler (re-evaluate, in case button should re-appear)

The button click reuses the existing classify code path:

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

`lastRun` is set in the existing `case 'result'` branch:

```js
lastRun = {
  text: editor.getText(),  // canonical post-classify text
  enabledEntities: [...selector.getSelected()].sort(),
};
updateRerunButton();
```

### Worker (`src/worker.js`)

New module-level state:

```js
let nerCache = null;
// shape: {
//   textHash: string,                       // SHA-256 hex of input text
//   normalizedText: string,                 // post-preprocess
//   segments: Segment[],                    // post-segment phase
//   bySource: Map<alias, Entity[]>,         // per-HF-model NER output (raw, pre-postprocess)
//   regex: Entity[] | null,                 // regex output, or null if not yet computed
// }
```

Helper:

```js
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

Unified classify orchestration:

```js
async function classify(text, enabledEntities) {
  const hash = await sha256Hex(text);
  const hit = nerCache?.textHash === hash;

  // --- Stage 1: preprocess + segment (skip on hit) ---
  let normalizedText, segments;
  if (hit) {
    normalizedText = nerCache.normalizedText;
    segments = nerCache.segments;
  } else {
    ({ text: normalizedText, segments } = await runPreSegmentPhases(text));
  }

  // --- Stage 2: NER per source (run only what's missing) ---
  const bySource = hit ? new Map(nerCache.bySource) : new Map();
  let regex = hit ? nerCache.regex : null;

  const requiredHf = requiredSources(enabledEntities)
    .filter(a => SOURCES[a]?.kind === 'hf');
  const missingHf = requiredHf.filter(a => !bySource.has(a));
  const regexNeeded = requiredSources(enabledEntities).includes('regex');

  if (missingHf.length > 0) {
    const fresh = await runNerForSources(missingHf, normalizedText, segments);
    // fresh: Map<alias, Entity[]>
    for (const [alias, ents] of fresh) bySource.set(alias, ents);
  }
  if (regexNeeded && regex === null) {
    regex = runRegex(normalizedText);
  }

  // --- Stage 3: postprocess on union of all entities ---
  const merged = [...[...bySource.values()].flat(), ...(regex ?? [])];
  const finalCtx = await runPostprocess(
    { text: normalizedText, segments, entities: merged },
    enabledEntities,
  );

  // --- Stage 4: atomic cache update on success ---
  nerCache = { textHash: hash, normalizedText, segments, bySource, regex };
  return finalCtx;
}
```

**Failure semantics:** if any stage throws, the cache is **not** mutated. `nerCache` retains its previous valid state (or stays `null`).

**Cache invalidation triggers:**
- New text (different `textHash`) — natural cache miss; cache is overwritten on next success.
- Backend override change in `configure` — explicitly clear `nerCache = null` (in addition to existing `disposeModel` calls).
- Worker reload (page refresh) — gone naturally.

### Pipeline factoring (`src/pipeline/`)

Today `createDefaultPipeline` returns a fixed list of `{ phase, steps }`. We expose three composable building blocks:

```js
// pipeline/configs/default.js (additions)

// Phases 1 & 2 only
export function createPreSegmentSteps(getSentenceBoundaries) { ... }

// Phase 3 only — accepts a runtime-decided HF subset
export function createNerSteps(hfSubset, regexActive, loadModel) { ... }

// Phase 4 only — same as today's postprocess steps
export function createPostprocessSteps(options) { ... }
```

`createDefaultPipeline` keeps its current shape so `src/eval/run.js` (and any tests that build the full monolithic pipeline) continue to work; internally it now delegates to the three helpers. The worker stops calling `createDefaultPipeline` and instead drives the helpers stage by stage.

`runPipeline` is extended to accept a pre-seeded context:

```js
// runner.js
export async function runPipeline(input, pipeline) {
  // Backwards-compatible: input can be a string OR a context object
  let ctx = typeof input === 'string' ? createContext(input) : input;
  // ... rest unchanged
}
```

The worker calls `runPipeline` once per stage with the appropriate steps, threading context manually:

```js
async function runPreSegmentPhases(text) {
  const ctx = await runPipeline(text, createPreSegmentSteps(get_sentence_boundaries));
  return { text: ctx.text, segments: ctx.segments };
}
```

For the NER stage, we want per-source output rather than a single merged entity list. Two options:

**A) Run each missing source as its own pipeline call**, collect entities per call. Simple but loses some debug coalescing.

**B) Add an explicit `bySource` field to context**, populate it during the NER step, leave `entities` as the merged union for downstream postprocess.

Recommendation: **A**. Cleaner; the per-source split is exactly the structural information we need to cache.

```js
async function runNerForSources(aliases, normalizedText, segments) {
  const out = new Map();
  for (const alias of aliases) {
    const ctx = await runPipeline(
      { text: normalizedText, segments, entities: [], anonymized: '', legend: {} },
      [{ phase: 'ner', steps: [createNerStep([toHfDescriptor(alias)], loadModelForPipeline)] }],
    );
    out.set(alias, ctx.entities);
  }
  return out;
}
```

Regex similarly:

```js
function runRegex(normalizedText) {
  const ctx = runRegexStepSync({ text: normalizedText, entities: [] });
  return ctx.entities;
}
```

(Regex step is sync — no need for runPipeline ceremony.)

### Postprocess replay

Postprocess steps are pure functions of `(text, segments, entities, enabledEntities)`. By the time postprocess runs, every source in `requiredSources(enabledEntities)` is guaranteed to be in the merged entity list — either drawn from `cache.bySource` or freshly run via `runNerForSources(missingHf, ...)`. So the source-filter step (`entity_group ∈ enabledEntities` AND `source ∈ authoritative_sources_for_type`) operates on the same coverage it would have in a fresh full run.

The cached `bySource` always contains complete output for each model that ran; the only axis that can be incomplete relative to a new selection is "which models ran at all," and `missingHf = requiredHf − bySource.keys()` exhaustively closes that gap before postprocess executes.

## File layout

| File | Change |
|---|---|
| `src/main.js` | Add `lastRun`, `updateRerunButton`, new button DOM + handlers |
| `index.html` | Add button element to workspace toolbar (or inject from main.js — match existing pattern) |
| `src/worker.js` | Add `nerCache`, `sha256Hex`, unified `classify` orchestration |
| `src/pipeline/configs/default.js` | Split into `createPreSegmentSteps` / `createNerSteps` / `createPostprocessSteps` |
| `src/pipeline/runner.js` | Accept pre-seeded ctx in `runPipeline` |
| `src/pipeline/runner.test.js` | New: pre-seeded-ctx path |
| `src/pipeline/configs/default.test.js` | Update if existing tests reference the monolithic pipeline shape |

No worker-level unit tests added; cache correctness verified via:
- existing pipeline tests (postprocess steps with synthetic entity lists),
- manual eval (`npm run eval -- --label=ner-cache`) — should produce **identical** F1 vs the pre-cache run.

## Performance expectations

For a 30-page document with all q8 models loaded (qualitative — actual savings depend on doc length and backend):

| Action | Before | After |
|---|---|---|
| First Anonimizuj | full pipeline | full pipeline (same) |
| Toggle category off, re-run | full pipeline | postprocess only (milliseconds) |
| Toggle category on (same models) | full pipeline | postprocess only |
| Toggle category on (requires new model) | full pipeline | preprocess+segment skipped, already-cached models skipped, only the new model runs |
| Edit text, re-run | full pipeline | full pipeline (correct — invalidated by hash) |

The dominant savings come from skipping inference on already-run models, not from skipping preprocess/segment. The latter still matters on 30-page inputs but is small relative to NER.

## Open questions

None blocking. Future work:

- Persist cache to IndexedDB keyed by `textHash` so reloading the same document is instant. Out of scope for v1.
- Visual hint when re-run will be instant ("Pamiętam ten tekst") vs slow. Premature.
