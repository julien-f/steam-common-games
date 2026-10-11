# Architecture

An Express backend (`server.js` + `lib/*`, plain CommonJS JavaScript) serving a Solid.js single-page app (`public/*`, TypeScript, bundled by Vite). The backend is a caching proxy over Steam/HLTB/IsThereAnyDeal/ProtonDB/Fanatical; accounts, lists and preferences live in the browser's `localStorage`, and the server stores them only for a signed-in user who syncs (`users`, `sessions`, `user_prefs` — [data.md](data.md)).

- [frontend.md](frontend.md) — the SPA: shell, routes, module map, reactivity rules
- [lists-and-accounts.md](lists-and-accounts.md) — the account/list data model the frontend is built around
- [integrations.md](integrations.md) — every upstream, and what's undocumented about each
- [data.md](data.md) — `db.sqlite`, cache tiers, refresh paths
- [observability.md](observability.md) — `/api/metrics`, budgets, proactive log warnings
- [decisions.md](decisions.md) — computed values (Weighted Rating, Production Tier), tooling choices, and why

Setup and dev commands are in [README.md](../../README.md); tests and hooks in [testing.md](testing.md).

## Build and serving

- `npm run build` (`vite build`) bundles `public/`'s single HTML entry into `dist/` (gitignored). `server.js` serves `dist/` when `dist/index.html` exists, else `public/` raw — which browsers can't run (TypeScript), so a fresh clone needs a build before `npm start`.
- In dev, Vite (`npm run dev:frontend`, `root: 'public'`) serves the sources and proxies `/api` to Express on `:3000`. Its port is pinned (`server.port`/`strictPort`): a different port is a different origin, so a fallback port would reset localStorage, cookies and sign-in.
- `publicDir: false`: `public/` is source, not passthrough assets, and the name would collide with Vite's own `publicDir` convention.
- **SPA fallback**: routes are real paths (`/lists/owned`, `/game/440`), so `server.js` ends with a catch-all (`app.get(/^\/(?!api\/)(?!.*\.[a-zA-Z0-9]+$).*/)`) sending `index.html` after the API routes and static files. Vite's dev server does this by itself.

## Backend modules

- **`server.js`** — Express setup and route handlers only; all upstream work lives in `lib/*`.
- **`lib/config.js`** — loads `.env` over `default.env` and exports the TTLs, budgets, session lifetime and upstream pacing shared across modules.
- **`lib/db.js`** — opens `db.sqlite` and applies its append-only `MIGRATIONS` ([data.md](data.md)).
- **`lib/cache.js`** — persistent cache over `db.sqlite` (`getCached`, `setCache`, `GROUPS`).
- **`lib/dedup.js`** — `createDedup`: concurrent calls for the same key share one promise.
- **`lib/steam.js`** — Steam Web API and store calls (`resolveSteamId`, `getOwnedGames`, `getWishlist`, `getFriendList`, `getPlayerSummaries`, `getGameRating`, `getAppDetails`, `getSteamTags`, `getGameDemo`, `searchStoreGames`, `getGameNews`, …), ProtonDB, and their per-host semaphores (`storeLimit`/`tagLimit`/`protonLimit`).
- **`lib/hltb.js`** — HLTB auth + search (`getHLTB`), behind its own semaphore (`hltbLimit`).
- **`lib/itad.js`** — IsThereAnyDeal calls (`getSteamShopId`, `getBundles`, `resolveSteamAppIds`, prices) behind bundle browsing and every price column.
- **`lib/fanatical.js`** — Fanatical's storefront feed, for pick-and-mix tier prices ([integrations.md](integrations.md#fanatical--pick-and-mix-tier-prices)).
- **`lib/upstream.js`** — `createSemaphore` (concurrency cap + per-slot pacing, registered for `GET /api/metrics`) and `upstreamError`, shared by the upstream clients.
- **`lib/circuitBreaker.js`** — one 403-storm breaker per blocking-prone upstream (Steam store, HLTB, ProtonDB).
- **`lib/metrics.js`** — `trackedFetch`, outbound budgets and the counters behind `GET /api/metrics` ([observability.md](observability.md)).
- **`lib/auth.js`** — Steam OpenID 2.0 sign-in, cookie sessions and per-key user prefs, behind `/auth/*` and `/api/me*`.

The dedup map, semaphores, breakers and metrics are process-local: correct for the single-process deployment, but several instances would each get their own and multiply upstream traffic silently.

## Tooling

