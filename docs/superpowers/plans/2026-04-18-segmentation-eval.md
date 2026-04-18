# Segmentation Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class segmentation support to the eval framework — persist predicted/expected segments, score them with P/R/F1, and visualize them in the HTML report.

**Architecture:** Serialize `ctx.segments` to `segments.json` per run/doc. Introduce ground-truth `.expected-segments.json` per test doc, bootstrapped from a one-shot script, then human-reviewed. Reuse the existing `matchEntities` matcher with `requireTypeMatch: false` to produce exact/partial/missed/spurious classification mirroring entity scoring. Add a collapsed "Segmentation" section in the HTML report showing segment blocks with boundary-mismatch carets.

**Tech Stack:** Node.js ESM, vitest (globals enabled), `@huggingface/transformers` + `sentencex` (already used), vanilla HTML/CSS in the report.

**Spec:** `docs/superpowers/specs/2026-04-18-segmentation-eval-design.md`

---

## Task 1: Serialize predicted segments in eval runner

Add segment persistence to each doc's run output. No pipeline changes.

**Files:**
- Modify: `src/eval/run.js` (around the existing `writeFile` calls in `processDocument`)

- [ ] **Step 1: Add segment write in `processDocument`**

Open `src/eval/run.js`. Find this block in `processDocument`:

```js
await writeFile(join(outDir, 'anonymized.txt'), ctx.anonymized, 'utf-8');
await writeFile(join(outDir, 'entities.json'), JSON.stringify(ctx.entities, null, 2), 'utf-8');
await writeFile(join(outDir, 'debug.json'), JSON.stringify(ctx.debug, null, 2), 'utf-8');
await writeFile(
  join(outDir, 'legend.json'),
  JSON.stringify(ctx.legend, null, 2),
  'utf-8',
);
```

Add a fifth `writeFile` immediately after the others:

```js
const segmentsJson = ctx.segments.map(s => ({
  start: s.offset,
  end: s.offset + s.text.length,
  text: s.text,
}));
await writeFile(join(outDir, 'segments.json'), JSON.stringify(segmentsJson, null, 2), 'utf-8');
```

Also update the `console.log` line slightly so the segment count surfaces. Change:

```js
console.log(`  Done in ${elapsed}s — ${ctx.entities.length} entities, ${Object.keys(ctx.legend).length} tokens`);
```

to:

```js
console.log(`  Done in ${elapsed}s — ${ctx.segments.length} segments, ${ctx.entities.length} entities, ${Object.keys(ctx.legend).length} tokens`);
```

And update the per-doc summary line at the bottom of `main`. Find:

```js
console.log(`  ${r.name}: ${r.entityCount} entities, ${r.tokenCount} tokens (${r.elapsed}s)`);
```

Change to:

```js
console.log(`  ${r.name}: ${r.segmentCount} segments, ${r.entityCount} entities, ${r.tokenCount} tokens (${r.elapsed}s)`);
```

Also update the `return` in `processDocument`:

```js
return {
  name,
  segmentCount: ctx.segments.length,
  entityCount: ctx.entities.length,
  tokenCount: Object.keys(ctx.legend).length,
  entitiesByType: countByType(ctx.entities),
  elapsed,
};
```

And add `segmentCount` propagation in the summary assembly in `main`:

```js
documents[r.name] = {
  segmentCount: r.segmentCount,
  entityCount: r.entityCount,
  tokenCount: r.tokenCount,
  entitiesByType: r.entitiesByType,
  elapsed: r.elapsed,
};
```

- [ ] **Step 2: Run eval against a single doc to verify segments.json appears**

Run:
```bash
npm run eval -- test-data/synthetic/pismo_01_wezwanie_do_zaplaty.txt --label=seg-artifact-check
```

Expected: completes without error, prints the updated log line ("N segments, M entities, K tokens"), writes `test-data/results/<runId>/pismo_01_wezwanie_do_zaplaty/segments.json`.

Verify the file:
```bash
ls test-data/results/latest/pismo_01_wezwanie_do_zaplaty/
cat test-data/results/latest/pismo_01_wezwanie_do_zaplaty/segments.json | head -20
```

