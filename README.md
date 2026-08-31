# Steam Common Games

Find games shared across multiple Steam libraries, with ratings and completion times.

For each shared game it shows:
- **Score** — Wilson score lower bound (same formula as SteamDB)
- **Main Story** and **Main + Extra** hours from HowLongToBeat

Results are grouped by who shares each game (e.g. all 3 players, or just 2 of 3), so you can see the full picture when libraries partially overlap.

**Steam Family sharing** is supported: click `+` next to any player to add a family member — their libraries are merged before the comparison so shared games show up correctly.

## Setup

```bash
echo "STEAM_API_KEY=your_key_here" > .env   # only required setting
npm install
npm run build          # build the frontend (TypeScript) to dist/
npm start              # http://127.0.0.1:3000
```

Get a Steam API key at <https://steamcommunity.com/dev/apikey>.

## Configuration

`default.env` (committed to the repo) contains all settings with their defaults and documentation. Create a `.env` file with only the values you want to override — `STEAM_API_KEY` is the only required one:

```
STEAM_API_KEY=your_key_here
```

The full list of available settings is in `default.env`.

## Development

```bash
npm run dev:web    # Vite dev server on :5173 — HMR, TS sources, /api proxied to :3000
npm run dev        # Express backend on :3000, restarts on file changes
npm test           # run unit tests
npm run typecheck  # strict tsc over public/*.ts
```

The frontend is TypeScript; run both `dev:web` and `dev` for development and use `http://localhost:5173`. `npm run build` + `npm start` serves the bundled production frontend on `:3000`.

Application data is stored in `db.sqlite` (gitignored); currently this is all cache tables. Run `npm run cache:clear` to wipe the cache entries without deleting the database file itself.

## Architecture

- **`server.js`** — Express routes
- **`lib/cache.js`** — Disk-persistent cache with TTL
- **`lib/config.js`** — Shared TTL constants
- **`lib/dedup.js`** — In-flight request deduplicator
- **`lib/steam.js`** — Steam API + Wilson score rating
- **`lib/hltb.js`** — HowLongToBeat search (direct API, no npm package)
- **`lib/groupGames.js`** — Groups libraries by owner set
- **`public/index.html`** — Frontend shell (vanilla TS, no framework)
- **`public/app.ts`** — Main frontend logic
- **`public/types.ts`** — Shared frontend types
- **`public/utils.ts`** — Shared utilities (also unit-tested in Node)
- **`public/style.css`** — Page styles
