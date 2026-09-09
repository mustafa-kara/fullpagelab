import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  // Every test launches its own Chrome with the extension loaded and drives a
  // real capture through it, which does not fit the 30s default on a busy
  // machine — the suite failed a different test on each run.
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config test/fixtures/vite.config.ts',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
