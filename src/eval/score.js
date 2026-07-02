import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { matchEntities } from './matching.js';
import { generateReport } from './report.js';
import { allEntityTypes } from '../pipeline/configs/entity-sources.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const DOCS_DIR = join(TEST_DATA_DIR, 'synthetic');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

// ── Subset filtering ────────────────────────────────────────────────

export function filterByTypes(entities, enabledSet) {
  return entities.filter(e => enabledSet.has(e.entity_group));
}

// Resolves the effective scoring filter from a run's enabledEntities and an
// optional --entities override. Override must be a (non-strict) subset of the
// run's enabledEntities — you can't score for types the pipeline never tried
// to detect. Returns a Set of entity_group names.
export function resolveScoringFilter({ runEnabledEntities, overrideEntities }) {
  const runEnabled = runEnabledEntities && runEnabledEntities.length > 0
    ? runEnabledEntities
    : allEntityTypes();
  const runSet = new Set(runEnabled);

  if (!overrideEntities || overrideEntities.length === 0) return runSet;

  const unknown = overrideEntities.filter(e => !runSet.has(e));
  if (unknown.length > 0) {
    throw new Error(
      `Cannot score for types not in run's enabledEntities: ${unknown.join(', ')}. ` +
      `Run scored: ${[...runSet].sort().join(', ')}`,
    );
  }
  return new Set(overrideEntities);
}

// ── Metrics ─────────────────────────────────────────────────────────

function computeMetrics(expected, predicted, options) {
  const { matched, missed, spurious, typeMismatched } = matchEntities(expected, predicted, options);

  // Strict scoring: only exact boundary matches count as TP
  const exactMatches = matched.filter(m => m.predicted.start === m.expected.start && m.predicted.end === m.expected.end);
  const partialMatches = matched.filter(m => m.predicted.start !== m.expected.start || m.predicted.end !== m.expected.end);

  const tp = exactMatches.length;
  const tpPartial = partialMatches.length;
  // Partial matches count as both FP (wrong boundary) and FN (not fully found)
  const fp = spurious.length + typeMismatched.length + partialMatches.length;
  const fn = missed.length + typeMismatched.length + partialMatches.length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { tp, fp, fn, tpPartial, precision, recall, f1, matched, missed, spurious, typeMismatched };
}

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

function computeByType(expected, predicted, options) {
  const types = new Set([...expected.map(e => e.entity_group), ...predicted.map(e => e.entity_group)]);
  const byType = {};

  for (const type of [...types].sort()) {
    const expOfType = expected.filter(e => e.entity_group === type);
    const predOfType = predicted.filter(e => e.entity_group === type);
    const { tp, fp, fn, tpPartial, precision, recall, f1 } = computeMetrics(expOfType, predOfType, options);
    byType[type] = { tp, fp, fn, tpPartial, precision, recall, f1 };
  }

  return byType;
}

function metricsFromCounts({ tp = 0, fp = 0, fn = 0, tpPartial = 0 }) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return { tp, fp, fn, tpPartial, precision, recall, f1 };
}

function sumMetrics(metrics) {
  return metricsFromCounts(metrics.reduce(
    (total, metric) => ({
      tp: total.tp + (metric?.tp ?? 0),
      fp: total.fp + (metric?.fp ?? 0),
      fn: total.fn + (metric?.fn ?? 0),
      tpPartial: total.tpPartial + (metric?.tpPartial ?? 0),
    }),
    { tp: 0, fp: 0, fn: 0, tpPartial: 0 },
  ));
}

function sumByType(byTypeEntries) {
  const totals = {};
  for (const byType of byTypeEntries) {
    for (const [type, metric] of Object.entries(byType)) {
      totals[type] ??= { tp: 0, fp: 0, fn: 0, tpPartial: 0 };
      totals[type].tp += metric.tp;
      totals[type].fp += metric.fp;
      totals[type].fn += metric.fn;
      totals[type].tpPartial += metric.tpPartial;
    }
  }
  return Object.fromEntries(
    Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, counts]) => [type, metricsFromCounts(counts)]),
  );
}

