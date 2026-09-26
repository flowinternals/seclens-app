import { defineConfig } from '@playwright/test'

/**
 * Secret-safe Playwright config for SPO oracle (design §5).
 * Video off; screenshots off; trace retain-on-failure only after tests clear secrets.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  timeout: 45 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.SECLENS_E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  // Do not auto-start servers here — operator runs `npm run dev:full` (needs real .env.local).
})
