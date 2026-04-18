# Segmentation evaluation — design

**Date:** 2026-04-18
**Status:** Draft, pending user approval

## Goal

Make segmentation a first-class part of the PII eval framework. Persist the
predicted segments produced by each run, persist ground-truth expected segments
per test document, score them with P/R/F1 (using the same partial-match
accounting as entity scoring), and visualize the result in the HTML report so
segmentation regressions are visible at a glance.

Motivation: segmentation is the first transformation applied to the input text
and shapes what every downstream step sees (NER, regex, snap, merge, backfill).
Bad segmentation silently poisons downstream metrics, and we currently have no
way to detect that.

## Non-goals

- Changing the segmentation algorithm itself (sentencex + abbreviation merge +
  long-sentence chunking stays as-is).
- Changing entity scoring or any other existing pipeline behavior.
- Adding cross-run segmentation comparison tables. Scope for a follow-up once
  the single-run view is proven useful.
- Automating ground-truth generation beyond an initial snapshot. Ground truth
  is maintained by human review and manual JSON edits.

## Data artifacts

### Expected (ground truth) — one per test document

Path: `test-data/synthetic/<doc>.expected-segments.json`

Format:

```json
[
  { "start": 0,   "end": 89,  "text": "…" },
  { "start": 90,  "end": 245, "text": "…" }
]
```

- Sorted by `start`.
- `text` is the exact substring `sourceText.slice(start, end)`. Redundant with
  `start`/`end`, kept so the file is human-reviewable and editable. A sanity
  check during scoring can warn if `text` disagrees with the slice (wrong
  ground truth), but scoring itself uses `start`/`end`.
- Covers every segment the pipeline is expected to produce, including:
  sentencex sentence splits, abbreviation merges, and long-sentence chunks
  (the deterministic 900-char split).
- Segments do **not** need to tile the text. Whitespace-only regions between
  sentencex sentences are simply covered by no segment. Scoring treats them as
  absence of a segment, not a missing one.

### Predicted — one per document per run

Path: `test-data/results/{runId}/{doc}/segments.json`

Same format as the expected file. Produced by `src/eval/run.js` by serializing
`ctx.segments` after the pipeline finishes:

```js
ctx.segments.map(s => ({
  start: s.offset,
  end: s.offset + s.text.length,
  text: s.text,
}))
```

No pipeline change is required; `ctx.segments` already holds the final segment
list. If a later pipeline step ever mutates `segments`, switch to reading from
the segment phase's `debug` diff.

## Scoring

### Matching

Reuse `src/eval/matching.js:matchEntities` with
`{ requireTypeMatch: false, overlapThreshold: 0.5 }`. This returns the same
`{ matched, missed, spurious, typeMismatched }` shape; `typeMismatched` will
always be empty because we disable type matching.

### Classification

For each entry returned by the matcher:

- `matched` with identical `start` and `end` → **exact** (TP).
- `matched` with different `start` or `end` → **partial** (boundary shift);
  counted as both FP and FN, and tracked as `tpPartial` for visibility.
- `missed` → FN, semantic label "missed split" (expected segment not produced).
- `spurious` → FP, semantic label "extra split" (predicted segment without
  expected counterpart).

This mirrors the existing entity scoring logic in `src/eval/score.js`
(`computeMetrics`) line-for-line. The only difference is the match options.

### Metrics

```
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2PR / (P + R)
```

Per doc and micro-averaged across all docs. Stored in `scores.json`:

```json
{
  "overall": {            // existing entity metrics, unchanged
    "precision": …, "recall": …, "f1": …,
    "tp": …, "fp": …, "fn": …, "tpPartial": …,
    "byType": { … }
  },
  "overallSegments": {    // new
    "precision": …, "recall": …, "f1": …,
    "tp": …, "fp": …, "fn": …, "tpPartial": …
  },
  "documents": {
    "pismo_01_…": {
      // existing entity fields
      "precision": …, …, "byType": { … },
      // new
      "segments": {
        "precision": …, "recall": …, "f1": …,
        "tp": …, "fp": …, "fn": …, "tpPartial": …
      }
    }
  }
}
```

Documents without an `.expected-segments.json` file are skipped for
segmentation scoring (logged once in CLI output, omitted from
`overallSegments` totals, no `segments` key in `documents.<doc>`).

### CLI output

`score.js` prints a "Segmentation" block after the existing entity block,
per-doc and overall:

```
--- pismo_01_wezwanie_do_zaplaty ---
  Entities: …

  Segmentation:
    P: 95.2%   R: 91.0%   F1: 93.1%
    TP: 38  FP: 2  FN: 4  (1 partial → FP+FN)
```

## Report visualization

New per-document `<details>` block titled "Segmentation", collapsed by default,
inserted after the entity annotated text and before the comparison section.

### Parts

