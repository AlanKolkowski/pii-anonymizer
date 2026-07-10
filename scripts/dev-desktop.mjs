// Desktop dev harness: starts the Vite dev server (electron config, port
// 5183) and launches Electron pointed at it. Dev-only convenience — packaged
// builds never load an http origin (see electron/main.mjs DEV_SERVER_URL).
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5183);
const DEV_URL = `http://localhost:${PORT}`;
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(`[dev-desktop] starting Vite on ${DEV_URL} …`);
const vite = spawn(npxCmd, ['vite', '--config', 'vite.config.electron.js', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: String(PORT) },
});

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolvePromise();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`Vite did not start on port ${port}`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

try {
  await waitForPort(PORT);
} catch (err) {
  console.error(`[dev-desktop] ${err.message}`);
  vite.kill();
  process.exit(1);
}

console.log('[dev-desktop] Vite is up, launching Electron…');
const electron = spawn(npxCmd, ['electron', '.'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PII_DEV_SERVER_URL: DEV_URL },
});

electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
vite.on('exit', (code) => {
  if (code !== null && code !== 0) {
    electron.kill();
    process.exit(code);
  }
});
