# Pitfalls

Surprising behaviors, misleading errors and their fixes. One entry each: symptom first (exact error text when there is one), then cause and fix. Delete entries once obsolete.

## Tests run slowly when started without `npm test`

- **Symptom**: `node --test` on store-backed tests spends most of its time idle.
- **Cause**: upstream calls are paced by `STORE_MIN_INTERVAL_MS` (500 ms) and `UPSTREAM_MIN_INTERVAL_MS` (1000 ms, both in `default.env`), which `npm test` sets to 0.
- **Fix**: run a single file with `npm run test:one test/<name>.test.js`, which sets them to 0.

## `ReferenceError: <name> is not defined` in the browser console mid-edit

- **Symptom**: the console of a page open on a dev server logs `ReferenceError` for a function that exists, with two `ListRoute.tsx?t=…` versions in the stack.
- **Cause**: hot reload picked up a module between two edits (e.g. a call added before its import).
- **Fix**: reload the page and check again before treating it as a bug.

## A blank page right after starting `npm run dev:mock`

- **Symptom**: the app stays blank; the server logs `The request id ".../node_modules/@solidjs/router/..." is outside of Vite serving allow list`, and the browser gets a 403 for it.
- **Cause**: a page requested Solid's router while Vite was still optimizing dependencies on startup.
- **Fix**: wait a few seconds and reload; the same file is then served (200).

## `page.goto: net::ERR_ABORTED` right after closing the panel or lightbox in an e2e test

- **Symptom**: a `page.goto` issued straight after a ×/Esc close fails with `net::ERR_ABORTED`, on CI more than locally.
- **Cause**: the close steps history back over the overlay's own entry (`overlayHistory.ts`) with an asynchronous `history.go`, and that traversal aborts the navigation already under way.
- **Fix**: wait for the step's `popstate` before navigating (see the L4 Recently Looked Up test).

## Exit 144, then `Port 58992 is already in use`, after `pkill -f`

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

## The client-side route test 404s in an agent worktree

- **Symptom**: `GET /some/client-side/route: 200 with the app shell HTML` (`test/server.test.js`) gets a 404, so the pre-commit hook blocks every commit from a checkout under `.claude/worktrees/`.
- **Cause**: `server.js` calls `res.sendFile` with an absolute path, and `send` treats any dot-segment in it (`.claude`) as a dotfile and refuses it.
- **Fix**: commit from a checkout whose path has no dot-directory (apply the worktree's patches on the main checkout).
