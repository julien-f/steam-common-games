'use strict';

process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});

const express = require('express');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { getCached, getCacheStats } = require('./lib/cache');
const { createDedup } = require('./lib/dedup');
const { resolveSteamId, getOwnedGames, getWishlist, getPlayerSummaries, getGameRating, getAppDetails, getSteamSpyTags, searchStoreGames, getProtonDbStatus } = require('./lib/steam');
const { getHLTB } = require('./lib/hltb');
const { groupByOwnership } = require('./lib/groupGames');

const HOST = process.env.HOST;
const PORT = process.env.PORT;
const MAX_USERS = Number(process.env.MAX_USERS);
const TRUST_PROXY = process.env.TRUST_PROXY;
const SEARCH_RATE_LIMIT_MAX = Number(process.env.SEARCH_RATE_LIMIT_MAX);
const DETAILS_RATE_LIMIT_MAX = Number(process.env.DETAILS_RATE_LIMIT_MAX);
const GAME_SEARCH_RATE_LIMIT_MAX = Number(process.env.GAME_SEARCH_RATE_LIMIT_MAX);

// Rate limiting is bypassed under NODE_ENV=test so the suite isn't throttled,
// unless a test opts in with RATE_LIMIT_ENABLED=true to exercise the limiter.
const rateLimitBypassed = () =>
  process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== 'true';

const isForceRefresh = (req) => req.query.refresh === '1' || req.query.refresh === 'true';

const app = express();
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY);
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/data-table-core', express.static(path.join(__dirname, 'node_modules/@vates/data-table-core/dist')));
app.use('/vendor/data-table-vanilla', express.static(path.join(__dirname, 'node_modules/@vates/data-table-vanilla/dist')));

// Stricter limit for searches — each uncached user triggers Steam API calls
const searchLimit = rateLimit({
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
const detailsLimit = rateLimit({
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
        && getCached(`tags:${appid}`)     !== undefined
        && getCached(`protondb:${appid}`) !== undefined;
  },
});

// Shared by the /api/search-games route and its rate limiter below.
const normalizeSearchTerm = (raw) => (raw || '').trim().slice(0, 100).toLowerCase();

// Name→appid lookups for the "look up any game" search box. Debounced client-side, and each
// distinct search term only ever costs one upstream call (subsequent requests for the same
// term hit the cache), so this can be looser than searchLimit — it never fans out into the
// dozens of Steam calls a library search does.
const gameSearchLimit = rateLimit({
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: !!process.env.STEAM_API_KEY, cache: getCacheStats() });
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
    if (err.isUpstream || err.name === 'TimeoutError') console.error('[upstream]', err.message);
    const status = err.isUpstream ? 502 : err.name === 'TimeoutError' ? 504 : 400;
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
    if (err.isUpstream || err.name === 'TimeoutError') console.error('[upstream]', err.message);
    const status = err.isUpstream ? 502 : err.name === 'TimeoutError' ? 504 : 400;
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
      getSteamSpyTags(appid, { force }),
      getProtonDbStatus(appid, { force }),
    ]).then(([ratingRes, hltbRes, metaRes, tagsRes, protondbRes]) => {
      // appid is included on every line — fetchGameDetails runs once per appid, often many in
      // parallel via the SSE stream endpoint, so without it there's no way to tell a one-game
      // failure apart from every game in a batch failing the same way (e.g. an upstream block).
      // logErr also appends `.cause` when present: Node's fetch throws a generic "fetch failed"
      // TypeError for any network-level failure (DNS, connection reset, timeout, ...) and buries
      // the actual reason in `.cause` — without it every such failure looks identical and gives
      // no signal about what actually went wrong.
      const logErr = (label, err) => console.warn(`[game-details] ${label} (appid ${appid}):`, err?.message, err?.cause ?? '');
      if (ratingRes.status   === 'rejected') logErr('rating',   ratingRes.reason);
      if (hltbRes.status     === 'rejected') logErr('hltb',     hltbRes.reason);
      if (metaRes.status     === 'rejected') logErr('meta',     metaRes.reason);
      if (tagsRes.status     === 'rejected') logErr('tags',     tagsRes.reason);
      if (protondbRes.status === 'rejected') logErr('protondb', protondbRes.reason);
      return {
        rating:   ratingRes.status   === 'fulfilled' ? ratingRes.value   : null,
        hltb:     hltbRes.status     === 'fulfilled' ? hltbRes.value     : null,
        meta:     metaRes.status     === 'fulfilled' ? metaRes.value     : null,
        tags:     tagsRes.status     === 'fulfilled' ? tagsRes.value     : null,
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
    if (err.isUpstream || err.name === 'TimeoutError') console.error('[upstream]', err.message);
    const status = err.isUpstream ? 502 : err.name === 'TimeoutError' ? 504 : 400;
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

app.post('/api/game-details/stream', async (req, res) => {
  const { games: gameList } = req.body;
  if (!Array.isArray(gameList) || gameList.length === 0) {
    return res.status(400).json({ error: 'Provide at least one game' });
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
    } catch {
      send({ appid, rating: null, hltb: null, meta: null, tags: null, protondb: null });
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
