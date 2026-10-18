# Pitfalls

Surprising behaviors, misleading errors and their fixes. One entry each: symptom first (exact error text when there is one), then cause and fix. Delete entries once obsolete.

## Tests run slowly when started without `npm test`

- **Symptom**: `node --test` on store-backed tests spends most of its time idle.
- **Cause**: upstream calls are paced by `STORE_MIN_INTERVAL_MS` (500 ms) and `UPSTREAM_MIN_INTERVAL_MS` (1000 ms, both in `default.env`), which `npm test` sets to 0.
- **Fix**: run a single file with `npm run test:one test/<name>.test.js`, which sets them to 0.

## A unit test still sees an earlier test's module state after `delete require.cache[…]`

- **Symptom**: a module-level value (a memoized fetch, a counter) carries over between tests even though each test deletes the module from `require.cache` and requires it again.
- **Cause**: a `.ts` module's own `import`s go through Node's ESM loader, which `require.cache` doesn't cover, so only the module required directly is reloaded.
- **Fix**: keep state a test must reset in a factory the test calls (like `createPanelDataCache()`), not at module level in an imported module.

## `ReferenceError: <name> is not defined` in the browser console mid-edit

- **Symptom**: the console of a page open on a dev server logs `ReferenceError` for a function that exists, with two `ListRoute.tsx?t=…` versions in the stack.
- **Cause**: hot reload picked up a module between two edits (e.g. a call added before its import).
- **Fix**: reload the page and check again before treating it as a bug.

## A commit fails on `TypeError: … is not a function` in a test it doesn't include

- **Symptom**: the pre-commit hook's `test` step fails in a new test file that isn't staged, e.g. `TypeError: needsRestart is not a function`.
- **Cause**: the hook sets aside unstaged edits to tracked files but leaves untracked ones, so a new test for code you haven't staged runs against the old code.
- **Fix**: commit a script and its new test together, and move other changes' untracked tests out of the tree until their commit.

## `dev:mock` measures a layout from older CSS

- **Symptom**: after commits in the main checkout, a page measured on `:58993` shows old CSS (a desktop rule missing, a box at its pre-change width) though the file on disk has the change.
- **Cause**: the server kept serving modules from before the commits; a reload doesn't fix it.
- **Fix**: `node scripts/mock-server.js up` restarts a server it started at another git HEAD. Uncommitted edits don't move HEAD: run `down` then `up` if they look stale.

## A ux-review at 390 px sees desktop-only UI on "phone"

