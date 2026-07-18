// A7 (EVAL-RECALL-AUDIT.md §8): measures precision/recall sensitivity to the
// per-type confidence threshold, on both corpora, for the weight>=3 types
// the audit flagged as calibrated for precision instead of professional
// secrecy (§7.1). Reads NER output cached by cache-ner-for-thresholds.mjs
// (the expensive part — model load + inference — split into its own
// process per corpus to avoid onnxruntime-node's "bad allocation" from
// cycling too many sessions in one process lifetime) and replays
// postprocess — cheap, pure JS — once per candidate threshold via
// createThresholdStep's override seam (src/pipeline/steps/threshold.js).
//
// Usage:
//   node scripts/cache-ner-for-thresholds.mjs --dir=test-data/synthetic --out=synthetic
//   node scripts/cache-ner-for-thresholds.mjs --dir=test-data/adversarial --out=adversarial
//   node scripts/measure-thresholds.mjs [--types=A,B] [--thresholds=0.3,0.4,...]
//
// Writes test-data/results/threshold-sweep.json (gitignored, like eval
// runs); the reproduction command is the artifact, not the data
// (EVAL-RECALL-AUDIT §10 convention).
//
// MF-2 (MASK-FLOOR-DESIGN.md §3): a second CLI mode reusing the SAME cache,
// added rather than a new script — sweeps MASK_FLOOR (§2) instead of a
// per-type threshold, in tiered mode (allMask:false):
//   node scripts/measure-thresholds.mjs --floor [--floors=off,0.45,0.40,0.35,0.30] [--min-weight=4]
// Writes test-data/results/mask-floor-sweep.json (gitignored, same
// discipline). Metric is leak recovery / character coverage (§3.1 pt 3,
// §0 pt 3 — NOT strict P/R): a candidate below strict-match quality can
// still close a full leak. See sweepMaskFloor/scoreHistogram below.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostprocessSteps } from '../src/pipeline/configs/default.js';
import { createThresholdStep } from '../src/pipeline/steps/threshold.js';
import { allEntityTypes } from '../src/pipeline/configs/entity-sources.js';
import { matchEntities } from '../src/eval/matching.js';
// MF-2 (MASK-FLOOR-DESIGN.md §3): charCoverage is EVAL-RECALL-AUDIT part C's
// character-coverage primitive (analyze.js), already reused by
// score-tiers.js — the mask-floor sweep reuses it too rather than
// reimplementing span-union math a third time.
import { charCoverage } from '../src/eval/analyze.js';
import { tierFor } from '../src/pipeline/configs/type-tiers.js';
import { weightFor } from '../src/pipeline/configs/type-weights.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const RESULTS_DIR = join(REPO_ROOT, 'test-data/results');
const CACHE_DIR = join(RESULTS_DIR, 'threshold-ner-cache');

const DEFAULT_TYPES = ['PERSON_IDENTIFIER', 'VEHICLE_IDENTIFIER', 'LOCATION', 'PERSON_ROLE_OR_TITLE', 'DEVICE_IDENTIFIER'];
const DEFAULT_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const CORPORA = ['synthetic', 'adversarial'];

function parseListArg(name, fallback, transform = (x) => x) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3).split(',').map((s) => transform(s.trim()));
}

export function metricsForType(expected, predicted, type) {
  const exp = expected.filter((e) => e.entity_group === type);
  const pred = predicted.filter((e) => e.entity_group === type);
  const { matched, missed, spurious } = matchEntities(exp, pred, { overlapThreshold: 0.5, requireTypeMatch: true });
  const exact = matched.filter((m) => m.predicted.start === m.expected.start && m.predicted.end === m.expected.end);
  const partial = matched.length - exact.length;
  return { tp: exact.length, fp: spurious.length + partial, fn: missed.length + partial };
}

function addCounts(a, b) {
  return { tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn };
}

function withRates(c) {
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : null;
  return { ...c, precision, recall };
}

async function loadCache() {
  const cache = {};
  for (const corpus of CORPORA) {
    const path = join(CACHE_DIR, `${corpus}.json`);
    try {
      cache[corpus] = JSON.parse(await readFile(path, 'utf-8'));
    } catch (err) {
      console.error(`Missing cache for ${corpus} (${path}). Run:`);
      console.error(`  node scripts/cache-ner-for-thresholds.mjs --dir=test-data/${corpus === 'adversarial' ? 'adversarial' : 'synthetic'} --out=${corpus}`);
      throw err;
    }
  }
  return cache;
}

