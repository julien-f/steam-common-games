# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-10 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)

## Simplify

None open.

## Correctness

- **C67 · major · S** — a failed owned/wishlist fetch becomes an empty set at `public/myOwnership.ts:89` and `cachedAccountId` stays set, so for the rest of the session every row reads "Not Owned", Played shows "—", panel badges and search ✓ vanish. Keep a per-half failed marker so peeks return unknown, and reset `cachedAccountId` so the next `ensureLoading` retries.
- **C70 · major · S** — a failed list refresh removes the only retry control: `load()` clears `fetchedAt` (and `listSources`) on every load at `public/ListRoute.tsx:1951-1955`, and the Updated tile renders only with an age (`:2812`), so after a 502 the tile and a dynamic list's formula line disappear until reload — against frontend.md's "rendered unconditionally". Keep the previous values through a refresh and render the tile for refreshable kinds without an age.
- **C71 · major · M** — the panel's ↑/↓ buttons close over the list and index captured at render (`public/panelNav.ts:38-39`), redrawn only on open and stream flush: after a re-sort or filter they step through the old order (keys use the new one), and with the open game outside the list (`idx` -1) they show "0 / N" and ↑ skips to `list[N-2]`. Resolve `getGameList()`/`stepGameList` at click time like the keys, keep "i / N" live, hide the buttons when the game isn't in the list.
- **C76 · minor · S** — "Default view", "Revert" and "Discard" call `table.setViewState` directly (`public/ListRoute.tsx:1845`, `:1869`, `:1819`), skipping the `withMembershipGrouping`/`withoutMembershipGrouping` adjustment applied only at construction (`:2500`): a comparison's groups lose their "Both first" order, and reverting to a baseline saved by a flat list ungroups it. Route every post-construction view apply through one adjusting helper.
- **C77 · minor · S** — `notePriceFetchedAt` keeps the older age (`public/ListRoute.tsx:625`) and only the price refresh resets it, so stepping bundle A → B, switching account or region shows the previous list's price age; `priceStatusText` likewise survives a 0-game bundle. Reset both in `load()` and `onRegionChange`.
- **C78 · minor · S** — `setCompareFailures([])` runs after the under-two-slots return (`public/ListRoute.tsx:1978-1985`), so going from a failed `/lists/compare?u=a&u=typo` to the bare Compare link keeps the ⚠ alert and marks the empty form's field invalid. Clear failures (and `editingPlayers`) before the slot-count check.
- **C79 · minor · S** — `editingSources` (`public/ListRoute.tsx:1035`) and `editingRankedSource` (`:783`) aren't reset by `load()`, so following a formula link from an open "Edit sources" opens the next list with its edit form open. Reset both on a non-refresh load.
- **C89 · cleanup · S** — each table rebuild reassigns `unsyncView` (`public/ListRoute.tsx:2495`, `:2498`) without disposing the previous binding; `clearTable()` doesn't call it, so old effects re-save a disposed table's view when `viewingShared` flips. Call `unsyncView?.()` in `clearTable()`.
- **C90 · cleanup · S** — "Save as a list" now names the saved comparison after its title, but `handleSaveComparison`'s comment (`public/ListRoute.tsx:1088`) and lists-and-accounts.md's "Comparing libraries" paragraph still say it's deliberately unnamed. Update both.

## Security

None open.

## Performance

None open.

## Reliability

- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

None open.
