'use strict';

process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});

const express = require('express');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { getCached, getCacheStats, getCacheEntryCounts } = require('./lib/cache');
const { createDedup } = require('./lib/dedup');
const { getMetrics, recordLimiterTrip } = require('./lib/metrics');
const { resolveSteamId, getOwnedGames, getWishlist, getPlayerSummaries, getGameRating, getAppDetails, getSteamTags, getGameDemo, searchStoreGames, getProtonDbStatus, getGameSchema, getPlayerAchievements, getGlobalAchievementPercentages, getGameNews, getStoreCircuitBreaker, getSemaphoreStats } = require('./lib/steam');
const { getHLTB } = require('./lib/hltb');
const { groupByOwnership } = require('./lib/groupGames');
const { getBundles, findBundleById, resolveSteamAppIds, resolveItadIds, getSteamShopId, getPrices, extractPriceInfo } = require('./lib/itad');

const HOST = process.env.HOST;
const PORT = process.env.PORT;
const MAX_USERS = Number(process.env.MAX_USERS);
const TRUST_PROXY = process.env.TRUST_PROXY;
const SEARCH_RATE_LIMIT_MAX = Number(process.env.SEARCH_RATE_LIMIT_MAX);
const DETAILS_RATE_LIMIT_MAX = Number(process.env.DETAILS_RATE_LIMIT_MAX);
const GAME_SEARCH_RATE_LIMIT_MAX = Number(process.env.GAME_SEARCH_RATE_LIMIT_MAX);
const ACHIEVEMENTS_RATE_LIMIT_MAX = Number(process.env.ACHIEVEMENTS_RATE_LIMIT_MAX);
const STREAM_MAX_GAMES = Number(process.env.STREAM_MAX_GAMES);
const BUNDLES_RATE_LIMIT_MAX = Number(process.env.BUNDLES_RATE_LIMIT_MAX);
// Optional feature — see ITAD_API_KEY's comment in default.env. Checked once here rather than
// duplicated across every /api/bundles* route handler.
const isItadConfigured = () => !!process.env.ITAD_API_KEY;
// Shared by every /api/bundles* route that takes a `country` query param — falls back to US
// for anything that isn't a plain 2-letter code rather than rejecting the request outright,
// same "trust but sanitize" treatment as the rest of this app's query params.
const parseCountry = (req) => /^[A-Za-z]{2}$/.test(req.query.country || '') ? req.query.country.toUpperCase() : 'US';

// Rate limiting is bypassed under NODE_ENV=test so the suite isn't throttled,
// unless a test opts in with RATE_LIMIT_ENABLED=true to exercise the limiter.
const rateLimitBypassed = () =>
  process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== 'true';

const isForceRefresh = (req) => req.query.refresh === '1' || req.query.refresh === 'true';

// Wraps rateLimit() so every limiter also records when it actually rejects a request — the
// inbound counterpart to lib/metrics.js's outbound statusCounts. `handler` only runs once a
// request is actually over budget (not on every request, and not on a skip), so this is a
// direct trip count, not a coarser proxy. Centralized here rather than repeating a `handler`
// on each of the limiter definitions below. Mirrors express-rate-limit's own default handler
// (status + message) after recording the trip — see lib/metrics.js's rateLimiters.
function namedRateLimit(name, opts) {
  return rateLimit({
    ...opts,
    handler: (req, res, _next, options) => {
      recordLimiterTrip(name);
      res.status(options.statusCode);
      if (!res.writableEnded) res.send(options.message);
    },
  });
}

// Shared by every route's catch block below. Used to only log isUpstream/TimeoutError
// errors — anything else (including a genuine bug: a TypeError, a bug in groupByOwnership,
// etc.) fell through unlogged, because a plain, unmarked Error was indistinguishable from
// one of lib/steam.js's deliberately-thrown, expected client-facing errors (bad Steam id,
// private profile — see clientError() there). Those are still skipped here since they're
// normal and frequent, not worth a log line, but now that they're explicitly marked
// (isClientError), everything unmarked is logged too, on the assumption that an error
// nobody bothered to mark expected is probably a bug worth being able to find later. Logs
// the full stack, not just the message, since a bug needs its source line to be traceable.
function routeErrorStatus(route, err) {
  if (err.isClientError) return 400;
  // Circuit-open errors (lib/steam.js's fetchStoreApi, while steam-store is blocked) are an
  // expected, already-logged consequence of the trip itself — see the one-time
  // [circuit-breaker] warning logged there at the moment it actually trips. Logging one more
  // near-identical [upstream:...] line per request blocked during the 5-minute window would
  // just repeat information already on record, potentially hundreds of times over.
  if (err.isCircuitOpen) return 502;
  if (err.isUpstream) { console.error(`[upstream:${route}]`, err.stack || err.message); return 502; }
  if (err.name === 'TimeoutError') { console.error(`[timeout:${route}]`, err.stack || err.message); return 504; }
  console.error(`[bug:${route}]`, err.stack || err.message);
  return 400;
}