export async function sweep(cache, enabledEntities, types, thresholds) {
  const results = {};
  for (const type of types) {
    results[type] = [];
    for (const threshold of thresholds) {
      const postSteps = createPostprocessSteps({
        enabledEntities,
        thresholdOverrides: { [type]: threshold },
      })[0].steps;

      const row = { threshold };
      for (const corpus of CORPORA) {
        let totals = { tp: 0, fp: 0, fn: 0 };
        for (const doc of cache[corpus]) {
          let ctx = { ...doc.nerCtx, anonymized: '', legend: {}, debug: [] };
          for (const step of postSteps) ctx = await step(ctx);
          totals = addCounts(totals, metricsForType(doc.expected, ctx.entities, type));
        }
        row[corpus] = withRates(totals);
      }
      results[type].push(row);
    }
  }
  return results;
}

function fmtRate(r) {
  return r == null ? '  — ' : `${(r * 100).toFixed(0)}%`.padStart(4);
}

function printTable(results) {
  for (const [type, rows] of Object.entries(results)) {
    console.log(`\n=== ${type} ===`);
    console.log('thr  | synth P    R   tp/fp/fn        | adv P     R   tp/fp/fn');
    for (const row of rows) {
      const s = row.synthetic;
      const a = row.adversarial;
      console.log(
        `${row.threshold.toFixed(1)}  | ${fmtRate(s.precision)} ${fmtRate(s.recall)} ${String(s.tp).padStart(2)}/${String(s.fp).padStart(2)}/${String(s.fn).padStart(2)}        | ` +
        `${fmtRate(a.precision)} ${fmtRate(a.recall)} ${String(a.tp).padStart(2)}/${String(a.fp).padStart(2)}/${String(a.fn).padStart(2)}`,
      );
    }
  }
}

// ── MF-2 (MASK-FLOOR-DESIGN.md §3): mask-floor sweep ───────────────────
//
// O-MF-1's grid, 'off' spelled null (entity-rules.js's own "disabled"
// value) rather than a magic string, so buildFloorPostSteps/
// createThresholdStep never need a second "is this off" convention.
export const MASK_FLOOR_GRID = [null, 0.45, 0.40, 0.35, 0.30];

function entityKey(e) {
  return `${e.entity_group}:${e.start}:${e.end}`;
}

// Threshold-only view of one floor value — deliberately bypasses dedup/
// merge/backfill/snap. "Which raw candidates does lowering the gate let
// through" (A8's framing, entity-rules.js:36-40 comment) is a property of
// the threshold step alone; running the full chain here would make the
// answer depend on dedup arbitration between the rescued low-score
// candidate and whatever wins its overlap, which is a real effect but a
// DIFFERENT question (see leakRecovery below, which asks exactly that
// question through the real chain). Reuses createThresholdStep itself
// (not a re-derivation of its math) so this tool and the shipped mechanism
// can never silently drift apart.
function passesFloor(candidates, floor) {
  const step = createThresholdStep({}, { allMask: false }, floor);
  return step({ text: '', segments: [], entities: candidates, anonymized: '', legend: {} }).entities;
}

// Raw candidates the floor ALONE lets through: present after `floor`,
// absent after the real baseline (floor=null, i.e. today's shipped
// threshold). Empty for floor=null by construction (self-consistency).
export function rescuedByFloor(rawCandidates, floor) {
  if (floor === null) return [];
  const offKeys = new Set(passesFloor(rawCandidates, null).map(entityKey));
  return passesFloor(rawCandidates, floor).filter((e) => !offKeys.has(entityKey(e)));
}

export function isDroppedToday(candidate) {
  return passesFloor([candidate], null).length === 0;
}

// One rescued (or any) candidate's relationship to ground truth, judged
// against `referenceEntities` — normally the REAL baseline's final,
// fully-postprocessed output (what the product shows today) — via
// charCoverage (src/eval/analyze.js, reused):
//   'no-coverage'   — doesn't overlap any GT span of its type at all (a
//                      clean FP the floor would introduce).
//   'fragment'      — overlaps a GT span the baseline ALREADY covers some
//                      other way (A8's class: redundant, not a fresh leak
//                      closed).
//   'recovers-leak' — overlaps a GT span that is a FULL leak (0% coverage)
//                      at the baseline.
export function classifyCandidate(candidate, groundTruth, referenceEntities) {
  const overlapping = groundTruth.filter(
    (g) => g.entity_group === candidate.entity_group && g.start < candidate.end && g.end > candidate.start,
  );
  if (overlapping.length === 0) return 'no-coverage';
  const anyFullLeakAtReference = overlapping.some((g) => charCoverage(g, referenceEntities).coverage === 0);
  return anyFullLeakAtReference ? 'recovers-leak' : 'fragment';
}

