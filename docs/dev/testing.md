# Testing and looking at the UI

## Unit tests

- `node:test` + `supertest`, flat in `test/*.test.{js,ts}`.
- `npm test` (~4 s) runs with `DB_FILE=`, so no real database is touched.
- Single file: `npm run test:one test/<name>.test.js` — same env as `npm test`, which hardcodes its glob.

## End-to-end tests

- `npm run test:e2e` (~20 s; Playwright, `e2e/`, against a production build) runs the tests of [journeys.md](journeys.md)'s journeys at desktop (1440×900) and phone (390×844) widths.
- `node scripts/journey-coverage.js` shows which journey steps they lock.
- Every `/api` call is mocked in the browser (`e2e/mockApi.ts`): no backend, no upstream traffic. Fixtures use made-up accounts only.
- The pre-commit hook runs the desktop half when `public/`, `e2e/` or a frontend config is staged; the pre-push hook runs all of it. Both skip it when the build (sourcemaps aside), `e2e/` and the test config match the last full passing run (`scripts/e2e.js`).
- `E2E_SHOTS=1 npm run test:e2e` keeps each test's final screen, plus any `shot(page, name)` (`e2e/state.ts`), under `test-results/`, one folder per test and width — a way to look at a UI change without touching real prefs.

## Looking at the UI

- **Mocked** (the default): `npm run dev:mock` (`:58993`) serves the app against the e2e fixtures — no backend or upstream traffic, and its own localStorage, so no demo-prefs seed/restore. The `mock` cookie switches on error and slow states (`e2e/mockApi.ts`).
  - From an agent session, `node scripts/mock-server.js up|down` starts or reuses it in the background.
  - `node scripts/ux-measure.js [--fresh] [--state=…] /route…` writes a Playwright file measuring those routes at both widths.
- **Real dev server**: only for real data or real loading times; `node scripts/dev-server.js up|down` runs it the same way. Its pages write the user's real prefs (every route but `/about`, `/game/:appid` included), so:
  1. before the first load, run `node scripts/demo-prefs.js seed --file` (or `empty`, for a first visit) and its `.playwright-mcp/demo-seed.js` with `browser_run_code_unsafe`'s `filename`;
  2. afterwards, `restore --file` and `demo-restore.js`, then confirm `steam.isonoe.net:prefs.backup` is gone.
  - Seeding refuses while a backup exists: restore that one first, never overwrite it.

## Hooks

- `pre-commit` (`.githooks/pre-commit`, enabled by `npm install`): `git diff --cached --check`, then `npm run check`'s steps in parallel on the staged content only (unstaged edits are set aside, then restored) — typecheck, lint, the CSS check and desktop e2e only when `public/`, `e2e/` or a frontend config is staged. It blocks the commit on failure.
- `pre-push`: what CI runs (`npm run check`, then both widths of e2e) on HEAD; refuses a push of anything else or from a dirty tree.
- A doc reference `check` reports is either stale (fix the doc) or deliberate history (add it to `HISTORY` in `scripts/doc-refs.js`).