- **`tsconfig.json`** — `strict`, `noEmit`, `moduleResolution: bundler`, `verbatimModuleSyntax` (type-only imports use `import type`), over `public/**/*.ts`; `paths: {"/*": ["./public/*"]}` maps the browser-style absolute imports (`'/utils.ts'`) onto the source tree. `tsconfig.e2e.json` extends it over `e2e/`. The compiler is TypeScript 7 (`tsgo`).
- **`eslint.config.mjs`** — `eslint-plugin-solid`'s `flat/typescript` rules only, parsed by `@babel/eslint-parser` ([decisions.md](decisions.md#linting-babel-not-typescript-eslint)). `solid/reactivity` is the rule that matters ([frontend.md](frontend.md#reactivity)). `.mjs` because `package.json` has no `"type": "module"`.
- **Prettier** (`.prettierrc.json`) formats the whole tree.

## API routes

| Route                                                                    | Purpose                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/common-games`                                                 | Resolve identifiers, fetch + union owned libraries per slot, group by owner set                                                                                                                                                                                                                         |
| `POST /api/wishlist`                                                     | One account's (or Family's) wishlist                                                                                                                                                                                                                                                                    |
| `POST /api/friends`                                                      | One account's (or Family's) union of friends, cross-referenceable against another account's own friends client-side                                                                                                                                                                                     |
| `GET /api/game-details/:appid`                                           | Rating, HLTB, store metadata, tags, ProtonDB for one game                                                                                                                                                                                                                                               |
| `GET /api/game-meta/:appid`                                              | Store metadata alone for one game (the panel's DLC card)                                                                                                                                                                                                                                                |
| `POST /api/game-details/stream`                                          | The same, for a list of appids, streamed over SSE                                                                                                                                                                                                                                                       |
| `GET /api/game-news/:appid`                                              | That game's own Steam announcements                                                                                                                                                                                                                                                                     |
| `GET /api/achievements/:appid`                                           | Achievement list + per-account progress                                                                                                                                                                                                                                                                 |
| `GET /api/search-games`                                                  | Store search by name                                                                                                                                                                                                                                                                                    |
| `GET /api/bundles`, `GET /api/bundles/:id`, `POST /api/bundles/resolve`  | ITAD bundle listing/lookup, ITAD gid → Steam appid                                                                                                                                                                                                                                                      |
| `POST /api/prices`                                                       | ITAD prices for a batch of gids or appids                                                                                                                                                                                                                                                               |
| `GET /api/game-bundles/:appid`                                           | ITAD: the current bundles one game is in (the side panel's Price card)                                                                                                                                                                                                                                  |
| `GET /api/health`, `GET /api/metrics`                                    | Config/liveness, and the counters in [observability.md](observability.md)                                                                                                                                                                                                                               |
| `GET /auth/steam/login`, `GET /auth/steam/callback`, `POST /auth/logout` | Steam OpenID sign-in/out (`lib/auth.js`) — see [lists-and-accounts.md](lists-and-accounts.md)                                                                                                                                                                                                           |
| `GET /api/me`                                                            | The signed-in user's steamid and every prefs key as `{ value, updatedAt }`, or `{ steamid: null, prefs: null }` signed out — always 200 (`initAuth` calls it on every page load)                                                                                                                        |
| `PUT /api/me/prefs/:key`                                                 | Writes one prefs key (`{ value, updatedAt }`), so concurrent writes to different keys can't clobber each other; a write always overwrites. 400 for a key the frontend never syncs (`isSyncedPrefKey`, `lib/auth.js`), 413 past 2 MB per account (`PREFS_MAX_BYTES`), 401 without a valid session cookie |

Every route is behind a named `express-rate-limit` instance that `skip`s requests it can answer from cache ([observability.md](observability.md), [data.md](data.md)).

## Request flow

1. Frontend POSTs `{ members: ["alice", "bob_family"] }` to `/api/common-games`: one account, or a Steam Family's member accounts, whose libraries are unioned. A comparison makes one call per player and combines them in the browser.
2. Server resolves every identifier to a Steam64 ID, deduplicates, fetches all libraries in one parallel pass, unions them, and returns `{ games, players, playtime, lastPlayed, fetchedAt }` — `playtime`/`lastPlayed` keyed by appid then by the member who owns it.
3. The frontend renders rows at once, then POSTs the appids to `POST /api/game-details/stream` (SSE) for rating, HLTB, store metadata and tags over one connection.
4. The stream route works the list through a bounded worker pool (`STREAM_CONCURRENCY`) pulling from a shared cursor, checking the client is still connected before each appid — dispatching every appid up front would make that check unreachable and let one request fill the shared semaphore queues ahead of everyone else's. It's gzipped when accepted (~5 KB per game, a fifth gzipped) and flushed per event.