const app = express();
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY);
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/data-table-core', express.static(path.join(__dirname, 'node_modules/@vates/data-table-core/dist')));
app.use('/vendor/data-table-vanilla', express.static(path.join(__dirname, 'node_modules/@vates/data-table-vanilla/dist')));

// Stricter limit for searches — each uncached user triggers Steam API calls
const searchLimit = namedRateLimit('search', {
  windowMs: 60 * 1000,
  max: SEARCH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please wait a minute and try again.' },
  skip: () => rateLimitBypassed(),
});

// The details limit exists to throttle upstream Steam/HLTB calls. Cache hits make
// no upstream calls, so they must not count — otherwise a refresh of an already
// loaded comparison (all cache hits) burns the budget and 429s itself.
const detailsLimit = namedRateLimit('details', {
  windowMs: 60 * 1000,
  max: DETAILS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    if (isForceRefresh(req)) return false; // force-refresh always re-fetches, so it must always count
    const appid = Number(req.params.appid);
    if (!Number.isInteger(appid) || appid <= 0) return false;
    return getCached(`rating:${appid}`)   !== undefined
        && getCached(`hltb:${appid}`)     !== undefined
        && getCached(`meta:${appid}`)     !== undefined
        && getCached(`browse:${appid}`)   !== undefined
        && getCached(`protondb:${appid}`) !== undefined;
  },
});

// News is deliberately NOT part of fetchGameDetails/the details limiter above — unlike
// rating/HLTB/meta/tags/ProtonDB, it's never shown anywhere but the side panel (no table
// column, nothing to sort/filter on), so fetching it for every game in a whole loaded
// library/comparison via the SSE stream would mean paying for it on games whose panel is
// never opened. It's fetched lazily instead, once per game, only when that game's panel
// actually opens (see loadNews in public/panel.js) — same on-demand shape as achievements
// (achievementsLimit below), just without the per-account fan-out.
const newsLimit = namedRateLimit('news', {
  windowMs: 60 * 1000,
  max: DETAILS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    if (isForceRefresh(req)) return false;
    const appid = Number(req.params.appid);
    if (!Number.isInteger(appid) || appid <= 0) return false;
    return getCached(`news:${appid}`) !== undefined;
  },
});

// Shared by the /api/search-games route and its rate limiter below.
const normalizeSearchTerm = (raw) => (raw || '').trim().slice(0, 100).toLowerCase();

// Name→appid lookups for the "look up any game" search box. Debounced client-side, and each
// distinct search term only ever costs one upstream call (subsequent requests for the same
// term hit the cache), so this can be looser than searchLimit — it never fans out into the
// dozens of Steam calls a library search does.
const gameSearchLimit = namedRateLimit('gameSearch', {
  windowMs: 60 * 1000,
  max: GAME_SEARCH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please wait a minute and try again.' },
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    const term = normalizeSearchTerm(req.query.q);
    if (term.length < 2) return true; // no upstream call happens below this length
    return getCached(`search:${term}`) !== undefined;
  },
});

const STEAM64_RE = /^7656119\d{10}$/;

// Schema is per-appid (one call regardless of how many accounts are loaded); player progress
// is per (steamid, appid) — skip only once every one of those is already cached, same
// "cache hits don't count" rule as detailsLimit above. Unresolved (non-Steam64, e.g. vanity
// name) ids can't be cache-checked without resolving them first, so they always count.
const achievementsLimit = namedRateLimit('achievements', {
  windowMs: 60 * 1000,
  max: ACHIEVEMENTS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    if (isForceRefresh(req)) return false;
    const appid = Number(req.params.appid);
    if (!Number.isInteger(appid) || appid <= 0) return false;
    if (getCached(`schema:${appid}`) === undefined) return false;
    if (getCached(`achrarity:${appid}`) === undefined) return false;
    const ids = (req.query.steamids || '').split(',').map(s => s.trim()).filter(Boolean);
    // No steamids at all (a standalone lookup with no player loaded) only ever needed
    // schema+rarity above, both already confirmed cached — nothing left to check.
    if (!ids.length) return true;
    return ids.every(id => STEAM64_RE.test(id) && getCached(`playerach:${id}:${appid}`) !== undefined);
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: !!process.env.STEAM_API_KEY, itadConfigured: isItadConfigured(), cache: getCacheStats() });
});

// Outbound-request counts to Steam/HLTB/ITAD/ProtonDB, grouped by trust-tier/routing boundary
// then by the specific function making the call — see lib/metrics.js. Every windowed signal
// (groups, rateLimiters, dedupHits, cacheHits — all tracked there directly) nests under the
// top-level sinceRestart/lastHour buckets, not the other way around — cacheHits named
// distinctly from GET /api/health's own `cache` field, a different shape: per-group hit/miss/
// forced windowed breakdown here vs. a flat entry count there. In-memory, resets on restart; no
// auth, same trust level as /api/health (nothing sensitive in it). `circuitBreakers`/`semaphores`/
// `cacheEntries` are composed in here rather than folded into lib/metrics.js itself — none of
// them are append-only counters the way everything else here is: `circuitBreakers`/`semaphores`
// are live state owned by lib/steam.js (storeBlockedUntil, the storeLimit/tagLimit/protonLimit
// semaphores' own active/queued/rejected counts), and `cacheEntries` is a snapshot read
// straight from db.sqlite by lib/cache.js, not an in-memory counter at all.
app.get('/api/metrics', (_req, res) => {
  res.json({
    ...getMetrics(),
    circuitBreakers: { 'steam-store': getStoreCircuitBreaker() },
    semaphores: getSemaphoreStats(),
    cacheEntries: getCacheEntryCounts(),
  });
});

