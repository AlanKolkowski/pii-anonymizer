// Desktop (Electron) smoke test — drives the app through every acceptance
// criterion:
//   1. app boots offline (network guard active, no dev server),
//   2. paste text -> Anonimizuj -> tokens, models loaded ONLY from app://,
//      blocked-request counter stays at 0,
//   3. OCR: scanned image/PDF import produces text, offline,
//   4. DOCX export of a (de)anonymized document works,
//   5. egress controls hold: WebRTC blocked, external-link allowlist exact.
//
// Two modes:
//   node e2e/desktop-smoke.mjs             repo layout (dist-desktop/ + models/)
//   node e2e/desktop-smoke.mjs --packaged  the real installed binary
//                                          (release/win-unpacked/…, app.asar +
//                                          resources/models — the layout users
//                                          actually get)
//   …--packaged --offline                  additionally simulates a machine with
//                                          no network at all (all DNS fails, no
//                                          proxy) — acceptance criterion 1,
//                                          without touching the host's adapters
//
// Prereqs: npm run desktop:fetch-models && npm run desktop:build:renderer
//          (--packaged additionally needs: npm run desktop:build)
import { _electron as electron, chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED = process.argv.includes('--packaged');
// Airplane-mode simulation: every DNS lookup fails and no proxy is reachable,
// so nothing can leave even if some code tried. Non-invasive (Chromium-level).
const OFFLINE = process.argv.includes('--offline');
const ARTIFACTS = join(ROOT, 'test-results', PACKAGED ? 'desktop-smoke-packaged' : 'desktop-smoke');
mkdirSync(ARTIFACTS, { recursive: true });

const SAMPLE_TEXT = readFileSync(join(ROOT, 'e2e', 'fixtures', 'sample.txt'), 'utf8');
const SCANNED_PDF = join(ROOT, 'e2e', 'fixtures', 'sample-scanned.pdf');
const PACKAGED_EXE = join(ROOT, 'release', 'win-unpacked', 'Lokalny anonimizator.exe');

const failures = [];
function check(name, ok, extra = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[smoke] ${mark}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(name);
}

const prereqs = PACKAGED
  ? [['packaged app', PACKAGED_EXE], ['packaged models', join(ROOT, 'release', 'win-unpacked', 'resources', 'models', 'ner')]]
  : [['renderer build', join(ROOT, 'dist-desktop', 'tool.html')], ['models', join(ROOT, 'models', 'ner')]];
for (const [label, path] of prereqs) {
  if (!existsSync(path)) {
    console.error(`[smoke] missing ${label} at ${path}`);
    console.error(PACKAGED ? '[smoke] run: npm run desktop:build' : '[smoke] run: npm run desktop:fetch-models && npm run desktop:build:renderer');
    process.exit(2);
  }
}

console.log(`[smoke] launching Electron (${PACKAGED ? 'PACKAGED binary, asar layout' : 'repo layout'}, app:// protocol`
  + `${OFFLINE ? ', OFFLINE: all DNS fails' : ''})…`);

// Two very different harnesses:
//   repo mode      — playwright's electron harness; gives main-process access
//                    (app.evaluate), so the network-guard canary can run.
//   packaged mode  — the shipped .exe has the `EnableNodeCliInspectArguments`
//                    fuse OFF (SECURITY.md §8), so playwright cannot attach via
//                    --inspect. That is the fuse working as intended. Drive it
//                    over CDP instead; main-process assertions fall back to the
//                    preload bridge, which exposes exactly what we need.
const CDP_PORT = 9222;
let app = null;
let browser = null;
let page;
let mainProc = null;
const mainLines = [];

if (PACKAGED) {
  const launchArgs = [`--remote-debugging-port=${CDP_PORT}`];
  if (OFFLINE) launchArgs.push('--host-resolver-rules=MAP * ~NOTFOUND');
  mainProc = spawn(PACKAGED_EXE, launchArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  mainProc.stdout?.on('data', (d) => mainLines.push(String(d).trimEnd()));
  mainProc.stderr?.on('data', (d) => mainLines.push(String(d).trimEnd()));

  let connected = false;
  for (let i = 0; i < 60 && !connected; i += 1) {
    await sleep(500);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      connected = true;
    } catch { /* not up yet */ }
  }
  if (!connected) {
    console.error('[smoke] could not attach to the packaged app over CDP');
    mainProc.kill();
    process.exit(2);
  }
  const context = browser.contexts()[0];
  // SECURITY-REVIEW: budget widened from 40*250ms (10s) to 120*250ms (30s) for
  // SECURITY-FIXES.md B1 — electron/model-integrity.mjs now streams SHA-256
  // over every model file (~576 MB) before createMainWindow() runs, adding
  // ~2-3s of measured startup latency on top of normal cold-start. CDP itself
  // comes up fast (Chromium binds --remote-debugging-port early, independent
  // of app.whenReady()), so the old budget was already tight; the extra gate
  // pushed "first page appears" past it. Matches the CDP-connect loop above.
  for (let i = 0; i < 120 && context.pages().length === 0; i += 1) await sleep(250);
  page = context.pages()[0];
  if (!page) {
    console.error('[smoke] CDP connected but no page ever appeared (app exited early? see main process output below)');
    console.log('[smoke] main process output tail:\n' + mainLines.slice(-40).join('\n'));
    mainProc.kill();
    process.exit(2);
  }
} else {
  app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, PII_DEV_SERVER_URL: '', PII_DEBUG: '1' },
  });
  page = await app.firstWindow();
  // Main-process logs (network guard, protocol errors) go to the Electron
  // process stdio, not the page console — capture both.
  const proc = app.process();
  proc.stdout?.on('data', (d) => mainLines.push(String(d).trimEnd()));
  proc.stderr?.on('data', (d) => mainLines.push(String(d).trimEnd()));
}

