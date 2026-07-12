// A7 (EVAL-RECALL-AUDIT.md §8): measures precision/recall sensitivity to the
// per-type confidence threshold, on both corpora, for the weight>=3 types the
// audit flagged as calibrated for precision instead of professional secrecy
// (§7.1). NER is the expensive part (model load + inference); it runs once
// per document and the raw entities are cached, then postprocess — cheap,
// pure JS — is replayed once per candidate threshold via
// createThresholdStep's override seam (src/pipeline/steps/threshold.js).
//
// Usage: node scripts/measure-thresholds.mjs [--types=A,B] [--thresholds=0.3,0.4,...]
// Writes test-data/results/threshold-sweep.json (gitignored, like eval runs);
// the reproduction command is the artifact, not the data (EVAL-RECALL-AUDIT
// §10 convention).
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../src/pipeline/runner.js';
import {
  createPreSegmentSteps,
  createModelLoadSteps,
  createNerSteps,
  createPostprocessSteps,
} from '../src/pipeline/configs/default.js';
import { SOURCES, allEntityTypes, requiredSources } from '../src/pipeline/configs/entity-sources.js';
import { readEvalText } from '../src/eval/eval-text.js';
import { matchEntities } from '../src/eval/matching.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const RESULTS_DIR = join(REPO_ROOT, 'test-data/results');

const DEFAULT_TYPES = ['PERSON_IDENTIFIER', 'VEHICLE_IDENTIFIER', 'LOCATION', 'PERSON_ROLE_OR_TITLE', 'DEVICE_IDENTIFIER'];
const DEFAULT_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

const CORPORA = [
  { label: 'synthetic', dir: join(REPO_ROOT, 'test-data/synthetic') },
  { label: 'adversarial', dir: join(REPO_ROOT, 'test-data/adversarial') },
];

function parseListArg(name, fallback, transform = (x) => x) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3).split(',').map((s) => transform(s.trim()));
}

async function loadModelNode(model) {
  const ner = await hfPipeline('token-classification', model.id, { dtype: model.dtype });
  return {
    infer: async (text) => await ner(text),
    countTokens: async (text) => {
      const enc = await ner.tokenizer([text], { add_special_tokens: true, truncation: false, padding: false });
      return enc.input_ids.dims.at(-1);
    },
    dispose: async () => await ner.dispose(),
  };
}

function metricsForType(expected, predicted, type) {
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

async function buildNerCache(enabledEntities) {
  const preSegment = createPreSegmentSteps(get_sentence_boundaries);
  const needed = requiredSources(enabledEntities);
  const hf = needed
    .filter((alias) => SOURCES[alias]?.kind === 'hf')
    .map((alias) => ({ alias, id: SOURCES[alias].id, dtype: SOURCES[alias].dtype }));
  const regexActive = needed.includes('regex');
  const modelLoadSteps = createModelLoadSteps(hf, loadModelNode);
  const nerSteps = createNerSteps(hf, regexActive, loadModelNode);
  const preNerPipeline = [...preSegment, ...modelLoadSteps, ...nerSteps];

  const cache = {};
  for (const corpus of CORPORA) {
    const entries = await readdir(corpus.dir);
    const txtFiles = entries.filter((f) => f.endsWith('.txt')).sort();
    cache[corpus.label] = [];
    for (const file of txtFiles) {
      const name = basename(file, extname(file));
      let expected;
      try {
        expected = JSON.parse(await readFile(join(corpus.dir, `${name}.expected.json`), 'utf-8'));
      } catch {
        continue; // no ground truth (e.g. stray .txt) — skip
      }
      console.error(`[ner] ${corpus.label}/${name}`);
      const text = await readEvalText(join(corpus.dir, file));
      const nerCtx = await runPipeline(text, preNerPipeline);
      cache[corpus.label].push({ name, expected, nerCtx });
    }
  }
  return cache;
}

async function sweep(cache, enabledEntities, types, thresholds) {
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
        for (const doc of cache[corpus.label]) {
          let ctx = doc.nerCtx;
          for (const step of postSteps) ctx = await step(ctx);
          totals = addCounts(totals, metricsForType(doc.expected, ctx.entities, type));
        }
        row[corpus.label] = withRates(totals);
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

async function main() {
  const types = parseListArg('types', DEFAULT_TYPES);
  const thresholds = parseListArg('thresholds', DEFAULT_THRESHOLDS, Number);
  const enabledEntities = allEntityTypes();

  console.error(`Sweeping ${types.join(', ')} over thresholds ${thresholds.join(', ')}`);
  const cache = await buildNerCache(enabledEntities);
  const results = await sweep(cache, enabledEntities, types, thresholds);

  printTable(results);

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, 'threshold-sweep.json');
  await writeFile(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nWritten: ${outPath}`);
}

main().catch((err) => {
  console.error('Threshold sweep failed:', err);
  process.exit(1);
});