Expected: `segments.json` is present; first entries look like `{ "start": 0, "end": ..., "text": "..." }`.

- [ ] **Step 3: Commit**

```bash
git add src/eval/run.js
git commit -m "feat(eval): persist predicted segments per doc"
```

---

## Task 2: Snapshot script for expected segments

One-shot CLI that runs preprocess + segment only (no NER, no model loading) and writes an initial `.expected-segments.json` per test doc, refusing to overwrite existing files.

**Files:**
- Create: `scripts/snapshot-segments.js`

- [ ] **Step 1: Create `scripts/` dir if absent and write the script**

```bash
mkdir -p scripts
```

Create `scripts/snapshot-segments.js`:

```js
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../src/pipeline/runner.js';
import { normalizeWhitespace } from '../src/pipeline/steps/preprocess.js';
import { createSentencexSegmentStep } from '../src/pipeline/steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../src/pipeline/steps/merge-abbreviations.js';

const DOCS_DIR = join(import.meta.dirname, '..', 'test-data', 'synthetic');

const pipelineConfig = [
  { phase: 'preprocess', steps: [normalizeWhitespace] },
  { phase: 'segment', steps: [
    createSentencexSegmentStep(get_sentence_boundaries),
    mergeAbbreviationsStep,
  ] },
];

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function main() {
  const entries = await readdir(DOCS_DIR);
  const txts = entries.filter(f => f.endsWith('.txt')).sort();

  if (txts.length === 0) {
    console.log(`No .txt files in ${DOCS_DIR}`);
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;

  for (const file of txts) {
    const name = basename(file, '.txt');
    const expectedPath = join(DOCS_DIR, `${name}.expected-segments.json`);

    if (await exists(expectedPath)) {
      console.log(`  SKIP: ${name} (expected-segments.json already exists)`);
      skipped++;
      continue;
    }

    const text = await readFile(join(DOCS_DIR, file), 'utf-8');
    const ctx = await runPipeline(text, pipelineConfig);
    const segments = ctx.segments.map(s => ({
      start: s.offset,
      end: s.offset + s.text.length,
      text: s.text,
    }));
    await writeFile(expectedPath, JSON.stringify(segments, null, 2), 'utf-8');
    console.log(`  WROTE: ${name} (${segments.length} segments)`);
    written++;
  }

  console.log(`\nDone — ${written} written, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script for convenience**

Open `package.json`. In the `"scripts"` block, add:

```json
"eval:snapshot-segments": "node scripts/snapshot-segments.js"
```

after the existing `"eval:view"` entry (mind the trailing comma on the previous line).

- [ ] **Step 3: Smoke test the script with no changes expected**

Run:
```bash
npm run eval:snapshot-segments
```

Expected on first run: 6 `WROTE:` lines (one per `pismo_*.txt`). Re-running should print 6 `SKIP:` lines and 0 written — confirms it doesn't overwrite.

- [ ] **Step 4: Commit the script**

Do NOT commit the generated `.expected-segments.json` yet — that happens in Task 3 after user review.

```bash
git add scripts/snapshot-segments.js package.json
git commit -m "feat(eval): snapshot-segments script for ground-truth bootstrap"
```

---

## Task 3: Ground-truth review gate (manual, then commit)

This task requires the human (user) to review the snapshot output. The agent should execute the snapshot, print the file list, and then STOP and hand off to the user with a clear message.

**Files:**
- Create (via snapshot): `test-data/synthetic/<doc>.expected-segments.json` × 6

- [ ] **Step 1: Run the snapshot if not already run**

```bash
npm run eval:snapshot-segments
```

Expected: either 6 `WROTE:` (if freshly bootstrapped) or 6 `SKIP:` (already there). Either is fine.

- [ ] **Step 2: List the generated files for the user**

```bash
ls test-data/synthetic/*.expected-segments.json
```

Expected: 6 paths printed.

- [ ] **Step 3: HAND-OFF — ask the user to review**

