import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline as hfPipeline } from '@huggingface/transformers';
import { runPipeline } from '../pipeline/runner.js';
import { createDefaultPipeline } from '../pipeline/configs/default.js';

const TEST_DATA_DIR = join(import.meta.dirname, '../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

async function loadModelNode(model) {
  const ner = await hfPipeline('token-classification', model.id, { dtype: model.dtype });
  return {
    infer: async (text) => await ner(text),
    dispose: async () => await ner.dispose(),
  };
}

async function processDocument(filePath, pipelineConfig) {
  const text = await readFile(filePath, 'utf-8');
  const name = basename(filePath, extname(filePath));

  console.log(`\nProcessing: ${name} (${text.length} chars)`);
  const startTime = performance.now();

  const ctx = await runPipeline(text, pipelineConfig);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`  Done in ${elapsed}s — ${ctx.entities.length} entities, ${Object.keys(ctx.legend).length} tokens`);

  // Write results
  const outDir = join(RESULTS_DIR, name);
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
  return { name, entityCount: ctx.entities.length, elapsed };
}

async function main() {
  const args = process.argv.slice(2);

  // Determine which files to process
  let files;
  if (args.length > 0 && !args[0].startsWith('--')) {
    // Specific file(s) passed as arguments
    files = args.filter(a => !a.startsWith('--'));
  } else {
    // All .txt files in test-data/
    const entries = await readdir(TEST_DATA_DIR);
    files = entries
      .filter(f => f.endsWith('.txt'))
      .map(f => join(TEST_DATA_DIR, f));
  }

  if (files.length === 0) {
    console.log('No .txt files found in test-data/');
    process.exit(1);
  }

  console.log(`Eval: ${files.length} document(s)`);
  console.log('Loading models...');

  const pipelineConfig = createDefaultPipeline(loadModelNode);
  await mkdir(RESULTS_DIR, { recursive: true });

  const results = [];
  for (const file of files) {
    results.push(await processDocument(file, pipelineConfig));
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.entityCount} entities (${r.elapsed}s)`);
  }
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
