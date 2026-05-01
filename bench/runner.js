import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink, symlink, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { deriveCases } from './cases.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'test-data/bench-results');
const USER_DATA_DIR = join(ROOT, 'bench/.user-data');
const TEST_DOC_PATH = join(ROOT, 'test-data/bench/single-page.txt');
const PORT = 5179;

const RESULT_TIMEOUT_MS = 600_000;
const VITE_STARTUP_TIMEOUT_MS = 30_000;
const PAGE_READY_TIMEOUT_MS = 60_000;

function makeRunId() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
}

async function startVite() {
  const proc = spawn('npx', ['vite', '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });
  await new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (!settled && buffer.includes(`localhost:${PORT}`)) {
        settled = true;
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Vite exited with code ${code} before reporting ready. Output:\n${buffer}`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error(`Vite startup timeout after ${VITE_STARTUP_TIMEOUT_MS}ms`));
      }
    }, VITE_STARTUP_TIMEOUT_MS);
  });
  return proc;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function parseTimingLine(line) {
  const m = line.match(/\[bench-timing\]\s+(\S+)(?:\s+alias=(\S+))?\s+t=([\d.]+)/);
  if (!m) return null;
  return { mark: m[1], alias: m[2] ?? null, t: parseFloat(m[3]) };
}

function summarizeTimings(events) {
  const start = events.find((e) => e.mark === 'classify:start')?.t;
  const end = events.find((e) => e.mark === 'result')?.t;
  if (start == null || end == null) return null;

  const loads = [];
  const openLoads = new Map();
  for (const e of events) {
    if (e.mark === 'model:load:start') openLoads.set(e.alias, e.t);
    else if (e.mark === 'model:load:end') {
      const startT = openLoads.get(e.alias);
      if (startT != null) {
        loads.push({ alias: e.alias, durationMs: e.t - startT });
        openLoads.delete(e.alias);
      }
    }
  }
  const totalLoadMs = loads.reduce((s, l) => s + l.durationMs, 0);
  const wallMs = end - start;
  return { wallMs, totalLoadMs, netInferenceMs: wallMs - totalLoadMs, loads };
}

async function runOne(context, baseURL, testText, entities) {
  const page = await context.newPage();
  const events = [];
  const errorMsgs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    const parsed = parseTimingLine(text);
    if (parsed) events.push(parsed);
    else if (msg.type() === 'error' || /\[worker\] .* failed:/.test(text)) {
      errorMsgs.push(text);
    }
  });

  await page.addInitScript((sel) => {
    localStorage.setItem('pii.selected-entities', JSON.stringify(sel));
  }, entities);

  await page.goto(baseURL);
  await page.waitForSelector('#anonymize-btn:not([disabled])', { timeout: PAGE_READY_TIMEOUT_MS });

  const textarea = page.locator('.ann-editor-textarea');
  await textarea.fill(testText);

  let outcome = 'ok';
  let e2eMs = null;
  const clickT = performance.now();
  await page.locator('#anonymize-btn').click();

  try {
    await page.waitForFunction(
      () => {
        const r = document.getElementById('result-section');
        const status = document.getElementById('model-status')?.textContent ?? '';
        return (r && !r.hidden) || status.startsWith('Błąd');
      },
      null,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const status = await page.locator('#model-status').textContent();
    if (status?.startsWith('Błąd')) {
      outcome = 'error';
      errorMsgs.push(status);
    } else {
      e2eMs = performance.now() - clickT;
    }
  } catch (err) {
    outcome = 'timeout';
    errorMsgs.push(err.message);
  }

  await page.close();
  return { e2eMs, events, summary: outcome === 'ok' ? summarizeTimings(events) : null, outcome, errors: errorMsgs };
}

async function captureSystemInfo(context, baseURL) {
  const page = await context.newPage();
  await page.goto(baseURL);
  const info = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
  }));
  await page.close();
  return info;
}

async function main() {
  const args = process.argv.slice(2);
  const label = args.find((a) => a.startsWith('--label='))?.slice(8);
  const runs = parseInt(args.find((a) => a.startsWith('--runs='))?.slice(7) ?? '3', 10);
  const skipWarmup = args.includes('--no-warmup');
  const headed = args.includes('--headed');

  const cases = deriveCases();
  const testText = await readFile(TEST_DOC_PATH, 'utf-8');

  const runId = makeRunId();
  const runDir = join(RESULTS_DIR, runId);
  await mkdir(runDir, { recursive: true });

  console.log(`Bench: ${cases.length} cases × ${runs} measured run(s)${skipWarmup ? '' : ' (+ 1 warmup)'}`);
  console.log(`Run:   ${runId}${label ? ` (${label})` : ''}`);
  console.log(`Doc:   ${TEST_DOC_PATH} (${testText.length} chars)`);
  console.log('Starting Vite...');

  const vite = await startVite();
  const baseURL = `http://localhost:${PORT}`;

  await mkdir(USER_DATA_DIR, { recursive: true });
  console.log('Launching Chromium...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: !headed });

  const cleanup = async () => {
    try { await context.close(); } catch {}
    try { vite.kill(); } catch {}
  };
  process.once('SIGINT', () => cleanup().finally(() => process.exit(130)));
  process.once('SIGTERM', () => cleanup().finally(() => process.exit(143)));

  let systemInfo;
  const results = [];

  try {
    systemInfo = await captureSystemInfo(context, baseURL);

    for (const c of cases) {
      console.log(`\n--- Case: ${c.label} (${c.sources.join(', ')}, ${c.sizeMB}MB) ---`);
      const entities = c.kind === 'all-entities' ? c.entities : [c.representativeEntity];

      if (!skipWarmup) {
        process.stdout.write('  warmup...');
        const w = await runOne(context, baseURL, testText, entities);
        console.log(` ${w.outcome}${w.summary ? ` (e2e=${w.e2eMs?.toFixed(0)}ms)` : ''}`);
      }

      const measurements = [];
      for (let i = 0; i < runs; i++) {
        const result = await runOne(context, baseURL, testText, entities);
        if (result.outcome !== 'ok' || !result.summary) {
          console.log(`  run ${i + 1}: ${result.outcome}${result.errors.length ? ' — ' + result.errors[0].slice(0, 100) : ''}`);
          measurements.push({ outcome: result.outcome, e2eMs: result.e2eMs, errors: result.errors });
          continue;
        }
        const m = {
          outcome: 'ok',
          e2eMs: result.e2eMs,
          inferenceWallMs: result.summary.wallMs,
          loadMs: result.summary.totalLoadMs,
          netInferenceMs: result.summary.netInferenceMs,
          loads: result.summary.loads,
        };
        measurements.push(m);
        console.log(`  run ${i + 1}: e2e=${m.e2eMs.toFixed(0)}ms, load=${m.loadMs.toFixed(0)}ms, infer=${m.netInferenceMs.toFixed(0)}ms`);
      }

      const ok = measurements.filter((m) => m.outcome === 'ok');
      const stat = (key) => {
        const xs = ok.map((m) => m[key]).filter((x) => x != null);
        if (xs.length === 0) return null;
        return { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
      };

      const caseOutcome = ok.length === 0
        ? 'failed'
        : ok.length === measurements.length ? 'ok' : 'partial';

      results.push({
        label: c.label,
        kind: c.kind,
        representativeEntity: c.representativeEntity,
        sources: c.sources,
        sizeMB: c.sizeMB,
        outcome: caseOutcome,
        runs: measurements,
        e2eMs: stat('e2eMs'),
        loadMs: stat('loadMs'),
        netInferenceMs: stat('netInferenceMs'),
        inferenceWallMs: stat('inferenceWallMs'),
      });
    }
  } finally {
    await cleanup();
  }

  const summary = {
    runId,
    timestamp: new Date().toISOString(),
    ...(label && { label }),
    runsPerCase: runs,
    warmup: !skipWarmup,
    document: {
      path: 'test-data/bench/single-page.txt',
      chars: testText.length,
    },
    system: systemInfo,
    cases: results,
  };

  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const latestLink = join(RESULTS_DIR, 'latest');
  try { await unlink(latestLink); } catch {}
  await symlink(runId, latestLink);

  console.log('\n=== Summary ===');
  for (const r of results) {
    if (r.e2eMs) {
      console.log(`  ${r.label.padEnd(40)} e2e=${r.e2eMs.median.toFixed(0)}ms  load=${r.loadMs.median.toFixed(0)}ms  infer=${r.netInferenceMs.median.toFixed(0)}ms  [${r.outcome}]`);
    } else {
      console.log(`  ${r.label.padEnd(40)} [${r.outcome}]`);
    }
  }
  console.log(`\nResults: ${runDir}/`);
}

main().catch((err) => {
  console.error('Bench failed:', err);
  process.exit(1);
});
