# Pitfalls

Surprising behaviors, misleading errors and their fixes. One entry each: symptom first (exact error text when there is one), then cause and fix. Delete entries once obsolete.

## Tests run slowly when started without `npm test`

- **Symptom**: `node --test` on store-backed tests spends most of its time idle.
- **Cause**: store calls are paced by `STORE_MIN_INTERVAL_MS` (500 ms, `default.env`), which `npm test` sets to 0.
- **Fix**: set `DB_FILE= STORE_MIN_INTERVAL_MS=0` when running a test file directly.

## `ReferenceError: <name> is not defined` in the browser console mid-edit

- **Symptom**: the console of a page open on a dev server logs `ReferenceError` for a function that exists, with two `ListRoute.tsx?t=…` versions in the stack.
- **Cause**: hot reload picked up a module between two edits (e.g. a call added before its import).
- **Fix**: reload the page and check again before treating it as a bug.

## A blank page right after starting `npm run dev:mock`

- **Symptom**: the app stays blank; the server logs `The request id ".../node_modules/@solidjs/router/..." is outside of Vite serving allow list`, and the browser gets a 403 for it.
- **Cause**: a page requested Solid's router while Vite was still optimizing dependencies on startup.
- **Fix**: wait a few seconds and reload; the same file is then served (200).
