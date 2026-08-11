# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
echo "STEAM_API_KEY=your_key_here" > .env   # first time only — only required setting
npm install                                  # first time only
npm start                                    # or: npm run dev  (restarts on file changes)
```

The server binds to `http://127.0.0.1:3000` by default. `default.env` (committed to the repo) holds all settings with their defaults and documentation. Create `.env` (gitignored) with only the values you want to override — `STEAM_API_KEY` is the only required one. The server exits immediately at startup with a clear error message if it is missing.

## Architecture

- **`server.js`** — Express setup and route handlers only.
- **`lib/cache.js`** — Persistent cache (`getCached`, `setCache`), disk I/O, process exit hooks.
- **`lib/config.js`** — TTL constants (`LIBRARY_CACHE_TTL_MS`, `RESOLVE_CACHE_TTL_MS`, `RATING_CACHE_TTL_MS`, `META_CACHE_TTL_MS`) shared across modules.
- **`lib/dedup.js`** — In-flight request deduplicator (`createDedup`): concurrent calls for the same key share one promise.
- **`lib/steam.js`** — Steam API calls (`resolveSteamId`, `getOwnedGames`, `getWishlist`, `getPlayerSummaries`, `getGameRating`, `getAppDetails`, `getSteamSpyTags`).
- **`lib/hltb.js`** — HLTB auth + search (`getHLTB`), plus exported `stringSimilarity` and `levenshtein` for unit testing.
- **`lib/groupGames.js`** — Groups slot libraries by exact ownership set (`groupByOwnership`).
- **`public/index.html`** — Single-page frontend shell (vanilla JS, no framework).
- **`public/app.js`** — Main frontend JS: search flow, SSE streaming, rendering, filtering/sorting, URL state, and the page-specific parts of the side panel (owner list, tag-click filtering, prev/next/random nav bar) built on top of `panel.js`.
- **`public/panel.js`** — Shared game detail side panel: `initPanel(options)`, `panelOpen(game)`, `panelClose()`, `isPanelOpen()`, `getPanelGame()`, `panelStepHero(dir, { wrap })`, `pickRandomFrom(list, queueKey, currentAppid)`/`clearRandomQueue`/`clearAllRandomQueues`. Renders the hero carousel, score/HLTB/tags/links body, and handles swipe gestures; used by both `app.js` and `library.js`. Page-specific bits (owner list, tag-click filtering, nav bar) are supplied via `options` or layered on by the host page wrapping `panelOpen`/`panelClose`.
- **`public/lightbox.js`** — Screenshot/video lightbox: `initLightbox({ onParamChange })`, `openLightbox(game, idxOrShotId)`, `closeLightbox()`, `stepLightbox(dir)`, `isLightboxOpen()`. Manages its own DOM (lazy singleton), HLS playback, zoom/pan, touch/swipe, focus trap, and loading indicator. Depends on `buildMediaItems`/`resolveShotIndex` from `mediaItems.js`.
- **`public/mediaItems.js`** — Builds the ordered media item list for a game (`buildMediaItems(appid, meta)`) and resolves a shot identifier to an index (`resolveShotIndex(shots, idxOrShotId)`). Exported for Node unit tests.
- **`public/urlState.js`** — Parses the URL search string into structured state (`parseUrlState(search)`) and exports `FILTER_DIMS`. Exported for Node unit tests.
- **`public/utils.js`** — Shared rendering utilities (`normalizeInput`, `scoreColor`, `fmtH`, `fmtPlaytime`, `foldStr`, `esc`, `renderScoreCell`, `renderMainCell`, `renderExtraCell`, `computeSteamdbRating`); exported for Node unit tests.
- **`public/library.html`** / **`public/library.js`** — Library Explorer: browse one player's full Steam library, or their wishlist, in a sortable/filterable/groupable table (`@vates/data-table-vanilla`, an npm dependency; `server.js` serves its `dist/` files straight from `node_modules`, resolved via an import map in `library.html`). A Library/Wishlist tab toggle switches between the two; each keeps independent table view state (`?view=`/`?wview=` URL params) and random-pick history. The wishlist is read-only — Steam has no key-based way to mutate it, only session-authenticated calls as the logged-in user, which this app doesn't support. Reuses `panel.js`/`lightbox.js`/`mediaItems.js`/`utils.js` for the same row-click side panel as the comparison page, minus the owner list and tag-click filtering.
- **`public/style.css`** — All page styles.

