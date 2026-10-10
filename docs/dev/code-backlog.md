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

- **C2 · minor · S** — `sweepRemovedAccounts` at `public/accountsStore.ts:213` is never called outside tests, so a soft-removed account (removed from recents, then its list deleted) stays hidden in `recentAccounts` and keeps syncing, contradicting lists-and-accounts.md ("a sweep on every reference change purges anything soft-deleted"). Call it next to each `sweepDeletedLists()`.
- **C3 · minor · S** — the two `noteFetchedAt` copies disagree: `public/BundlesBrowseRoute.tsx:366` depends on page order (pages [3 d, fresh, 1 h] end at "1h ago", understating page 1's age); `public/ListRoute.tsx:588` keeps the minimum correctly. Share ListRoute's rule as one helper.
- **C4 · cleanup · S** — exports only their own tests call: `foldStr`, `renderScoreCell`, `renderMainCell`, `renderExtraCell` (`public/utils.ts:270-292`), `fetchAccountOwnedAppids` (`public/accountData.ts:211`), `nullAllPriceFields` (`public/priceLoading.ts:79`, named in frontend.md), `removeRecentGame` (`public/recentGames.ts:62`), `getFolder` (`public/listsStore.ts:75`). Delete with their tests and doc mentions.
- **C5 · cleanup · S** — `reorderSiblings` and `restoreList` (`public/listsStore.ts:242, 422`) and `restoreRecentAccount` (`public/accountsStore.ts:194`) back a trash/drag-and-drop UI never built (`HomeRoute.tsx:11`: "ready for it, just not surfaced"). Delete with their tests; re-add with the UI. Judgment call.
- **C6 · cleanup · S** — `REGION_CURRENCY[resolveRegion(getStoredRegion())] ?? 'USD'` repeated at `public/BundlesBrowseRoute.tsx:196`, `public/ListRoute.tsx:357`, `public/panel.tsx:67`. Export one `regionCurrency()` from `region.ts`.
- **C7 · cleanup · S** — two `/api/health` probes derive `itadConfigured` (`public/panelData.ts:79`, `public/ListRoute.tsx:1597`, the latter on every mount, each counting every cache table). One memoized shared `isItadConfigured()`.
- **C8 · cleanup · S** — the 11 limiters after `namedRateLimit` (`server.js:105`) each repeat `windowMs`, header flags and the `rateLimitBypassed()` check; `searchLimit` and `friendsLimit` (`server.js:245-269, 296-312`) copy the same cached-steam64 loop. Move the defaults into `namedRateLimit`, extract a shared cached-ids helper.
- **C9 · cleanup · S** — `/api/bundles` query parsing is copied into `bundlesListLimit`'s skip (`server.js:461-465` vs `850-854`); if they drift, cached reloads silently count. One `parseBundlesQuery(req)`.
- **C10 · cleanup · S** — five ITAD routes repeat `if (!isItadConfigured()) return 503` (`server.js:846, 882, 916, 950, 996`). One ITAD-required middleware after each limiter.
- **C11 · cleanup · S** — `stepGameList`'s `table: unknown` at `public/panelNav.ts:51` is only truth-tested and always truthy. Drop it; pass the list instead of a getter.
- **C12 · cleanup · S** — `walk(dir, keep)` duplicated in `scripts/deps-audit.js:16` and `scripts/doc-refs.js:28`. Use `fs.readdirSync(dir, { recursive: true })`.
- **C13 · cleanup · M** — `refreshIds` (common-games, wishlist, friends; `server.js:579-581, 653-654, 710-711`, limiter branches at `236-241, 286-289`) and `getPlayerSummaries`' `forceIds` (`lib/steam.js:325-358`) served the old Library Explorer ↻; no frontend or e2e sends them. Delete with their two tests.
- **C14 · cleanup · M** — `/api/common-games` (`server.js:538-610`, `lib/groupGames.js`) accepts several slots, the legacy `{ users }` body and ownership grouping; the frontend posts one slot and flattens `groups` (`accountData.ts:142-147, 307, 342`). Take `{ members }` like `/api/wishlist`, return flat `games`, drop `groupByOwnership`, and update architecture.md:81 and `e2e/mockApi.ts`.
- **C15 · cleanup · M** — `const data = await res.json(); if (!res.ok) throw new Error(data.error || '…')` at 13 sites in `public/` (accountData ×3, panelData ×3, bundleData ×2, priceLoading, SearchRoute, ListRoute ×2, BundlesBrowseRoute); each turns a proxy's HTML 502 into a JSON parse error. One JSON-fetch helper in `utils.ts`.

## Security

- **C19 · minor · S** — `parseCookies` (`lib/auth.js:26`) lets `decodeURIComponent` throw: any malformed cookie on the host (`other=100%`) makes `/api/me`, the callback, logout and prefs PUT return 500. Skip undecodable pairs.
- **C20 · minor · S** — no final error handler in `server.js` and `npm start` doesn't set `NODE_ENV`: anything thrown outside a route's try reaches Express's default handler with a full stack (`/api/search-games?q=a&q=b`, `/api/achievements/1?steamids=a&steamids=b`, malformed JSON, and a body without JSON content-type or `games: [null]` at `server.js:541, 1154, 1164`). Add an `(err, req, res, next)` handler replying `{ error }` (4xx from `err.status`, else 500); accept only string query params; default `req.body ?? {}`.
- **C21 · minor · S** — `PUT /api/me/prefs/:key` (`server.js:1300`, `lib/auth.js:155`) stores any key and any value up to 100 kB: one free Steam account writes ~2.9 GB/day per IP, and `/api/me` loads every key. Allow only the keys `prefs.ts` syncs; cap value size.
- **C22 · minor · S** — the Metacritic chip at `public/panel.tsx:925` puts `mc.url` (unfiltered Steam field) straight into `href`; a `javascript:` value would run in the app's origin. Wrap in `safeHref` like the other upstream links.

## Performance

- **C28 · minor · S** — `public/AppRoot.tsx:19-26` imports every route statically: ~200 kB of the 415 kB entry chunk (data-table 115 kB, ListRoute 46 kB, gameColumns 13 kB, other table routes ~20 kB) loads on `/` and `/about`. `lazy()` the table routes; fix `vite.config.js`'s "~310 kB" comment.
- **C29 · minor · S** — `getCachedAt` (`lib/cache.js:133`) selects the whole value to read `ts`, called 10× per game in `fetchGameDetails` (`server.js:802-815`), including the ~20 KB `meta:` blob twice (~110 ms event-loop per 2200-game cached stream vs. 28 ms); limiter skips use `getCached` (`server.js:329-333`), inflating `/api/metrics` `cacheHits` ~70%. Ts-only statement, ages computed once per game, a non-recording existence check for skips.

## Reliability

- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.
- **C32 · minor · S** — `routeErrorStatus` (`server.js:139-156`) sends `TypeError: fetch failed` (DNS, ECONNRESET) and `SyntaxError` from an HTML 200 to `[bug:…]` → 400 (probe: `400 { error: 'fetch failed' }`). Mark them upstream in `trackedFetch` and around JSON parses, or map them to 502.
- **C33 · minor · S** — `fetchPlayerBatch`/`getPlayerSummaries` (`lib/steam.js:311-318, 356-361`): a non-OK response silently yields `{ personaname: steamid }`, which `public/HomeRoute.tsx:164` stores as the account label; a thrown error fails the whole `/api/common-games` though libraries loaded; `p.finally(...)` leaves an unhandled rejection per id. Catch with a `[steam]` warn, flag placeholders so the client never stores them, `.catch` the `finally` chain.
- **C37 · minor · S** — `hltbPromise` (`server.js:750-753`) resolves `null` when `meta` rejects, so `failed` lists `meta` but not `hltb` and the HLTB cell looks like "no data". Rethrow so HLTB is reported failed.
- **C38 · minor · S** — `getGlobalAchievementPercentages(...).catch(() => null)` (`server.js:1095`) degrades with no `[tag]` warn and the same response as "no rarity data". Warn `[achievements]` and return a failure flag the panel shows.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.
- **C45 · minor · S** — the store breaker is checked only on entering `fetchStoreApi` (`lib/steam.js:143-146`): jobs already queued in `storeLimit` still fire into the block and re-trip it. Re-check inside the semaphore callback and before each retry.
- **C46 · minor · S** — HLTB is searched for every appid whatever `meta.type` (`server.js:750-753`): soundtracks, videos, demos, tools are near-certain misses against a spoofed-header endpoint. Skip non-playable types (keep `dlc`).
- **C47 · minor · S** — `resolveSteamAppIds` (`lib/itad.js:229-244`) posts all uncached gids (up to 500) in one lookup, while siblings chunk at 200 (`lib/itad.js:319, 375`); neither 200 rule is in integrations.md. Chunk at 200; record the cap (documented for prices, assumed for lookups).
- **C48 · minor · S** — the `expandSteamShopId` fallback (`lib/itad.js:279`) runs uncapped `Promise.all`: with the store breaker open, every sub/bundle gid falls back to one simultaneous `games/info/v2` call (up to 500), and the resulting `null` — also any timeout/budget error swallowed in `lib/itad.js:191-204` — is cached 24 h as "not on Steam" (`lib/itad.js:282`). Cap concurrency at ~3; report "errored" separately and don't cache it.
- **C49 · minor · S** — integrations.md doesn't record: ProtonDB (no section — endpoint, no headers, 404 = no reports, 403 block, `provisionalTier`; `lib/steam.js:825`), `store.steampowered.com/appreviews` (`lib/steam.js:397`), `GetNewsForApp`'s undocumented `feeds=` (`lib/steam.js:1040`), and the achievements status rules (`lib/steam.js:872, 927, 968`: 400/403 private, JSON vs. HTML 403, keyless global percentages). Add them, ProtonDB in the untrusted tier.
- **C50 · cleanup · S** — integrations.md:36 says `GetWishlist` is a plain `?steamid=` request, but `lib/steam.js:259` also sends `key=`. Drop the key if unneeded, else fix the doc.

## Tests

- **C58 · minor · S** — `createPanelDataCache` (`public/panelData.ts:68`) is untested: a failed forced refresh keeping the last good news/bundles/DLC, the `achievementCount === 0` short-circuit, `isItadOff`. Note `fetchAchievements` (`:162-163`) and `fetchPrice` (`:187-188`) clear loaded data on a failed refresh unlike the others — confirm which is intended. Add `test/panelData.test.js`.
- **C64 · minor · S** — no e2e test locks journey D2 step 3 (the panel's ↻ retrying a source that didn't answer, once the upstream is back); `GET /api/game-details/:appid?refresh=1` itself is unit-tested. Add a mock state that fails a details source until cleared, and a D2.3 test.
- **C65 · minor · S** — the Released column's comment (`public/gameColumns.ts`, its `groupValue`) says "Coming soon"/"TBA" resolve to a year, but `endOfReleasePeriod` deliberately returns NaN for them, and `withMissingGroup` only treats `null` as missing, so grouping by year hands NaN to `bucketDatePart`. Check which group they land in, decide where placeholders belong (likely "—"), fix the comment.
