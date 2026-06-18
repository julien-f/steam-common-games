# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Side panel "Owned by" section now shows each account's playtime (e.g. "12h") next to their name; multi-account (Steam Family) slots list each member's playtime individually
- Side panel header image shows a shimmer skeleton while loading to prevent layout shift
- Side panel scrolls back to the top when navigating to a different game (e.g. via arrow keys)

- `POST /api/game-details/stream` endpoint: streams per-game detail events over SSE so the frontend opens one connection per search instead of N individual requests

### Changed

- Frontend loads game details via a single SSE stream (`ReadableStream` + `fetch`) instead of a pool of concurrent `GET /api/game-details/:appid` requests; the old endpoint is unchanged and still used by direct API consumers

### Fixed

- Page no longer freezes while SSE detail events arrive: each event now updates only the affected row's cells instead of re-reconciling every row in every table

- `CACHE_FILE` env var controls the cache file path; set to an empty string to disable disk persistence (used by the test script to prevent tests from overwriting `cache.json`)

### Fixed

- Side panel: game description no longer double-encodes HTML entities (e.g. `&quot;` was shown literally instead of as `"`)
- `refreshTable` now reconciles the DOM instead of replacing `tbody.innerHTML`: existing `<tr>` nodes are moved/updated in place, new ones are inserted, and removed ones are discarded. This means row identity is stable across re-renders — clicks, active highlights, and filters all work correctly while details are still loading and the sort order updates live
- Updated tests for `getHLTB` and `getAppDetails` to match current return shapes (`id`, `completionist` for HLTB; `description`, `releaseDate` for app details)

### Added

- Side panel: open state is reflected in the URL as `?game=<appid>`; sharing or reloading the URL restores the panel for that game automatically
- Side panel: ArrowUp/ArrowDown keys navigate to the previous/next game in the current group while the panel is open (skipped when focus is in a text input)
- Side panel: Completionist playtime (HLTB `comp_100`) shown as a third HLTB column when available
- Side panel: release date and short description from the Steam Store API shown below the game title
- Side panel: "Owned by" section listing the player slots that own the selected game
- Side panel: widens to `min(480px, 30vw)` on screens ≥ 1400 px wide
- Side panel: genre, category, developer, and publisher tags are now clickable filter toggles; active filters are highlighted in blue

- Side panel drawer: clicking a game row (outside the Steam link) slides in a detail panel showing the Steam header image, score with review counts, HLTB playtime (with a direct ↗ link to the HowLongToBeat entry), genres, categories, developer, publisher sorted alphabetically, and links to Steam Store / SteamDB / ProtonDB; close with the × button, backdrop click, or Escape

### Fixed

- Side panel no longer stays stuck on skeleton/loading state after game details finish loading: `fetchDetails` now calls `renderPanel()` directly when the loaded game is the currently-open one; filter tag buttons in the panel are no longer replaced mid-click by a concurrent detail load
- HLTB search now normalizes Unicode (e.g. `Ö` → `O`) before building search terms and computing similarity, so games with diacritics in their title (e.g. "Öoo") match the correct HLTB entry instead of a spurious one

- Filters and sort order are now applied immediately as each game's details load: loading games are excluded from active filters (previously shown as matching), and each completed detail fetch triggers a full `refreshTable()` re-sort/re-filter instead of an in-place cell patch

- Filter search inputs and checkboxes no longer lose focus while game details are loading progressively: `updateRow` now updates only the three data cells in-place (score, main, extra) instead of replacing the entire `<tr>`, and `updateFilterOptions` appends new options surgically without rebuilding the filter panel HTML; a full panel rebuild is still done when a new dimension first appears, but focus is saved and restored around it

- Game-details rate limiter no longer counts cache hits. The limit exists to throttle upstream Steam/HLTB calls, but it previously counted every request equally — so refreshing an already-loaded comparison (all cache hits) could exhaust the budget and `429` itself, leaving rows blank. Cache hits now bypass the limiter entirely
- Game-details loading now retries once after a `429`, waiting out the rate-limit window (honoring `Retry-After`), so first-time loads of very large shared libraries recover instead of leaving rows blank
- Game-details loading now checks the HTTP response status before parsing; a `502` error body is no longer stored as game details, which previously left rows rendered blank (no rating/HLTB) instead of falling back gracefully
- Cache loader now distinguishes `ENOENT` (expected on first run) from other errors (JSON parse failure, I/O error); non-ENOENT errors are logged as warnings instead of silently discarded, preventing a corrupted `cache.json` from resetting the cache without any indication
- Cache loader now falls back to `cache.json.tmp` if `cache.json` fails to load, recovering entries from the last in-progress write

### Added

- Filter panel: active filters are shown as removable chips (e.g. "Genre: Action ×") between the header and the dimension columns, making the active set immediately scannable without hunting through checkboxes
- Filter panel: each dimension (Genre, Category, Developer, Publisher) now has a live search box to narrow down long option lists
- Steam store API calls (`getGameRating`, `getAppDetails`) now go through a semaphore (max 2 concurrent) and retry up to twice on 429 responses, with `Retry-After`-aware delay or exponential backoff
- Per-IP rate limits are now configurable via `SEARCH_RATE_LIMIT_MAX` (default 10/min) and `DETAILS_RATE_LIMIT_MAX` (default 300/min)

