// Electron main process for the desktop build ("Lokalny anonimizator").
// Security posture: air-gap by construction — see SECURITY.md for the full
// map of every mitigation to its code location.
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ORIGIN,
  contentSecurityPolicy,
  installAppProtocolHandler,
  registerAppScheme,
} from './app-protocol.mjs';
import { getNetworkBlockStats, installNetworkGuard } from './network-guard.mjs';
import { isAllowedExternalLink } from './main-links.mjs';
import { verifyModelIntegrity } from './model-integrity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dev server URL is honoured ONLY when the app is not packaged. A packaged
// binary can't be talked into loading an http origin via env vars.
const DEV_SERVER_URL = app.isPackaged ? null : (process.env.PII_DEV_SERVER_URL || null);

// Renderer + models live in different places depending on packaging:
//   packaged:  <install>/resources/app.asar/dist-desktop  +  <install>/resources/models
//   from repo: ./dist-desktop                             +  ./models
const DIST_ROOT = join(app.getAppPath(), 'dist-desktop');
const MODELS_ROOT = app.isPackaged
  ? join(process.resourcesPath, 'models')
  : join(app.getAppPath(), 'models');

// SECURITY-REVIEW: integrity anchor for MODELS_ROOT (SECURITY.md §12a,
// THREAT-MODEL.md §4 S1, SECURITY-FIXES.md B1). The anchor deliberately does
// NOT live next to the models it checks — that would let one filesystem write
// replace both the data and the reference it's checked against. In a packaged
// build it is baked into app.asar's ROOT as `manifest.json` (electron-builder.yml
// `files`, copied from models/manifest.json at build time), which the
// EnableEmbeddedAsarIntegrityValidation fuse protects. In repo mode it's the
// same models/manifest.json that scripts/verify-models.mjs already treats as
// the source of truth. See electron/model-integrity.mjs for the check itself.
const MODEL_MANIFEST_PATH = app.isPackaged
  ? join(app.getAppPath(), 'manifest.json')
  : join(app.getAppPath(), 'models', 'manifest.json');

// External links (SECURITY.md §5): only user-clicked, allow-listed https URLs
// are handed to shell.openExternal. Policy lives in ./main-links.mjs so it can
// be unit-tested without booting Electron.

// Must run before app.whenReady().
registerAppScheme();

// No Chromium background services that could phone home (variations service,
// component updater, domain reliability beacons).
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');

// One instance only: two processes sharing %APPDATA% would race on the
// Chromium profile (localStorage prefs, OCR model cache).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// No application menu: no File/Edit chrome for a single-purpose tool, and no
// accidental devtools shortcut in production. Copy/paste keyboard shortcuts
// still work (handled natively by Chromium on Windows).
Menu.setApplicationMenu(null);

/** Fatal startup problems must be visible: a packaged GUI app has no console. */
function fatalStartupError(title, detail) {
  console.error(`[main] ${title}: ${detail}`);
  dialog.showErrorBox(title, detail);
  app.exit(1);
}

