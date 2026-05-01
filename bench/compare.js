import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '../test-data/bench-results');

async function listRuns() {
  let entries;
  try { entries = await readdir(RESULTS_DIR); } catch { return []; }
  const runs = [];
  for (const entry of entries) {
    if (entry === 'latest') continue;
    const summaryPath = join(RESULTS_DIR, entry, 'summary.json');
    try {
      await stat(summaryPath);
      runs.push(entry);
    } catch {}
  }
  return runs.sort();
}

async function resolveRun(ref) {
  if (ref === 'latest') {
    return await readlink(join(RESULTS_DIR, 'latest'));
  }
  const runs = await listRuns();
  const exact = runs.find((r) => r === ref);
  if (exact) return exact;
  const matches = runs.filter((r) => r.startsWith(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`No run matching "${ref}". Available: ${runs.join(', ')}`);
  }
  throw new Error(`Ambiguous ref "${ref}" matches ${matches.length} runs: ${matches.join(', ')}. Use a longer prefix.`);
}

async function loadSummary(runId) {
  const raw = await readFile(join(RESULTS_DIR, runId, 'summary.json'), 'utf-8');
  return JSON.parse(raw);
}

function deltaMs(oldVal, newVal) {
  if (oldVal == null || newVal == null) return '   n/a';
  const diff = newVal - oldVal;
  const pct = oldVal === 0 ? 0 : (diff / oldVal) * 100;
  if (Math.abs(diff) < 1) return '     =';
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)}ms (${sign}${pct.toFixed(1)}%)`;
}

function formatRow(label, oldVal, newVal, unit = 'ms', pad = 22) {
  const oldStr = oldVal == null ? 'n/a' : `${oldVal.toFixed(0)}${unit}`;
  const newStr = newVal == null ? 'n/a' : `${newVal.toFixed(0)}${unit}`;
  return `  ${label.padEnd(pad)} ${oldStr.padStart(8)} → ${newStr.padStart(8)}   ${deltaMs(oldVal, newVal)}`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const runs = await listRuns();
    if (runs.length === 0) {
      console.log('No bench runs found.');
      return;
    }
    console.log('Available bench runs:\n');
    for (const runId of runs) {
      const summary = await loadSummary(runId);
      const label = summary.label ? ` (${summary.label})` : '';
      const okCount = summary.cases.filter((c) => c.outcome === 'ok').length;
      console.log(`  ${runId}${label}  — ${okCount}/${summary.cases.length} cases ok`);
    }
    let latest;
    try { latest = await readlink(join(RESULTS_DIR, 'latest')); } catch {}
    if (latest) console.log(`\n  latest → ${latest}`);
    return;
  }

  let oldId, newId;
  if (args.length >= 2) {
    oldId = await resolveRun(args[0]);
    newId = await resolveRun(args[1]);
  } else if (args.length === 1) {
    newId = await resolveRun('latest');
    oldId = await resolveRun(args[0]);
  } else {
    const runs = await listRuns();
    if (runs.length < 2) {
      console.log('Need at least 2 runs to compare. Use --list to see available runs.');
      process.exit(1);
    }
    oldId = runs[runs.length - 2];
    newId = runs[runs.length - 1];
  }

  const oldSummary = await loadSummary(oldId);
  const newSummary = await loadSummary(newId);

  const oldLabel = oldSummary.label ? ` (${oldSummary.label})` : '';
  const newLabel = newSummary.label ? ` (${newSummary.label})` : '';
  console.log('\nComparing bench runs:');
  console.log(`  OLD: ${oldId}${oldLabel}`);
  console.log(`  NEW: ${newId}${newLabel}\n`);

  const allLabels = new Set([
    ...oldSummary.cases.map((c) => c.label),
    ...newSummary.cases.map((c) => c.label),
  ]);

  for (const label of [...allLabels].sort()) {
    const oldCase = oldSummary.cases.find((c) => c.label === label);
    const newCase = newSummary.cases.find((c) => c.label === label);
    console.log(`--- ${label} ---`);
    if (oldCase?.outcome !== newCase?.outcome) {
      console.log(`  outcome: ${oldCase?.outcome ?? 'missing'} → ${newCase?.outcome ?? 'missing'}`);
    }
    console.log(formatRow('e2e (median)',         oldCase?.e2eMs?.median,         newCase?.e2eMs?.median));
    console.log(formatRow('load (median)',        oldCase?.loadMs?.median,        newCase?.loadMs?.median));
    console.log(formatRow('inference (median)',   oldCase?.netInferenceMs?.median, newCase?.netInferenceMs?.median));
    console.log('');
  }
}

main().catch((err) => {
  console.error('Compare failed:', err);
  process.exit(1);
});