export function computeOverallFromDocuments(documents, options = { overlapThreshold: 0.5, requireTypeMatch: true }) {
  const entityMetrics = [];
  const byTypeEntries = [];
  const segmentMetrics = [];

  for (const doc of documents) {
    const expected = doc.expected ?? [];
    const predicted = doc.predicted ?? [];
    const metrics = doc.metrics ?? computeMetrics(expected, predicted, options);
    entityMetrics.push(metrics);
    byTypeEntries.push(doc.byType ?? computeByType(expected, predicted, options));

    if (doc.segmentMetrics) {
      segmentMetrics.push(doc.segmentMetrics);
    } else if (doc.expectedSegments || doc.predictedSegments) {
      segmentMetrics.push(computeSegmentMetrics(doc.expectedSegments ?? [], doc.predictedSegments ?? []));
    }
  }

  return {
    overall: sumMetrics(entityMetrics),
    overallByType: sumByType(byTypeEntries),
    overallSegments: segmentMetrics.length > 0 ? sumMetrics(segmentMetrics) : null,
  };
}

// ── Formatting ──────────────────────────────────────────────────────

function pct(v) { return (v * 100).toFixed(1).padStart(5) + '%'; }
function pad(s, n) { return s.padEnd(n); }

function printDocScores(name, metrics, byType) {
  console.log(`\n--- ${name} ---`);
  console.log(`  Precision: ${pct(metrics.precision)}   Recall: ${pct(metrics.recall)}   F1: ${pct(metrics.f1)}`);
  console.log(`  TP: ${metrics.tp}  FP: ${metrics.fp}  FN: ${metrics.fn}`);

  if (metrics.missed.length > 0) {
    console.log(`\n  Missed (FN):`);
    for (const e of metrics.missed) {
      console.log(`    ${pad(e.entity_group, 28)} "${e.text}"`);
    }
  }

  if (metrics.spurious.length > 0) {
    console.log(`\n  Spurious (FP):`);
    for (const e of metrics.spurious) {
      const text = e.text || `[${e.start}:${e.end}]`;
      console.log(`    ${pad(e.entity_group, 28)} "${text}"`);
    }
  }

  if (metrics.typeMismatched.length > 0) {
    console.log(`\n  Type mismatches (${metrics.typeMismatched.length}):`);
    for (const m of metrics.typeMismatched) {
      const text = m.predicted.text || m.expected.text || `[${m.predicted.start}:${m.predicted.end}]`;
      console.log(`    "${text}"  predicted: ${pad(m.predicted.entity_group, 28)} expected: ${m.expected.entity_group}`);
    }
  }

  console.log(`\n  Per type:`);
  console.log(`    ${pad('TYPE', 28)} ${' P'.padStart(6)} ${' R'.padStart(6)} ${'F1'.padStart(6)}  TP  FP  FN`);
  for (const [type, m] of Object.entries(byType)) {
    console.log(`    ${pad(type, 28)} ${pct(m.precision)} ${pct(m.recall)} ${pct(m.f1)}  ${String(m.tp).padStart(2)}  ${String(m.fp).padStart(2)}  ${String(m.fn).padStart(2)}`);
  }
}

