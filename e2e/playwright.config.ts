import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'labs',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.PW_OUTPUT_DIR ?? '/repo/e2e/.last/pw-results',
  use: {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
