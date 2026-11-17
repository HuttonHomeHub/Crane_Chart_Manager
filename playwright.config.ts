import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the running TypeScript app, started by scripts/e2e.sh on a
// throwaway in-memory data folder (BASE_URL points at it). Run through
// scripts/check-node.sh, locally and in CI; never with browsers installed on CT 106.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e-results',
  fullyParallel: false,
  workers: 1, // one server: tests use names of their own so they don't collide
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