Print the following message verbatim to the user:

> Ground-truth segment files have been snapshotted from the current pipeline output. Before scoring is meaningful, please review each `test-data/synthetic/<doc>.expected-segments.json` and correct any wrong splits by editing the JSON directly. You can iterate with `npm run eval && npm run eval:score` once Tasks 4 and 5 land — the segmentation section of the report will show the snapshot against itself and make boundary decisions easy to eyeball. When you're satisfied, commit the files. To proceed with Tasks 4–6 without the review, say so explicitly; scoring will still work, it will just be scoring against the current pipeline's own output.

**The agent must stop here and wait for user input before continuing.**

- [ ] **Step 4: After user confirms (or explicitly opts to defer review), commit the snapshots**

```bash
git add test-data/synthetic/*.expected-segments.json
git commit -m "test-data: initial expected-segments snapshots"
```

---

## Task 4: Segment scoring in score.js

Add `computeSegmentMetrics`, load expected segments per doc, add CLI output, save metrics to `scores.json`. TDD first.

**Files:**
- Create: `src/eval/score.test.js`
- Modify: `src/eval/score.js`

- [ ] **Step 1: Write failing test for `computeSegmentMetrics`**

Create `src/eval/score.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { computeSegmentMetrics } from './score.js';

describe('computeSegmentMetrics', () => {
  it('returns P=R=F1=1 for identical segmentations', () => {
    const segs = [
      { start: 0, end: 10, text: 'one' },
      { start: 10, end: 20, text: 'two' },
    ];
    const m = computeSegmentMetrics(segs, segs);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.tp).toBe(2);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
    expect(m.tpPartial).toBe(0);
  });

  it('counts missing expected as FN', () => {
    const expected = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const predicted = [
      { start: 0, end: 10, text: 'a' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(1);
    expect(m.fn).toBe(1);
    expect(m.fp).toBe(0);
  });

  it('counts extra predicted as FP', () => {
    const expected = [
      { start: 0, end: 10, text: 'a' },
    ];
    const predicted = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(1);
    expect(m.fp).toBe(1);
    expect(m.fn).toBe(0);
  });

  it('counts a shifted boundary as partial (FP+FN, tpPartial=1)', () => {
    // Same coverage, different boundaries.
    const expected = [
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
    ];
    const predicted = [
      { start: 0, end: 12, text: 'a+' },
      { start: 12, end: 20, text: '-b' },
    ];
    const m = computeSegmentMetrics(expected, predicted);
    expect(m.tp).toBe(0);
    expect(m.tpPartial).toBe(2);
    expect(m.fp).toBe(2);
    expect(m.fn).toBe(2);
  });

  it('returns zeroes for empty inputs', () => {
    const m = computeSegmentMetrics([], []);
    expect(m.tp).toBe(0);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/eval/score.test.js
```

Expected: all 5 tests fail with "computeSegmentMetrics is not a function" or similar import error.

- [ ] **Step 3: Implement `computeSegmentMetrics` in `score.js`**

Open `src/eval/score.js`. At the top, update the `matchEntities` import if not already there — it is. Below `computeMetrics` (around line 30), add and export:

```js
export function computeSegmentMetrics(expected, predicted) {
  const normalized = {
    exp: expected.map(s => ({ ...s, entity_group: 'SEGMENT' })),
    pred: predicted.map(s => ({ ...s, entity_group: 'SEGMENT' })),
  };
  const { matched, missed, spurious } = matchEntities(
    normalized.exp,
    normalized.pred,
    { overlapThreshold: 0.5, requireTypeMatch: false },
  );

  const exactMatches = matched.filter(
    m => m.predicted.start === m.expected.start && m.predicted.end === m.expected.end,
  );
  const partialMatches = matched.filter(
    m => m.predicted.start !== m.expected.start || m.predicted.end !== m.expected.end,
  );

  const tp = exactMatches.length;
  const tpPartial = partialMatches.length;
  const fp = spurious.length + partialMatches.length;
  const fn = missed.length + partialMatches.length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { tp, fp, fn, tpPartial, precision, recall, f1, matched, missed, spurious };
}
```

