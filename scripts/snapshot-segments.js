import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { get_sentence_boundaries } from 'sentencex';
import { runPipeline } from '../src/pipeline/runner.js';
import { normalizeWhitespace } from '../src/pipeline/steps/preprocess.js';
import { createSentencexSegmentStep } from '../src/pipeline/steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../src/pipeline/steps/merge-abbreviations.js';
import { tightenSegmentsStep } from '../src/pipeline/steps/tighten-segments.js';

const DOCS_DIR = join(import.meta.dirname, '..', 'test-data', 'synthetic');

const pipelineConfig = [
  { phase: 'preprocess', steps: [normalizeWhitespace] },
  { phase: 'segment', steps: [
    createSentencexSegmentStep(get_sentence_boundaries),
    mergeAbbreviationsStep,
    tightenSegmentsStep,
  ] },
];

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function main() {
  const entries = await readdir(DOCS_DIR);
  const txts = entries.filter(f => f.endsWith('.txt')).sort();

  if (txts.length === 0) {
    console.log(`No .txt files in ${DOCS_DIR}`);
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;

  for (const file of txts) {
    const name = basename(file, '.txt');
    const expectedPath = join(DOCS_DIR, `${name}.expected-segments.json`);

    if (await exists(expectedPath)) {
      console.log(`  SKIP: ${name} (expected-segments.json already exists)`);
      skipped++;
      continue;
    }

    const text = await readFile(join(DOCS_DIR, file), 'utf-8');
    const ctx = await runPipeline(text, pipelineConfig);
    const segments = ctx.segments.map(s => ({
      start: s.offset,
      end: s.offset + s.text.length,
      text: s.text,
    }));
    await writeFile(expectedPath, JSON.stringify(segments, null, 2), 'utf-8');
    console.log(`  WROTE: ${name} (${segments.length} segments)`);
    written++;
  }

  console.log(`\nDone — ${written} written, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
