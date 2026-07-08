import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /production-startup\.spec\.js$/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
});
