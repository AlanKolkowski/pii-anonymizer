import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { allEntityTypes } from '../pipeline/configs/entity-sources.js';
import { sameEnabledSets, NEQ_MARKER } from './enabled-entities.js';

const RESULTS_DIR = join(import.meta.dirname, '../../test-data/results');

async function listRuns() {
  const entries = await readdir(RESULTS_DIR);
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
  // Allow partial match — e.g. "2026-04-14" matches the first run from that day
  const runs = await listRuns();
  const match = runs.find(r => r.startsWith(ref));
  if (match) return match;
  throw new Error(`No run matching "${ref}". Available: ${runs.join(', ')}`);
}

async function loadSummary(runId) {
  const raw = await readFile(join(RESULTS_DIR, runId, 'summary.json'), 'utf-8');
  return JSON.parse(raw);
}

async function loadScores(runId) {
  try {
    const raw = await readFile(join(RESULTS_DIR, runId, 'scores.json'), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

function allTypes(a, b) {
  const types = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...types].sort();
}

function delta(oldVal, newVal) {
  const diff = newVal - oldVal;
  if (diff === 0) return '  =';
  return diff > 0 ? ` +${diff}` : ` ${diff}`;
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }

function deltaPct(oldVal, newVal) {
  const diff = (newVal - oldVal) * 100;
  if (Math.abs(diff) < 0.05) return '  =';
  return diff > 0 ? ` +${diff.toFixed(1)}pp` : ` ${diff.toFixed(1)}pp`;
}

function formatScoreRow(label, oldVal, newVal, pad = 30, showDelta = true) {
  const trail = showDelta ? deltaPct(oldVal, newVal) : NEQ_MARKER;
  return `  ${label.padEnd(pad)} ${pct(oldVal).padStart(6)} → ${pct(newVal).padStart(6)}  ${trail}`;
}

function formatRow(label, oldVal, newVal, pad = 30, showDelta = true) {
  const trail = showDelta ? delta(oldVal, newVal) : NEQ_MARKER;
  return `  ${label.padEnd(pad)} ${String(oldVal).padStart(5)} → ${String(newVal).padStart(5)}  ${trail}`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const runs = await listRuns();
    if (runs.length === 0) {
      console.log('No eval runs found.');
      return;
    }
    console.log('Available eval runs:\n');
    for (const runId of runs) {
      const summary = await loadSummary(runId);
      const scores = await loadScores(runId);
      const label = summary.label ? ` (${summary.label})` : '';
      const f1 = scores ? `  F1: ${pct(scores.overall.f1)}` : '';
      console.log(`  ${runId}${label}  — ${summary.totals.entities} entities, ${summary.totals.tokens} tokens${f1}`);
    }
    let latest;
    try { latest = await readlink(join(RESULTS_DIR, 'latest')); } catch {}
    if (latest) console.log(`\n  latest → ${latest}`);
    return;
  }

  // Determine which two runs to compare
  let oldId, newId;
  if (args.length >= 2) {
    oldId = await resolveRun(args[0]);
    newId = await resolveRun(args[1]);
  } else if (args.length === 1) {
    // Compare given run against latest
    newId = await resolveRun('latest');
    oldId = await resolveRun(args[0]);
  } else {
    // Compare last two runs
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

  const oldEnabled = oldSummary.enabledEntities || allEntityTypes();
  const newEnabled = newSummary.enabledEntities || allEntityTypes();
  const sameEnabled = sameEnabledSets(oldEnabled, newEnabled);

  console.log(`\nComparing eval runs:`);
  console.log(`  OLD: ${oldId}${oldLabel}`);
  console.log(`  NEW: ${newId}${newLabel}\n`);

  if (!sameEnabled) {
    console.log('  ⚠ enabledEntities differ between runs — score and count deltas hidden (≠types).');
    console.log('     Pipeline behavior is non-distributive over types: re-run with matched subsets to compare.');
    const onlyOld = oldEnabled.filter(t => !newEnabled.includes(t));
    const onlyNew = newEnabled.filter(t => !oldEnabled.includes(t));
    if (onlyOld.length) console.log(`     only in OLD: ${onlyOld.join(', ')}`);
    if (onlyNew.length) console.log(`     only in NEW: ${onlyNew.join(', ')}`);
    console.log('');
  }

  // Overall totals
  console.log('=== Totals ===');
  console.log(formatRow('Entities', oldSummary.totals.entities, newSummary.totals.entities, 30, sameEnabled));
  console.log(formatRow('Tokens', oldSummary.totals.tokens, newSummary.totals.tokens, 30, sameEnabled));
  console.log(formatRow('Time (s)', oldSummary.totals.elapsed, newSummary.totals.elapsed));

  // Scores comparison
  const oldScores = await loadScores(oldId);
  const newScores = await loadScores(newId);

  if (oldScores && newScores) {
    console.log('\n=== Scores ===');
    console.log(formatScoreRow('Precision', oldScores.overall.precision, newScores.overall.precision, 30, sameEnabled));
    console.log(formatScoreRow('Recall', oldScores.overall.recall, newScores.overall.recall, 30, sameEnabled));
    console.log(formatScoreRow('F1', oldScores.overall.f1, newScores.overall.f1, 30, sameEnabled));
    console.log(formatRow('TP', oldScores.overall.tp, newScores.overall.tp, 30, sameEnabled));
    console.log(formatRow('FP', oldScores.overall.fp, newScores.overall.fp, 30, sameEnabled));
    console.log(formatRow('FN', oldScores.overall.fn, newScores.overall.fn, 30, sameEnabled));
  } else if (!oldScores && !newScores) {
    console.log('\n  (no scores — run `npm run eval:score` on both runs)');
  }

  // Per-document comparison
  const allDocs = allTypes(oldSummary.documents, newSummary.documents);

  for (const doc of allDocs) {
    const oldDoc = oldSummary.documents[doc] || { entityCount: 0, tokenCount: 0, entitiesByType: {}, elapsed: '0' };
    const newDoc = newSummary.documents[doc] || { entityCount: 0, tokenCount: 0, entitiesByType: {}, elapsed: '0' };

    console.log(`\n--- ${doc} ---`);
    console.log(formatRow('Entities', oldDoc.entityCount, newDoc.entityCount, 30, sameEnabled));
    console.log(formatRow('Tokens', oldDoc.tokenCount, newDoc.tokenCount, 30, sameEnabled));

    if (oldScores?.documents[doc] && newScores?.documents[doc]) {
      const os = oldScores.documents[doc];
      const ns = newScores.documents[doc];
      console.log(formatScoreRow('F1', os.f1, ns.f1, 30, sameEnabled));
      console.log(formatScoreRow('Precision', os.precision, ns.precision, 30, sameEnabled));
      console.log(formatScoreRow('Recall', os.recall, ns.recall, 30, sameEnabled));
    }

    // Per-type breakdown — show count delta only when the type was scored by
    // both runs. (Per-type cells are the closest thing to a fair cross-subset
    // comparison since matching is type-restricted within a single type.)
    const oldEnabledSet = new Set(oldEnabled);
    const newEnabledSet = new Set(newEnabled);
    const types = allTypes(oldDoc.entitiesByType, newDoc.entitiesByType);
    for (const type of types) {
      const oldCount = oldDoc.entitiesByType[type] || 0;
      const newCount = newDoc.entitiesByType[type] || 0;
      if (oldCount !== newCount) {
        const bothScored = oldEnabledSet.has(type) && newEnabledSet.has(type);
        console.log(formatRow(`  ${type}`, oldCount, newCount, 30, bothScored));
      }
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('Compare failed:', err);
  process.exit(1);
});