Note: `matchEntities` requires an `entity_group` field when `requireTypeMatch: false` — reviewing `matching.js`, it does not (the `entity_group` check is gated by `requireTypeMatch`). The normalized mapping above is belt-and-braces; safe even if internal behavior changes.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/eval/score.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Load expected segments and wire CLI output**

Still in `src/eval/score.js`, in `main()`, just after the `expectedFiles` line find the per-doc loop. Add expected-segments loading + predicted-segments loading + scoring inside the loop. The full per-doc loop should look like this (replace the existing one):

```js
  const allExpected = [];
  const allPredicted = [];
  const allExpectedSegments = [];
  const allPredictedSegments = [];
  const docScores = {};

  for (const expFile of expectedFiles.sort()) {
    const name = basename(expFile, '.expected.json');
    const expected = JSON.parse(await readFile(join(DOCS_DIR, expFile), 'utf-8'));

    let predicted;
    try {
      const raw = await readFile(join(runDir, name, 'entities.json'), 'utf-8');
      predicted = JSON.parse(raw);
    } catch {
      console.log(`  SKIP: ${name} — no results in this run`);
      continue;
    }

    let sourceText;
    try {
      sourceText = await readFile(join(DOCS_DIR, `${name}.txt`), 'utf-8');
      for (const e of predicted) {
        if (!e.text) e.text = sourceText.slice(e.start, e.end);
      }
    } catch {}

    const metrics = computeMetrics(expected, predicted, options);
    const byType = computeByType(expected, predicted, options);

    // Segmentation scoring — optional (skipped if no expected-segments file)
    let segmentMetrics = null;
    let expectedSegments = null;
    let predictedSegments = null;
    try {
      expectedSegments = JSON.parse(
        await readFile(join(DOCS_DIR, `${name}.expected-segments.json`), 'utf-8'),
      );
    } catch {}
    try {
      predictedSegments = JSON.parse(
        await readFile(join(runDir, name, 'segments.json'), 'utf-8'),
      );
    } catch {}
    if (expectedSegments && predictedSegments) {
      segmentMetrics = computeSegmentMetrics(expectedSegments, predictedSegments);
      allExpectedSegments.push(...expectedSegments);
      allPredictedSegments.push(...predictedSegments);
    }

    printDocScores(name, metrics, byType);
    if (segmentMetrics) printSegmentScores(name, segmentMetrics);

    docScores[name] = {
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      tp: metrics.tp,
      fp: metrics.fp,
      fn: metrics.fn,
      tpPartial: metrics.tpPartial,
      byType,
      ...(segmentMetrics && {
        segments: {
          precision: segmentMetrics.precision,
          recall: segmentMetrics.recall,
          f1: segmentMetrics.f1,
          tp: segmentMetrics.tp,
          fp: segmentMetrics.fp,
          fn: segmentMetrics.fn,
          tpPartial: segmentMetrics.tpPartial,
        },
      }),
    };

    allExpected.push(...expected);
    allPredicted.push(...predicted);
  }
```

- [ ] **Step 6: Add `printSegmentScores` helper**

In `src/eval/score.js`, just after `printDocScores`, add:

```js
function printSegmentScores(_name, m) {
  const partialNote = m.tpPartial ? `  (${m.tpPartial} partial → FP+FN)` : '';
  console.log(`\n  Segmentation:`);
  console.log(`    P: ${pct(m.precision)}  R: ${pct(m.recall)}  F1: ${pct(m.f1)}`);
  console.log(`    TP: ${m.tp}  FP: ${m.fp}  FN: ${m.fn}${partialNote}`);
}
```

(The `_name` is unused; left for symmetry with `printDocScores` in case we ever prefix the output.)

- [ ] **Step 7: Compute and print overall segment metrics; save to scores.json**

Still in `main()`, just after the existing overall-entities print block (just before the `scoresData` object is assembled), add:

