import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
