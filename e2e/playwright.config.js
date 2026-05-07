import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 5180;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/pii-anonymizer/`,
    trace: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: `npx vite --strictPort --port ${PORT}`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/pii-anonymizer/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
