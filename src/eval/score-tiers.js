// Three-way (W1/W2/W3) scoring — SCOPE-TIERS-DESIGN.md §6.2.
//
// `.expected.json` stays flat and untiered (§6.1: "GT jest stałe, warstwa
// jest funkcją konfiguracji"). This module partitions expected/predicted
// entities by TYPE_TIERS at scoring time, so changing a type's tier is a
// one-line edit in type-tiers.js, never a corpus re-annotation.
//
// W1 (liczba do obrony): EXACTLY score.js's strict scoring (imported, not
// reimplemented — computeMetrics/computeByType are the same functions
// eval:score uses), narrowed to entities whose type is tierFor === 'mask'.
// W2 (pokrycie do przeglądu): per review-tier GT entity, character
// coverage by the union of (review-tier predicted spans ∪ mask-tier
// predicted spans) ≥ 50%. A value hidden by W1 masking counts as covered
// — hidden beats shown (§6.2 pt 3). No boundary or type-match requirement
// inside W2 by design (a HEALTH_DATA candidate proposing a span GT calls
// CRIMINAL_OFFENCE_DATA still satisfies "flagged for review").
// W3 (poza metrykami): count of GT entities whose type is tierFor ===
// 'pass' — reported, never scored (no predicted-side notion of "spurious
// pass" exists, since pass-tier types are never masked).
//
// Data note: ST-2 (the pipeline partition step that will emit
// ctx.reviewCandidates / candidates.json) doesn't exist yet — every run on
// disk today has every enabled type flowing into entities.json
// undifferentiated. This scorer prefers a per-doc candidates.json when
// present (future runs) and falls back to filtering entities.json by tier
// (every run today) — the fallback recovers exactly what a partition step
// would have produced, since nothing upstream of scoring has changed.
//
// CLI: node src/eval/score-tiers.js [runId] [--dir=<path>]
// --dir overrides the corpus a run is scored against, taking precedence
// over the run's stamped summary.docsDir. Needed when a run's stamped
// docsDir no longer resolves (e.g. it pointed at an ephemeral scratchpad
// copy of a corpus that has since been committed elsewhere) — without an
// override you'd either get a hard ENOENT or, worse, silently score 0
// documents. Always check the printed "Documents scored: N of M" line and
// the zero-TP guard below before trusting a number out of this script.
import { readdir, readFile, writeFile, readlink } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMetrics, computeByType, computeOverallFromDocuments } from './score.js';
import { charCoverage } from './analyze.js';
import { overlapRatio } from './matching.js';
import { tierFor, TYPE_TIERS } from '../pipeline/configs/type-tiers.js';
import { readEvalText, validateExpectedOffsets, formatOffsetMismatches, EVAL_TEXT_CONVENTION } from './eval-text.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');
const REPO_ROOT = join(import.meta.dirname, '../..');

export const SCORING_VERSION = 'tiers-v1';

const STRICT_OPTIONS = { overlapThreshold: 0.5, requireTypeMatch: true };

function byTier(entities, tier) {
  return entities.filter(e => tierFor(e.entity_group) === tier);
}

// Prefers a real candidates.json (future ST-2 runs); falls back to
// filtering today's flat entities.json by tier (see module doc comment).
function reviewPredictionsFor(candidates, predictedAll) {
  if (candidates) return candidates;
  return byTier(predictedAll, 'review');
}

// W2 hit: charCoverage (analyze.js, reused) of a review-tier GT entity by
// the union of review-tier and mask-tier predicted spans ≥ 50%. Masked-by-
// W1 counts as covered (§6.2 pt 3: "ukryta > pokazana").
export function scoreReviewCoverage(expectedReview, reviewPredicted, maskPredicted) {
  const coverSpans = [...reviewPredicted, ...maskPredicted];
  const misses = [];
  let hits = 0;
  for (const e of expectedReview) {
    const { coverage } = charCoverage(e, coverSpans);
    if (coverage >= 0.5) hits++;
    else misses.push(e);
  }
  return {
    total: expectedReview.length,
    hits,
    misses,
    coverage: expectedReview.length > 0 ? hits / expectedReview.length : 1,
  };
}

// "Szum kosza" (§6.2 pt 3): review-tier predicted spans with literally no
// overlapping GT entity of ANY tier — a candidate that points at nothing
// real. Deliberately tier/type-agnostic: a review candidate overlapping a
// mask- or pass-tier GT entity did point at something real (a tier- or
// type-attribution question, closer to H-3 than to basket noise), so it is
// not counted here. Ergonomics signal only — no gate (O-ST-6).
export function basketNoise(reviewPredicted, allExpected) {
  return reviewPredicted.filter(p => !allExpected.some(e => overlapRatio(e, p) > 0)).length;
}

