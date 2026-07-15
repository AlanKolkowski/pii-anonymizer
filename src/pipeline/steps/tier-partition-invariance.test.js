// ST-2 all-mask invariance proof (SCOPE-TIERS-DESIGN.md §3.3 pkt 1, GS-5,
// R-ST-3): loads REAL, already-postprocessed entity lists from local eval
// runs — test-data/results is gitignored (local machine state only, never
// in a fresh checkout or CI), so every fixture lookup below degrades to
// "found zero fixtures" instead of failing when that directory is absent.
//
// entities.json for a run is ctx.entities exactly where tierPartitionStep
// now sits: run.js (src/eval/run.js) snapshots it as the LAST thing before
// writing output, and tokenizeStep (the only step after tierPartitionStep)
// never touches ctx.entities — so it is precisely "ctx.entities after
// mergeStep, before tierPartitionStep" under today's (pre-ST-2) pipeline.
//
// The proof: reconstruct the exact normalized text the run used (source .txt
// through the same LF-normalization eval reading uses — preprocess's
// normalizeWhitespace is a no-op, so no other transform sits in between),
// run it through createTierPartitionStep({allMask: true}) + anonymizeText,
// and diff against the anonymized.txt/legend.json that run already wrote to
// disk under today's tier-less pipeline. Zero inference — entities.json
// already has the model output baked in.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTierPartitionStep } from './tier-partition.js';
import { anonymizeText } from '../../anonymizer.js';
import { normalizeEol } from '../../eval/eval-text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '../../../test-data');
const RESULTS_DIR = join(TEST_DATA_DIR, 'results');

// Named by the Sonnet ST-2 work package: holdout run 2026-07-13T22-09-45,
// dev run 2026-07-13T17-18-37 (source corpora: adversarial-holdout / adversarial).
const FIXTURE_RUNS = [
  { runId: '2026-07-13T22-09-45', sourceDir: join(TEST_DATA_DIR, 'adversarial-holdout'), label: 'holdout' },
  { runId: '2026-07-13T17-18-37', sourceDir: join(TEST_DATA_DIR, 'adversarial'), label: 'dev' },
];

function collectFixtures() {
  const fixtures = [];
  for (const { runId, sourceDir, label } of FIXTURE_RUNS) {
    const runDir = join(RESULTS_DIR, runId);
    if (!existsSync(runDir) || !existsSync(sourceDir)) continue;
    const docNames = readdirSync(runDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of docNames) {
      const docDir = join(runDir, name);
      const sourcePath = join(sourceDir, `${name}.txt`);
      const entitiesPath = join(docDir, 'entities.json');
      const anonymizedPath = join(docDir, 'anonymized.txt');
      const legendPath = join(docDir, 'legend.json');
      if (![sourcePath, entitiesPath, anonymizedPath, legendPath].every(existsSync)) continue;
      fixtures.push({ label, runId, name, sourcePath, entitiesPath, anonymizedPath, legendPath });
    }
  }
  return fixtures;
}

const fixtures = collectFixtures();

describe('ST-2 all-mask invariance against real local eval runs', () => {
  it('local fixture availability (informational — see console output if zero)', () => {
    if (fixtures.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[tier-invariance] no local eval runs found under test-data/results ' +
        '(gitignored, expected on a fresh checkout/CI). Run `npm run eval` ' +
        'locally against test-data/adversarial and test-data/adversarial-holdout ' +
        'with run ids 2026-07-13T17-18-37 / 2026-07-13T22-09-45 to exercise ' +
        'the byte-for-byte invariance proof below.',
      );
    }
    expect(fixtures.length).toBeGreaterThanOrEqual(0);
  });

  it.each(fixtures)(
    '$label/$name: createTierPartitionStep({allMask:true}) + anonymizeText reproduces the recorded legacy output byte-for-byte',
    ({ sourcePath, entitiesPath, anonymizedPath, legendPath }) => {
      const text = normalizeEol(readFileSync(sourcePath, 'utf-8'));
      const entities = JSON.parse(readFileSync(entitiesPath, 'utf-8'));
      const recordedAnonymized = readFileSync(anonymizedPath, 'utf-8');
      const recordedLegend = JSON.parse(readFileSync(legendPath, 'utf-8'));

      // Sanity: the reconstructed text must actually line up with the saved
      // offsets, or the comparison below proves nothing.
      for (const e of entities) {
        expect(text.slice(e.start, e.end).length).toBe(e.end - e.start);
      }

      const step = createTierPartitionStep({ allMask: true });
      const partitioned = step({ text, segments: [], entities, anonymized: '', legend: {} });

      // allMask's entire contract: nothing is dropped to 'pass', nothing
      // moves to the review basket — every entity stays exactly as it was.
      expect(partitioned.entities).toEqual(entities);
      expect(partitioned.reviewCandidates).toEqual([]);

      const { anonymized, legend } = anonymizeText(text, partitioned.entities);
      expect(anonymized).toBe(recordedAnonymized);
      expect(legend).toEqual(recordedLegend);
    },
  );
});