### Request flow

1. Frontend POSTs `{ slots: [["alice", "bob_family"], ["charlie"]] }` to `/api/common-games`. Each slot is a logical player — multiple accounts in a slot have their libraries unioned before comparison (Steam Family simulation). Legacy `{ users: [...] }` is also accepted and treated as single-account slots.
2. Server resolves every identifier to a Steam64 ID, deduplicates within each slot, fetches all libraries in one parallel pass, unions libraries per slot, groups games by exact set of slot owners, returns `{ groups, slots }`.
3. Frontend renders groups immediately (one table per owner set, from most owners to fewest), then POSTs the full game list to `POST /api/game-details/stream` (SSE endpoint) to load rating, HLTB, store metadata, and tags progressively in a single connection. The legacy `GET /api/game-details/:appid` endpoint still exists for direct API consumers.

### Ratings — Wilson score vs. SteamDB Rating

The comparison page's own table cell (and the "Wilson Score" column in the Library Explorer) show the **Wilson score lower bound** at 95% confidence, computed server-side in `getGameRating`/`computeRating` from Steam's own review counts (`store.steampowered.com/appreviews/:appid`). Do not replace it with a simple positive/total ratio — that's exactly the naive approach the Wilson bound is meant to avoid, since it lets a game with 2 positive reviews outrank one with 50,000 mostly-positive reviews. (SteamDB itself used to use this same formula but has since switched to a different one — see below — so don't assume parity with what SteamDB currently shows.)

