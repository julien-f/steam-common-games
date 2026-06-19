# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
cp .env.example .env   # first time only — then fill in STEAM_API_KEY
npm install            # first time only
npm start              # or: npm run dev  (restarts on file changes)
```

The server binds to `http://127.0.0.1:3000` by default. All settings live in `.env` (gitignored); see `.env.example` for the full list with comments.

## Architecture

- **`server.js`** — Express setup and route handlers only.
- **`lib/cache.js`** — Persistent cache (`getCached`, `setCache`), disk I/O, process exit hooks.
- **`lib/config.js`** — TTL constants (`CACHE_TTL_MS`, `DETAILS_CACHE_TTL_MS`) shared across modules.
- **`lib/dedup.js`** — In-flight request deduplicator (`createDedup`): concurrent calls for the same key share one promise.
- **`lib/steam.js`** — Steam API calls (`resolveSteamId`, `getOwnedGames`, `getPlayerSummaries`, `getGameRating`, `getAppDetails`, `getSteamSpyTags`).
- **`lib/hltb.js`** — HLTB auth + search (`getHLTB`), plus exported `stringSimilarity` and `levenshtein` for unit testing.
- **`lib/groupGames.js`** — Groups slot libraries by exact ownership set (`groupByOwnership`).
- **`public/index.html`** — Single-page frontend shell (vanilla JS, no framework).
- **`public/app.js`** — Main frontend JS (split from `index.html`).
- **`public/utils.js`** — Shared utilities (`normalizeInput`, `scoreColor`, `fmtH`, `esc`); also exported for Node unit tests.
- **`public/style.css`** — All page styles (split from `index.html`).

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

The cache is an in-memory `Map` backed by `cache.json` (written with a 5 s debounce, flushed synchronously on exit). Two TTLs apply:

| Key prefix | TTL env var | Default | Reason |
|---|---|---|---|
| `resolve:`, `rating:`, `hltb:`, `meta:`, `tags:` | `DETAILS_CACHE_TTL_MINUTES` | 7 days | Stable data |
| `games:`, `player:` | `CACHE_TTL_MINUTES` | 60 min | Changes when users buy games |

Delete `cache.json` to force a full refresh.

### URL / sharing

Players are encoded as `?u=` query params. A single-account player is `?u=alice`; a multi-account slot (Steam Family) is `?u=alice,bob_family` (comma-joined). Old single-account URLs are fully compatible. Members within each slot and slots themselves are sorted alphabetically so the same comparison always produces the same URL. `history.pushState` is used for explicit searches; `pushState: false` is used when restoring from URL on load or back/forward navigation to avoid polluting history.

## Changelog

Always update `CHANGELOG.md` before committing any code change. Add entries under `## [Unreleased]` (create the section if it doesn't exist) using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format (Added / Changed / Fixed / Removed).
