# Steam Common Games

Find games shared across multiple Steam libraries, with ratings and completion times.

For each shared game it shows:
- **Score** — Wilson score lower bound (same formula as SteamDB)
- **Main Story** and **Main + Extra** hours from HowLongToBeat

Results are grouped by who shares each game (e.g. all 3 players, or just 2 of 3), so you can see the full picture when libraries partially overlap.

**Steam Family sharing** is supported: click `+` next to any player to add a family member — their libraries are merged before the comparison so shared games show up correctly.

## Setup

```bash
cp .env.example .env   # then add your Steam API key
npm install
npm start              # http://127.0.0.1:3000
```

Get a Steam API key at <https://steamcommunity.com/dev/apikey>.

## Configuration

All settings are in `.env` (see `.env.example` for the full list with comments):

| Variable | Default | Description |
|---|---|---|
| `STEAM_API_KEY` | — | Required. Your Steam Web API key. |
| `HOST` | `127.0.0.1` | Interface to bind to. Use `0.0.0.0` to expose on the network. |
| `PORT` | `3000` | HTTP port. |
| `CACHE_TTL_MINUTES` | `60` | TTL for libraries and player profiles. |
| `DETAILS_CACHE_TTL_MINUTES` | `10080` | TTL for ratings and HLTB data (7 days). |

## Development

```bash
npm run dev    # restarts on file changes
npm test       # run unit tests
```

Cache is stored in `cache.json` (gitignored). Delete it to force a full refresh.

## Architecture

- **`server.js`** — Express routes
- **`lib/cache.js`** — Disk-persistent cache with TTL
- **`lib/config.js`** — Shared TTL constants
- **`lib/dedup.js`** — In-flight request deduplicator
- **`lib/steam.js`** — Steam API + Wilson score rating
- **`lib/hltb.js`** — HowLongToBeat search (direct API, no npm package)
- **`lib/groupGames.js`** — Groups libraries by owner set
- **`public/index.html`** — Frontend shell (vanilla JS, no framework)
- **`public/app.js`** — Main frontend logic
- **`public/utils.js`** — Shared utilities (also unit-tested in Node)
- **`public/style.css`** — Page styles
