import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for docs/dev/journeys.md's journeys (`npm run test:e2e`). The app runs on
// its own Vite server; every /api call is answered in the browser by e2e/mockApi.ts, so no
// backend, database or upstream service is involved.
// Below Linux's ephemeral range (32768–60999): the pre-commit hook runs this beside the unit tests,
// whose servers and requests draw random ports from that range and could take a fixed one there.
// E2E_PORT: scripts/guard.js runs a base and a head checkout, each on its own server, never reused.
const PORT = Number(process.env.E2E_PORT) || 28992;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'dot',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // region.ts reads the region from the time zone; pinned so a UTC CI runner prices like a EUR region.
    timezoneId: 'Europe/Paris',
    // `E2E_SHOTS=1 npm run test:e2e` keeps every test's final screen in test-results/, to look at a UI change under mocks.
    screenshot: process.env.E2E_SHOTS ? 'on' : 'off',
  },
  // The two sizes ux-review checks.
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.E2E_PORT,
  },
});