function hardenWebContents(contents) {
  // WebRTC is raw UDP/ICE: it never passes through session.webRequest, so the
  // §3 network guard cannot see or cancel it. Measured on Electron 43: with the
  // default policy, ICE gathering emits an `srflx` candidate — i.e. STUN
  // packets really do leave the machine. `disable_non_proxied_udp` with no
  // proxy configured yields ZERO candidates: no UDP egress. This is the actual
  // control; the CSP directive and the preload API removal are depth.
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

  // Block all navigation except inside the app's own origin (tool <-> landing).
  contents.on('will-navigate', (event, url) => {
    const sameOrigin = url.startsWith(`${APP_ORIGIN}/`)
      || (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL));
    if (!sameOrigin) {
      console.warn(`[main] navigation blocked: ${url}`);
      event.preventDefault();
    }
  });
  contents.on('will-attach-webview', (event) => {
    // No <webview> anywhere in this app; refuse if anything tries.
    event.preventDefault();
  });
  // New windows are never created. Allow-listed https links (help pages) open
  // in the system browser; everything else is dropped.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalLink(url)) {
      shell.openExternal(url);
    } else {
      console.warn(`[main] window.open blocked: ${url}`);
    }
    return { action: 'deny' };
  });
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101014',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // Renderer isolation (SECURITY.md §1): no Node, isolated world, OS sandbox.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // No spellchecker: Chromium would otherwise download dictionaries.
      spellcheck: false,
      // Devtools only outside packaged builds (or with explicit debug flag).
      devTools: !app.isPackaged || process.env.PII_DEBUG === '1',
    },
  });

  hardenWebContents(win.webContents);

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer gone:', details.reason, details.exitCode);
  });

  win.once('ready-to-show', () => win.show());

  if (DEV_SERVER_URL) {
    win.loadURL(new URL('/tool.html', DEV_SERVER_URL).href);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL(`${APP_ORIGIN}/tool.html`);
  }
  return win;
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  installNetworkGuard(ses, { devServerUrl: DEV_SERVER_URL });
  installAppProtocolHandler(ses.protocol, { distRoot: DIST_ROOT, modelsRoot: MODELS_ROOT });

  // CSP for dev-server responses (packaged builds get CSP directly from the
  // app:// handler; the dev server serves none). Applying it in dev too keeps
  // both environments honest about the same policy.
  if (DEV_SERVER_URL) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const isDoc = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
      if (!isDoc) return callback({});
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [contentSecurityPolicy()],
        },
      });
    });
  }

  // A packaged app with a missing renderer would show a bare "Not Found" page,
  // and one with missing models would hang on the configure handshake. Both are
  // unrecoverable and must say so out loud rather than degrade silently.
  if (!DEV_SERVER_URL && !existsSync(join(DIST_ROOT, 'tool.html'))) {
    fatalStartupError(
      'Brak zbudowanego interfejsu',
      `Nie znaleziono pliku tool.html w:\n${DIST_ROOT}\n\nUruchom: npm run desktop:build:renderer`,
    );
    return;
  }
  if (!existsSync(join(MODELS_ROOT, 'ner'))) {
    fatalStartupError(
      'Brak wbudowanych modeli',
      `Nie znaleziono katalogu modeli NER w:\n${MODELS_ROOT}\n\nUruchom: npm run desktop:fetch-models`,
    );
    return;
  }

  // SECURITY-REVIEW: model integrity gate (SECURITY.md §12a, THREAT-MODEL.md §4
  // S1, SECURITY-FIXES.md B1). Models sit outside app.asar (see MODELS_ROOT /
  // electron-builder.yml `extraResources`), so nothing but this check stands
  // between a tampered model file and a silent fail-open anonymizer. Every
  // failure mode — hash mismatch, size mismatch, missing file, missing or
  // unreadable anchor — is fail-closed: refuse to start, never "skip and
  // continue". Runs before createMainWindow() / any loadURL, so the renderer
  // never gets a chance to load a worker against unverified models.
  //
  // Residual risk, intentionally not hidden: this is a start-time check, not
  // continuous monitoring, so it cannot catch a model swapped WHILE the app is
  // already running (TOCTOU). That window is closed by SECURITY-FIXES.md B3
  // (perMachine install => resources/ is not writable without UAC elevation),
  // not by this gate alone — the two ship together.
  const modelIntegrity = await verifyModelIntegrity({ anchorPath: MODEL_MANIFEST_PATH, modelsRoot: MODELS_ROOT });
  if (!modelIntegrity.ok) {
    fatalStartupError(
      'Naruszona integralność modeli',
      'Pliki modeli nie zgadzają się z oczekiwanymi sumami kontrolnymi:\n\n'
      + `${modelIntegrity.problems.join('\n')}\n\n`
      + 'To może oznaczać uszkodzoną instalację albo nieautoryzowaną modyfikację plików. '
      + 'Zainstaluj aplikację ponownie z oryginalnego instalatora.',
    );
    return;
  }

  // Single read-only diagnostic channel (SECURITY.md §4): renderer can ask for
  // version info + the blocked-request counter. Nothing else crosses IPC.
  ipcMain.handle('pii:desktop-info', () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    packaged: app.isPackaged,
    networkBlock: getNetworkBlockStats(),
  }));

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Defense in depth: harden any webContents that might ever be created.
app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents);
});

app.on('window-all-closed', () => {
  // Also on macOS: this tool has no background role; closing = exiting keeps
  // the "legend lives only in session memory" model simple (SECURITY.md §9).
  app.quit();
});