// Browsing the bundle list, resolving games to/from Steam appids, and pricing them — each
// distinct combination of params/ids only ever costs one upstream call (repeats hit the
// cache), same reasoning as gameSearchLimit above. Unlike gameSearchLimit's single shared
// limiter, this is 4 separate rateLimit() instances (one per route below) each with a `skip`
// tailored to that route's own cache-key shape — mirroring detailsLimit/achievementsLimit's own
// "cache hits don't count" skip, not just a shared always-counts limiter. Without this, simply
// reloading the Bundles page a handful of times (every reload re-requests the list, and
// re-opens whatever bundle is deep-linked — see the `?bundle=` section in CLAUDE.md) burns the
// whole per-minute budget on requests that never actually hit ITAD, and once burned, real
// upstream calls (a newly-opened bundle) start 429ing with no visible explanation. Named
// generically (not `bundlesRateLimitOpts`) since `pricesLimit` below also backs the Library
// Explorer's Wishlist price columns, not just the Bundles page.
const itadRateLimitOpts = {
  windowMs: 60 * 1000,
  max: BUNDLES_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
};

const bundlesListLimit = namedRateLimit('bundlesList', {
  ...itadRateLimitOpts,
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    const country = parseCountry(req);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const sort = typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : '-publish';
    const expired = req.query.expired === '1' || req.query.expired === 'true';
    // Mirrors getBundles' own cache key exactly (lib/itad.js) — `mature` is always `false` here
    // since GET /api/bundles never accepts it as a query param.
    return getCached(`itad-bundles:${country}:${sort}:${expired}:false:${offset}:${limit}`) !== undefined;
  },
});

// GET /api/bundles/:id has no single deterministic cache key of its own — findBundleById
// (lib/itad.js) walks a variable number of already-cache-checked pages depending on where (or
// whether) the id turns up, so there's no cheap way to know in advance whether a given call
// will cost zero upstream requests. It still benefits from getBundles' own per-page cache
// underneath (a repeat deep link to an already-searched bundle makes no upstream calls even
// though it still counts here) — just given a looser budget instead of a skip, since deep
// links are a comparatively rare action (once per opened bundle) next to list browsing.
const bundlesByIdLimit = namedRateLimit('bundlesById', { ...itadRateLimitOpts, max: BUNDLES_RATE_LIMIT_MAX * 2, skip: () => rateLimitBypassed() });

const bundlesResolveLimit = namedRateLimit('bundlesResolve', {
  ...itadRateLimitOpts,
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    const gids = req.body?.gids;
    if (!Array.isArray(gids) || gids.length === 0) return false; // let the route's own validation reject it
    // Mirrors resolveSteamAppIds' own per-gid cache key (lib/itad.js).
    return gids.every(gid => typeof gid === 'string' && getCached(`itad-appid:${gid}`) !== undefined);
  },
});

// Backs the one shared /api/prices route below, so its skip has to handle both shapes a
// request can take: `gids` (Bundles, already resolved) or `appids` (Wishlist, resolved
// internally by that route via resolveItadIds first). Mirrors getPrices' own per-(gid,country)
// cache key either way; the appids branch additionally checks resolveItadIds' own
// per-appid cache key, since that resolution step is this route's own internal work too.
const pricesLimit = namedRateLimit('prices', {
  ...itadRateLimitOpts,
  skip: (req) => {
    if (rateLimitBypassed()) return true;
    if (isForceRefresh(req)) return false; // force-refresh always re-fetches, so it must always count
    const { gids, appids } = req.body || {};
    const country = parseCountry(req);
    if (Array.isArray(gids) && gids.length > 0) {
      return gids.every(gid => typeof gid === 'string' && getCached(`itad-price:${country}:${gid}`) !== undefined);
    }
    if (Array.isArray(appids) && appids.length > 0) {
      return appids.every(appid => {
        if (!Number.isInteger(appid)) return false;
        const gid = getCached(`itad-gid:${appid}`);
        if (gid === undefined) return false; // resolution itself not cached yet
        if (gid === null) return true; // confirmed no ITAD listing — nothing left to price
        return getCached(`itad-price:${country}:${gid}`) !== undefined;
      });
    }
    return false; // let the route's own validation reject it
  },
});

