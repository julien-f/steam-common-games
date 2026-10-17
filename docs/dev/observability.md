# Observability

Outbound-request metrics, budgets, and the warnings the app logs on its own. Cache tiers: [data.md](data.md); upstream trust tiers: [integrations.md](integrations.md).

## GET /api/metrics

No auth, same trust level as `GET /api/health`. In memory, reset on restart (except `cacheEntries`); no history beyond the trailing hour.

```
{ since,
  sinceRestart: { groups:       { [group]: { [label]: { requests, statusCounts, networkErrors, avgLatencyMs, maxLatencyMs } } },
                  rateLimiters: { [name]: count },
                  dedupHits:    { [name]: count },
                  cacheHits:    { [group]: { hits, misses, forced } } },
  lastHour:     { …same shape as sinceRestart… },
  budgets:         { [group]: { hourUsed, hourMax, dayUsed, dayMax } },
  circuitBreakers: { 'steam-store' | hltb | protondb: { blockedUntil, tripCount, consecutive403s } },
  semaphores:      { store | tag | proton | hltb | 'itad-info': { active, queued, maxQueueSeen, rejected } },
  cacheEntries:    { [group]: count } }
```

- **Windows**: every windowed signal nests under `sinceRestart`/`lastHour`, always the outermost keys; nothing nests a window of its own. Live snapshots (`budgets`, `circuitBreakers`, `semaphores`, `cacheEntries`) sit outside both. A name with no events yet is absent rather than zeroed.

### Outbound — `groups`

- Every outbound call goes through `trackedFetch` (`lib/metrics.js`), a drop-in for `fetch`. Modules reach it only through `createTrackedFetch(group)`, bound once per group at load; it returns `(label, url, opts)` and registers the group, which is how `budgets` lists it from startup.
- `group` is the service or routing boundary: `steam-store` (`fetchStoreApi`/`storeLimit`), `steam-browse` (`tagLimit`), `steam-api` (the keyed `api.steampowered.com` calls), `steam-openid`, `protondb`, `hltb`, `itad`, `fanatical`. `label` is the calling function, so one operation stalling shows apart from its siblings.
- `statusCounts` is a `{ [status]: count }` map, deliberately not one "errors" count: several non-2xx answers are expected outcomes (403 = private profile or no stats on achievements, 404 = no ProtonDB reports; see [integrations.md](integrations.md)). Read it against what's expected for that label.
- `networkErrors`: `fetch()` itself threw (timeout, DNS, abort); never an expected outcome.
- `avgLatencyMs`/`maxLatencyMs` cover every outcome, so an upstream slowing down before it errors shows here first.

### Inbound — `rateLimiters`

- Trips (requests rejected) per `express-rate-limit` instance in `server.js`, recorded by the shared `namedRateLimit` wrapper: `search`, `friends`, `details`, `meta`, `news`, `gameSearch`, `creatorGames`, `achievements`, `bundlesList`, `bundlesById`, `bundlesResolve`, `prices`, `gameBundles`, `auth`. Plus `stream`: details streams refused by `STREAM_MAX_PER_IP`.
- Only trips count, not requests a limiter saw or skipped as cached.

### `dedupHits`, `cacheHits`, `cacheEntries`

- `dedupHits`: concurrent calls `createDedup(name)` (`lib/dedup.js`) coalesced into one in flight — `steam`, `itad`, `fanatical`. A burst points at a retry loop or a polling client.
- `cacheHits`: `getCached()` outcomes per `lib/cache.js` `GROUPS` label (`library`, `resolve`, `rating`, `meta`, `search`, `news`, `bundles`, `itad-ids`). `forced` (a user's ↻) is kept apart from `misses`. A rate limiter's cache check doesn't record, so each request counts once. Tells "traffic grew" apart from "the cache stopped working" when outbound counts jump.
- `cacheEntries`: row count per group, read from `db.sqlite` (survives restarts, lists every group). With `cacheHits`: few entries plus many misses means a TTL too short; many entries plus many misses, a key space the cache can't help.

### Live snapshots

- `circuitBreakers` (`lib/circuitBreaker.js`; Steam store, HLTB search, ProtonDB): `blockedUntil` (0 = closed), `tripCount` (lifetime, tells "once long ago" from "every 20 minutes"), `consecutive403s` (one more trips it).
- `semaphores` (`lib/upstream.js` `getSemaphoreStats`, one per `createSemaphore`): `active`/`queued` now, `maxQueueSeen` (lifetime high-water mark), `rejected` (calls turned away by the `SEMAPHORE_MAX_QUEUE` valve; should stay 0). High latency with low `queued` = slow upstream; high `queued` = our own concurrency cap.
- `budgets`: current usage per outbound `group`, every one listed from startup (0 used) so the ceilings show before anything spends against them; see below.

## Outbound budgets

- `chargeBudget(group)` runs at the top of `trackedFetch` and caps calls per service per hour and per day (`OUTBOUND_HOURLY_MAX`/`OUTBOUND_DAILY_MAX`, see [configuration.md](../user/configuration.md); `0` disables).
- The only limit that isn't per client: it protects a key's quota from all clients together, and from the app's own retry loops.
- Past a ceiling it throws an `isUpstream` error, so routes answer 502 with no new error path. Refused calls aren't counted as requests.
- Fixed windows, not sliding: it runs on every call and stays O(1). A window starts at the group's first call once the previous one has ended; reading `budgets` never starts one.

## Log warnings

Logged at the moment they happen, once per event rather than once per affected request:

- **`[circuit-breaker] <name> tripped …`** — once per trip, with the time it's blocked until.
- **`[budget:<group>] hourly/daily outbound budget exhausted …`** — once per window per service, with the time the window rolls over.
- **`[semaphore:<name>] queue saturated …`** — every rejection, unthrottled: it should never fire, so each one matters.
- **`[HLTB] search failed …`** — throttled to one per `HLTB_SEARCH_WARN_THROTTLE_MS` (30 s); the searches themselves still run and fail normally. `[HLTB] init failed` is throttled by the auth retry backoff.

All are `console.warn`: degraded but recoverable. An error marked `isCircuitOpen` (thrown by `assertClosed` while a breaker is open) or `isBudgetExhausted` (thrown by `chargeBudget` past a budget) is not logged again by `routeErrorStatus` or `fetchGameDetails`, since the trip or the exhaustion already warned; without that, one open breaker or spent budget logs a line per game in a large load.

Deliberately not done:

- Log warnings for cache hit-rate collapse or latency trends: no single event to hang them on; read `GET /api/metrics` instead.
- Several time windows (5 min, day, week): one hour answers "is it happening now", `sinceRestart` the rest.
- A per-group total under `groups`: sum the labels client-side.