```js
  const overallSegments = (allExpectedSegments.length > 0 || allPredictedSegments.length > 0)
    ? computeSegmentMetrics(allExpectedSegments, allPredictedSegments)
    : null;

  if (overallSegments) {
    console.log('\n=== OVERALL SEGMENTATION ===');
    console.log(`  Precision: ${pct(overallSegments.precision)}   Recall: ${pct(overallSegments.recall)}   F1: ${pct(overallSegments.f1)}`);
    const partialNote = overallSegments.tpPartial ? `  (${overallSegments.tpPartial} partial → FP+FN)` : '';
    console.log(`  TP: ${overallSegments.tp}  FP: ${overallSegments.fp}  FN: ${overallSegments.fn}${partialNote}`);
  }
```

Then update the `scoresData` assembly to include segment results. Find:

```js
  const scoresData = {
    runId,
    options,
    overall: { ... },
    documents: docScores,
  };
```

Add a conditional `overallSegments` field:

```js
  const scoresData = {
    runId,
    options,
    overall: {
      precision: overall.precision,
      recall: overall.recall,
      f1: overall.f1,
      tp: overall.tp,
      fp: overall.fp,
      fn: overall.fn,
      tpPartial: overall.tpPartial,
      byType: overallByType,
    },
    ...(overallSegments && {
      overallSegments: {
        precision: overallSegments.precision,
        recall: overallSegments.recall,
        f1: overallSegments.f1,
        tp: overallSegments.tp,
        fp: overallSegments.fp,
        fn: overallSegments.fn,
        tpPartial: overallSegments.tpPartial,
      },
    }),
    documents: docScores,
  };
```

- [ ] **Step 8: Run the full test suite to ensure no regressions**

```bash
npm test
```

Expected: all tests pass, including the 5 new `computeSegmentMetrics` tests.

- [ ] **Step 9: End-to-end check against the latest run**

```bash
npm run eval:score
```

Expected: existing per-doc and overall entity output unchanged; new "Segmentation:" block appears under each doc; "=== OVERALL SEGMENTATION ===" block appears at the bottom. Since the expected snapshot matches current pipeline output exactly, segmentation metrics should be ~100% (barring any whitespace/chunking oddity).

Inspect the saved file:
```bash
cat test-data/results/latest/scores.json | grep -A 10 overallSegments
```

Expected: block with precision/recall/f1 fields.

- [ ] **Step 10: Commit**

```bash
git add src/eval/score.js src/eval/score.test.js
git commit -m "feat(eval): score segmentation with P/R/F1 and partial-match semantics"
```

---

## Task 5: Segmentation section in HTML report

Add a per-doc collapsed `<details>` block with a shaded segmented-text view, boundary-mismatch carets, and a metrics table.

**Files:**
- Modify: `src/eval/report.js`
- Modify: `src/eval/report.test.js`

- [ ] **Step 1: Write failing smoke test for `buildSegmentationSection`**

Open `src/eval/report.test.js`. At the top, add `buildSegmentationSection` to the import list:

```js
import {
  buildAnnotatedText, classifyEntities, humanizeDocName,
  ENTITY_COLORS, buildLegend,
  buildComparisonTable, formatDelta,
  generateReport,
  buildSegmentationSection,
} from './report.js';
```

At the bottom of the file, add:

