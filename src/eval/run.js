import { readdir, readFile, mkdir, writeFile, symlink, unlink, readlink } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../pipeline/runner.js';
import { createDefaultPipeline } from '../pipeline/configs/default.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
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
  console.log(`  Done in ${elapsed}s — ${ctx.entities.length} entities, ${Object.keys(ctx.legend).length} tokens`);

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

  console.log(`  Results: ${outDir}/`);
  return {
    name,
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
    const entries = await readdir(TEST_DATA_DIR);
    files = entries
      .filter(f => f.endsWith('.txt'))
      .map(f => join(TEST_DATA_DIR, f));
  }

  if (files.length === 0) {
    console.log('No .txt files found in test-data/');
    process.exit(1);
  }

  const runId = makeRunId();
  const runDir = join(RESULTS_DIR, runId);

  console.log(`Eval: ${files.length} document(s)`);
  console.log(`Run:  ${runId}${label ? ` (${label})` : ''}`);
  console.log('Loading models...');

  const pipelineConfig = createDefaultPipeline(loadModelNode, get_sentence_boundaries);
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
      entityCount: r.entityCount,
      tokenCount: r.tokenCount,
      entitiesByType: r.entitiesByType,
      elapsed: r.elapsed,
    };
    totalEntities += r.entityCount;
    totalTokens += r.tokenCount;
    totalElapsed += parseFloat(r.elapsed);
  }

  const summary = {
    runId,
    timestamp: new Date().toISOString(),
    ...(label && { label }),
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
    console.log(`  ${r.name}: ${r.entityCount} entities, ${r.tokenCount} tokens (${r.elapsed}s)`);
  }
  console.log(`  TOTAL: ${totalEntities} entities, ${totalTokens} tokens (${totalElapsed.toFixed(2)}s)`);
  console.log(`\nResults: ${runDir}/`);
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