// GT-level leak recovery (§3.1 pt 3, bullet 1): mask-tier entities of
// weight >= minWeight that are a full leak (0% coverage) in `offFinal`
// (baseline's real final output) and become partly-or-fully covered in
// `flooredFinal`. Deliberately the FULL pipeline's output (dedup/merge/
// backfill included, via buildFloorPostSteps below) — this is "does the
// actual product recover it", not a raw-candidate question.
export function leakRecovery(groundTruth, offFinal, flooredFinal, { minWeight = 4 } = {}) {
  const recovered = [];
  for (const gt of groundTruth) {
    if (tierFor(gt.entity_group) !== 'mask') continue;
    if (weightFor(gt.entity_group) < minWeight) continue;
    if (charCoverage(gt, offFinal).coverage > 0) continue; // not a full leak — out of scope
    if (charCoverage(gt, flooredFinal).coverage > 0) recovered.push(gt);
  }
  return recovered;
}

// Full real postprocess chain (createPostprocessSteps, tiered) with the
// threshold step's floor swapped for `floor` — locates it by step.name
// exactly like cache-orchestrator.js locates backfillOccurrencesStep
// (default.js's own doc comment on bindTierOf), so this stays correct if
// the chain's step order or membership ever changes.
function buildFloorPostSteps({ enabledEntities, floor }) {
  const steps = createPostprocessSteps({ enabledEntities, allMask: false })[0].steps;
  const idx = steps.findIndex((s) => s.name === 'thresholdStep');
  steps[idx] = createThresholdStep({}, { allMask: false }, floor);
  return steps;
}

async function runSteps(steps, nerCtx) {
  let ctx = { ...nerCtx, anonymized: '', legend: {}, debug: [] };
  for (const step of steps) ctx = await step(ctx);
  return ctx;
}

// Per-floor-value sweep: leak recovery, mask-count delta (ergonomics) and
// the three-bucket rescued-candidate breakdown, aggregated per type and
// per document. `floors` should include `null` (off) — its row is the
// self-consistency check (MASK-FLOOR-DESIGN.md §2.3 pkt 2/4 in measurement
// form): everything is trivially zero there.
export async function sweepMaskFloor(cache, opts = {}) {
  const enabledEntities = opts.enabledEntities ?? allEntityTypes();
  const floors = opts.floors ?? MASK_FLOOR_GRID;
  const minWeight = opts.minWeight ?? 4;

  const offSteps = buildFloorPostSteps({ enabledEntities, floor: null });
  const offFinalByDoc = new Map();
  for (const doc of cache) {
    offFinalByDoc.set(doc.name, (await runSteps(offSteps, doc.nerCtx)).entities);
  }

  const results = [];
  for (const floor of floors) {
    let leaksRecovered = 0;
    let maskDelta = 0;
    const byType = {};
    const perDoc = [];

    for (const doc of cache) {
      const offFinal = offFinalByDoc.get(doc.name);
      const flooredFinal = floor === null
        ? offFinal
        : (await runSteps(buildFloorPostSteps({ enabledEntities, floor }), doc.nerCtx)).entities;

      const recovered = leakRecovery(doc.expected, offFinal, flooredFinal, { minWeight });
      const delta = flooredFinal.length - offFinal.length;
      leaksRecovered += recovered.length;
      maskDelta += delta;

      const rescued = rescuedByFloor(doc.nerCtx.entities, floor);
      for (const candidate of rescued) {
        const bucket = classifyCandidate(candidate, doc.expected, offFinal);
        byType[candidate.entity_group] ??= { 'recovers-leak': 0, fragment: 0, 'no-coverage': 0 };
        byType[candidate.entity_group][bucket] += 1;
      }

      perDoc.push({ name: doc.name, recovered: recovered.length, maskDelta: delta, rescued: rescued.length });
    }
    results.push({ floor, leaksRecovered, maskDelta, byType, perDoc });
  }
  return results;
}