function printSegmentScores(_name, m) {
  const partialNote = m.tpPartial ? `  (${m.tpPartial} partial → FP+FN)` : '';
  console.log(`\n  Segmentation:`);
  console.log(`    P: ${pct(m.precision)}  R: ${pct(m.recall)}  F1: ${pct(m.f1)}`);
  console.log(`    TP: ${m.tp}  FP: ${m.fp}  FN: ${m.fn}${partialNote}`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse positional run id (first non-flag arg), default to "latest"
  const positional = args.filter(a => !a.startsWith('--'));
  let runId = positional[0] || 'latest';
  if (runId === 'latest') {
    const { readlink } = await import('node:fs/promises');
    runId = await readlink(join(RESULTS_DIR, 'latest'));
  }

  // Optional --entities override (must be subset of run's enabledEntities)
  const entitiesArg = args.find(a => a.startsWith('--entities='))?.slice('--entities='.length);
  const overrideEntities = entitiesArg
    ? entitiesArg.split(',').map(s => s.trim()).filter(Boolean)
    : null;

  const runDir = join(RESULTS_DIR, runId);
  console.log(`Scoring run: ${runId}`);

  // Load summary for enabledEntities (fall back to "all" for older runs)
  let runEnabledEntities;
  try {
    const summaryRaw = await readFile(join(runDir, 'summary.json'), 'utf-8');
    const summary = JSON.parse(summaryRaw);
    runEnabledEntities = summary.enabledEntities;
  } catch {}

  let filterSet;
  try {
    filterSet = resolveScoringFilter({ runEnabledEntities, overrideEntities });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const allTypes = allEntityTypes();
  const isFullSet = filterSet.size === allTypes.length;
  const enabledList = [...filterSet].sort();
  if (!isFullSet) {
    console.log(`Filter: ${enabledList.length} of ${allTypes.length} types — ${enabledList.join(', ')}`);
  }
  console.log('');

  // Find expected files
  const entries = await readdir(DOCS_DIR);
  const expectedFiles = entries.filter(f => f.endsWith('.expected.json'));

  if (expectedFiles.length === 0) {
    console.log('No .expected.json files found in test-data/synthetic/. Create ground truth first.');
    process.exit(1);
  }

  const options = { overlapThreshold: 0.5, requireTypeMatch: true };
  const docAggregates = [];
  const docScores = {};
  let totalDroppedExpected = 0;

  for (const expFile of expectedFiles.sort()) {
    const name = basename(expFile, '.expected.json');
    const expectedRaw = JSON.parse(await readFile(join(DOCS_DIR, expFile), 'utf-8'));

    let predictedRaw;
    try {
      const raw = await readFile(join(runDir, name, 'entities.json'), 'utf-8');
      predictedRaw = JSON.parse(raw);
    } catch {
      console.log(`  SKIP: ${name} — no results in this run`);
      continue;
    }

    // Add text to predicted for nicer output
    let sourceText;
    try {
      sourceText = await readFile(join(DOCS_DIR, `${name}.txt`), 'utf-8');
      for (const e of predictedRaw) {
        if (!e.text) e.text = sourceText.slice(e.start, e.end);
      }
    } catch {}

    // Apply the filter: drop expected entities of types not in the filter set,
    // and (defensively) predicted entities of unscored types in case anyone
    // hand-edited entities.json. Predicted should already be subset-filtered
    // at run time via sourceFilterStep.
    const expected = isFullSet ? expectedRaw : filterByTypes(expectedRaw, filterSet);
    const predicted = isFullSet ? predictedRaw : filterByTypes(predictedRaw, filterSet);

    if (!isFullSet) {
      totalDroppedExpected += expectedRaw.length - expected.length;
    }

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

    docAggregates.push({
      expected,
      predicted,
      metrics,
      byType,
      ...(segmentMetrics && { expectedSegments, predictedSegments, segmentMetrics }),
    });
  }

  // Overall (micro-averaged): sum per-document counts so offset collisions in
  // different documents cannot fabricate matches.
  const { overall, overallByType, overallSegments } = computeOverallFromDocuments(docAggregates, options);

  console.log('\n=== OVERALL (micro-averaged, strict exact matching) ===');
  if (!isFullSet) {
    console.log(`  Scoring ${enabledList.length} of ${allTypes.length} types — dropped ${totalDroppedExpected} expected entities of unscored types`);
  }
  console.log(`  Precision: ${pct(overall.precision)}   Recall: ${pct(overall.recall)}   F1: ${pct(overall.f1)}`);
  console.log(`  TP: ${overall.tp}  FP: ${overall.fp}  FN: ${overall.fn}  (${overall.tpPartial} partial → counted as FP+FN)`);

  console.log(`\n  Per type:`);
  console.log(`    ${pad('TYPE', 34)} ${' P'.padStart(6)} ${' R'.padStart(6)} ${'F1'.padStart(6)}  TP  FP  FN`);
  for (const [type, m] of Object.entries(overallByType)) {
    console.log(`    ${pad(type, 34)} ${pct(m.precision)} ${pct(m.recall)} ${pct(m.f1)}  ${String(m.tp).padStart(2)}  ${String(m.fp).padStart(2)}  ${String(m.fn).padStart(2)}`);
  }

  if (overallSegments) {
    console.log('\n=== OVERALL SEGMENTATION ===');
    console.log(`  Precision: ${pct(overallSegments.precision)}   Recall: ${pct(overallSegments.recall)}   F1: ${pct(overallSegments.f1)}`);
    const partialNote = overallSegments.tpPartial ? `  (${overallSegments.tpPartial} partial → FP+FN)` : '';
    console.log(`  TP: ${overallSegments.tp}  FP: ${overallSegments.fp}  FN: ${overallSegments.fn}${partialNote}`);
  }

  // Save scores to run directory
  const scoresData = {
    runId,
    options,
    enabledEntities: enabledList,
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

  await writeFile(join(runDir, 'scores.json'), JSON.stringify(scoresData, null, 2), 'utf-8');
  console.log(`\nScores saved: ${join(runDir, 'scores.json')}`);

  // Generate HTML report
  const reportPath = await generateReport(runId, scoresData);
  console.log(`Report saved: ${reportPath}`);
}

main().catch((err) => {
  console.error('Scoring failed:', err);
  process.exit(1);
});
