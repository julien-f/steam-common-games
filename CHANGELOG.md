# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- HLTB auth thundering herd: concurrent calls that find the token expired now share a single in-flight init request instead of each firing their own
- Steam API cache stampede: concurrent requests for the same vanity URL, library, or player summaries now share a single in-flight fetch instead of each issuing a duplicate API call
- Game-details cache stampede: concurrent requests for the same appid now share a single in-flight fetch (Steam reviews + HLTB) instead of queuing duplicate work through the HLTB concurrency cap

- HLTB lookups now succeed for games with edition suffixes (e.g. "Spiritfarer®: Farewell Edition", "Batman: Arkham Asylum GOTY Edition") — punctuation was stripped from search terms and common edition words ("Edition", "Definitive", "GOTY", etc.) are now excluded to avoid HLTB's strict AND-matching returning empty results
- Lowered HLTB similarity threshold from 0.4 to 0.35 to catch cases where the Steam title includes a subtitle/edition but HLTB only indexes the base title (e.g. "Spiritfarer" vs "Spiritfarer: Farewell Edition", score was 0.379)
- Games with punctuation in their name (colons, em dashes, standalone hyphens) now return HLTB results correctly

### Added

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