app.post('/api/common-games', searchLimit, async (req, res) => {
  // Accept { slots: [["alice", "bob"], ["charlie"]] }
  // or legacy { users: ["alice", "charlie"] } (each user becomes a single-member slot)
  let rawSlots = req.body.slots;
  if (!rawSlots && Array.isArray(req.body.users)) {
    rawSlots = req.body.users.map(u => [u]);
  }

  if (
    !Array.isArray(rawSlots) ||
    rawSlots.length < 1 ||
    !rawSlots.every(s => Array.isArray(s) && s.length > 0 && s.every(u => typeof u === 'string' && u.trim().length > 0))
  ) {
    return res.status(400).json({ error: 'Provide at least 1 player' });
  }
  if (rawSlots.reduce((n, s) => n + s.length, 0) > MAX_USERS) {
    return res.status(400).json({ error: `Too many users — maximum is ${MAX_USERS}` });
  }

  // Explicit refresh (a user-clicked "↻ Refresh", not a normal search) bypasses the
  // library-tier cache (owned games + player summaries) so a just-bought game or a
  // changed display name shows up immediately, without waiting out the TTL.
  const refresh = req.body.refresh === true;
  // Per-account refresh (the accounts bar's own "↻" on one chip) — bypasses the cache for
  // just these already-resolved Steam64 IDs instead of every account in the search.
  const refreshIds = new Set(Array.isArray(req.body.refreshIds) ? req.body.refreshIds : []);

  try {
    // Resolve all users; deduplicate within each slot
    const resolvedSlots = await Promise.all(
      rawSlots.map(async slot => [...new Set(await Promise.all(slot.map(resolveSteamId)))])
    );

    // Fetch all unique Steam IDs in one pass
    const uniqueIds = [...new Set(resolvedSlots.flat())];
    const [playerList, libraryList] = await Promise.all([
      getPlayerSummaries(uniqueIds, { force: refresh, forceIds: refreshIds }),
      Promise.all(uniqueIds.map(id => getOwnedGames(id, { force: refresh || refreshIds.has(id) }))),
    ]);

    const libraryById = new Map(uniqueIds.map((id, i) => [id, libraryList[i]]));
    const playerById = new Map(playerList.map(p => [p.steamid, p]));

    // Union libraries within each slot, group player summaries by slot
    const slotLibraries = resolvedSlots.map(ids => {
      const merged = new Map();
      for (const id of ids) {
        for (const game of libraryById.get(id) || []) {
          if (!merged.has(game.appid)) merged.set(game.appid, game);
        }
      }
      return [...merged.values()];
    });

    // `gameCount` rides along on each player object so the frontend can show it next to an
    // account's avatar (e.g. in the Library Explorer's accounts bar) without a second request —
    // it's just the length of the per-account library already fetched above.
    const playerSlots = resolvedSlots.map(ids =>
      ids.map(id => ({
        ...(playerById.get(id) || { steamid: id, personaname: id, profileurl: '' }),
        gameCount: (libraryById.get(id) || []).length,
      }))
    );

    const groups = groupByOwnership(slotLibraries);

    // Build per-account playtime, and last-played timestamp, for common games only
    const groupAppIds = new Set(groups.flatMap(g => g.games.map(game => game.appid)));
    const playtime = {};
    const lastPlayed = {};
    for (const [steamId, games] of libraryById) {
      for (const game of games) {
        if (!groupAppIds.has(game.appid)) continue;
        if (!playtime[game.appid]) playtime[game.appid] = {};
        playtime[game.appid][steamId] = game.playtime_forever || 0;
        // Steam returns this as a Unix timestamp (seconds) directly on GetOwnedGames — no
        // extra request param needed. 0/missing means "never played" (owned but not launched).
        if (!lastPlayed[game.appid]) lastPlayed[game.appid] = {};
        lastPlayed[game.appid][steamId] = game.rtime_last_played || 0;
      }
    }

    res.json({ groups, slots: playerSlots, playtime, lastPlayed });
  } catch (err) {
    const status = routeErrorStatus('common-games', err);
    res.status(status).json({ error: err.message });
  }
});

// Wishlist has no "family" concept in Steam itself — this just unions the
// wishlists of whichever accounts the Library Explorer page has loaded,
// same as it unions their owned-game libraries.
app.post('/api/wishlist', searchLimit, async (req, res) => {
  const members = req.body.members;

  if (
    !Array.isArray(members) ||
    members.length < 1 ||
    !members.every(u => typeof u === 'string' && u.trim().length > 0)
  ) {
    return res.status(400).json({ error: 'Provide at least 1 player' });
  }
  if (members.length > MAX_USERS) {
    return res.status(400).json({ error: `Too many users — maximum is ${MAX_USERS}` });
  }

  const refresh = req.body.refresh === true;
  const refreshIds = new Set(Array.isArray(req.body.refreshIds) ? req.body.refreshIds : []);

  try {
    const ids = [...new Set(await Promise.all(members.map(resolveSteamId)))];
    const [playerList, lists] = await Promise.all([
      getPlayerSummaries(ids, { force: refresh, forceIds: refreshIds }),
      Promise.all(ids.map(id => getWishlist(id, { force: refresh || refreshIds.has(id) }))),
    ]);

    // Union across accounts — first-seen wins, same rule /api/common-games uses for libraries.
    const merged = new Map();
    for (const list of lists) {
      for (const item of list) {
        if (!merged.has(item.appid)) merged.set(item.appid, item);
      }
    }

    const items = [...merged.values()].map(item => ({
      appid: item.appid,
      priority: item.priority,
      dateAdded: item.date_added ? new Date(item.date_added * 1000).toISOString().slice(0, 10) : null,
    }));

    // Player summaries + per-account wishlist size, same shape/purpose as /api/common-games'
    // `slots` — lets the frontend show an accounts bar on the Wishlist tab too.
    const playerById = new Map(playerList.map(p => [p.steamid, p]));
    const players = ids.map((id, i) => ({
      ...(playerById.get(id) || { steamid: id, personaname: id, profileurl: '' }),
      itemCount: lists[i].length,
    }));

    res.json({ items, players });
  } catch (err) {
    const status = routeErrorStatus('wishlist', err);
    res.status(status).json({ error: err.message });
  }
});

