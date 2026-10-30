# Testing and looking at the UI

## Unit tests

- `node:test` + `supertest`, flat in `test/*.test.{js,ts}`.
- `npm test` (~6 s) runs with `DB_FILE=`, so no real database is touched.
- Single file: `npm run test:one test/<name>.test.js` — same env as `npm test`, which hardcodes its glob.
- `--conditions=browser` loads solid-js's browser build: under Node's default (server build) effects and memos never re-run and `createResource` throws, so reactivity couldn't be tested.

## End-to-end tests

- `npm run test:e2e` (both widths, timed by `node scripts/setup-facts.js --cost`; Playwright, `e2e/`, against a production build) runs the tests of [journeys.md](journeys.md)'s journeys at desktop (1440×900) and phone (390×844) widths.
- `node scripts/journey-coverage.js` shows which journey steps they lock.
- After an `npm install` that updates Playwright, run `npx playwright install chromium-headless-shell`: otherwise every test fails with `Executable doesn't exist at …/chrome-headless-shell`, buried under a follow-on `uncaught page errors` failure.
- The browser renders with the committed DejaVu fonts (`e2e/fonts/`, through `FONTCONFIG_FILE`), not the machine's: layout checks measure the same locally and in CI. DejaVu is also Ubuntu's and Debian's default and wider than most, so an overflow shows up locally. Linux only (fontconfig).
- Every `/api` call is mocked in the browser (`e2e/mockApi.ts`): no backend, no upstream traffic. Fixtures use made-up accounts only.
- The presentation window (a popup) gets its stubs from `e2e/presentationHooks.ts`, injected into its HTML by a context route: init scripts, `page.clock` included, miss a popup's first document about one run in four. Fake time on the main page only.
- The pre-commit hook runs the desktop half when `public/`, `e2e/` or a frontend config is staged; the pre-push hook runs all of it. Both skip it when the build (sourcemaps aside), `e2e/` and the test config match the last full passing run (`scripts/e2e.js`). `E2E_DEFER=1` skips the pre-commit e2e, for fix-batch lanes only ([BATCH.md](../../.claude/skills/code-fix/BATCH.md)), which run the suite once before reporting.
- `npm run test:e2e -- --since=<ref>` skips the run when the commits since `<ref>` touch none of those files (`check.js`'s `touchesUi`): a fix-batch lane's doc- or backend-only work.
- `node scripts/e2e-flakes.js [--repeat=N] [--load=THREADS] [playwright args…]` runs the suite N times (default 5), beside THREADS busy-looping threads, and prints each test's failure rate and the slowest tests. The added load stacks on other sessions', so it logs the load sampled during the run (`.git/dev-metrics/flakes.jsonl`; `setup-facts.js --cost` shows the last one). 5 repeats find candidates; confirming a flake or a fix takes 20. A full passing run records the e2e pass like any other.
- `E2E_SHOTS=1 npm run test:e2e` keeps each test's final screen, plus any `shot(page, name)` (`e2e/state.ts`), under `test-results/`, one folder per test and width — a way to look at a UI change without touching real prefs.

## Writing reliable tests

Each rule comes from a flake it fixed; add one when a fix teaches something new.

- No real-time wait: drive time with the fake clock (`page.clock`, `node:test`'s `mock.timers`). A real wait is a window that load closes or stretches.
  - `page.clock` is the whole context's: install it after `startPresenting`, not before (the popup's first document misses it about one run in four). Timers armed before the install keep real time.
  - A window between two inputs (double-tap, a wheel gesture's end, a burst's settle): `pauseAt`, then `runFor` past it.
  - Paused, `requestAnimationFrame` and debounced writes (the lightbox's status line) wait too: assert on what changes at once (its counter).
- Wait for the state the next step needs, not a proxy: `not lb--loading` holds before the lightbox opens and before its media arrive (`stillShown`); `waitForResponse` resolves before the app's handlers run.
- A "nothing after" check advances the fake clock past the window, then asserts; break the app once to see it fail.
- Mocked "fetched" stamps take the answer's time: a module-level `Date.now()` ages with the worker.
- `Event.timeStamp` is real time: app code a test drives by the clock reads `performance.now()` or `Date.now()`.
- A flake: reproduce it with `node scripts/e2e-flakes.js --repeat=24 --load=24 --project=… -g …` and Playwright's `--workers=12` (the full suite's contention: alone it rarely fails), fix the cause, then show 0 failures over at least twice the runs it took to fail, under the same load.

## Looking at the UI

- **Mocked** (the default): `npm run dev:mock` (`:58993`; a worktree its own, `node scripts/ports.js mock`) serves the app against the e2e fixtures — no backend or upstream traffic, and its own localStorage, so no demo-prefs seed/restore. The `mock` cookie switches on error and slow states (`e2e/mockApi.ts`).
  - From an agent session, `node scripts/mock-server.js up|down` starts or reuses it in the background.
  - `node scripts/ux-measure.js [--fresh] [--state=…] /route…` writes a Playwright file measuring those routes at both widths.
- **Real dev server**: only for real data or real loading times; `node scripts/dev-server.js up|down` runs it the same way. Its pages write the user's real prefs (every route but `/about`, `/game/:appid` included), so:
  1. before the first load, run `node scripts/demo-prefs.js seed --file` (or `empty`, for a first visit) and its `.playwright-mcp/demo-seed.js` with `browser_run_code_unsafe`'s `filename`;
  2. afterwards, `restore --file` and `demo-restore.js`, then confirm `steam.isonoe.net:prefs.backup` is gone.
  - Seeding refuses while a backup exists: restore that one first, never overwrite it.

## Skill evals

- `node scripts/skill-evals.js [SKILL...]` runs each `.claude/skills/<name>/evals.json` routing case through headless `claude -p` and reports which skill it loaded (~30 s for all; each run stops at its first tool call). `--repeat=N` measures how stable a route is; a single run can pass by luck.
- `--dry-run` also runs each skill's `dryRun` command to the end in `auto` permission mode (about $1 and 1–2 min each, capped by `--budget`) and reports its denied and failed calls. Only skills safe to run unattended have one.
- Each run's routing score and dry-run results are kept locally (`scripts/dev-metrics.js`), and the routing line names the last comparable run's score.
- Runs use a throwaway clone (no remote; `node_modules` reflinked for `--dry-run`) of the working tree, or of `--ref=<REF>` to compare a skill change before and after, and write no session transcripts. Not part of `check`: it costs real tokens.

## Hooks

- `pre-commit` (`.githooks/pre-commit`, enabled by `npm install`): `git diff --cached --check`, then `npm run check`'s steps (each `scripts/check.js` run first stops if `node_modules` is behind `package-lock.json`) in parallel on the staged content (unstaged edits to tracked files are set aside, then restored; untracked files stay, so a commit lacking one can still pass) — typecheck, lint, the CSS check and desktop e2e only when `public/`, `e2e/` or a frontend config is staged (`node scripts/setup-facts.js --cost` times it). It blocks the commit on failure. `npm install` also points `git blame` at `.git-blame-ignore-revs`.
- Every `scripts/check.js` run (both hooks and `npm run check`) logs its step times and failures to `.git/dev-metrics/` (`scripts/dev-metrics.js`: local, shared by worktrees), as does `scripts/backlog-run-log.js` (each backlog-run's review yield and its escapes) — project scripts log there, not in `~/.claude/logs`; `node scripts/setup-facts.js --cost` summarizes them.
- `pre-merge-commit`: the changelog check on the merge's whole diff — a feature branch's own commits skip the entry requirement, so its merge into `main` must carry them.
- `pre-push`: what CI runs (`npm run check`, then both widths of e2e) on HEAD; refuses a push of anything else or with untracked files, and sets uncommitted edits to tracked files aside for the checks, then restores them.
- CI (`.github/workflows/ci.yml`): `npm run check` and the e2e suite as two parallel jobs on Node 24, on every push to `main` and every PR; the run's summary lists the journey steps the tests lock.
- A doc reference `check` reports is either stale (fix the doc) or deliberate history (add it to `HISTORY` in `scripts/doc-refs.js`, which reports an entry no doc mentions any more).
- `scripts/doc-lint.js` fails on history phrasing ("used to", "no longer"… outside quotes), a paragraph over 1000 characters, and a `docs/` file missing from CLAUDE.md's or README.md's index.