1. **Segmented text view.** The source text rendered with each *expected*
   segment wrapped in a `<span class="segment">` element. Alternating
   background shades (two pale grays) so adjacent segments are visually
   distinct. Overlaid carets at positions where expected and predicted
   boundaries disagree:

   - Missed split (expected boundary, no predicted boundary near it): red
     `▼` caret positioned at the expected cut; hover title "missed split —
     expected boundary at char N".
   - Extra split (predicted boundary, no expected boundary near it): orange
     `▲` caret; hover title "extra split — predicted boundary at char N".
   - Shifted boundary (matched but not exact): red caret at expected position,
     orange caret at predicted position; a thin connector line between them
     (CSS `::before` on the later caret) so the shift is visible.

   Exact-match boundaries are not marked at all — silent success keeps the
   view readable.

2. **Metrics row.** A single-row summary `P / R / F1 / TP / FP / FN / partial`
   in the same visual style as the entity scoring table (reuse
   `.scoring-table` CSS).

### Implementation

- New function `buildSegmentationSection(sourceText, expected, predicted,
  metrics)` in `src/eval/report.js`, returning an HTML fragment.
- CSS additions in `buildCss()`:
  - `.segment:nth-child(odd) { background: #f5f5f5; }`
  - `.segment:nth-child(even) { background: #fafafa; }`
  - `.boundary-marker.missed { color: #c62828; }`
  - `.boundary-marker.extra { color: #E65100; }`
  - `.boundary-marker.shifted { position: relative; }` with a `::before`
    connector.
- Wire into `docSections` between the existing "Annotated Text" block and the
  comparison block.

### Not in v1

- No segmentation metrics in the cross-run comparison table. If a segmentation
  regression matters enough to track across runs, we'll add it as a
  follow-up — the single-run view is the v1 goal.
- No separate page or dashboard for segmentation.
- No inline editing of expected segments from the report. Ground truth is
  edited by hand in the JSON files.

## Bootstrap workflow

Initial ground truth is created via snapshot, then reviewed by the user.

### Snapshot script

New: `scripts/snapshot-segments.js`.

- Iterates every `*.txt` in `test-data/synthetic/`.
- For each: runs the `preprocess` and `segment` phases only (no NER, no
  postprocess) by constructing a pipeline that stops after `segment` or by
  calling the segment steps directly with a trivial context.
- Writes `<doc>.expected-segments.json` **only if it does not already exist**
  (never overwrites user review edits).
- Prints per-doc segment counts so the user knows the review load up front.

Run with: `node scripts/snapshot-segments.js`. No model loading needed; this
is fast.

### Review step

After the snapshot exists, the user opens the generated JSON files and
reviews each segment. Corrections are manual JSON edits (adjust `start`/`end`,
split a segment into two, merge two into one, fix the `text` field if
boundaries change). The eval report can be used as a review aid: run
`npm run eval && npm run eval:score` to render the segmentation view before
scoring is meaningful — the metrics will be close to 100% at first (expected
was just snapshotted) and will diverge as the user corrects the expected
file.

Once the user is satisfied, the `.expected-segments.json` files are
committed to the repo. Scoring from that point on reflects divergence from
reviewed ground truth.

## Code surface

| File | Change |
|---|---|
| `src/pipeline/steps/segment-sentencex.js` | Unchanged. |
| `src/eval/run.js` | Write `segments.json` per doc. Add segment count to summary. |
| `src/eval/score.js` | New `computeSegmentMetrics`; load expected segments; add per-doc + overall segmentation metrics; CLI block; save to `scores.json`. |
| `src/eval/matching.js` | Possibly a thin `matchSegments` helper; or just call `matchEntities` with `requireTypeMatch: false` inline from `score.js`. |
| `src/eval/report.js` | New `buildSegmentationSection`; CSS additions; wire into per-doc section. |
| `scripts/snapshot-segments.js` | New. One-shot ground-truth bootstrap. |
| `test-data/synthetic/*.expected-segments.json` | New. Created by snapshot, reviewed by user, committed. |

## Testing

- Unit tests in `src/eval/score.test.js` (add if missing) for
  `computeSegmentMetrics`:
  - identical expected/predicted → P=R=F1=1.0, no partials;
  - all expected missing from predicted → R=0;
  - extra predicted segments → P<1;
  - shifted boundary → one partial, counted as FP+FN.
- Smoke test for `buildSegmentationSection`: given a doc with mixed
  matched/shifted/missing segments, it returns non-empty HTML without
  throwing.
- Manual: run `npm run eval && npm run eval:score`, open the report, verify
  the segmentation section renders and the carets land where expected.

## Risks & open points

- **Ground-truth quality.** Metrics are only as good as the reviewed JSON
  files. Mitigation: the report flags docs lacking an expected file; the
  review step is explicit in this design and gates meaningful scoring.
- **Visual density.** A doc with 60+ segments may produce a busy shaded
  view. Accepted for v1; add a toggle or condensed mode if it turns out to
  be unreadable in practice.
- **Chunked-sentence noise.** `MAX_CHUNK_CHARS=900` chunking is
  deterministic given input. If no test doc has a sentence over 900 chars,
  no chunking happens and this is invisible. If chunking changes or
  `MAX_CHUNK_CHARS` is tuned, the metrics will catch it — desired behavior.
- **Gaps between sentences.** Sentencex can leave whitespace between
  sentences uncovered by any segment. Scoring compares `(start, end)`
  spans, not inter-segment gaps, so whitespace gaps have no effect.
