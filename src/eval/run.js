import { readdir, readFile, mkdir, writeFile, symlink, unlink } from 'node:fs/promises';
import { join, basename, extname, resolve, relative, sep } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../pipeline/runner.js';
import { createContext } from '../pipeline/context.js';
import { createDefaultPipeline } from '../pipeline/configs/default.js';
import { ENTITY_SOURCES, SOURCES, allEntityTypes, requiredSources } from '../pipeline/configs/entity-sources.js';
import { rulesFor } from '../pipeline/configs/entity-rules.js';
import { readEvalText, EVAL_TEXT_CONVENTION } from './eval-text.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const DOCS_DIR = join(TEST_DATA_DIR, 'synthetic');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

function makeRunId() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
}

function countByType(entities) {
  const counts = {};
  for (const e of entities) {
    counts[e.entity_group] = (counts[e.entity_group] || 0) + 1;
  }
  return counts;
}

function serializeRule(rule) {
  const out = {};
  for (const [key, value] of Object.entries(rule)) {
    if (Array.isArray(value) && value.some(v => v instanceof RegExp)) {
      out[key] = value.map(v => v instanceof RegExp ? v.toString() : v);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function snapshotConfig({ pipelineConfig, enabledEntities, entitySources, sources }) {
  const pipeline = pipelineConfig.map(({ phase, steps }) => ({
    phase,
    steps: steps.map(s => s.name || 'anonymous'),
  }));

  const filteredEntitySources = {};
  const filteredRules = {};
  for (const type of enabledEntities) {
    if (entitySources[type]) filteredEntitySources[type] = entitySources[type];
    filteredRules[type] = serializeRule(rulesFor(type));
  }

  const activeSources = {};
  for (const alias of requiredSources(enabledEntities)) {
    if (sources[alias]) activeSources[alias] = sources[alias];
  }

  return {
    pipeline,
    entitySources: filteredEntitySources,
    sources: activeSources,
    entityRules: filteredRules,
  };
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

// Sibling options file (<name>.options.json) for one corpus document, or
// null. Malformed JSON is a corpus authoring error — fail loudly, not
// silently without the options.
async function readDocOptions(filePath) {
  const optionsPath = filePath.replace(/\.txt$/, '.options.json');
  let raw;
  try {
    raw = await readFile(optionsPath, 'utf-8');
  } catch {
    return null;
  }
  return JSON.parse(raw);
}

async function processDocument(filePath, pipelineConfig, runDir, docOptions = null) {
  const text = await readEvalText(filePath);
  const name = basename(filePath, extname(filePath));

  console.log(`\nProcessing: ${name} (${text.length} chars)`);
  const startTime = performance.now();

  // OS-1 (OCR-SPACING-DESIGN.md §2.2 pkt 6): eval-side provenance comes from
  // the document's name (the *ocr* corpus classes — hold_ocr_mega and
  // friends); it gates the despaced NER pass exactly like the worker's
  // import-metadata flag does in the browser.
  const ocrProvenance = name.toLowerCase().includes('ocr');
  const ctx = await runPipeline(
    { ...createContext(text), meta: { ocrProvenance } },
    pipelineConfig,
  );

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`  Done in ${elapsed}s — ${ctx.segments.length} segments, ${ctx.entities.length} entities, ${Object.keys(ctx.legend).length} tokens`);

  const outDir = join(runDir, name);
  await mkdir(outDir, { recursive: true });

  await writeFile(join(outDir, 'anonymized.txt'), ctx.anonymized, 'utf-8');
  await writeFile(join(outDir, 'entities.json'), JSON.stringify(ctx.entities, null, 2), 'utf-8');
  await writeFile(join(outDir, 'debug.json'), JSON.stringify(ctx.debug, null, 2), 'utf-8');
  await writeFile(
    join(outDir, 'legend.json'),
    JSON.stringify(ctx.legend, null, 2),
    'utf-8',
  );
  const segmentsJson = ctx.segments.map(s => ({
    start: s.offset,
    end: s.offset + s.text.length,
    text: s.text,
  }));
  await writeFile(join(outDir, 'segments.json'), JSON.stringify(segmentsJson, null, 2), 'utf-8');

  console.log(`  Results: ${outDir}/`);
  return {
    name,
    segmentCount: ctx.segments.length,
    entityCount: ctx.entities.length,
    tokenCount: Object.keys(ctx.legend).length,
    entitiesByType: countByType(ctx.entities),
    elapsed,
    ...(docOptions && { options: docOptions }),
  };
}

async function updateLatestSymlink(runId) {
  const linkPath = join(RESULTS_DIR, 'latest');
  try { await unlink(linkPath); } catch {}
  await symlink(runId, linkPath);
}

async function main() {
  const args = process.argv.slice(2);
  const label = args.find(a => a.startsWith('--label='))?.slice(8);

  // --dir=<path> switches the corpus (default: test-data/synthetic). The
  // resolved corpus is stamped into summary.json so eval:score reads ground
  // truth from the same place — the two can never drift apart silently.
  const REPO_ROOT = join(import.meta.dirname, '../..');
  const dirArg = args.find(a => a.startsWith('--dir='))?.slice('--dir='.length);
  const docsDir = dirArg ? resolve(REPO_ROOT, dirArg) : DOCS_DIR;
  const docsDirRel = relative(REPO_ROOT, docsDir).split(sep).join('/');

  let files;
  if (args.length > 0 && !args[0].startsWith('--')) {
    files = args.filter(a => !a.startsWith('--'));
  } else {
    const entries = await readdir(docsDir);
    files = entries
      .filter(f => f.endsWith('.txt'))
      .map(f => join(docsDir, f));
  }

  if (files.length === 0) {
    console.log(`No .txt files found in ${docsDirRel}/`);
    process.exit(1);
  }

  const runId = makeRunId();
  const runDir = join(RESULTS_DIR, runId);

  const entitiesArg = args.find(a => a.startsWith('--entities='))?.slice('--entities='.length);
  let enabledEntities;
  if (entitiesArg) {
    const requested = entitiesArg.split(',').map(s => s.trim()).filter(Boolean);
    const known = new Set(allEntityTypes());
    const unknown = requested.filter(e => !known.has(e));
    if (unknown.length > 0) {
      console.error(`Unknown entity types: ${unknown.join(', ')}`);
      console.error(`Valid: ${[...known].sort().join(', ')}`);
      process.exit(1);
    }
    enabledEntities = requested;
  } else {
    enabledEntities = allEntityTypes();
  }

  console.log(`Eval: ${files.length} document(s)`);
  console.log(`Run:  ${runId}${label ? ` (${label})` : ''}`);
  console.log(`Entities: ${enabledEntities.length === allEntityTypes().length ? 'all' : enabledEntities.join(', ')}`);
  console.log('Loading models...');

  const pipelineConfig = createDefaultPipeline(
    loadModelNode,
    get_sentence_boundaries,
    { enabledEntities, entitySources: ENTITY_SOURCES, sources: SOURCES },
  );
  await mkdir(runDir, { recursive: true });

  const results = [];
  for (const file of files) {
    // ST-5 (SCOPE-TIERS-DESIGN.md §5.2 pkt 3 / §6.3 pkt 4): a document may
    // carry a sibling <name>.options.json (today: { caseAllowlist: [...] })
    // — the eval-side stand-in for the per-session configuration the browser
    // passes through configure. Steps are plain per-run functions (models
    // load and dispose inside runPipeline either way), so a per-document
    // pipeline config costs nothing extra.
    const docOptions = await readDocOptions(file);
    const docConfig = docOptions?.caseAllowlist?.length
      ? createDefaultPipeline(loadModelNode, get_sentence_boundaries, {
        enabledEntities, entitySources: ENTITY_SOURCES, sources: SOURCES, caseAllowlist: docOptions.caseAllowlist,
      })
      : pipelineConfig;
    results.push(await processDocument(file, docConfig, runDir, docOptions));
  }

  // Build summary
  const documents = {};
  let totalEntities = 0;
  let totalTokens = 0;
  let totalElapsed = 0;
  for (const r of results) {
    documents[r.name] = {
      segmentCount: r.segmentCount,
      entityCount: r.entityCount,
      tokenCount: r.tokenCount,
      entitiesByType: r.entitiesByType,
      elapsed: r.elapsed,
      ...(r.options && { options: r.options }),
    };
    totalEntities += r.entityCount;
    totalTokens += r.tokenCount;
    totalElapsed += parseFloat(r.elapsed);
  }

  const config = snapshotConfig({
    pipelineConfig,
    enabledEntities,
    entitySources: ENTITY_SOURCES,
    sources: SOURCES,
  });

  const summary = {
    runId,
    timestamp: new Date().toISOString(),
    textConvention: EVAL_TEXT_CONVENTION,
    docsDir: docsDirRel,
    ...(label && { label }),
    enabledEntities: [...enabledEntities].sort(),
    config,
    totals: {
      documents: results.length,
      entities: totalEntities,
      tokens: totalTokens,
      elapsed: totalElapsed.toFixed(2),
    },
    documents,
  };

  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  await updateLatestSymlink(runId);

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.segmentCount} segments, ${r.entityCount} entities, ${r.tokenCount} tokens (${r.elapsed}s)`);
  }
  console.log(`  TOTAL: ${totalEntities} entities, ${totalTokens} tokens (${totalElapsed.toFixed(2)}s)`);
  console.log(`\nResults: ${runDir}/`);
}

main()
  .then(() => {
    // Every model's InferenceSession is already disposed per-document
    // (src/pipeline/steps/ner.js / load-models.js tear each one down right
    // after use) — but onnxruntime-node's native session threads have been
    // observed to outlive every JS-visible dispose() call and keep the
    // process alive indefinitely with no further work to do (RECALL-B2-NOTES.md
    // §5: summary.json written and correct, node.exe still running hours
    // later, unkillable via TaskStop). All output is flushed by this point
    // (summary.json + the `latest` symlink), so force a clean exit rather
    // than waiting on a natural event-loop drain that may never happen.
    process.exit(0);
  })
  .catch((err) => {
    console.error('Eval failed:', err);
    process.exit(1);
  });