- **Symptom**: a hint or hover affordance hidden on touch screens (e.g. `/rank`'s `.rank-hint`) still shows in a 390×844 Playwright MCP screenshot.
- **Cause**: `ux-measure.js` and `browser_resize` only shrink the viewport; the browser keeps its mouse, so `(any-pointer: fine)` / `(hover: hover)` still match.
- **Fix**: check touch-only rules in the e2e `phone` project (`hasTouch: true`), not on a resized desktop browser.

## A blank page right after starting `npm run dev:mock`

- **Symptom**: the app stays blank; the server logs `The request id ".../node_modules/@solidjs/router/..." is outside of Vite serving allow list`, and the browser gets a 403 for it.
- **Cause**: a page requested Solid's router while Vite was still optimizing dependencies on startup.
- **Fix**: wait a few seconds and reload; the same file is then served (200).

## `page.goto: net::ERR_ABORTED` right after closing the panel or lightbox in an e2e test

- **Symptom**: a `page.goto` issued straight after a ×/Esc close fails with `net::ERR_ABORTED`, on CI more than locally.
- **Cause**: the close steps history back over the overlay's own entry (`overlayHistory.ts`) with an asynchronous `history.go`, and that traversal aborts the navigation already under way.
- **Fix**: wait for the step's `popstate` before navigating (see the L4 Recently Looked Up test).

## Exit 144, then `Port 58991 is already in use` (or 58993), after `pkill -f`

- **Symptom**: `pkill -f vite` (or `node server.js`) ends the command with exit 144, and the next start fails on a busy port or gets connection refused.
- **Cause**: the pattern matches the shell running the `pkill` command itself, so it kills that shell, and it can miss the server's actual process.
- **Fix**: stop servers with `node scripts/mock-server.js down` / `node scripts/dev-server.js down`, never `pkill`.

## `document is not defined` in `browser_run_code_unsafe`

- **Symptom**: `ReferenceError: document is not defined` (or `localStorage`, `setTimeout`, `require`) from a Playwright MCP code call.
- **Cause**: the code runs in Playwright's sandbox with `page`, not in the page.
- **Fix**: DOM and storage access go inside `page.evaluate(() => …)`; wait with `page.waitForTimeout(ms)`; pass a script file through `filename`.

## `File access denied … is outside allowed roots` from Playwright MCP

- **Symptom**: a screenshot path or `filename` in the scratchpad or `/tmp` is refused.
- **Cause**: the Playwright MCP server reads and writes only under the repo's `.playwright-mcp/`.
- **Fix**: keep MCP inputs and outputs under `.playwright-mcp/` (gitignored).

## A background agent's chained `git` command or heredoc is refused

- **Symptom**: in an agent worktree (`.claude/worktrees/`), a chained command (`git add … && git commit …`) or a multi-line `python3` heredoc is denied, while the same steps run one by one go through.
- **Cause**: a background agent can't answer a permission prompt, so any command its rules don't allow outright is refused, and a compound command is judged as a whole.
- **Fix**: one plain command per call; commit with `git commit -F <file>` instead of a heredoc message, and write scripts to a file before running them.

## `window is not defined` requiring a table module from a unit test

- **Symptom**: `require('../public/gameColumns.ts')` (or any module importing `@vates/data-table-solid`) throws `ReferenceError: window is not defined` under `node:test`.
- **Cause**: `@vates/data-table-solid` touches `window` when it loads.
- **Fix**: resolve it to `@vates/data-table-core`, which provides the helpers, with a `module.registerHooks` resolve hook in the test (see `test/gameColumns.test.js`; needs Node ≥ 22.15).

## A unit test's effect never re-runs on a module's signal

- **Symptom**: an effect created in a test with `require('solid-js')` runs once and never again when a `public/` module's signal changes.
- **Cause**: `require` loads solid-js's CommonJS build, while the `.ts` modules `import` its ESM build: two Solid instances that don't see each other's signals.
- **Fix**: `await import('solid-js')` in the test (see `test/authStore.test.js`).

## The e2e run fails at start while agents run in parallel

- **Symptom**: `npm run test:e2e` (or the pre-commit hook's e2e step) fails at start with `http://localhost:28992 is already used, make sure that nothing is running on the port/url`.
- **Cause**: every checkout serves e2e on port 28992, and a run never reuses a server already there (it would serve another checkout's build), so a second run while one is going fails.
- **Fix**: give each checkout its own port: `E2E_PORT=<free port> git commit …` (or `npm run test:e2e`).

## A column menu opened by an e2e click closes at once on phone, on CI only

- **Symptom**: after `menu.click()`, the next step waits forever for an item of the header menu (`locator.click: Test timeout`); the error context shows the menu closed.
- **Cause**: the header button sits past the phone's right edge (grouping widens the table; CI's fonts add a few pixels more than local ones). `click()` scrolls `.dt-table-wrap` to reach it, that scroll event fires after the menu opened, and data-table closes a menu on any scroll outside it.
- **Fix**: `await menu.scrollIntoViewIfNeeded()`, then wait a frame (`page.evaluate(() => new Promise(requestAnimationFrame))`) before the click. To reproduce locally, narrow the viewport until the button straddles the edge (e.g. 370 px).

## A worktree agent's branch lacks the latest commits

- **Symptom**: an agent started with `isolation: "worktree"` doesn't see a commit just made on `main` (e.g. backlog items it was asked to fix: "the section reads None open").
- **Cause**: the worktree branches from `origin/main`, not local `main`, which is ahead until pushed.
- **Fix**: have the agent run `git merge --ff-only main` first (BATCH.md's lane template does), and commit what it needs before launching it.

## Two agents' commits swap messages

- **Symptom**: a commit made with `git commit -F <scratchpad>/msg.txt` carries another agent's message.
- **Cause**: the session scratchpad is shared by every agent, so a generic file name is overwritten between one agent's write and its commit.
- **Fix**: name message files per agent or lane (`msg-<lane>.txt`).

## A phone e2e layout test fails in CI only, by a few pixels

- **Symptom**: a position check like I1's `expect(top).toBeLessThan(520)` gets `Received: 524.5` in CI, yet passes locally and in the `mcr.microsoft.com/playwright` image.
- **Cause**: the GitHub runner's fonts run wider, so a row at its 390 px limit (340.4 px of buttons in 340 px) wraps there only.
- **Fix**: reproduce locally by widening the text (`page.addStyleTag` with `letter-spacing: 1px`), as I1's test does; to see CI's layout, log `getBoundingClientRect()`s from the test on a branch run.
- **Also**: to find the change that broke it, diff against the last green run's commit (`gh run view <id> --json headSha`), not just the newest commit: one push can carry many.

## A closed `[popover]` panel shows anyway

- **Symptom**: a popover panel sits on the page, in flow under its button, before anything opened it; `toBeHidden()` on it fails.
- **Cause**: the browser hides a closed popover with a user-agent `display: none`, which any `display` in the app's CSS (`.account-chip-panel`'s `flex`) overrides.
- **Fix**: restate it for closed panels, `:not(:popover-open) { display: none }`, as `.site-nav-popover-panel` does in `style.css`.
