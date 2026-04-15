import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { matchEntities } from './matching.js';
import { generateReport } from './report.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

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

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Resolve which run to score
  let runId = args[0] || 'latest';
  if (runId === 'latest') {
    const { readlink } = await import('node:fs/promises');
    runId = await readlink(join(RESULTS_DIR, 'latest'));
  }

  const runDir = join(RESULTS_DIR, runId);
  console.log(`Scoring run: ${runId}\n`);

  // Find expected files
  const entries = await readdir(TEST_DATA_DIR);
  const expectedFiles = entries.filter(f => f.endsWith('.expected.json'));

  if (expectedFiles.length === 0) {
    console.log('No .expected.json files found in test-data/. Create ground truth first.');
    process.exit(1);
  }

  const options = { overlapThreshold: 0.5, requireTypeMatch: true };
  const allExpected = [];
  const allPredicted = [];
  const docScores = {};

  for (const expFile of expectedFiles.sort()) {
    const name = basename(expFile, '.expected.json');
    const expected = JSON.parse(await readFile(join(TEST_DATA_DIR, expFile), 'utf-8'));

    let predicted;
    try {
      const raw = await readFile(join(runDir, name, 'entities.json'), 'utf-8');
      predicted = JSON.parse(raw);
    } catch {
      console.log(`  SKIP: ${name} — no results in this run`);
      continue;
    }

    // Add text to predicted for nicer output
    let sourceText;
    try {
      sourceText = await readFile(join(TEST_DATA_DIR, `${name}.txt`), 'utf-8');
      for (const e of predicted) {
        if (!e.text) e.text = sourceText.slice(e.start, e.end);
      }
    } catch {}

    const metrics = computeMetrics(expected, predicted, options);
    const byType = computeByType(expected, predicted, options);

    printDocScores(name, metrics, byType);

    docScores[name] = {
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      tp: metrics.tp,
      fp: metrics.fp,
      fn: metrics.fn,
      tpPartial: metrics.tpPartial,
      byType,
    };

    allExpected.push(...expected);
    allPredicted.push(...predicted);
  }

  // Overall (micro-averaged)
  const overall = computeMetrics(allExpected, allPredicted, options);
  const overallByType = computeByType(allExpected, allPredicted, options);

  console.log('\n=== OVERALL (micro-averaged, strict exact matching) ===');
  console.log(`  Precision: ${pct(overall.precision)}   Recall: ${pct(overall.recall)}   F1: ${pct(overall.f1)}`);
  console.log(`  TP: ${overall.tp}  FP: ${overall.fp}  FN: ${overall.fn}  (${overall.tpPartial} partial → counted as FP+FN)`);

  console.log(`\n  Per type:`);
  console.log(`    ${pad('TYPE', 34)} ${' P'.padStart(6)} ${' R'.padStart(6)} ${'F1'.padStart(6)}  TP  FP  FN`);
  for (const [type, m] of Object.entries(overallByType)) {
    console.log(`    ${pad(type, 34)} ${pct(m.precision)} ${pct(m.recall)} ${pct(m.f1)}  ${String(m.tp).padStart(2)}  ${String(m.fp).padStart(2)}  ${String(m.fn).padStart(2)}`);
  }

  // Save scores to run directory
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