### Changed

- Frontend detail-loading concurrency reduced from 5 to 2 to reduce the peak number of outbound Steam store requests

- `details:${appid}` cache entry split into three independent entries — `rating:${appid}`, `hltb:${appid}`, `meta:${appid}` — so each source can be cached and retried independently; only fulfilled fetches are cached (rejections are not), so a transient API failure is retried on the next request without discarding successfully-fetched data
- `getCached` now returns `undefined` for a cache miss instead of `null`, allowing `null` to be stored as a valid "no data" result (e.g. a game with no reviews, no HLTB entry, or not on the Steam Store)
- `getGameRating` and `getAppDetails` now throw on non-ok HTTP responses instead of returning `null`, so `Promise.allSettled` can distinguish fetch failures from legitimate "no data" results
- `getHLTB` now throws on auth unavailability, 401/403, and non-ok responses instead of returning `null`; auth is checked before acquiring the concurrency semaphore so a failed auth does not block the queue

- Cache TTL is now resolved from config by key prefix (`getTtlForKey`) rather than being stored in each entry or passed on every read; `getCached` and `setCache` no longer accept a `ttlMs` argument

### Fixed

- Expired cache entries are now evicted on startup; previously they lingered in memory until lazily evicted on first read after a restart
- Removed stale migration guard that re-fetched `details:` cache entries lacking a `meta` field; any such entry has long since expired under the 7-day TTL

- Filter no longer shows games whose Store API metadata fetch failed (null meta): previously `gameMatchesFilters` returned `true` for any falsy meta, conflating "still loading" with "fetch failed"; now only `game.loading === true` bypasses filtering — games with `meta: null` are correctly excluded when any filter is active

- Steam Store API is now requested with `&l=english` so genres and categories are always returned in English instead of the server's IP-geolocated locale
- `/api/game-details` no longer serves cached entries that predate the `meta` field; those entries have `meta: undefined` and are re-fetched transparently so the filter panel populates correctly after upgrading; entries written since the change have `meta: null` (explicit) on Store API failure and are still served from cache normally

- `slotHtml` now validates that `profileurl` starts with `http://` or `https://` before injecting it into an `href` attribute; previously `esc()` did not strip dangerous URL schemes, so a `javascript:` URL would have passed through unchanged and executed on click
- `sortedGames` HLTB sort now uses `?? Infinity` instead of `|| Infinity`; the `||` form incorrectly treated a `0`-hour value as unknown and sorted it to the bottom, because `0` is falsy

### Added

- `normalizeInput`, `scoreColor`, `fmtH`, and `esc` extracted from the inline script into `public/utils.js`, loaded via `<script src>` and testable in Node without a browser (`if (typeof module !== 'undefined') module.exports = ...`); unit tests added in `test/frontend-utils.test.js` (23 new tests, 115 total)
- `getAppDetails(appid)` fetches genres, categories, developers and publishers from the Steam Store API (`store.steampowered.com/api/appdetails`) and adds them as `meta` to the `/api/game-details/:appid` response; data is cached under the same `details:` key (7-day TTL); partial failures are tolerated via `Promise.allSettled` so a rate-limit or timeout on the Store API does not break ratings or HLTB
- Filter panel below the search card lets users narrow results by genre, category, developer and publisher; options populate progressively as game details load; filters are ANDed across dimensions and ORed within each dimension; groups with no matching games are hidden; the results count shows `N / total` when filters are active; games whose metadata has not yet loaded are always shown (not filtered out)
- Filter state is encoded in the URL (`?u=alice&u=bob&genre=Action&cat=Co-op`) so filtered views can be shared and bookmarked; filter params are updated via `replaceState` on every change (fixed dimension order: `genre`, `cat`, `dev`, `pub`; values sorted alphabetically within each); `loadFromUrl` and `popstate` restore the full filter state on page load and back/forward navigation