const dedupDetails = createDedup();

function fetchGameDetails(appid, { force = false } = {}) {
  // Force-refresh gets its own dedup lane so it never joins an already in-flight
  // non-forced fetch that started before the cache was known to be bypassed.
  const dedupKey = force ? `details:force:${appid}` : `details:${appid}`;
  return dedupDetails(dedupKey, () => {
    const metaPromise = getAppDetails(appid, { force });
    // The name used to search HLTB always comes from store metadata resolved from the
    // appid itself, never from client input — this endpoint has no ownership check, so a
    // client-supplied name would just be an unverified string. This costs a little latency
    // versus searching HLTB in parallel with an already-known, trusted name (e.g. an owned
    // game's name from Steam's library API) — that's the trade for not trusting the client.
    const hltbPromise = metaPromise.then(meta => getHLTB(appid, meta?.name || '', { force }), () => null);

    return Promise.allSettled([
      getGameRating(appid, { force }),
      hltbPromise,
      metaPromise,
      getSteamTags(appid, { force }),
      // Rides on the exact same cached IStoreBrowseService item getSteamTags just fetched
      // (or is about to) — see getGameDemo/getStoreBrowseItem in lib/steam.js — so this
      // never costs an extra upstream call of its own.
      getGameDemo(appid, { force }),
      getProtonDbStatus(appid, { force }),
    ]).then(([ratingRes, hltbRes, metaRes, tagsRes, demoRes, protondbRes]) => {
      // appid is included on every line — fetchGameDetails runs once per appid, often many in
      // parallel via the SSE stream endpoint, so without it there's no way to tell a one-game
      // failure apart from every game in a batch failing the same way (e.g. an upstream block).
      // logErr also appends `.cause` when present: Node's fetch throws a generic "fetch failed"
      // TypeError for any network-level failure (DNS, connection reset, timeout, ...) and buries
      // the actual reason in `.cause` — without it every such failure looks identical and gives
      // no signal about what actually went wrong. Skips isCircuitOpen errors — same reasoning
      // as routeErrorStatus's own skip: a batch load hits this once per field per appid, so
      // without the skip a single already-logged circuit trip would print potentially hundreds
      // of near-identical lines here alone (rating + meta both go through fetchStoreApi).
      const logErr = (label, err) => {
        if (err?.isCircuitOpen) return;
        console.warn(`[game-details] ${label} (appid ${appid}):`, err?.message, err?.cause ?? '');
      };
      if (ratingRes.status   === 'rejected') logErr('rating',   ratingRes.reason);
      if (hltbRes.status     === 'rejected') logErr('hltb',     hltbRes.reason);
      if (metaRes.status     === 'rejected') logErr('meta',     metaRes.reason);
      if (tagsRes.status     === 'rejected') logErr('tags',     tagsRes.reason);
      if (demoRes.status     === 'rejected') logErr('demo',     demoRes.reason);
      if (protondbRes.status === 'rejected') logErr('protondb', protondbRes.reason);
      return {
        rating:   ratingRes.status   === 'fulfilled' ? ratingRes.value   : null,
        hltb:     hltbRes.status     === 'fulfilled' ? hltbRes.value     : null,
        meta:     metaRes.status     === 'fulfilled' ? metaRes.value     : null,
        tags:     tagsRes.status     === 'fulfilled' ? tagsRes.value     : null,
        demo:     demoRes.status     === 'fulfilled' ? demoRes.value     : null,
        protondb: protondbRes.status === 'fulfilled' ? protondbRes.value : null,
      };
    });
  });
}

// Backs the "look up any game" search box (both pages) — resolves a typed name to a short
// list of candidate appids, independent of anyone's library/wishlist. See lib/steam.js's
// searchStoreGames for the upstream endpoint and CLAUDE.md for its compliance note.
app.get('/api/search-games', gameSearchLimit, async (req, res) => {
  const term = normalizeSearchTerm(req.query.q);
  if (term.length < 2) return res.json({ results: [] });
  try {
    const results = await searchStoreGames(term, { force: isForceRefresh(req) });
    res.json({ results });
  } catch (err) {
    const status = routeErrorStatus('search-games', err);
    res.status(status).json({ error: err.message });
  }
});