Client-side, from the same `rating.positive`/`.total` numbers already delivered to the frontend (no extra backend calls), `computeSteamdbRating(positive, total)` in `public/utils.js` computes SteamDB's current formula instead: `p − (p − 0.5) × 2^(−log₁₀(n + 1))` where `p = positive/total` and `n = total reviews`. A Bayesian shrinkage toward a neutral 50% prior that fades as review volume grows (e.g. 90% positive over 100 reviews lands at 80%). SteamDB moved to this from the Wilson interval specifically because it's easier to explain to users; see [steamdb.info-issues#793](https://github.com/SteamDatabase/steamdb.info-issues/issues/793). It returns the **raw, unrounded** value — round only for display; the Library Explorer's SteamDB Rating column sorts on the unrounded number so otherwise-tied displayed integers still order deterministically, and isn't groupable (grouping keys off the raw value, which would otherwise split into a near-useless one-row-per-group table).

This one function backs two different, intentionally-asymmetric surfaces:

- **Library Explorer table** — "SteamDB Rating" is the default-visible, default-sorted score column; "Wilson Score" and "Steam %" (the raw, unadjusted ratio) both exist too, hidden by default.
- **Game detail side panel** (`public/panel.js`, shared by both pages) — shows only the SteamDB Rating (labeled just "SteamDB", linking to the game's SteamDB page — same treatment as the "Metacritic" link right below it) plus a compact reviews line (e.g. "99% positive of 465k reviews"), no Wilson score and no Steam review-summary text tier (e.g. "Very Positive"). This means the comparison page's own table cell (Wilson score) and its side panel (SteamDB Rating) intentionally show two different numbers for the same game — expected, not a bug.

### HLTB — no npm package

The `howlongtobeat` npm package was removed (it pulled in a vulnerable `axios`). HLTB is called directly with a two-step auth flow:

1. `GET https://howlongtobeat.com/api/bleed/init?t={ms}` → returns `{ token, hpKey, hpVal }`
2. `POST https://howlongtobeat.com/api/bleed` with `X-Auth-Token`, `X-Hp-Key`, `X-Hp-Val` headers and `{ [hpKey]: hpVal, ...payload }` in the body

The token is cached in memory for 5 minutes (not on disk — it's session-bound). A 401/403 from the search endpoint clears the cache so the next call re-fetches. Match quality is checked via Levenshtein similarity; results below 0.35 are discarded.

`pickBestMatch` extracts four times from the matched entry's raw fields (all in seconds, converted to rounded hours): `main` (`comp_main`), `extra` (`comp_plus`), `completionist` (`comp_100`), and `all` (`comp_all`) — HLTB's "All PlayStyles" figure. `all` is **not** an average of the other three — it's the average of every individual completion-time submission pooled together regardless of category, weighted by how many people submitted each one (`comp_all_count` equals `comp_main_count + comp_plus_count + comp_100_count`). Since far more players report a Main Story time than a Completionist one, it usually lands much closer to Main Story than to the simple midpoint of all three. It's the default-displayed HLTB column in the Library Explorer (`hltbAll`, "All (h)") and shown first (leftmost) in the side panel's How Long To Beat section as "All PlayStyles", precisely because it's a single representative number rather than one specific playstyle.

If HLTB breaks again, recent npm packages (e.g. `howlongtobeat-ts`) tend to reverse-engineer the new flow quickly and are a good first place to look.

**Compliance note:** `/api/bleed` is an undocumented, internal HLTB endpoint reached with spoofed browser `User-Agent`/`Referer` headers — this is not a published public API and isn't guaranteed to be sanctioned by HLTB's terms of service. Usage here is low-volume and non-commercial, but treat it as liable to break or be blocked without notice, and don't scale up request volume without revisiting this.

### Wishlist — undocumented endpoint

`getWishlist` calls `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid={id}`, which is not listed in Valve's published Web API docs (same unofficial-endpoint situation as HLTB above, though no spoofed headers are needed here — it works with a plain request). A private wishlist, a private profile, and a genuinely empty wishlist are all indistinguishable: each returns `200 OK` with `{"response":{}}` (no `items` key). The app treats a missing `items` key as an empty wishlist rather than surfacing an error, since there's no way to tell those cases apart.

### Database (`db.sqlite`)

`db.sqlite` is the application database, opened via the built-in `node:sqlite` module (`DatabaseSync`). It currently holds only cache tables, but is intentionally named `db.sqlite` (not `cache.db`) to accommodate non-cache data in the future. WAL mode is enabled for better concurrent write throughput. Cache entries are evicted at startup and lazily on read; every write goes directly to SQLite (no debounced flush). Set `DB_FILE=` (empty) in `.env` to use an in-memory database. Cache TTLs:

| Key prefix | TTL env var | Default | Reason |
|---|---|---|---|
| `resolve:` | `RESOLVE_CACHE_TTL_MINUTES` | 90 days | Steam ID resolution — essentially permanent |
| `rating:` | `RATING_CACHE_TTL_MINUTES` | 30 days | Steam review scores — drifts slowly |
| `hltb:`, `meta:`, `tags:` | `META_CACHE_TTL_MINUTES` | 60 days | Store metadata, HLTB, tags — rarely changes for an existing game |
| `games:`, `player:`, `wishlist:` | `LIBRARY_CACHE_TTL_MINUTES` | 6 hours | Changes when users buy games / edit their wishlist |

Run `npm run cache:clear` to wipe all cache entries without deleting the database file.

These TTLs are generous because both `getCached` and every `lib/steam.js`/`lib/hltb.js` fetch function accept `{ force: true }` to bypass the cache read for one call (the fetch still writes fresh data back to the cache). This backs two user-facing "↻ Refresh" affordances rather than being needed for background freshness:

- The **search bar's Refresh button** (comparison page and Library Explorer) re-POSTs `/api/common-games`/`/api/wishlist` with `refresh: true`, forcing fresh owned-games/player/wishlist data for that search only.
- The **side panel's Refresh button** re-fetches `GET /api/game-details/:appid?refresh=1`, forcing fresh rating/HLTB/store metadata/tags for that one game only. This request always counts against `DETAILS_RATE_LIMIT_MAX` (the rate limiter's cache-hit skip is disabled for `refresh=1`, since a forced call never is a cache hit).

Neither refresh path touches `resolve:` — a vanity-URL mapping isn't expected to change, so there's no user-facing reason to force it.

### URL / sharing

Players are encoded as `?u=` query params. A single-account player is `?u=alice`; a multi-account slot (Steam Family) is `?u=alice,bob_family` (comma-joined). Old single-account URLs are fully compatible. Members within each slot and slots themselves are sorted alphabetically so the same comparison always produces the same URL. `history.pushState` is used for explicit searches; `pushState: false` is used when restoring from URL on load or back/forward navigation to avoid polluting history.

## Changelog

Always update `CHANGELOG.md` before committing any code change. Add entries under `## [Unreleased]` (create the section if it doesn't exist) using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format (Added / Changed / Fixed / Removed).
