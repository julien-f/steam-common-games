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
- **`lib/steam.js`** — Steam API calls (`resolveSteamId`, `getOwnedGames`, `getPlayerSummaries`, `getGameRating`, `getAppDetails`, `getSteamSpyTags`).
- **`lib/hltb.js`** — HLTB auth + search (`getHLTB`), plus exported `stringSimilarity` and `levenshtein` for unit testing.
- **`lib/groupGames.js`** — Groups slot libraries by exact ownership set (`groupByOwnership`).
- **`public/index.html`** — Single-page frontend shell (vanilla JS, no framework).
- **`public/app.js`** — Main frontend JS: search flow, SSE streaming, rendering, panel, filtering/sorting, URL state.
- **`public/lightbox.js`** — Screenshot/video lightbox: `initLightbox({ onParamChange })`, `openLightbox(game, idxOrShotId)`, `closeLightbox()`, `stepLightbox(dir)`, `isLightboxOpen()`. Manages its own DOM (lazy singleton), HLS playback, zoom/pan, touch/swipe, focus trap, and loading indicator. Depends on `buildMediaItems`/`resolveShotIndex` from `mediaItems.js`.
- **`public/mediaItems.js`** — Builds the ordered media item list for a game (`buildMediaItems(appid, meta)`) and resolves a shot identifier to an index (`resolveShotIndex(shots, idxOrShotId)`). Exported for Node unit tests.
- **`public/urlState.js`** — Parses the URL search string into structured state (`parseUrlState(search)`) and exports `FILTER_DIMS`. Exported for Node unit tests.
- **`public/utils.js`** — Shared rendering utilities (`normalizeInput`, `scoreColor`, `fmtH`, `fmtPlaytime`, `foldStr`, `esc`, `renderScoreCell`, `renderMainCell`, `renderExtraCell`); exported for Node unit tests.
- **`public/style.css`** — All page styles.

### Request flow

1. Frontend POSTs `{ slots: [["alice", "bob_family"], ["charlie"]] }` to `/api/common-games`. Each slot is a logical player — multiple accounts in a slot have their libraries unioned before comparison (Steam Family simulation). Legacy `{ users: [...] }` is also accepted and treated as single-account slots.
2. Server resolves every identifier to a Steam64 ID, deduplicates within each slot, fetches all libraries in one parallel pass, unions libraries per slot, groups games by exact set of slot owners, returns `{ groups, slots }`.
3. Frontend renders groups immediately (one table per owner set, from most owners to fewest), then POSTs the full game list to `POST /api/game-details/stream` (SSE endpoint) to load rating, HLTB, store metadata, and tags progressively in a single connection. The legacy `GET /api/game-details/:appid` endpoint still exists for direct API consumers.

### Ratings — Wilson score

The score shown is the **Wilson score lower bound** at 95% confidence, computed from Steam's own review counts (`store.steampowered.com/appreviews/:appid`). This is the same formula SteamDB uses. Do not replace it with a simple positive/total ratio.

### HLTB — no npm package

The `howlongtobeat` npm package was removed (it pulled in a vulnerable `axios`). HLTB is called directly with a two-step auth flow:

1. `GET https://howlongtobeat.com/api/bleed/init?t={ms}` → returns `{ token, hpKey, hpVal }`
2. `POST https://howlongtobeat.com/api/bleed` with `X-Auth-Token`, `X-Hp-Key`, `X-Hp-Val` headers and `{ [hpKey]: hpVal, ...payload }` in the body

The token is cached in memory for 5 minutes (not on disk — it's session-bound). A 401/403 from the search endpoint clears the cache so the next call re-fetches. Match quality is checked via Levenshtein similarity; results below 0.35 are discarded.

If HLTB breaks again, recent npm packages (e.g. `howlongtobeat-ts`) tend to reverse-engineer the new flow quickly and are a good first place to look.

### Cache

The cache is a SQLite database (`cache.db`) opened via the built-in `node:sqlite` module (`DatabaseSync`). WAL mode is enabled for better concurrent write throughput. Entries are evicted at startup and lazily on read. No debounced flush or exit hooks — every write goes directly to SQLite. Set `CACHE_FILE=` (empty) in `.env` to use an in-memory database. Three TTLs apply:

| Key prefix | TTL env var | Default | Reason |
|---|---|---|---|
| `resolve:` | `RESOLVE_CACHE_TTL_MINUTES` | 7 days | Steam ID resolution |
| `rating:` | `RATING_CACHE_TTL_MINUTES` | 14 days | Steam review scores |
| `hltb:`, `meta:`, `tags:` | `META_CACHE_TTL_MINUTES` | 30 days | Store metadata, HLTB, tags |
| `games:`, `player:` | `LIBRARY_CACHE_TTL_MINUTES` | 60 min | Changes when users buy games |

Delete `cache.db` to force a full refresh.

### URL / sharing

Players are encoded as `?u=` query params. A single-account player is `?u=alice`; a multi-account slot (Steam Family) is `?u=alice,bob_family` (comma-joined). Old single-account URLs are fully compatible. Members within each slot and slots themselves are sorted alphabetically so the same comparison always produces the same URL. `history.pushState` is used for explicit searches; `pushState: false` is used when restoring from URL on load or back/forward navigation to avoid polluting history.

## Changelog

Always update `CHANGELOG.md` before committing any code change. Add entries under `## [Unreleased]` (create the section if it doesn't exist) using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format (Added / Changed / Fixed / Removed).