- `server.js` now exports `{ app }` and guards `app.listen` with `require.main === module` so the app can be imported by tests without binding a port; `STEAM_API_KEY` is now read at request time (not module load) so it can be toggled per-test, and rate limiters are skipped when `NODE_ENV=test`
- TTL constants (`CACHE_TTL_MS`, `DETAILS_CACHE_TTL_MS`) extracted to `lib/config.js`; previously the `DETAILS_CACHE_TTL_MS` formula was copy-pasted in both `steam.js` and `server.js` with two independent default values that could silently diverge
- The `name` query parameter on `/api/game-details/:appid` is now capped at 200 characters before being forwarded to HLTB, preventing oversized strings from inflating outbound request payloads
- `/api/health` now includes `cache: { entries: N }` so it is useful for monitoring the running instance
- Added `morgan('dev')` access logging (skipped in `NODE_ENV=test`) and server-side logging for upstream errors in `/api/common-games` and for rejected `Promise.allSettled` settlements in `/api/game-details`
- `getPlayerSummaries` now caches each player individually under `player:${steamid}` instead of the entire batch under a combined key, so overlapping searches (e.g. [A,B] then [A,B,C]) reuse already-fetched summaries instead of making a redundant API call
- Fixed CLAUDE.md: HLTB similarity threshold was documented as 0.4 but the code uses 0.35 (lowered intentionally to catch edition-suffix mismatches)
- Added `process.on('unhandledRejection')` handler to log and survive promise rejections that escape the try/catch blocks; without it, Node ≥15 crashes the process silently
- Cache is now written atomically: data goes to `cache.json.tmp` first, then renamed over `cache.json`, so a crash mid-write can no longer corrupt the cache file
- `/api/common-games` now returns 502 when the Steam API itself returns an error, and 504 on request timeout, instead of incorrectly returning 400 (Bad Request) for upstream failures; user errors (unknown account, private library) still return 400
- `/api/common-games` now validates that slot values are non-empty strings, returning a clean 400 instead of leaking an internal TypeError when a slot contains `null`, a number, or an empty string
- `getCached` now deletes expired entries on read instead of leaving them in the Map until the next save cycle, freeing memory sooner (especially relevant for large game-library entries)
- Cache save timer is now unref'd so a naturally-exiting process is not held alive for 5 s waiting for the debounce to fire (the `process.on('exit')` handler already flushes synchronously)
- `evictExpired` now uses the TTL stored with each entry instead of a single global max-age, so short-lived `games:` and `players:` entries (60 min) are evicted promptly rather than accumulating for 7 days; `setCache` accepts the TTL as a third argument and all callers have been updated

- Extracted in-flight dedup helper to `lib/dedup.js` (`createDedup`) and replaced the duplicate `_detailsInFlight` block in `server.js` with a call to it, eliminating two independent copies of the same pattern
- HLTB auth init now backs off for 30 s after a failed init request instead of retrying on every queued search
- `getHLTB` now returns null immediately when the game name reduces to an empty string after stripping trademark symbols, avoiding a pointless API round-trip
- HLTB auth thundering herd: concurrent calls that find the token expired now share a single in-flight init request instead of each firing their own
- Steam API cache stampede: concurrent requests for the same vanity URL, library, or player summaries now share a single in-flight fetch instead of each issuing a duplicate API call
- Game-details cache stampede: concurrent requests for the same appid now share a single in-flight fetch (Steam reviews + HLTB) instead of queuing duplicate work through the HLTB concurrency cap

- HLTB lookups now succeed for games with edition suffixes (e.g. "Spiritfarer®: Farewell Edition", "Batman: Arkham Asylum GOTY Edition") — punctuation was stripped from search terms and common edition words ("Edition", "Definitive", "GOTY", etc.) are now excluded to avoid HLTB's strict AND-matching returning empty results
- Lowered HLTB similarity threshold from 0.4 to 0.35 to catch cases where the Steam title includes a subtitle/edition but HLTB only indexes the base title (e.g. "Spiritfarer" vs "Spiritfarer: Farewell Edition", score was 0.379)
- Games with punctuation in their name (colons, em dashes, standalone hyphens) now return HLTB results correctly

### Added

- Integration tests for all route handlers via supertest (`test/server.test.js`): health configured flag, all `POST /api/common-games` validation cases (missing slots, empty slot, null/empty values, too many users, missing API key), happy-path grouping, legacy `users` array, 502 on upstream failure, 400 on private library, `GET /api/game-details` appid validation, cache-hit path, fresh rating+HLTB fetch, and partial failure (null rating) via `Promise.allSettled`
- Unit tests for `createDedup` in `test/dedup.test.js`, covering basic resolution, concurrent-call deduplication, post-resolve retry, post-reject retry, and independent keys
- Unit tests for `resolveSteamId`, `getOwnedGames`, and `getPlayerSummaries` in `test/steam.test.js`, covering Steam64 bypass, API fetch, cache hits, upstream errors, private library, and order-independent cache key
- Unit tests for `cache.js`: TTL checking, eager expiry deletion, entry overwrite, and no-`ttlMs` fallback behaviour (`test/cache.test.js`)
- `TRUST_PROXY` env var to configure Express `trust proxy` (needed for correct rate-limit IPs behind a reverse proxy)
- Steam Family support: click `+` next to any player to add a family member whose library is merged (unioned) into that slot before computing common games
- URL encoding updated to support multi-account slots (`?u=alice,bob_family&u=charlie`); old single-account URLs remain fully compatible
- URL is now canonical: slot members and slots themselves are sorted alphabetically, so the same comparison always produces the same shareable URL

## [0.1.0] - 2026-06-16

### Added

- Compare Steam libraries across multiple users by Steam ID, vanity URL, or profile URL
- Group common games by exact set of owners (from most to fewest)
- Wilson score lower bound (95% confidence) from Steam review data
- HowLongToBeat completion times via direct API integration (no npm package)
- Persistent disk cache with separate TTLs for stable vs. frequently-changing data
- URL sharing via `?u=` query params with browser history support
- Progressive loading of ratings and HLTB data (up to 5 concurrent requests)