// Backs the Bundles page's bundle list — a thin, cached proxy over ITAD's GET /bundles/v1.
// See lib/itad.js and CLAUDE.md for the upstream API and caching notes.
app.get('/api/bundles', bundlesListLimit, async (req, res) => {
  if (!isItadConfigured()) {
    return res.status(503).json({ error: 'IsThereAnyDeal API not configured — set ITAD_API_KEY in your .env' });
  }
  const country = parseCountry(req);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const sort = typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : '-publish';
  const expired = req.query.expired === '1' || req.query.expired === 'true';
  try {
    const bundles = await getBundles({ country, offset, limit, sort, expired });
    res.json({ bundles, offset, limit });
  } catch (err) {
    const status = routeErrorStatus('bundles', err);
    res.status(status).json({ error: err.message });
  }
});

// Backs the Bundles page's `?bundle=<id>` deep link. There's no single-bundle-fetch endpoint
// upstream (see findBundleById's own comment in lib/itad.js) — this pages through the same
// GET /bundles/v1 the list above uses, active bundles first then expired, up to a bounded
// number of pages, and 404s rather than searching indefinitely if the id never turns up (very
// old/deleted bundle, or a bad id).
app.get('/api/bundles/:id', bundlesByIdLimit, async (req, res) => {
  if (!isItadConfigured()) {
    return res.status(503).json({ error: 'IsThereAnyDeal API not configured — set ITAD_API_KEY in your .env' });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid bundle id' });
  }
  const country = parseCountry(req);
  try {
    const bundle = await findBundleById(id, { country });
    if (!bundle) {
      return res.status(404).json({ error: 'Bundle not found — it may be older than what we search, or already fully expired' });
    }
    res.json({ bundle });
  } catch (err) {
    const status = routeErrorStatus('bundles-by-id', err);
    res.status(status).json({ error: err.message });
  }
});

// Resolves a bundle's ITAD game ids (uuids, off tiers[].games[].id) to their Steam appid, so
// the Bundles page can feed the resolved subset into the same GET /api/game-details/:appid /
// POST /api/game-details/stream pipeline every other page already uses. Returns null for a
// gid with no Steam listing — the frontend renders those as the separate "not on Steam" list.
const MAX_BUNDLE_RESOLVE_GAMES = 500;
app.post('/api/bundles/resolve', bundlesResolveLimit, async (req, res) => {
  if (!isItadConfigured()) {
    return res.status(503).json({ error: 'IsThereAnyDeal API not configured — set ITAD_API_KEY in your .env' });
  }
  const gids = req.body.gids;
  if (!Array.isArray(gids) || gids.length === 0 || !gids.every(g => typeof g === 'string' && g)) {
    return res.status(400).json({ error: 'Provide at least one game id' });
  }
  if (gids.length > MAX_BUNDLE_RESOLVE_GAMES) {
    return res.status(400).json({ error: `Too many games — maximum is ${MAX_BUNDLE_RESOLVE_GAMES}` });
  }
  try {
    const resolved = await resolveSteamAppIds([...new Set(gids)]);
    res.json({ appids: Object.fromEntries(resolved) });
  } catch (err) {
    const status = routeErrorStatus('bundles-resolve', err);
    res.status(status).json({ error: err.message });
  }
});

// Steam's non-discounted regular price plus historical lows (all-time/1yr/3mo) and the current
// best deal across every shop ITAD tracks — one shared route for both callers that need this,
// since the actual pricing operation is identical either way and only the identifier space the
// caller already has differs:
//   - Bundles already has ITAD gids (off a bundle's own tiers[].games[].id) — pass `gids`.
//   - The Library Explorer's Wishlist tab only has Steam appids — pass `appids`; they're
//     resolved to gids internally first (resolveItadIds, the reverse of resolveSteamAppIds
//     above) before the identical price lookup runs. That reverse resolution isn't exposed as
//     its own route the way /api/bundles/resolve's gid→appid mapping is — nothing needs the raw
//     gid itself, unlike Bundles' own "which of these games have no Steam listing at all" list.
// A separate route from /api/bundles/resolve since it needs `country` (prices are region-
// specific; appid resolution isn't) and isn't always wanted (e.g. before a bundle's games have
// even resolved to Steam). See lib/itad.js's resolveItadIds/getPrices/extractPriceInfo.
const MAX_PRICE_LOOKUP_GAMES = 500;
app.post('/api/prices', pricesLimit, async (req, res) => {
  if (!isItadConfigured()) {
    return res.status(503).json({ error: 'IsThereAnyDeal API not configured — set ITAD_API_KEY in your .env' });
  }
  const { gids, appids } = req.body;
  const byGid = Array.isArray(gids) && gids.length > 0;
  const byAppid = Array.isArray(appids) && appids.length > 0;
  if (byGid === byAppid) { // neither, or both — exactly one is required
    return res.status(400).json({ error: 'Provide exactly one of gids or appids' });
  }
  if (byGid && !gids.every(g => typeof g === 'string' && g)) {
    return res.status(400).json({ error: 'gids must be non-empty strings' });
  }
  if (byAppid && !appids.every(a => Number.isInteger(a) && a > 0)) {
    return res.status(400).json({ error: 'appids must be positive integers' });
  }
  if ((byGid ? gids : appids).length > MAX_PRICE_LOOKUP_GAMES) {
    return res.status(400).json({ error: `Too many games — maximum is ${MAX_PRICE_LOOKUP_GAMES}` });
  }
  const country = parseCountry(req);
  // ?refresh=1 backs the page-level "↻ Refresh prices" button (bundles.js/library.js) — force
  // only the price lookup itself, not the appid↔gid resolution above: that's an identity
  // mapping, not price data, and near-permanent in practice (same reasoning as the panel's own
  // ↻ Refresh never touching `resolve:` — see the "Refresh" section in CLAUDE.md), so refreshing
  // it on every price refresh would just be an extra upstream call for nothing.
  const force = isForceRefresh(req);
  try {
    // Map(requested key → gid|null) — an identity map when the caller already sent gids, so
    // the response-shaping loop below doesn't need two separate code paths.
    const gidByKey = byAppid
      ? await resolveItadIds([...new Set(appids)])
      : new Map(gids.map(g => [g, g]));
    const gidsToPrice = [...new Set([...gidByKey.values()].filter(Boolean))];
    const [shopId, prices] = await Promise.all([
      getSteamShopId(),
      getPrices(gidsToPrice, { country, force }),
    ]);
    const out = {};
    for (const [key, gid] of gidByKey) out[key] = extractPriceInfo(gid ? prices.get(gid) : null, shopId);
    res.json({ prices: out });
  } catch (err) {
    const status = routeErrorStatus('prices', err);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/game-details/:appid', detailsLimit, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'Invalid appid' });
  }
  res.json(await fetchGameDetails(appid, { force: isForceRefresh(req) }));
});