```js
describe('buildSegmentationSection', () => {
  const text = 'Alpha. Beta gamma. Delta epsilon.';
  // 0          7          19
  // Alpha. Beta gamma. Delta epsilon.

  it('renders an empty placeholder when no expected segments are available', () => {
    const html = buildSegmentationSection(text, null, [], null);
    expect(html).toContain('No expected-segments');
  });

  it('renders segment blocks and metrics when both are provided', () => {
    const expected = [
      { start: 0, end: 6, text: 'Alpha.' },
      { start: 7, end: 18, text: 'Beta gamma.' },
      { start: 19, end: 33, text: 'Delta epsilon.' },
    ];
    const predicted = [
      { start: 0, end: 6, text: 'Alpha.' },
      { start: 7, end: 18, text: 'Beta gamma.' },
      // third expected segment missed entirely
    ];
    const metrics = { precision: 1, recall: 2/3, f1: 0.8, tp: 2, fp: 0, fn: 1, tpPartial: 0 };
    const html = buildSegmentationSection(text, expected, predicted, metrics);
    expect(html).toContain('class="segment"');
    expect(html).toContain('boundary-marker missed'); // the missing third segment's boundary
    expect(html).toMatch(/F1.*?80\.0%/s);
  });

  it('renders orange caret for an extra predicted boundary', () => {
    const expected = [
      { start: 0, end: 33, text: 'Alpha. Beta gamma. Delta epsilon.' },
    ];
    const predicted = [
      { start: 0, end: 6, text: 'Alpha.' },
      { start: 7, end: 33, text: 'Beta gamma. Delta epsilon.' },
    ];
    const metrics = { precision: 0, recall: 0, f1: 0, tp: 0, fp: 2, fn: 1, tpPartial: 0 };
    const html = buildSegmentationSection(text, expected, predicted, metrics);
    expect(html).toContain('boundary-marker extra');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/eval/report.test.js
```

Expected: the 3 new tests fail ("buildSegmentationSection is not a function" / import error). Existing tests still pass.

- [ ] **Step 3: Implement `buildSegmentationSection` in `report.js`**

Open `src/eval/report.js`. Just after `buildScoringSection` (around line 793), add and export:

```js
export function buildSegmentationSection(sourceText, expected, predicted, metrics) {
  if (!expected) {
    return `<div class="section-title">Segmentation</div>
      <p style="font-size:0.85rem;color:#666">No <code>expected-segments.json</code> for this document — run <code>npm run eval:snapshot-segments</code> and review.</p>`;
  }

  const expectedStarts = new Set(expected.map(s => s.start));
  const expectedEnds = new Set(expected.map(s => s.end));
  const predictedStarts = new Set(predicted.map(s => s.start));
  const predictedEnds = new Set(predicted.map(s => s.end));

  const sortedExpected = [...expected].sort((a, b) => a.start - b.start);

  // Collect all boundary positions from both segmentations and classify each.
  // A position present in both sets is a correct boundary (not marked).
  const allBoundaries = new Set([
    ...expectedStarts, ...expectedEnds,
    ...predictedStarts, ...predictedEnds,
  ]);
  allBoundaries.delete(0);
  allBoundaries.delete(sourceText.length);

  const markers = [];
  for (const pos of allBoundaries) {
    const inExpected = expectedStarts.has(pos) || expectedEnds.has(pos);
    const inPredicted = predictedStarts.has(pos) || predictedEnds.has(pos);
    if (inExpected && inPredicted) continue;
    if (inExpected && !inPredicted) {
      markers.push({ pos, kind: 'missed', char: '▼' });
    } else {
      markers.push({ pos, kind: 'extra', char: '▲' });
    }
  }
  markers.sort((a, b) => a.pos - b.pos);

  const renderHtml = renderSegmentedText(sourceText, sortedExpected, markers);

  const m = metrics || { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0, tpPartial: 0 };
  const partialNote = m.tpPartial ? ` <small style="color:#E65100">(${m.tpPartial}p)</small>` : '';

  return `<div class="section-title">Segmentation</div>
    <div class="segmented-text">${renderHtml}</div>
    <table class="scoring-table segmentation-metrics">
      <thead><tr><th>P</th><th>R</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th><th>Partial</th></tr></thead>
      <tbody><tr>
        <td>${pct(m.precision)}</td>
        <td>${pct(m.recall)}</td>
        <td>${pct(m.f1)}</td>
        <td>${m.tp}</td>
        <td>${m.fp}${partialNote}</td>
        <td>${m.fn}${partialNote}</td>
        <td>${m.tpPartial}</td>
      </tr></tbody>
    </table>
    <p style="font-size:0.82rem;color:#666;margin-top:0.5rem">
      <span style="color:#c62828">▼</span> missed split &nbsp;
      <span style="color:#E65100">▲</span> extra split &nbsp;
      (exact matches are not marked)
    </p>`;
}

function renderSegmentedText(sourceText, sortedExpected, markers) {
  // Collect split points: every segment start/end and every marker pos.
  const points = new Set([0, sourceText.length]);
  for (const s of sortedExpected) { points.add(s.start); points.add(s.end); }
  for (const m of markers) { points.add(m.pos); }
  const sorted = [...points].sort((a, b) => a - b);

  let html = '';
  let segIdx = 0;
  const segAt = (pos) => sortedExpected.find(s => s.start <= pos && pos < s.end);
  const indexOfSeg = (seg) => sortedExpected.indexOf(seg);

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];

    // Marker at `from` (if any). Render before the text chunk.
    const markerHere = markers.find(m => m.pos === from);
    if (markerHere) {
      html += `<span class="boundary-marker ${markerHere.kind}" title="${markerHere.kind} boundary at char ${markerHere.pos}">${markerHere.char}</span>`;
    }

    const chunk = escapeHtml(sourceText.slice(from, to));
    const seg = segAt(from);
    if (seg) {
      const idx = indexOfSeg(seg);
      const shade = idx % 2 === 0 ? 'seg-a' : 'seg-b';
      html += `<span class="segment ${shade}" data-start="${seg.start}" data-end="${seg.end}">${chunk}</span>`;
    } else {
      html += chunk;
    }
  }
  // Final marker at last position, if any.
  const last = sorted[sorted.length - 1];
  const tailMarker = markers.find(m => m.pos === last);
  if (tailMarker) {
    html += `<span class="boundary-marker ${tailMarker.kind}" title="${tailMarker.kind} boundary at char ${tailMarker.pos}">${tailMarker.char}</span>`;
  }
  return html;
}
```

