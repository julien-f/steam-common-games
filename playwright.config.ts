import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for docs/dev/scenarios.md's ★ scenarios (`npm run test:e2e`). The app runs on
// its own Vite server; every /api call is answered in the browser by e2e/mockApi.ts, so no
// backend, database or upstream service is involved.
const PORT = 58992;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    // `E2E_SHOTS=1 npm run test:e2e` keeps every test's final screen in test-results/, to look at a UI change under mocks.
    screenshot: process.env.E2E_SHOTS ? 'on' : 'off',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
});