// Recent news/announcements for one game — see newsLimit above for why this is its own
// route rather than folded into fetchGameDetails/the SSE stream. Fetched by the side panel
// (public/panel.js's loadNews) once per game, only when that game's panel actually opens.
app.get('/api/game-news/:appid', newsLimit, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'Invalid appid' });
  }
  try {
    const news = await getGameNews(appid, { force: isForceRefresh(req) });
    res.json({ news });
  } catch (err) {
    const status = routeErrorStatus('game-news', err);
    res.status(status).json({ error: err.message });
  }
});

// Backs the Library Explorer side panel's "Achievements" section — schema (names/icons,
// shared regardless of who's asking) plus per-account unlock state for every account
// currently loaded (`steamids`, comma-separated; raw identifiers, resolved here same as
// everywhere else — never trusted as already-Steam64 even though the client always does
// send resolved ids in practice). Accounts within a slot are unioned the same way
// /api/common-games unions owned games: an achievement counts as unlocked for the group if
// any member has it, keeping the earliest unlock time among those that do.
app.get('/api/achievements/:appid', achievementsLimit, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'Invalid appid' });
  }
  // Player progress (steamids) is optional — the achievement *list* (names, descriptions,
  // icons, community-wide rarity) is store metadata, not tied to any account, so it's still
  // useful with nobody loaded (e.g. a standalone "look up any game" lookup). Only the
  // achieved/unlocktime state per item depends on steamids being present; see `playerCount`
  // in the response below, which the frontend uses to distinguish "no player was asked about"
  // from "a player was asked about but their data is unavailable" (private:true).
  const rawIds = (req.query.steamids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (rawIds.length > MAX_USERS) {
    return res.status(400).json({ error: `Too many users — maximum is ${MAX_USERS}` });
  }

  const force = isForceRefresh(req);
  try {
    const steamIds = [...new Set(await Promise.all(rawIds.map(resolveSteamId)))];

    // Cheap short-circuit: appdetails (already fetched/cached for this game via
    // fetchGameDetails, well before any panel opens) already tells us — for free — whether
    // this game has achievements at all. Skip GetSchemaForGame/GetGlobalAchievementPercentages/
    // one GetPlayerAchievements per account entirely for a confirmed zero, since the only
    // possible result below is the same empty response. `force: false` — this is just an
    // opportunistic cache read; refreshing achievements shouldn't force a redundant appdetails
    // re-fetch. Any failure here (upstream down, never cached) is tolerated — it only costs
    // the optimization, never breaks the route — by falling through to the schema fetch below.
    const meta = await getAppDetails(appid, { force: false }).catch(() => null);
    if (meta && meta.achievementCount === 0) {
      return res.json({ achievements: [], total: 0, unlocked: 0, private: false, playerCount: steamIds.length });
    }

    // Sequenced rather than batched with the calls below: even when appdetails didn't confirm
    // zero (meta missing/failed, or achievementCount unknown), don't fire rarity/per-player
    // calls until schema itself confirms there's something to annotate.
    const schema = await getGameSchema(appid, { force });
    if (!schema || schema.length === 0) {
      return res.json({ achievements: [], total: 0, unlocked: 0, private: false, playerCount: steamIds.length });
    }

    const [rarity, ...perPlayer] = await Promise.all([
      // Rarity is a nice-to-have annotation, not core progress data — a transient upstream
      // failure here shouldn't take down the whole achievements panel the way a genuine
      // schema/player-achievements failure does, so it degrades to "no rarity data" instead
      // of rejecting the whole Promise.all.
      getGlobalAchievementPercentages(appid, { force }).catch(() => null),
      ...steamIds.map(id => getPlayerAchievements(id, appid, { force })),
    ]);

    // null means "no data for this account" (private profile, or never touched this game's
    // stats) — distinguished here from "resolved, but genuinely 0 achieved" so the frontend
    // can tell "nobody has unlocked anything (yet)" apart from "can't tell, profile's private".
    const anyPlayerData = perPlayer.some(p => p !== null);
    const unlockedAt = new Map(); // apiname -> earliest unlocktime across members who have it
    for (const list of perPlayer) {
      if (!list) continue;
      for (const a of list) {
        if (!a.achieved) continue;
        const prev = unlockedAt.get(a.apiname);
        if (prev === undefined || (a.unlocktime && a.unlocktime < prev)) unlockedAt.set(a.apiname, a.unlocktime || 0);
      }
    }

    const achievements = schema.map(a => ({
      ...a,
      achieved: unlockedAt.has(a.apiname),
      unlocktime: unlockedAt.get(a.apiname) ?? null,
      // Community-wide unlock % (rarity) — absent rather than 0 when Steam has no rarity
      // data at all for this apiname, so the frontend can tell "genuinely unrated" apart
      // from "rounds to 0%".
      globalPct: rarity?.[a.apiname] ?? null,
    }));

    res.json({
      achievements,
      total: achievements.length,
      unlocked: unlockedAt.size,
      // `private:true` when steamIds were given but yielded no usable data (private profile,
      // or nobody in the group has touched this game's stats) — never true when steamIds was
      // empty in the first place, that's what `playerCount` is for instead (see comment above).
      private: steamIds.length > 0 && !anyPlayerData,
      playerCount: steamIds.length,
      // Steam's public, non-player-specific achievements page for this game (works with no
      // login, no steamid needed) — not the same as a specific account's own achievements
      // page (which would need a steamid and, for a merged Family slot, picking one member
      // arbitrarily over the others), so this is the one link that's always correct
      // regardless of who — if anyone — is currently loaded.
      steamUrl: `https://steamcommunity.com/stats/${appid}/achievements/`,
    });
  } catch (err) {
    const status = routeErrorStatus('achievements', err);
    res.status(status).json({ error: err.message });
  }
});

