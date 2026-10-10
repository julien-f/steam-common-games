# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-10 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10.

- [Simplify](#simplify)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)

## Simplify

- **C4 · cleanup · S** — exports only their own tests call: `foldStr`, `renderScoreCell`, `renderMainCell`, `renderExtraCell` (`public/utils.ts:270-292`), `fetchAccountOwnedAppids` (`public/accountData.ts:211`), `nullAllPriceFields` (`public/priceLoading.ts:79`, named in frontend.md), `removeRecentGame` (`public/recentGames.ts:62`), `getFolder` (`public/listsStore.ts:75`). Delete with their tests and doc mentions.
- **C5 · cleanup · S** — `reorderSiblings` and `restoreList` (`public/listsStore.ts:242, 422`) and `restoreRecentAccount` (`public/accountsStore.ts:194`) back a trash/drag-and-drop UI never built (`HomeRoute.tsx:11`: "ready for it, just not surfaced"). Delete with their tests; re-add with the UI. Judgment call.
- **C7 · cleanup · S** — two `/api/health` probes derive `itadConfigured` (`public/panelData.ts:79`, `public/ListRoute.tsx:1597`, the latter on every mount, each counting every cache table). One memoized shared `isItadConfigured()`.
- **C8 · cleanup · S** — the 11 limiters after `namedRateLimit` (`server.js:105`) each repeat `windowMs`, header flags and the `rateLimitBypassed()` check; `searchLimit` and `friendsLimit` (`server.js:245-269, 296-312`) copy the same cached-steam64 loop. Move the defaults into `namedRateLimit`, extract a shared cached-ids helper.
- **C11 · cleanup · S** — `stepGameList`'s `table: unknown` at `public/panelNav.ts:51` is only truth-tested and always truthy. Drop it; pass the list instead of a getter.
- **C13 · cleanup · M** — `refreshIds` (common-games, wishlist, friends; `server.js:579-581, 653-654, 710-711`, limiter branches at `236-241, 286-289`) and `getPlayerSummaries`' `forceIds` (`lib/steam.js:325-358`) served the old Library Explorer ↻; no frontend or e2e sends them. Delete with their two tests.
- **C14 · cleanup · M** — `/api/common-games` (`server.js:538-610`, `lib/groupGames.js`) accepts several slots, the legacy `{ users }` body and ownership grouping; the frontend posts one slot and flattens `groups` (`accountData.ts:142-147, 307, 342`). Take `{ members }` like `/api/wishlist`, return flat `games`, drop `groupByOwnership`, and update architecture.md:81 and `e2e/mockApi.ts`.
- **C15 · cleanup · M** — `const data = await res.json(); if (!res.ok) throw new Error(data.error || '…')` at 13 sites in `public/` (accountData ×3, panelData ×3, bundleData ×2, priceLoading, SearchRoute, ListRoute ×2, BundlesBrowseRoute); each turns a proxy's HTML 502 into a JSON parse error. One JSON-fetch helper in `utils.ts`.

## Security

None open.

## Performance

None open.

## Reliability

- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

- **C64 · minor · S** — no e2e test locks journey D2 step 3 (the panel's ↻ retrying a source that didn't answer, once the upstream is back); `GET /api/game-details/:appid?refresh=1` itself is unit-tested. Add a mock state that fails a details source until cleared, and a D2.3 test.