Note: `escapeHtml` and `pct` are already defined in `report.js` — reuse them.

- [ ] **Step 4: Add CSS rules for segmentation**

Still in `src/eval/report.js`, in `buildCss()`, add these rules just before the closing backtick of the template (before the closing `  `;`):

```css
    .segmented-text {
      white-space: pre-wrap;
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
      font-size: 0.85rem;
      line-height: 1.9;
      padding: 1rem;
      background: #fdfdfd;
      border: 1px solid #eee;
      border-radius: 4px;
      margin-bottom: 0.75rem;
      overflow-x: auto;
    }
    .segmented-text .segment.seg-a { background: rgba(0, 0, 0, 0.035); }
    .segmented-text .segment.seg-b { background: rgba(0, 0, 0, 0.075); }
    .segmented-text .boundary-marker {
      display: inline-block;
      font-weight: bold;
      font-size: 0.9em;
      vertical-align: middle;
      padding: 0 1px;
      cursor: help;
    }
    .segmented-text .boundary-marker.missed { color: #c62828; }
    .segmented-text .boundary-marker.extra { color: #E65100; }
    .segmentation-metrics { margin-top: 0.5rem; width: auto; }
    .segmentation-metrics th, .segmentation-metrics td { white-space: nowrap; }
```

- [ ] **Step 5: Wire `buildSegmentationSection` into `generateReport`**

In `generateReport` (in `src/eval/report.js`), find the per-doc loop and locate where `scoringHtml` is built. After `const scoringHtml = buildScoringSection(docScores);`, load the segment files and build the section. Replace the block:

```js
    // Classify entities
    const spans = classifyEntities(expected, predicted);
    const annotatedHtml = buildAnnotatedText(sourceText, spans);
    const legendHtml = buildLegend(spans);
    const scoringHtml = buildScoringSection(docScores);
```

with:

```js
    // Classify entities
    const spans = classifyEntities(expected, predicted);
    const annotatedHtml = buildAnnotatedText(sourceText, spans);
    const legendHtml = buildLegend(spans);
    const scoringHtml = buildScoringSection(docScores);

    // Load segments for segmentation view
    let expectedSegs = null;
    let predictedSegs = [];
    try {
      expectedSegs = JSON.parse(
        await readFile(join(DOCS_DIR, `${docName}.expected-segments.json`), 'utf-8'),
      );
    } catch {}
    try {
      predictedSegs = JSON.parse(
        await readFile(join(runDir, docName, 'segments.json'), 'utf-8'),
      );
    } catch {}
    const segmentationHtml = buildSegmentationSection(
      sourceText,
      expectedSegs,
      predictedSegs,
      docScores.segments ?? null,
    );
```

Then find the `docSections.push(...)` block and insert `${segmentationHtml}` between `${scoringHtml}` and `<div class="section-title">Comparison</div>`:

```js
    docSections.push(`
      <details data-doc="${docName}">
        <summary>${humanizeDocName(docName)} ${f1Badge(docScores.f1)}</summary>
        <div>
          <div class="section-title">Annotated Text</div>
          <div class="annotated-text">${annotatedHtml}</div>
          ${legendHtml}
          ${scoringHtml}
          ${segmentationHtml}
          <div class="section-title">Comparison</div>
          ${docComparisonHtml}
        </div>
      </details>
    `);
```

- [ ] **Step 6: Run tests to verify implementation passes**

```bash
npx vitest run src/eval/report.test.js
```

Expected: all existing tests pass, plus 3 new `buildSegmentationSection` tests.

- [ ] **Step 7: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: End-to-end visual check**

```bash
npm run eval:score
open test-data/results/latest/report.html
```

Expected: report opens; each per-doc block has a "Segmentation" subsection below "Scoring" with the shaded text view and the metrics table. With a pristine snapshot, no carets appear (perfect match). Click around a segment to confirm hover titles.

- [ ] **Step 9: Commit**

```bash
git add src/eval/report.js src/eval/report.test.js
git commit -m "feat(eval): segmentation section in HTML report"
```

---

## Task 6: End-to-end verification and polish

Run everything top to bottom, sanity-check outputs, tighten any rough edges.

**Files:**
- No new files expected. May touch the modified files above if issues surface.

- [ ] **Step 1: Clean-run the eval pipeline**

```bash
npm run eval -- --label=segmentation-e2e
npm run eval:score
```

Expected: eval runs, score prints entity + segmentation blocks, `scores.json` contains `overallSegments` and per-doc `segments`.

- [ ] **Step 2: Open the HTML report and spot-check**

```bash
open test-data/results/latest/report.html
```

Checklist (with the pristine-snapshot ground truth):
- [ ] Per-doc "Segmentation" section appears.
- [ ] Segmented text shows alternating shading.
- [ ] No carets visible (expected equals predicted).
- [ ] Metrics table shows P/R/F1 = 100% and TP = segment count.
- [ ] Collapsing/expanding the per-doc `<details>` still works.

- [ ] **Step 3: Deliberately perturb one expected file to verify carets**

Pick one doc, open its `.expected-segments.json`, shift one boundary by 2 chars (e.g., change an `"end": 120` to `"end": 118` and the next segment's `"start": 120` to `"start": 118`). Re-run scoring (no re-eval needed — expected files are read at score time):

```bash
npm run eval:score
```

Expected: for that doc, segmentation F1 < 100%; the report shows a red ▼ (missed boundary at original position 120) and an orange ▲ (extra boundary at 118) near that cut.

Revert the perturbation. Re-run scoring — metrics back to 100%.

- [ ] **Step 4: Confirm the snapshot script still refuses to overwrite**

```bash
npm run eval:snapshot-segments
```

Expected: 6 SKIP lines, 0 written.

- [ ] **Step 5: Run the full test suite one more time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Final commit for any polish changes**

If any fixes were made during verification:

```bash
git add -u
git commit -m "chore(eval): segmentation e2e polish"
```

If no changes are needed, skip this step — no empty commits.

---

## Post-plan: user review of ground truth

Task 3 deferred meaningful ground-truth review to the human. Once this plan is complete and Tasks 4–5 are in place, the user now has the segmentation view as a review aid and can correct the snapshotted `.expected-segments.json` files by hand. Each correction is a normal git commit against those files; no code changes needed for the correction itself to take effect — scoring reads them live.
