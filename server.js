'use strict';

require('dotenv').config();

process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});

const express = require('express');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { getCached, getCacheStats } = require('./lib/cache');
const { createDedup } = require('./lib/dedup');
const { resolveSteamId, getOwnedGames, getPlayerSummaries, getGameRating, getAppDetails, getSteamSpyTags } = require('./lib/steam');
const { getHLTB } = require('./lib/hltb');
const { groupByOwnership } = require('./lib/groupGames');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;
const MAX_USERS = Number(process.env.MAX_USERS || 10);
const TRUST_PROXY = process.env.TRUST_PROXY;
const SEARCH_RATE_LIMIT_MAX = Number(process.env.SEARCH_RATE_LIMIT_MAX || 10);
const DETAILS_RATE_LIMIT_MAX = Number(process.env.DETAILS_RATE_LIMIT_MAX || 300);

// Rate limiting is bypassed under NODE_ENV=test so the suite isn't throttled,
// unless a test opts in with RATE_LIMIT_ENABLED=true to exercise the limiter.
const rateLimitBypassed = () =>
  process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== 'true';

const app = express();
if (TRUST_PROXY !== undefined) app.set('trust proxy', TRUST_PROXY);
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    const appid = Number(req.params.appid);
    if (!Number.isInteger(appid) || appid <= 0) return false;
    return getCached(`rating:${appid}`) !== undefined
        && getCached(`hltb:${appid}`)   !== undefined
        && getCached(`meta:${appid}`)   !== undefined
        && getCached(`tags:${appid}`)   !== undefined;
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: !!process.env.STEAM_API_KEY, cache: getCacheStats() });
});

app.post('/api/common-games', searchLimit, async (req, res) => {
  if (!process.env.STEAM_API_KEY) {
    return res.status(503).json({
      error: 'STEAM_API_KEY is not configured. Restart: STEAM_API_KEY=yourkey node server.js',
    });
  }

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

  try {
    // Resolve all users; deduplicate within each slot
    const resolvedSlots = await Promise.all(
      rawSlots.map(async slot => [...new Set(await Promise.all(slot.map(resolveSteamId)))])
    );

    // Fetch all unique Steam IDs in one pass
    const uniqueIds = [...new Set(resolvedSlots.flat())];
    const [playerList, libraryList] = await Promise.all([
      getPlayerSummaries(uniqueIds),
      Promise.all(uniqueIds.map(getOwnedGames)),
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

    const playerSlots = resolvedSlots.map(ids =>
      ids.map(id => playerById.get(id) || { steamid: id, personaname: id, profileurl: '' })
    );

    const groups = groupByOwnership(slotLibraries);

    // Build per-account playtime for common games only
    const groupAppIds = new Set(groups.flatMap(g => g.games.map(game => game.appid)));
    const playtime = {};
    for (const [steamId, games] of libraryById) {
      for (const game of games) {
        if (!groupAppIds.has(game.appid)) continue;
        if (!playtime[game.appid]) playtime[game.appid] = {};
        playtime[game.appid][steamId] = game.playtime_forever || 0;
      }
    }

    res.json({ groups, slots: playerSlots, playtime });
  } catch (err) {
    if (err.isUpstream || err.name === 'TimeoutError') console.error('[upstream]', err.message);
    const status = err.isUpstream ? 502 : err.name === 'TimeoutError' ? 504 : 400;
    res.status(status).json({ error: err.message });
  }
});

const dedupDetails = createDedup();

function fetchGameDetails(appid, name) {
  return dedupDetails(`details:${appid}`, () =>
    Promise.allSettled([
      getGameRating(appid),
      getHLTB(appid, name),
      getAppDetails(appid),
      getSteamSpyTags(appid),
    ]).then(([ratingRes, hltbRes, metaRes, tagsRes]) => {
      if (ratingRes.status === 'rejected') console.warn('[game-details] rating:', ratingRes.reason?.message);
      if (hltbRes.status   === 'rejected') console.warn('[game-details] hltb:',   hltbRes.reason?.message);
      if (metaRes.status   === 'rejected') console.warn('[game-details] meta:',   metaRes.reason?.message);
      if (tagsRes.status   === 'rejected') console.warn('[game-details] tags:',   tagsRes.reason?.message);
      return {
        rating: ratingRes.status === 'fulfilled' ? ratingRes.value : null,
        hltb:   hltbRes.status   === 'fulfilled' ? hltbRes.value   : null,
        meta:   metaRes.status   === 'fulfilled' ? metaRes.value   : null,
        tags:   tagsRes.status   === 'fulfilled' ? tagsRes.value   : null,
      };
    })
  );
}

app.get('/api/game-details/:appid', detailsLimit, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    return res.status(400).json({ error: 'Invalid appid' });
  }
  const name = (req.query.name || '').trim().slice(0, 200);
  res.json(await fetchGameDetails(appid, name));
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
    validated.push({ appid, name: String(g.name || '').trim().slice(0, 200) });
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

  await Promise.allSettled(validated.map(async ({ appid, name }) => {
    if (closed) return;
    try {
      const result = await fetchGameDetails(appid, name);
      send({ appid, ...result });
    } catch {
      send({ appid, rating: null, hltb: null, meta: null, tags: null });
    }
  }));

  send({ done: true });
  if (!res.writableEnded) res.end();
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\nSteam Common Games → http://${HOST}:${PORT}\n`);
    if (!process.env.STEAM_API_KEY) {
      console.warn('  ⚠  STEAM_API_KEY is not set!');
      console.warn('  Get your key: https://steamcommunity.com/dev/apikey');
      console.warn('  Then run: STEAM_API_KEY=yourkey node server.js\n');
    }
  });
}

module.exports = { app };
