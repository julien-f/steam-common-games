# steam.isonoe.net

Explore Steam libraries as lists of games — one account's owned games or wishlist, a bundle, or a list you build yourself — with ratings, completion times and current prices in one sortable table.

Combine lists to answer the questions Steam can't: what two friends both own, what's on your wishlist but already owned by someone in your family, what a bundle adds that you don't have yet. Steam Families are supported as a single merged account.

![A bundle's games in the sortable table — tier price, best deal, weighted rating, completion time — with one game's detail panel open beside it](docs/images/list-table-and-panel.png)

[Setup](#setup) · [Development](#development) · [Documentation](#documentation)

- [What the app does](docs/user/features.md) — the full feature tour
- [Configuration](docs/user/configuration.md) — every setting

## Setup

```bash
echo "STEAM_API_KEY=your_key_here" > .env   # only required setting
npm install
npm run build          # bundle the frontend to dist/
npm start              # http://127.0.0.1:3000
```

Get a Steam API key at <https://steamcommunity.com/dev/apikey>. An optional `ITAD_API_KEY` ([get one](https://isthereanydeal.com/apps/new/)) enables bundle browsing and price columns; everything else works without it. All settings and their defaults are documented in `default.env` — put overrides in `.env`.

## Development

```bash
npm run dev             # Vite on :58991 + Express on :3000, together
npm test                # Node's test runner
npm run typecheck       # tsc --noEmit over public/
npm run lint            # eslint-plugin-solid over public/
```

Open `http://localhost:58991` in dev (not `:3000` — that serves the last `npm run build`).

A `pre-commit` hook runs the test suite before every commit. `.git/` isn't version-controlled, so recreate it after a fresh clone:

```bash
printf '#!/bin/sh\nnpm test\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

Application data lives in `db.sqlite` (gitignored); today it holds only cache tables. `npm run cache:clear` empties them without deleting the file.

## Documentation

### User

- [features.md](docs/user/features.md) — what the app does, feature by feature, with screenshots
- [configuration.md](docs/user/configuration.md) — every setting worth setting, and what the rest default to

### Development

- [architecture.md](docs/dev/architecture.md) — backend, build, API routes, request flow
- [frontend.md](docs/dev/frontend.md) — the SPA: routes, modules, reactivity, table, panel
- [lists-and-accounts.md](docs/dev/lists-and-accounts.md) — the account/list data model
- [integrations.md](docs/dev/integrations.md) — Steam, HLTB, IsThereAnyDeal, ProtonDB
- [data.md](docs/dev/data.md) — database, cache tiers, refresh paths
- [observability.md](docs/dev/observability.md) — metrics endpoint and log warnings
- [decisions.md](docs/dev/decisions.md) — computed ratings and heuristics

Screenshots used by the docs live in [docs/images/](docs/images).

`CLAUDE.md` holds the working conventions for this repo (style, git and development workflow).