// Scores one document across all three tiers. `doc` = { name, expected,
// predicted, candidates? }; candidates may be null/undefined (fallback).
export function scoreDocumentTiers(doc, options = STRICT_OPTIONS) {
  const expectedMask = byTier(doc.expected, 'mask');
  const predictedMask = byTier(doc.predicted, 'mask');
  const expectedReview = byTier(doc.expected, 'review');
  const reviewPredicted = reviewPredictionsFor(doc.candidates, doc.predicted);
  const expectedPass = byTier(doc.expected, 'pass');

  const metrics = computeMetrics(expectedMask, predictedMask, options);
  const byType = computeByType(expectedMask, predictedMask, options);
  const w2 = scoreReviewCoverage(expectedReview, reviewPredicted, predictedMask);
  const noise = basketNoise(reviewPredicted, doc.expected);

  return {
    name: doc.name,
    w1: { metrics, byType },
    w2: { ...w2, noise },
    w3: { dropped: expectedPass.length },
  };
}

// Aggregates per-document tier scores. W1 reuses computeOverallFromDocuments
// (micro-average via summed counts, not pooled-offset rematching — same
// discipline score.js uses for OVERALL).
export function aggregateTiers(perDoc) {
  const w1Docs = perDoc.map(d => ({ metrics: d.w1.metrics, byType: d.w1.byType }));
  const { overall, overallByType } = computeOverallFromDocuments(w1Docs);

  const totalReview = perDoc.reduce((s, d) => s + d.w2.total, 0);
  const totalHits = perDoc.reduce((s, d) => s + d.w2.hits, 0);
  const totalNoise = perDoc.reduce((s, d) => s + d.w2.noise, 0);
  const totalDropped = perDoc.reduce((s, d) => s + d.w3.dropped, 0);

  return {
    w1: { overall, overallByType },
    w2: {
      total: totalReview,
      hits: totalHits,
      coverage: totalReview > 0 ? totalHits / totalReview : 1,
      noiseTotal: totalNoise,
      avgNoisePerDoc: perDoc.length > 0 ? totalNoise / perDoc.length : 0,
    },
    w3: { droppedTotal: totalDropped },
  };
}

// ── Loading ─────────────────────────────────────────────────────────

// Returns null when the document isn't part of this run (no entities.json)
// — mirrors score.js's own SKIP semantics. Throws on a GT/text offset
// mismatch (never silently scores garbage — same contract as score.js).
async function loadDoc({ docsDir, runDir, name }) {
  let predictedRaw;
  try {
    predictedRaw = JSON.parse(await readFile(join(runDir, name, 'entities.json'), 'utf-8'));
  } catch {
    return null;
  }

  const expectedRaw = JSON.parse(await readFile(join(docsDir, `${name}.expected.json`), 'utf-8'));
  const sourceText = await readEvalText(join(docsDir, `${name}.txt`));
  const mismatches = validateExpectedOffsets(expectedRaw, sourceText);
  if (mismatches.length > 0) {
    throw new Error(formatOffsetMismatches(name, mismatches));
  }

  let candidates = null;
  try {
    candidates = JSON.parse(await readFile(join(runDir, name, 'candidates.json'), 'utf-8'));
  } catch {}

  return { name, expected: expectedRaw, predicted: predictedRaw, candidates };
}

// ── Formatting ──────────────────────────────────────────────────────

function pct(v) { return (v * 100).toFixed(1).padStart(5) + '%'; }
function pad(s, n) { return String(s).padEnd(n); }

// ── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  let runId = positional[0] || 'latest';
  if (runId === 'latest') {
    runId = await readlink(join(RESULTS_DIR, 'latest'));
  }
  const runDir = join(RESULTS_DIR, runId);

  const dirArg = args.find(a => a.startsWith('--dir='))?.slice('--dir='.length);

  let summary;
  try {
    summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf-8'));
  } catch {
    console.error(`No summary.json in ${runDir} — is "${runId}" a valid run id?`);
    process.exit(1);
  }

  if (summary.textConvention !== EVAL_TEXT_CONVENTION) {
    console.error(
      `Run ${runId} lacks textConvention="${EVAL_TEXT_CONVENTION}" ` +
      `(found: ${summary.textConvention ? `"${summary.textConvention}"` : 'none'}). Refusing to score.`,
    );
    process.exit(1);
  }

  const docsDirRel = dirArg ?? summary.docsDir ?? 'test-data/synthetic';
  const docsDir = resolve(REPO_ROOT, docsDirRel);

  console.log(`Scoring run (tiers): ${runId}`);
  console.log(`Corpus: ${docsDirRel}${dirArg ? ' (--dir override)' : ''}\n`);

  let entries;
  try {
    entries = await readdir(docsDir);
  } catch {
    console.error(`Cannot read corpus directory: ${docsDir}`);
    console.error('(stamped docsDir may be stale — pass --dir=<path> to override, e.g. --dir=test-data/adversarial-holdout)');
    process.exit(1);
  }
  const names = entries.filter(f => f.endsWith('.expected.json')).map(f => basename(f, '.expected.json')).sort();

  const perDoc = [];
  for (const name of names) {
    let doc;
    try {
      doc = await loadDoc({ docsDir, runDir, name });
    } catch (err) {
      console.error(err.message);
      console.error('Ground truth is out of sync with the document text. Refusing to score.');
      process.exit(1);
    }
    if (!doc) continue; // not part of this run
    perDoc.push(scoreDocumentTiers(doc));
  }

  if (perDoc.length === 0) {
    console.error(`No documents scored — 0 of ${names.length} corpus documents have entities.json in ${runDir}.`);
    console.error('Check that --dir points at the corpus this run actually processed.');
    process.exit(1);
  }

  const agg = aggregateTiers(perDoc);
  console.log(`Documents scored: ${perDoc.length} of ${names.length} in corpus\n`);

  // PUŁAPKA 0/0/0 guard: a wrong --dir/docsDir can produce a run that reads
  // and validates fine but matches nothing real. TP=0 alone is plausible
  // (a genuinely hard doc); TP=0 AND FN=0 (zero mask-tier GT entities seen
  // at all) is not, for any real legal document corpus.
  if (agg.w1.overall.tp === 0 && agg.w1.overall.fn === 0) {
    console.warn('⚠  Zero mask-tier (W1) ground-truth entities found across all scored documents.');
    console.warn('   This is the "PUŁAPKA 0/0/0" — check --dir points at the corpus this run was made against.\n');
  }

  console.log('=== W1 (ścisły, liczba do obrony — tylko typy warstwy mask) ===');
  console.log(`  Precision: ${pct(agg.w1.overall.precision)}   Recall: ${pct(agg.w1.overall.recall)}   F1: ${pct(agg.w1.overall.f1)}`);
  console.log(`  TP: ${agg.w1.overall.tp}  FP: ${agg.w1.overall.fp}  FN: ${agg.w1.overall.fn}  (${agg.w1.overall.tpPartial} partial → counted as FP+FN)`);
  console.log(`\n  Per type:`);
  console.log(`    ${pad('TYPE', 28)} ${' P'.padStart(6)} ${' R'.padStart(6)} ${'F1'.padStart(6)}  TP  FP  FN`);
  for (const [type, m] of Object.entries(agg.w1.overallByType)) {
    console.log(`    ${pad(type, 28)} ${pct(m.precision)} ${pct(m.recall)} ${pct(m.f1)}  ${String(m.tp).padStart(2)}  ${String(m.fp).padStart(2)}  ${String(m.fn).padStart(2)}`);
  }

  console.log('\n=== W2 (pokrycie do przeglądu — typy warstwy review) ===');
  console.log(`  GT encji review: ${agg.w2.total}   Pokrytych (≥50% znaków, review∪mask): ${agg.w2.hits}   Pokrycie: ${pct(agg.w2.coverage)}`);
  console.log(`  Szum kosza: ${agg.w2.noiseTotal} kandydatów bez odpowiednika w GT (śr. ${agg.w2.avgNoisePerDoc.toFixed(2)}/dok.) — ergonomia, bez bramki (O-ST-6)`);

  console.log('\n=== W3 (poza metrykami — typy warstwy pass) ===');
  console.log(`  Pominięto (dropped by tier): ${agg.w3.droppedTotal} encji GT`);

  const output = {
    runId,
    scoringVersion: SCORING_VERSION,
    tiersConfig: TYPE_TIERS,
    docsDir: docsDirRel,
    documentCount: perDoc.length,
    corpusDocumentCount: names.length,
    w1: agg.w1,
    w2: agg.w2,
    w3: agg.w3,
    documents: Object.fromEntries(perDoc.map(d => [d.name, { w1: d.w1, w2: d.w2, w3: d.w3 }])),
  };

  const outPath = join(runDir, 'tiers-scores.json');
  await writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nTiers scores saved: ${outPath}`);
}

// Run only when executed as a script (mirrors score.js/analyze.js) —
// score-tiers.test.js imports this module, and an import must never kick
// off a scoring pass.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Tiered scoring failed:', err);
    process.exit(1);
  });
}
