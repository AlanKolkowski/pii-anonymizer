// A7 (EVAL-RECALL-AUDIT.md §8): NER caching phase, split into its own
// process per corpus. A single Node process cycling ONNX Runtime sessions
// through 45 documents (7 synthetic + 38 adversarial, up to 2 models each)
// hit "bad allocation" from onnxruntime-node — session create/dispose
// doesn't fully release native memory back to the OS across that many
// cycles in one process lifetime. `npm run eval` never hits this because it
// only ever processes one corpus per process invocation; this script
// mirrors that by caching ONE corpus's raw (pre-postprocess) NER output to
// disk, so measure-thresholds.mjs can run the actual sweep — cheap, pure
// JS, no model loading — against cached JSON instead of live model state.
//
// Usage: node scripts/cache-ner-for-thresholds.mjs --dir=test-data/synthetic --out=synthetic
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../src/pipeline/runner.js';
import { createPreSegmentSteps, createModelLoadSteps, createNerSteps } from '../src/pipeline/configs/default.js';
import { SOURCES, allEntityTypes, requiredSources } from '../src/pipeline/configs/entity-sources.js';
import { readEvalText } from '../src/eval/eval-text.js';

const REPO_ROOT = join(import.meta.dirname, '..');
const CACHE_DIR = join(REPO_ROOT, 'test-data/results/threshold-ner-cache');

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

async function main() {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? 'test-data/synthetic';
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? 'synthetic';
  const docsDir = join(REPO_ROOT, dirArg);

  const enabledEntities = allEntityTypes();
  const preSegment = createPreSegmentSteps(get_sentence_boundaries);
  const needed = requiredSources(enabledEntities);
  const hf = needed
    .filter((alias) => SOURCES[alias]?.kind === 'hf')
    .map((alias) => ({ alias, id: SOURCES[alias].id, dtype: SOURCES[alias].dtype }));
  const regexActive = needed.includes('regex');
  const lexiconActive = needed.includes('lexicon');
  const modelLoadSteps = createModelLoadSteps(hf, loadModelNode);
  const nerSteps = createNerSteps(hf, regexActive, lexiconActive, loadModelNode);
  const preNerPipeline = [...preSegment, ...modelLoadSteps, ...nerSteps];

  const entries = await readdir(docsDir);
  const txtFiles = entries.filter((f) => f.endsWith('.txt')).sort();
  const cached = [];
  for (const file of txtFiles) {
    const name = basename(file, extname(file));
    let expected;
    try {
      expected = JSON.parse(await readFile(join(docsDir, `${name}.expected.json`), 'utf-8'));
    } catch {
      continue;
    }
    console.error(`[ner] ${outArg}/${name}`);
    const text = await readEvalText(join(docsDir, file));
    const nerCtx = await runPipeline(text, preNerPipeline);
    cached.push({
      name,
      expected,
      nerCtx: { text: nerCtx.text, segments: nerCtx.segments, entities: nerCtx.entities },
    });
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const outPath = join(CACHE_DIR, `${outArg}.json`);
  await writeFile(outPath, JSON.stringify(cached, null, 2), 'utf-8');
  console.log(`Cached ${cached.length} documents -> ${outPath}`);
}

main().catch((err) => {
  console.error('NER caching failed:', err);
  process.exit(1);
});
