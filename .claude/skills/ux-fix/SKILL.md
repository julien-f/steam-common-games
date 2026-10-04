---
name: ux-fix
description: Fix items from the UX backlog (docs/dev/improvements.md) — test first, fix, check on the mocked server, close the item, one commit each. Use when asked to fix, implement or close a U-item or a ux-review finding.
---

# UX fix

Works through the named `U<n>` items in [improvements.md](../../../docs/dev/improvements.md), in order, one commit each. Finding new problems is [ux-review](../ux-review/SKILL.md)'s job; this one fixes what's there.

## 0. Before starting

- Read every requested item and the scenario it names in [scenarios.md](../../../docs/dev/scenarios.md), then the code involved.
- Batch the real design forks into one `AskUserQuestion`, recommendation first: placement or interaction model, frontend-only vs. a backend change, anything on CLAUDE.md's ask-first list (a new dependency). Everything else proceeds on the obvious fix — an item whose "Direction" already settles it needs no question.

## 1. Test first

- Behaviour: a test in `e2e/scenarios.spec.ts` titled `<scenario> edge: <what must hold>`, next to that scenario's tests; backend logic: `test/*.test.js`. Mock data the test needs goes in `e2e/fixtures.ts` / `e2e/mockApi.ts`.
- Run it alone (`npx playwright test -g "<title>"`) and confirm it fails for the reason the item describes. Timers: `page.clock.install()` before the first `goto`, then `page.clock.runFor(ms)`.
- Layout-only items (shift, overlap, spacing) skip the test; step 3 measures them instead.

## 2. Fix

The smallest change that closes the item, following [frontend.md](../../../docs/dev/frontend.md)'s reactivity rules. Re-run the step 1 test.

## 3. Look at it

- `node scripts/mock-server.js up` (`dev:mock` on `:58993`, its own storage: no demo-prefs seed/restore; `down` when done). Check in the browser at **1440×900** and **390×844**: for layout, `node scripts/ux-measure.js --name=ux-U<n> /route…` then `browser_run_code_unsafe` with `filename: .playwright-mcp/measure.js` (first-row position, block heights, overflow, targets under 24 px, unnamed controls, console errors, screenshots); for anything else, one `browser_run_code_unsafe` call per step that acts, measures what the item is about (bounding boxes before/after, accessible names), and screenshots to `.playwright-mcp/ux-U<n>-<what>.png`.
- This is the item's re-check — no separate ux-review run.
- A stale-module error after editing a widely imported file: restart the server (`down`, then `up`). A console error that appeared mid-edit: reload before believing it (pitfalls.md).

## 4. Close and commit

- Remove the item from improvements.md, or narrow it to what's left and say so.
- `CHANGELOG.md` under `## [Unreleased]` (Fixed or Changed), in user-facing words; update any doc the change makes stale.
- `npm run format`, then commit: subject says what changed for the user, body names `U<n>` and why. The pre-commit hook runs `npm run check` and the e2e suite.

## Report

One table — item, commit, how it was verified (test, measurement) — then anything narrowed rather than closed, and side effects worth knowing (e.g. a new trade-off on phone).
