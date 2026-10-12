# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-11 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10 · docs 2026-10-12.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)
- [Docs](#docs)

## Simplify

None open.

## Correctness

- **C154 · minor · S** — the panel's ↻ Refresh does nothing on `/search`: `public/SearchRoute.tsx:252` registers no `refreshGame` (`public/AppShell.tsx:202` calls `routeHandlers.refreshGame?.`), so the spinner-less click is silently dropped. Register one that refetches `/api/game-details/:appid?refresh=1` and updates the shown result, sharing RankRoute's once its follow-up lands.

## Security

None open.

## Performance

None open.

## Reliability

- **C168 · minor · S** — `pushPrefToServer` (`public/prefs.ts`) treats any response as success: a 429 (`authLimit`) or 413 (over the 2 MB cap) is neither logged nor retried until the next sign-in merge, so a pref change can silently stay local. Check `res.ok`, log with the `[prefs]` tag and re-schedule the key's push.
- **C169 · minor · M** — `.githooks/pre-commit:10` sets aside only tracked unstaged edits; an untracked file the commit lacks (a new module) still lets the checks pass. Set untracked files aside too, per worktree (not `git stash -u`, shared across worktrees).
- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C170 · minor · S** — `lib/steam.js:72` reads `Retry-After` with `Number(...)`, so its HTTP-date form becomes NaN and the store falls back to 2/4/8 s instead of the wait Steam asked for (integrations.md says it's honoured). Parse a date as the seconds until it.
- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

- **C171 · minor · S** — `test/clipboard.test.js:89` ("restores a label made of several nodes") waits `COPIED_MS + 10` ms of real time for a restore timer that starts only after the copy promise settles, so under load it can assert before the restore: it failed once in a pre-commit run on 2026-10-12, then passed unchanged. Drive the timer with `node:test`'s `mock.timers` instead of sleeping.
- **C172 · minor · S** — `e2e/scenarios.spec.ts` "I2 edge: Esc closing the panel returns focus to the row it was showing" presses ArrowDown as soon as `.game-panel` is visible, which can be before the table's rows load, so `stepGame` finds no next row, the press is lost and the URL keeps `game=1145360`: it failed once in a pre-commit run on 2026-10-12 and 3 times in 840 repeats. Wait for the rows before pressing.

## Docs

None open.
