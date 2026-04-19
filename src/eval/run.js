import { readdir, readFile, mkdir, writeFile, symlink, unlink, readlink } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../pipeline/runner.js';
import { createDefaultPipeline } from '../pipeline/configs/default.js';
import { ENTITY_SOURCES, SOURCES, allEntityTypes, requiredSources } from '../pipeline/configs/entity-sources.js';
import { rulesFor } from '../pipeline/configs/entity-rules.js';

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
    dispose: async () => await ner.dispose(),
  };
}

async function processDocument(filePath, pipelineConfig, runDir) {
  const text = await readFile(filePath, 'utf-8');
  const name = basename(filePath, extname(filePath));

  console.log(`\nProcessing: ${name} (${text.length} chars)`);
  const startTime = performance.now();

  const ctx = await runPipeline(text, pipelineConfig);

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

  let files;
  if (args.length > 0 && !args[0].startsWith('--')) {
    files = args.filter(a => !a.startsWith('--'));
  } else {
    const entries = await readdir(DOCS_DIR);
    files = entries
      .filter(f => f.endsWith('.txt'))
      .map(f => join(DOCS_DIR, f));
  }

  if (files.length === 0) {
    console.log('No .txt files found in test-data/synthetic/');
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
    results.push(await processDocument(file, pipelineConfig, runDir));
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
    ...(label && { label }),
    enabledEntities,
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

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