// Clipboard + window focus differ per harness. In packaged mode we go through
// the page's async Clipboard API, which the §7 permission handler allows for
// the app origin — exercising the real user path.
async function focusWindow() {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
  } else {
    await page.bringToFront();
  }
}
async function clipboardWrite(text) {
  if (app) return app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
  return page.evaluate((t) => navigator.clipboard.writeText(t), text);
}
async function clipboardRead() {
  if (app) return app.evaluate(({ clipboard }) => clipboard.readText());
  return page.evaluate(() => navigator.clipboard.readText());
}

const consoleLines = [];
let resolveFirstResult;
const firstResultSeen = new Promise((resolve) => { resolveFirstResult = resolve; });
page.on('console', (msg) => {
  const text = msg.text();
  consoleLines.push(text);
  if (text.includes('[bench-timing] result')) resolveFirstResult();
});
page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

try {
  // ---- 1. Boot ------------------------------------------------------------
  await page.waitForSelector('[data-testid="sources-add-paste"]', { timeout: 30000 });
  check('app boots and renders the tool UI', true, page.url());
  check('app is served from app:// (no http origin)', page.url().startsWith('app://app/'));

  // ---- 2. Paste -> Anonimizuj ---------------------------------------------
  await page.locator('[data-testid="sources-add-paste"]').click();
  await page.locator('.ann-editor-textarea').fill(SAMPLE_TEXT);
  await page.waitForSelector('[data-action="anonymize"]:not([disabled])', { timeout: 30000 });
  await page.locator('[data-action="anonymize"]').click();

  // First run loads both INT8 models from disk — allow a few minutes. The
  // worker mirrors a '[bench-timing] result' console line on completion.
  await withTimeout(firstResultSeen, 300000, 'first classify result');

  // Tokens are not rendered as raw text (the editor shows highlights); the
  // tokenized form is what "Kopiuj wszystkie" puts on the clipboard. The
  // async Clipboard API requires OS window focus — force it first.
  await focusWindow();
  await clipboardWrite('__smoke_sentinel__');
  await page.waitForSelector('[data-action="copy-all"]:not([disabled])', { timeout: 60000 });
  await page.locator('[data-action="copy-all"]').click();
  let copied = '';
  for (let i = 0; i < 20; i += 1) {
    copied = await clipboardRead();
    if (copied !== '__smoke_sentinel__') break;
    await page.waitForTimeout(250);
  }
  check('anonymization produced tokens (clipboard)', /\[[A-Z_]+_\d+\]/.test(copied),
    (copied ?? '').slice(0, 120).replaceAll('\n', ' '));
  check('original PII replaced (no PESEL number in tokenized text)', !copied.includes('80010112345'));

  const loadedFromLocal = consoleLines.filter((l) => l.includes('[worker] loaded')).join(' | ');
  check('NER models loaded (worker log)', /\[worker\] loaded/.test(loadedFromLocal), loadedFromLocal);
  check('q8 dtype in use', /q8/.test(loadedFromLocal), loadedFromLocal);

  // ---- 3. OCR (scanned PDF, offline) --------------------------------------
  await page.locator('[data-testid="sources-add-file-input"]').setInputFiles(SCANNED_PDF);
  // The recovered text lands in the annotation editor's textarea (not in
  // body.innerText) — same assertion upstream's e2e/upload.spec.js uses.
  await page.waitForFunction(
    () => /Jan|Kowalski/i.test(document.querySelector('.ann-editor-textarea')?.value ?? ''),
    null,
    { timeout: 300000 },
  ).catch(() => {});
  const afterOcr = await page.evaluate(() => document.querySelector('.ann-editor-textarea')?.value ?? '');
  check('OCR extracted text from scanned PDF', /Jan|Kowalski/i.test(afterOcr), afterOcr.slice(0, 80).replaceAll('\n', ' '));
  if (!/Jan|Kowalski/i.test(afterOcr)) {
    await page.screenshot({ path: join(ARTIFACTS, 'ocr-state.png') }).catch(() => {});
    console.log('[smoke] OCR debug — main process log tail:\n' + mainLines.slice(-20).join('\n'));
    console.log('[smoke] OCR debug — page console tail:\n' + consoleLines.slice(-20).join('\n'));
  }

  // ---- 4. DOCX export (deanonymize tab) ------------------------------------
  // Seed the clipboard with the tokenized text from step 2, paste it as an LLM
  // outcome, export as DOCX.
  await clipboardWrite(copied);
  await page.locator('[data-mode-tab="deanonymize"]').click();
  await page.waitForSelector('[data-testid="deanon-paste"]', { timeout: 30000 });
  await page.locator('[data-testid="deanon-paste"]').click();
  await page.waitForSelector('[data-testid="deanon-input-body"]', { timeout: 30000 });

  const downloadPath = join(ARTIFACTS, 'export-smoke.docx');
  if (app) {
    await app.evaluate(({ session }, savePath) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(savePath);
      });
    }, downloadPath);
  } else {
    // Over CDP the main process is out of reach; steer the download directory.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: ARTIFACTS });
  }
  await page.locator('[data-testid="deanon-export-docx"]').click();
  await page.waitForTimeout(4000);

  // Packaged mode names the file itself (zdeanonimizowane-*.docx).
  const findDocx = () => {
    if (existsSync(downloadPath)) return downloadPath;
    const hit = readdirSync(ARTIFACTS).find((f) => f.endsWith('.docx'));
    return hit ? join(ARTIFACTS, hit) : null;
  };
  const docxPath = findDocx();
  const docxOk = Boolean(docxPath) && statSync(docxPath).size > 500;
  check('DOCX export saved a non-empty file', docxOk, docxOk ? `${statSync(docxPath).size} B` : 'missing');
  if (docxOk) {
    const head = readFileSync(docxPath).subarray(0, 2).toString('latin1');
    check('DOCX file is a ZIP container (PK)', head === 'PK');
  }

  // ---- 5. Egress controls ---------------------------------------------------
  // 5a. A renderer fetch to a remote origin must not succeed (CSP connect-src
  //     stops it before it even reaches the §3 guard).
  const probe = await page.evaluate(async () => {
    const results = {};
    try {
      await fetch('https://huggingface.co/robots.txt', { mode: 'no-cors' });
      results.https = 'REACHED';
    } catch (err) { results.https = `blocked: ${err.message.slice(0, 50)}`; }

    // 5b. WebRTC is raw UDP and bypasses both webRequest and connect-src.
    //     Two assertions: the API is gone from the main world, AND — even
    //     when recovered from a fresh realm — ICE gathers ZERO candidates,
    //     which is the only proof that no UDP packet left the machine.
    results.mainWorldCtor = typeof RTCPeerConnection;
    let RTC;
    try {
      const frame = document.createElement('iframe');
      document.body.appendChild(frame);
      RTC = frame.contentWindow.RTCPeerConnection;
    } catch { /* iframe blocked entirely */ }
    if (typeof RTC !== 'function') {
      results.iceCandidates = 0;
      results.iceNote = 'no RTCPeerConnection reachable at all';
      return results;
    }
    const pc = new RTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('probe');
    const candidates = [];
    pc.onicecandidate = (e) => { if (e.candidate) candidates.push(e.candidate.candidate); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => {
      const t = setTimeout(r, 6000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); }
      };
    });
    results.iceCandidates = candidates.length;
    results.iceTypes = [...new Set(candidates.map((c) => (c.match(/ typ (\w+)/) ?? [, '?'])[1]))];
    pc.close();
    return results;
  });
  check('renderer fetch to a remote origin is blocked', probe.https !== 'REACHED', probe.https);
  check('WebRTC API removed from the page main world', probe.mainWorldCtor === 'undefined',
    `typeof RTCPeerConnection = ${probe.mainWorldCtor}`);
  check('WebRTC sends ZERO UDP packets (no ICE candidates, even from a fresh realm)',
    probe.iceCandidates === 0,
    `candidates=${probe.iceCandidates} types=${JSON.stringify(probe.iceTypes ?? [])}${probe.iceNote ? ` (${probe.iceNote})` : ''}`);

  // 5c. The external-link allowlist must reject data-bearing / look-alike URLs.
  const { isAllowedExternalLink } = await import('../electron/main-links.mjs');
  const linkCases = [
    ['https://github.com/wjarka/pii-anonymizer', true],
    ['https://github.com/wjarka/pii-anonymizer/blob/main/docs/webmcp.md', true],
    ['https://nodejs.org/', true],
    // A path carries data just as well as a query string.
    ['https://github.com/wjarka/pii-anonymizer/PESEL80010112345', false],
    ['https://nodejs.org/en/download', false],
    ['https://github.com/wjarka/pii-anonymizer-EVIL', false],
    ['https://github.com/wjarka/pii-anonymizer?d=PESEL80010112345', false],
    ['https://nodejs.org/#PESEL', false],
    ['https://evil.com/', false],
    ['http://github.com/wjarka/pii-anonymizer', false],
    ['https://user:pass@nodejs.org/', false],
  ];
  const linkFails = linkCases.filter(([url, want]) => isAllowedExternalLink(url) !== want);
  check('external-link allowlist is exact (no data-bearing or look-alike URLs)', linkFails.length === 0,
    linkFails.map(([u]) => u).join(' | '));

  // ---- Network guard proof --------------------------------------------------
  // First: after the full anonymize + OCR + export run, the app must not have
  // attempted a single outbound request. This is the "zero egress" claim.
  const infoBefore = await page.evaluate(() => window.desktopApp?.getInfo());
  check('preload bridge exposes desktopApp', Boolean(infoBefore));
  check(`app ran in ${PACKAGED ? 'packaged' : 'repo'} mode`,
    PACKAGED ? infoBefore?.packaged === true : infoBefore?.packaged === false,
    `packaged=${infoBefore?.packaged}`);
  check('the app itself attempted ZERO outbound requests', infoBefore?.networkBlock?.blockedTotal === 0,
    `blockedTotal=${infoBefore?.networkBlock?.blockedTotal} byOrigin=${JSON.stringify(infoBefore?.networkBlock?.blockedByOrigin)}`);

  // Second: prove the §3 guard actually cancels — a counter that only ever
  // reads 0 proves nothing on its own. The renderer probe above was stopped by
  // CSP before reaching webRequest, so fire a request from the MAIN process
  // (test-only; app code never imports `net`), which webRequest does see.
  //
  // Packaged mode has no main-process access (the `EnableNodeCliInspectArguments`
  // fuse is off — by design), so this canary runs in repo mode only. Say so
  // rather than silently skipping.
  if (app) {
    const guardProbe = await app.evaluate(async ({ net }) => {
      try {
        await net.fetch('https://example.com/canary');
        return 'REACHED';
      } catch (err) { return `blocked: ${err.message.slice(0, 60)}`; }
    });
    check('main-process request is cancelled by the network guard', guardProbe !== 'REACHED', guardProbe);

    const infoAfter = await page.evaluate(() => window.desktopApp?.getInfo());
    console.log('[smoke] desktop info:', JSON.stringify(infoAfter, null, 2));
    check('the guard counted the canary request (counter is live, not stuck at 0)',
      (infoAfter?.networkBlock?.blockedTotal ?? 0) >= 1,
      `blockedTotal=${infoAfter?.networkBlock?.blockedTotal}`);
    check('the counted origin is the canary, nothing from the app',
      Object.keys(infoAfter?.networkBlock?.blockedByOrigin ?? {}).every((o) => o.includes('example.com')),
      `byOrigin=${JSON.stringify(infoAfter?.networkBlock?.blockedByOrigin)}`);
  } else {
    console.log('[smoke] SKIP  main-process canary — packaged binary has node CLI inspect fused off '
      + '(that is the point). Covered by `npm run desktop:smoke`.');
    console.log('[smoke] desktop info:', JSON.stringify(infoBefore, null, 2));
  }

  const netErrors = consoleLines.filter((l) => /ERR_|net::|Failed to fetch|jsdelivr|bcebos/i.test(l))
    // The renderer probe's own rejection is expected.
    .filter((l) => !/huggingface\.co\/robots\.txt/.test(l));
  check('no network-ish errors in console', netErrors.length === 0, netErrors.slice(0, 5).join(' | '));

  await page.screenshot({ path: join(ARTIFACTS, 'final-state.png') });
} catch (err) {
  console.error('[smoke] FATAL:', err);
  failures.push(`fatal: ${err.message}`);
  await page.screenshot({ path: join(ARTIFACTS, 'failure.png') }).catch(() => {});
  console.log('[smoke] last console lines:\n' + consoleLines.slice(-40).join('\n'));
} finally {
  if (app) await app.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (mainProc && !mainProc.killed) mainProc.kill();
}

if (failures.length > 0) {
  console.error(`\n[smoke] ${failures.length} FAILURE(S): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\n[smoke] all checks passed ✔');