// This does the exact same per-appid work (rating/HLTB/meta/tags/ProtonDB) as
// GET /api/game-details/:appid above and is meant to be throttled by the same budget — it's
// just delivered as one SSE batch instead of N separate requests — so it shares detailsLimit
// rather than going unthrottled. Its skip() keys off req.params.appid, which doesn't exist on
// this array-bodied route, so every stream request counts fully against the budget (no
// cache-hit exemption here, unlike the single-appid route); that's the safe direction to be
// wrong in. STREAM_MAX_GAMES also caps how much work one request can queue up regardless of
// how many requests/minute the budget above allows.
app.post('/api/game-details/stream', detailsLimit, async (req, res) => {
  const { games: gameList } = req.body;
  if (!Array.isArray(gameList) || gameList.length === 0) {
    return res.status(400).json({ error: 'Provide at least one game' });
  }
  if (gameList.length > STREAM_MAX_GAMES) {
    return res.status(400).json({ error: `Too many games — maximum is ${STREAM_MAX_GAMES}` });
  }

  const validated = [];
  for (const g of gameList) {
    const appid = Number(g.appid);
    if (!Number.isInteger(appid) || appid <= 0) {
      return res.status(400).json({ error: 'Invalid appid' });
    }
    validated.push(appid);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  const send = (data) => {
    if (!closed && !res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  await Promise.allSettled(validated.map(async appid => {
    if (closed) return;
    try {
      const result = await fetchGameDetails(appid);
      send({ appid, ...result });
    } catch (err) {
      // fetchGameDetails resolves every sub-fetch via Promise.allSettled internally and should
      // never itself reject — this is a defensive backstop, not an expected path, so unlike
      // the per-field failures it already logs (see logErr above) this used to vanish with
      // no trace at all if it ever did fire.
      console.error(`[bug:stream]`, `appid ${appid}:`, err.stack || err.message);
      send({ appid, rating: null, hltb: null, meta: null, tags: null, demo: null, protondb: null });
    }
  }));

  send({ done: true });
  if (!res.writableEnded) res.end();
});

if (require.main === module) {
  if (!process.env.STEAM_API_KEY) {
    console.error('Error: STEAM_API_KEY is not set.');
    console.error('Add it to your .env file: STEAM_API_KEY=yourkey');
    console.error('Get a key at: https://steamcommunity.com/dev/apikey');
    process.exit(1);
  }
  app.listen(PORT, HOST, () => {
    console.log(`\nSteam Common Games → http://${HOST}:${PORT}\n`);
  });
}

module.exports = { app };
