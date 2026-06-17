# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- TTL constants (`CACHE_TTL_MS`, `DETAILS_CACHE_TTL_MS`) extracted to `lib/config.js`; previously the `DETAILS_CACHE_TTL_MS` formula was copy-pasted in both `steam.js` and `server.js` with two independent default values that could silently diverge
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