// Floor-INDEPENDENT diagnostic (§3.1 pt 3, bullet 3): every mask-tier
// candidate dropped by today's real threshold, scored in [min, max),
// bucketed by its own score into `binWidth`-wide bins and classified via
// classifyCandidate against the real baseline's final output — "the chart
// you read the knee and the value from" per the design, independent of
// which specific floor value in the grid would rescue it.
export async function scoreHistogram(cache, opts = {}) {
  const enabledEntities = opts.enabledEntities ?? allEntityTypes();
  const min = opts.min ?? 0.25;
  const max = opts.max ?? 0.60;
  const binWidth = opts.binWidth ?? 0.05;
  // Integer-cent arithmetic sidesteps float drift (0.45 - 0.25 !== 0.2 in
  // IEEE754) that would otherwise misassign a candidate to the wrong bin.
  const cents = (x) => Math.round(x * 100);
  const minC = cents(min);
  const widthC = cents(binWidth);

  const offSteps = buildFloorPostSteps({ enabledEntities, floor: null });
  const bins = {};
  for (const doc of cache) {
    const offFinal = (await runSteps(offSteps, doc.nerCtx)).entities;
    for (const candidate of doc.nerCtx.entities) {
      if (candidate.score < min || candidate.score >= max) continue;
      if (tierFor(candidate.entity_group) !== 'mask') continue;
      if (!isDroppedToday(candidate)) continue;
      const scoreC = cents(candidate.score);
      const binC = minC + Math.floor((scoreC - minC) / widthC) * widthC;
      const binLabel = (binC / 100).toFixed(2);
      bins[binLabel] ??= { 'recovers-leak': 0, fragment: 0, 'no-coverage': 0 };
      bins[binLabel][classifyCandidate(candidate, doc.expected, offFinal)] += 1;
    }
  }
  return bins;
}

function printFloorTable(results) {
  console.log('floor | leaks recovered | mask delta | byType (recovers-leak/fragment/no-coverage)');
  for (const r of results) {
    const byTypeStr = Object.entries(r.byType)
      .map(([t, b]) => `${t}:${b['recovers-leak']}/${b.fragment}/${b['no-coverage']}`)
      .join(', ') || '—';
    console.log(`${(r.floor ?? 'off').toString().padEnd(5)} | ${String(r.leaksRecovered).padStart(15)} | ${String(r.maskDelta).padStart(10)} | ${byTypeStr}`);
  }
}

function printHistogram(bins) {
  console.log('score bin | recovers-leak / fragment / no-coverage');
  for (const [bin, b] of Object.entries(bins).sort(([a], [b2]) => Number(a) - Number(b2))) {
    console.log(`${bin}     | ${b['recovers-leak']} / ${b.fragment} / ${b['no-coverage']}`);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────

async function mainTypeSweep() {
  const types = parseListArg('types', DEFAULT_TYPES);
  const thresholds = parseListArg('thresholds', DEFAULT_THRESHOLDS, Number);
  const enabledEntities = allEntityTypes();

  console.error(`Sweeping ${types.join(', ')} over thresholds ${thresholds.join(', ')}`);
  const cache = await loadCache();
  const results = await sweep(cache, enabledEntities, types, thresholds);

  printTable(results);

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, 'threshold-sweep.json');
  await writeFile(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nWritten: ${outPath}`);
}

async function mainFloorSweep() {
  const floorsArg = parseListArg('floors', ['off', '0.45', '0.40', '0.35', '0.30']);
  const floors = floorsArg.map((f) => (f === 'off' ? null : Number(f)));
  const minWeightArg = process.argv.find((a) => a.startsWith('--min-weight='));
  const minWeight = minWeightArg ? Number(minWeightArg.slice('--min-weight='.length)) : 4;
  const enabledEntities = allEntityTypes();

  console.error(`Mask-floor sweep over ${floors.map((f) => f ?? 'off').join(', ')} (allMask:false, minWeight=${minWeight})`);
  const cache = await loadCache();

  const combined = {};
  for (const [corpus, docs] of Object.entries(cache)) {
    console.log(`\n=== ${corpus} ===`);
    const results = await sweepMaskFloor(docs, { enabledEntities, floors, minWeight });
    printFloorTable(results);
    const histogram = await scoreHistogram(docs, { enabledEntities });
    printHistogram(histogram);
    combined[corpus] = { results, histogram };
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, 'mask-floor-sweep.json');
  await writeFile(outPath, JSON.stringify(combined, null, 2), 'utf-8');
  console.log(`\nWritten: ${outPath}`);
}

async function main() {
  if (process.argv.includes('--floor')) return mainFloorSweep();
  return mainTypeSweep();
}

// CLI entry point: only when run directly, not when imported (e.g. by
// measure-thresholds.test.js's golden test against a fixture cache).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Threshold sweep failed:', err);
    process.exit(1);
  });
}
